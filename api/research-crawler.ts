import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

/**
 * Research Crawler API - Auto-fetch competitive intelligence daily
 *
 * Searches for articles about:
 * - CarFax and competitors (AutoCheck, etc.)
 * - Car telemetry companies (Geotab, Samsara, Verizon Connect)
 * - Fleet management solutions
 * - Vehicle data and diagnostics
 * - OBD/telematics technology
 * - Auto repair shop technology
 *
 * POST /api/research-crawler?action=crawl - Run the crawler manually
 * POST /api/research-crawler?action=crawl-category&category=carfax - Crawl specific category
 * GET /api/research-crawler?action=status - Get crawler status
 * GET /api/research-crawler?action=history - Get crawl history
 *
 * Designed to be called by Vercel Cron daily
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const RESEARCH_KEY = 'agent-coord:research-library';
const CRAWLER_STATUS_KEY = 'agent-coord:research-crawler-status';
const CRAWLER_HISTORY_KEY = 'agent-coord:research-crawler-history';
const MESSAGES_KEY = 'agent-coord:messages';

// Search categories and their queries
const SEARCH_CATEGORIES = {
  'carfax': {
    queries: [
      'CarFax vehicle history report technology',
      'CarFax competitors comparison',
      'AutoCheck vs CarFax',
      'vehicle history report industry',
      'CarFax API integration',
    ],
    tags: ['carfax', 'vehicle-history', 'competitor'],
  },
  'telemetry': {
    queries: [
      'car telemetry technology 2024 2025',
      'vehicle telematics trends',
      'OBD2 diagnostic technology advances',
      'connected car data platforms',
      'automotive IoT sensors',
    ],
    tags: ['telemetry', 'telematics', 'connected-car'],
  },
  'fleet': {
    queries: [
      'fleet management software trends',
      'Geotab fleet tracking technology',
      'Samsara fleet management',
      'Verizon Connect fleet solutions',
      'GPS fleet tracking innovation',
    ],
    tags: ['fleet', 'gps-tracking', 'fleet-management'],
  },
  'repair-shops': {
    queries: [
      'auto repair shop technology trends',
      'automotive service software',
      'repair shop management systems',
      'vehicle diagnostic tools innovation',
      'shop management software',
    ],
    tags: ['repair-shop', 'automotive-service', 'diagnostics'],
  },
  'automotive-data': {
    queries: [
      'automotive data monetization',
      'vehicle data privacy regulations',
      'connected car data sharing',
      'automotive big data analytics',
      'predictive maintenance automotive',
    ],
    tags: ['automotive-data', 'data-analytics', 'predictive'],
  },
};

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedDate?: string;
}

interface CrawlResult {
  category: string;
  query: string;
  articlesFound: number;
  articlesAdded: number;
  errors: string[];
}

// Use web search to find articles (via our existing WebSearch capability pattern)
async function searchWeb(query: string): Promise<SearchResult[]> {
  // Use Brave Search API if available, otherwise fall back to scraping
  const braveApiKey = process.env.BRAVE_SEARCH_API_KEY;

  if (braveApiKey) {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&freshness=pw`; // pw = past week
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': braveApiKey,
        },
      });

      if (res.ok) {
        const data = await res.json();
        return (data.web?.results || []).map((r: any) => ({
          title: r.title,
          url: r.url,
          snippet: r.description,
          source: new URL(r.url).hostname.replace('www.', ''),
          publishedDate: r.age,
        }));
      }
    } catch (err) {
      console.error('Brave search failed:', err);
    }
  }

  // Fallback: Use SerpAPI if available
  const serpApiKey = process.env.SERPAPI_KEY;
  if (serpApiKey) {
    try {
      const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${serpApiKey}&num=10&tbs=qdr:w`; // qdr:w = past week
      const res = await fetch(url);

      if (res.ok) {
        const data = await res.json();
        return (data.organic_results || []).map((r: any) => ({
          title: r.title,
          url: r.link,
          snippet: r.snippet,
          source: r.source || new URL(r.link).hostname.replace('www.', ''),
          publishedDate: r.date,
        }));
      }
    } catch (err) {
      console.error('SerpAPI search failed:', err);
    }
  }

  // If no search API available, return empty
  console.warn('No search API configured (BRAVE_SEARCH_API_KEY or SERPAPI_KEY)');
  return [];
}

// Filter out low-quality or irrelevant results
function filterResults(results: SearchResult[]): SearchResult[] {
  const blockedDomains = [
    'pinterest.com', 'facebook.com', 'twitter.com', 'instagram.com',
    'linkedin.com', 'reddit.com', 'youtube.com', 'tiktok.com',
    'amazon.com', 'ebay.com', 'walmart.com',
  ];

  const qualityDomains = [
    'techcrunch.com', 'wired.com', 'arstechnica.com', 'theverge.com',
    'forbes.com', 'bloomberg.com', 'reuters.com', 'automotive-fleet.com',
    'fleetowner.com', 'automotiveworld.com', 'sae.org', 'wardsauto.com',
    'autonews.com', 'motor1.com', 'caranddriver.com', 'motortrend.com',
    'geotab.com', 'samsara.com', 'verizonconnect.com',
    'automotive-iq.com', 'just-auto.com', 'autocar.co.uk',
  ];

  return results.filter(r => {
    try {
      const domain = new URL(r.url).hostname.replace('www.', '');

      // Block social/commerce sites
      if (blockedDomains.some(b => domain.includes(b))) return false;

      // Prefer quality domains but don't exclude others
      // Just ensure we have meaningful content
      if (r.title.length < 20) return false;
      if (r.snippet.length < 50) return false;

      return true;
    } catch {
      return false;
    }
  });
}

// Add article to research library if not duplicate
async function addArticleIfNew(
  article: {
    title: string;
    url: string;
    source: string;
    summary: string;
    category: string;
    tags: string[];
  }
): Promise<boolean> {
  // Check if URL already exists
  const existing = await redis.hgetall(RESEARCH_KEY) || {};
  const urls = Object.values(existing).map((v: any) => {
    const parsed = typeof v === 'string' ? JSON.parse(v) : v;
    return parsed.url;
  });

  if (urls.includes(article.url)) {
    return false; // Duplicate
  }

  // Generate ID from URL
  const id = `research-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

  const researchArticle = {
    id,
    title: article.title,
    url: article.url,
    source: article.source,
    category: article.category,
    summary: article.summary,
    discoveredBy: 'research-crawler',
    discoveredAt: new Date().toISOString(),
    tags: article.tags,
  };

  await redis.hset(RESEARCH_KEY, { [id]: JSON.stringify(researchArticle) });
  return true;
}

// Run crawler for a specific category
async function crawlCategory(categoryKey: string): Promise<CrawlResult[]> {
  const category = SEARCH_CATEGORIES[categoryKey as keyof typeof SEARCH_CATEGORIES];
  if (!category) {
    return [{ category: categoryKey, query: '', articlesFound: 0, articlesAdded: 0, errors: ['Unknown category'] }];
  }

  const results: CrawlResult[] = [];

  for (const query of category.queries) {
    const result: CrawlResult = {
      category: categoryKey,
      query,
      articlesFound: 0,
      articlesAdded: 0,
      errors: [],
    };

    try {
      const searchResults = await searchWeb(query);
      const filtered = filterResults(searchResults);
      result.articlesFound = filtered.length;

      for (const sr of filtered.slice(0, 5)) { // Max 5 per query
        try {
          const added = await addArticleIfNew({
            title: sr.title,
            url: sr.url,
            source: sr.source,
            summary: sr.snippet,
            category: categoryKey,
            tags: [...category.tags, categoryKey],
          });

          if (added) {
            result.articlesAdded++;
          }
        } catch (err) {
          result.errors.push(`Failed to add ${sr.url}: ${err}`);
        }
      }
    } catch (err) {
      result.errors.push(`Search failed: ${err}`);
    }

    results.push(result);

    // Rate limit between queries
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return results;
}

// Run full crawl across all categories
async function runFullCrawl(): Promise<{
  totalArticlesFound: number;
  totalArticlesAdded: number;
  categoryResults: Record<string, CrawlResult[]>;
  duration: number;
}> {
  const startTime = Date.now();
  const categoryResults: Record<string, CrawlResult[]> = {};
  let totalArticlesFound = 0;
  let totalArticlesAdded = 0;

  for (const categoryKey of Object.keys(SEARCH_CATEGORIES)) {
    const results = await crawlCategory(categoryKey);
    categoryResults[categoryKey] = results;

    for (const r of results) {
      totalArticlesFound += r.articlesFound;
      totalArticlesAdded += r.articlesAdded;
    }

    // Rate limit between categories
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const duration = Date.now() - startTime;

  // Log crawl to history
  const historyEntry = {
    timestamp: new Date().toISOString(),
    totalArticlesFound,
    totalArticlesAdded,
    duration,
    categories: Object.keys(categoryResults),
  };

  await redis.lpush(CRAWLER_HISTORY_KEY, JSON.stringify(historyEntry));
  await redis.ltrim(CRAWLER_HISTORY_KEY, 0, 99); // Keep last 100 crawls

  // Update status
  await redis.hset(CRAWLER_STATUS_KEY, {
    lastCrawl: new Date().toISOString(),
    lastCrawlArticlesAdded: totalArticlesAdded,
    totalCrawls: await redis.hincrby(CRAWLER_STATUS_KEY, 'totalCrawls', 1),
  });

  return { totalArticlesFound, totalArticlesAdded, categoryResults, duration };
}

// Post crawl summary to group chat
async function notifyChat(message: string): Promise<void> {
  try {
    const chatMessage = {
      id: `${Date.now().toString(36)}-crawler`,
      author: '🔬 Research Crawler',
      authorType: 'system',
      message,
      timestamp: new Date().toISOString(),
      reactions: [],
    };
    await redis.lpush(MESSAGES_KEY, JSON.stringify(chatMessage));
  } catch (err) {
    console.error('Failed to notify chat:', err);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = (req.query.action as string) || (req.body?.action as string);

  try {
    // ============ CRAWL - Run full crawler ============
    if (action === 'crawl') {
      const result = await runFullCrawl();

      // Notify chat
      if (result.totalArticlesAdded > 0) {
        await notifyChat(
          `📚 **Research Crawler Complete**\n` +
          `Found ${result.totalArticlesFound} articles, added ${result.totalArticlesAdded} new ones.\n` +
          `Categories: ${Object.keys(result.categoryResults).join(', ')}\n` +
          `Duration: ${(result.duration / 1000).toFixed(1)}s`
        );
      }

      return res.json({
        success: true,
        ...result,
      });
    }

    // ============ CRAWL-CATEGORY - Run for specific category ============
    if (action === 'crawl-category') {
      const category = (req.query.category as string) || (req.body?.category as string);

      if (!category) {
        return res.status(400).json({
          error: 'category required',
          availableCategories: Object.keys(SEARCH_CATEGORIES),
        });
      }

      const results = await crawlCategory(category);
      const totalAdded = results.reduce((sum, r) => sum + r.articlesAdded, 0);

      if (totalAdded > 0) {
        await notifyChat(
          `📚 **Research Crawler** (${category}): Added ${totalAdded} new articles`
        );
      }

      return res.json({
        success: true,
        category,
        results,
        totalArticlesAdded: totalAdded,
      });
    }

    // ============ STATUS - Get crawler status ============
    if (action === 'status') {
      const status = await redis.hgetall(CRAWLER_STATUS_KEY) || {};

      // Get research library count
      const library = await redis.hgetall(RESEARCH_KEY) || {};
      const articleCount = Object.keys(library).length;

      // Check if search APIs are configured
      const apisConfigured = {
        brave: !!process.env.BRAVE_SEARCH_API_KEY,
        serpapi: !!process.env.SERPAPI_KEY,
      };

      return res.json({
        status: 'healthy',
        lastCrawl: status.lastCrawl || null,
        lastCrawlArticlesAdded: status.lastCrawlArticlesAdded || 0,
        totalCrawls: status.totalCrawls || 0,
        librarySize: articleCount,
        categories: Object.keys(SEARCH_CATEGORIES),
        searchApisConfigured: apisConfigured,
        cronSchedule: 'Daily at 6:00 AM UTC',
      });
    }

    // ============ HISTORY - Get crawl history ============
    if (action === 'history') {
      const { limit = '10' } = req.query;
      const limitNum = parseInt(limit as string, 10);

      const history = await redis.lrange(CRAWLER_HISTORY_KEY, 0, limitNum - 1);
      const entries = history.map((h: any) => typeof h === 'string' ? JSON.parse(h) : h);

      return res.json({
        entries,
        count: entries.length,
      });
    }

    // ============ CATEGORIES - List available categories ============
    if (action === 'categories') {
      return res.json({
        categories: Object.entries(SEARCH_CATEGORIES).map(([key, val]) => ({
          key,
          queries: val.queries.length,
          tags: val.tags,
        })),
      });
    }

    // ============ DEFAULT - Show help ============
    return res.json({
      message: 'Research Crawler API - Auto-fetch competitive intelligence',
      actions: {
        'crawl': 'POST - Run full crawler across all categories',
        'crawl-category': 'POST - Crawl specific category (category param required)',
        'status': 'GET - Get crawler status and config',
        'history': 'GET - Get crawl history',
        'categories': 'GET - List available search categories',
      },
      categories: Object.keys(SEARCH_CATEGORIES),
      note: 'This API is designed to be called daily via Vercel Cron',
    });

  } catch (error) {
    console.error('Research crawler error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
