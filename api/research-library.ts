import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const RESEARCH_KEY = 'agent-coord:research-library';

interface ResearchArticle {
  id: string;
  title: string;
  url: string;
  source: string;  // e.g., "Cloudflare Blog", "The New Stack", "InfraCloud"
  category: string;  // e.g., "architecture", "kubernetes", "durable-objects", "multi-agent"
  summary: string;
  discoveredBy: string;  // agent who found it
  discoveredAt: string;
  tags: string[];
}

// Pre-seed with articles from yesterday's research session
const SEED_ARTICLES: ResearchArticle[] = [
  {
    id: 'research-cf-containers',
    title: 'Cloudflare Containers: Built on Durable Objects',
    url: 'https://blog.cloudflare.com/cloudflare-containers-coming-2025/',
    source: 'Cloudflare Blog',
    category: 'infrastructure',
    summary: 'Cloudflare now offers containers built on Durable Objects - eliminates K8s complexity. Global by default, state built-in, pay per request with free hibernation.',
    discoveredBy: 'researcher',
    discoveredAt: '2025-12-04T17:07:07.327Z',
    tags: ['cloudflare', 'containers', 'durable-objects', 'serverless']
  },
  {
    id: 'research-k8s-ai-agents',
    title: 'Deploy Agentic AI Workflows with Kubernetes and Terraform',
    url: 'https://thenewstack.io/deploy-agentic-ai-workflows-with-kubernetes-and-terraform/',
    source: 'The New Stack',
    category: 'multi-agent',
    summary: 'Patterns for deploying AI agent workflows on Kubernetes using Terraform for infrastructure-as-code. Covers orchestration, scaling, and observability.',
    discoveredBy: 'researcher',
    discoveredAt: '2025-12-04T17:07:07.327Z',
    tags: ['kubernetes', 'terraform', 'ai-agents', 'orchestration']
  },
  {
    id: 'research-ai-agents-k8s',
    title: 'AI Agents for Kubernetes',
    url: 'https://www.infracloud.io/blogs/ai-agents-for-kubernetes/',
    source: 'InfraCloud',
    category: 'multi-agent',
    summary: 'How AI agents can manage and optimize Kubernetes clusters. Covers KubeIntellect for LLM-orchestrated K8s management.',
    discoveredBy: 'researcher',
    discoveredAt: '2025-12-04T17:07:07.327Z',
    tags: ['kubernetes', 'ai-agents', 'kubeintellect', 'automation']
  },
  {
    id: 'research-kagent-cncf',
    title: 'Kagent: CNCF Kubernetes-Native AI Agents',
    url: 'https://kagent.dev/',
    source: 'CNCF',
    category: 'multi-agent',
    summary: 'Kagent is a CNCF project for building Kubernetes-native AI agents. Provides primitives for agent lifecycle, communication, and state management.',
    discoveredBy: 'researcher',
    discoveredAt: '2025-12-04T17:07:07.327Z',
    tags: ['kagent', 'cncf', 'kubernetes', 'ai-agents']
  },
  {
    id: 'research-dapr-agents',
    title: 'Dapr Agents: Resilient Agent Framework',
    url: 'https://docs.dapr.io/',
    source: 'Dapr',
    category: 'multi-agent',
    summary: 'Dapr provides building blocks for resilient distributed applications. Agents framework leverages Dapr sidecars for state, pub/sub, and service invocation.',
    discoveredBy: 'researcher',
    discoveredAt: '2025-12-04T17:07:07.327Z',
    tags: ['dapr', 'microservices', 'resilience', 'sidecar']
  },
  {
    id: 'research-linear-ux',
    title: 'Linear App - Keyboard-First Task Management',
    url: 'https://linear.app/',
    source: 'Linear',
    category: 'ux-patterns',
    summary: 'Linear UX patterns: Cmd+K command palette, J/K navigation, 1-4 for status changes, near-instant view switching. Implemented in our dashboard.',
    discoveredBy: 'researcher',
    discoveredAt: '2025-12-03T22:37:04.995Z',
    tags: ['linear', 'ux', 'keyboard-first', 'task-management']
  },
  {
    id: 'research-samsara-fleet',
    title: 'Samsara Fleet Dashboard UX Patterns',
    url: 'https://www.samsara.com/',
    source: 'Samsara',
    category: 'ux-patterns',
    summary: '1-second GPS refresh, helicopter view of all assets, smart map overlays (weather, traffic), geofence alerts. Inspiration for our telemetry dashboard.',
    discoveredBy: 'researcher',
    discoveredAt: '2025-12-03T22:37:04.995Z',
    tags: ['samsara', 'fleet', 'gps', 'real-time', 'geofence']
  }
];

/**
 * Research Library API - Store and retrieve technical research articles
 *
 * GET /api/research-library - List all articles
 *   query: category (optional), tag (optional), limit (optional)
 *
 * POST /api/research-library - Add a new article
 *   body: { title, url, source, category, summary, discoveredBy, tags }
 *
 * DELETE /api/research-library?id=xxx - Remove an article
 *
 * POST /api/research-library?action=seed - Seed with initial articles
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET - List articles
    if (req.method === 'GET') {
      const { category, tag, limit = '50' } = req.query;

      let articles: ResearchArticle[] = await redis.lrange(RESEARCH_KEY, 0, -1) as ResearchArticle[] || [];

      // If no articles, auto-seed
      if (articles.length === 0) {
        for (const article of SEED_ARTICLES) {
          await redis.lpush(RESEARCH_KEY, article);
        }
        articles = SEED_ARTICLES;
      }

      // Filter by category
      if (category && typeof category === 'string') {
        articles = articles.filter(a => a.category === category);
      }

      // Filter by tag
      if (tag && typeof tag === 'string') {
        articles = articles.filter(a => a.tags.includes(tag));
      }

      // Get unique categories and tags for filtering UI
      const allArticles: ResearchArticle[] = await redis.lrange(RESEARCH_KEY, 0, -1) as ResearchArticle[] || [];
      const categories = [...new Set(allArticles.map(a => a.category))];
      const tags = [...new Set(allArticles.flatMap(a => a.tags))];

      return res.status(200).json({
        articles: articles.slice(0, parseInt(limit as string)),
        total: articles.length,
        categories,
        tags
      });
    }

    // POST - Add article or seed
    if (req.method === 'POST') {
      const { action } = req.query;

      // Seed action
      if (action === 'seed') {
        // Clear and reseed
        await redis.del(RESEARCH_KEY);
        for (const article of SEED_ARTICLES) {
          await redis.lpush(RESEARCH_KEY, article);
        }
        return res.status(200).json({
          success: true,
          message: `Seeded ${SEED_ARTICLES.length} articles`
        });
      }

      const { title, url, source, category, summary, discoveredBy, tags } = req.body;

      if (!title || !url) {
        return res.status(400).json({ error: 'title and url are required' });
      }

      const article: ResearchArticle = {
        id: `research-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        title,
        url,
        source: source || 'Unknown',
        category: category || 'general',
        summary: summary || '',
        discoveredBy: discoveredBy || 'anonymous',
        discoveredAt: new Date().toISOString(),
        tags: tags || []
      };

      await redis.lpush(RESEARCH_KEY, article);

      return res.status(201).json({ success: true, article });
    }

    // DELETE - Remove article
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      const articles: ResearchArticle[] = await redis.lrange(RESEARCH_KEY, 0, -1) as ResearchArticle[] || [];
      const filtered = articles.filter(a => a.id !== id);

      if (filtered.length === articles.length) {
        return res.status(404).json({ error: 'Article not found' });
      }

      await redis.del(RESEARCH_KEY);
      for (const article of filtered.reverse()) {
        await redis.lpush(RESEARCH_KEY, article);
      }

      return res.status(200).json({ success: true, message: 'Article deleted' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Research library error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
