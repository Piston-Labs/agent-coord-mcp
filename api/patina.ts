import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const PATINA_SITES_KEY = 'patina:sites';
const PATINA_SITES_BY_CATEGORY = 'patina:sites:category';
const PATINA_SUBMISSIONS_KEY = 'patina:submissions';

interface PatinaSite {
  id: string;
  url: string;
  domain: string;
  title?: string;
  description?: string;

  // LLM evaluation
  confidence: number;
  era: '1990-1995' | '1995-2000' | '2000-2005' | '2005-2010' | '2010-2015' | 'timeless';
  category: 'folklore' | 'personal' | 'forum' | 'archive' | 'tool' | 'art' | 'academic' | 'other';
  vibe: string;
  why: string;

  // Metadata
  submittedBy?: string;
  submittedAt: string;
  vouchCount: number;
  featured?: boolean;
}

interface PatinaSubmission {
  id: string;
  url: string;
  reason?: string;
  submittedBy?: string;
  submittedAt: string;
  status: 'pending' | 'evaluating' | 'approved' | 'rejected';
  evaluation?: {
    include: boolean;
    confidence: number;
    era: string;
    category: string;
    vibe: string;
    why: string;
  };
}

function generateId(): string {
  return `patina-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function searchScore(site: PatinaSite, query: string): number {
  const q = query.toLowerCase();
  const fields = [
    site.title || '',
    site.description || '',
    site.vibe || '',
    site.why || '',
    site.domain || '',
    site.category || ''
  ].map(f => f.toLowerCase());

  let score = 0;
  for (const field of fields) {
    if (field.includes(q)) score += 10;
    const words = q.split(/\s+/);
    for (const word of words) {
      if (field.includes(word)) score += 2;
    }
  }

  // Boost by confidence
  score += site.confidence / 20;

  // Boost by vouches
  score += site.vouchCount * 2;

  return score;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = (req.query.action as string) || (req.body?.action as string);

  try {
    switch (action) {
      // Search the index
      case 'search': {
        const query = (req.query.query as string) || (req.body?.query as string);
        const category = (req.query.category as string) || (req.body?.category as string);
        const limit = parseInt((req.query.limit as string) || '20');

        if (!query && !category) {
          return res.status(400).json({ error: 'Query or category required' });
        }

        // Get all sites
        const allSites = await redis.hgetall(PATINA_SITES_KEY) as Record<string, PatinaSite> || {};
        let sites = Object.values(allSites);

        // Filter by category if specified
        if (category) {
          sites = sites.filter(s => s.category === category);
        }

        // Search and score
        if (query) {
          sites = sites
            .map(s => ({ site: s, score: searchScore(s, query) }))
            .filter(r => r.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(r => r.site);
        } else {
          sites = sites.slice(0, limit);
        }

        return res.json({
          query,
          category,
          count: sites.length,
          sites
        });
      }

      // Random site (wander)
      case 'wander': {
        const category = (req.query.category as string) || (req.body?.category as string);

        const allSites = await redis.hgetall(PATINA_SITES_KEY) as Record<string, PatinaSite> || {};
        let sites = Object.values(allSites);

        if (category) {
          sites = sites.filter(s => s.category === category);
        }

        if (sites.length === 0) {
          return res.json({ site: null, message: 'No sites in index yet' });
        }

        const randomSite = sites[Math.floor(Math.random() * sites.length)];
        return res.json({ site: randomSite });
      }

      // Browse by category
      case 'browse': {
        const category = (req.query.category as string) || (req.body?.category as string);

        const allSites = await redis.hgetall(PATINA_SITES_KEY) as Record<string, PatinaSite> || {};
        let sites = Object.values(allSites);

        if (category) {
          sites = sites.filter(s => s.category === category);
        }

        // Group by category
        const byCategory: Record<string, PatinaSite[]> = {};
        for (const site of sites) {
          if (!byCategory[site.category]) byCategory[site.category] = [];
          byCategory[site.category].push(site);
        }

        return res.json({
          totalSites: sites.length,
          categories: Object.keys(byCategory).map(cat => ({
            name: cat,
            count: byCategory[cat].length,
            sites: category ? byCategory[cat] : byCategory[cat].slice(0, 5)
          }))
        });
      }

      // Submit a site for evaluation
      case 'submit': {
        const url = (req.body?.url as string);
        const reason = (req.body?.reason as string);
        const submittedBy = (req.body?.agentId as string) || (req.body?.submittedBy as string);

        if (!url) {
          return res.status(400).json({ error: 'URL required' });
        }

        // Check if already in index
        const allSites = await redis.hgetall(PATINA_SITES_KEY) as Record<string, PatinaSite> || {};
        const existing = Object.values(allSites).find(s => s.url === url || s.domain === extractDomain(url));
        if (existing) {
          return res.json({
            alreadyExists: true,
            site: existing,
            message: 'This site is already in the Patina index'
          });
        }

        const submission: PatinaSubmission = {
          id: generateId(),
          url,
          reason,
          submittedBy,
          submittedAt: new Date().toISOString(),
          status: 'pending'
        };

        await redis.hset(PATINA_SUBMISSIONS_KEY, { [submission.id]: submission });

        return res.json({
          submitted: true,
          submission,
          message: 'Site submitted for evaluation. Check back later for results.'
        });
      }

      // Add a site directly (for pipeline/admin)
      case 'add': {
        const site: Partial<PatinaSite> = req.body?.site || req.body;

        if (!site.url) {
          return res.status(400).json({ error: 'Site URL required' });
        }

        const fullSite: PatinaSite = {
          id: site.id || generateId(),
          url: site.url,
          domain: site.domain || extractDomain(site.url),
          title: site.title,
          description: site.description,
          confidence: site.confidence || 80,
          era: site.era || 'timeless',
          category: site.category || 'other',
          vibe: site.vibe || '',
          why: site.why || '',
          submittedBy: site.submittedBy,
          submittedAt: site.submittedAt || new Date().toISOString(),
          vouchCount: site.vouchCount || 0,
          featured: site.featured
        };

        await redis.hset(PATINA_SITES_KEY, { [fullSite.id]: fullSite });

        return res.json({ added: true, site: fullSite });
      }

      // Bulk add sites (for seeding)
      case 'seed': {
        const sites: Partial<PatinaSite>[] = req.body?.sites || [];

        if (!Array.isArray(sites) || sites.length === 0) {
          return res.status(400).json({ error: 'Sites array required' });
        }

        const added: PatinaSite[] = [];
        for (const site of sites) {
          if (!site.url) continue;

          const fullSite: PatinaSite = {
            id: site.id || generateId(),
            url: site.url,
            domain: site.domain || extractDomain(site.url),
            title: site.title,
            description: site.description,
            confidence: site.confidence || 80,
            era: site.era || 'timeless',
            category: site.category || 'other',
            vibe: site.vibe || '',
            why: site.why || '',
            submittedBy: site.submittedBy || 'seed',
            submittedAt: site.submittedAt || new Date().toISOString(),
            vouchCount: site.vouchCount || 0
          };

          await redis.hset(PATINA_SITES_KEY, { [fullSite.id]: fullSite });
          added.push(fullSite);
        }

        return res.json({
          seeded: true,
          count: added.length,
          sites: added
        });
      }

      // Get pending submissions
      case 'submissions': {
        const status = (req.query.status as string) || 'pending';

        const allSubs = await redis.hgetall(PATINA_SUBMISSIONS_KEY) as Record<string, PatinaSubmission> || {};
        const submissions = Object.values(allSubs)
          .filter(s => status === 'all' || s.status === status)
          .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

        return res.json({ count: submissions.length, submissions });
      }

      // Stats
      case 'stats': {
        const allSites = await redis.hgetall(PATINA_SITES_KEY) as Record<string, PatinaSite> || {};
        const allSubs = await redis.hgetall(PATINA_SUBMISSIONS_KEY) as Record<string, PatinaSubmission> || {};

        const sites = Object.values(allSites);
        const subs = Object.values(allSubs);

        const byCategory: Record<string, number> = {};
        const byEra: Record<string, number> = {};

        for (const site of sites) {
          byCategory[site.category] = (byCategory[site.category] || 0) + 1;
          byEra[site.era] = (byEra[site.era] || 0) + 1;
        }

        return res.json({
          totalSites: sites.length,
          pendingSubmissions: subs.filter(s => s.status === 'pending').length,
          byCategory,
          byEra,
          averageConfidence: sites.length > 0
            ? Math.round(sites.reduce((a, b) => a + b.confidence, 0) / sites.length)
            : 0
        });
      }

      default:
        return res.status(400).json({
          error: 'Unknown action',
          availableActions: ['search', 'wander', 'browse', 'submit', 'add', 'seed', 'submissions', 'stats']
        });
    }
  } catch (error) {
    console.error('Patina error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
