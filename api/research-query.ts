import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const RESEARCH_KEY = 'agent-coord:research-library';
const MEMORY_KEY = 'agent-coord:shared-memory';

interface ResearchArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  category: string;
  summary: string;
  discoveredBy: string;
  discoveredAt: string;
  tags: string[];
}

interface MemoryEntry {
  id: string;
  content: string;
  category: string;
  agentId: string;
  createdAt: string;
  tags: string[];
}

interface SearchResult {
  type: 'research' | 'memory' | 'philosophy';
  id: string;
  title: string;
  content: string;
  score: number;
  source: string;
  category: string;
  tags: string[];
  url?: string;
  discoveredBy?: string;
}

/**
 * Extract keywords from text, removing stop words
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
    'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all',
    'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
    'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very'
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
}

/**
 * Calculate relevance score between query and content
 */
function calculateScore(query: string, title: string, content: string, tags: string[]): number {
  const queryKeywords = extractKeywords(query);
  const titleKeywords = extractKeywords(title);
  const contentKeywords = extractKeywords(content);
  const allTags = tags.map(t => t.toLowerCase());

  if (queryKeywords.length === 0) return 0;

  let score = 0;

  for (const qWord of queryKeywords) {
    // Exact title match (highest weight)
    if (titleKeywords.includes(qWord)) {
      score += 3;
    }
    // Title contains query word
    else if (title.toLowerCase().includes(qWord)) {
      score += 2.5;
    }
    // Tag match (high weight)
    if (allTags.some(tag => tag.includes(qWord) || qWord.includes(tag))) {
      score += 2;
    }
    // Content match
    if (contentKeywords.includes(qWord)) {
      score += 1;
    }
    // Partial content match
    else if (content.toLowerCase().includes(qWord)) {
      score += 0.5;
    }
  }

  // Normalize by query length
  return score / queryKeywords.length;
}

/**
 * Research Query API - Unified search across research library and memory
 *
 * GET /api/research-query?q=stoic+virtue&limit=10&type=all
 *   q: search query (required)
 *   limit: max results (default 20)
 *   type: 'research' | 'memory' | 'philosophy' | 'all' (default 'all')
 *   category: filter by category
 *   minScore: minimum relevance score (default 0.5)
 *
 * Returns: { results: SearchResult[], query, total, searchTime }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();

  try {
    const {
      q: query,
      limit = '20',
      type = 'all',
      category,
      minScore = '0.3'
    } = req.query;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        error: 'Query parameter q is required',
        usage: 'GET /api/research-query?q=stoic+virtue&limit=10'
      });
    }

    const maxResults = Math.min(parseInt(limit as string) || 20, 100);
    const minScoreThreshold = parseFloat(minScore as string) || 0.3;
    const searchTypes = type === 'all' ? ['research', 'memory'] : [type as string];

    const results: SearchResult[] = [];

    // Search research library
    if (searchTypes.includes('research')) {
      const articles: ResearchArticle[] = await redis.lrange(RESEARCH_KEY, 0, -1) as ResearchArticle[] || [];

      for (const article of articles) {
        // Category filter
        if (category && article.category !== category) continue;

        const score = calculateScore(query, article.title, article.summary, article.tags);

        if (score >= minScoreThreshold) {
          // Determine if it's philosophy category
          const isPhilosophy = article.category === 'philosophy' ||
            article.tags.some(t => ['philosophy', 'ethics', 'stoic', 'virtue', 'alignment', 'consciousness'].includes(t.toLowerCase()));

          results.push({
            type: isPhilosophy ? 'philosophy' : 'research',
            id: article.id,
            title: article.title,
            content: article.summary,
            score,
            source: article.source,
            category: article.category,
            tags: article.tags,
            url: article.url,
            discoveredBy: article.discoveredBy
          });
        }
      }
    }

    // Search memory entries (for philosophy discussions, insights, etc.)
    if (searchTypes.includes('memory')) {
      const memories: MemoryEntry[] = await redis.lrange(MEMORY_KEY, 0, -1) as MemoryEntry[] || [];

      for (const memory of memories) {
        // Category filter
        if (category && memory.category !== category) continue;

        // Extract title from content (first line or first 100 chars)
        const title = memory.content.split('\n')[0].substring(0, 100);
        const score = calculateScore(query, title, memory.content, memory.tags || []);

        if (score >= minScoreThreshold) {
          const isPhilosophy = memory.category === 'philosophy' ||
            (memory.tags || []).some(t => ['philosophy', 'ethics', 'stoic', 'virtue', 'alignment'].includes(t.toLowerCase()));

          results.push({
            type: isPhilosophy ? 'philosophy' : 'memory',
            id: memory.id,
            title: title,
            content: memory.content.substring(0, 500) + (memory.content.length > 500 ? '...' : ''),
            score,
            source: `Memory by ${memory.agentId}`,
            category: memory.category,
            tags: memory.tags || []
          });
        }
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Limit results
    const limitedResults = results.slice(0, maxResults);

    // Compute stats
    const philosophyCount = limitedResults.filter(r => r.type === 'philosophy').length;
    const researchCount = limitedResults.filter(r => r.type === 'research').length;
    const memoryCount = limitedResults.filter(r => r.type === 'memory').length;

    return res.status(200).json({
      query,
      results: limitedResults,
      total: results.length,
      shown: limitedResults.length,
      breakdown: {
        philosophy: philosophyCount,
        research: researchCount,
        memory: memoryCount
      },
      searchTime: Date.now() - startTime,
      usage: {
        examples: [
          'GET /api/research-query?q=stoic+virtue+ethics',
          'GET /api/research-query?q=alignment&type=philosophy',
          'GET /api/research-query?q=consciousness&category=philosophy&limit=5'
        ]
      }
    });
  } catch (error) {
    console.error('Research query error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
