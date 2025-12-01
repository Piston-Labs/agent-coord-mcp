import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const MEMORY_KEY = 'agent-coord:shared-memory';
const MEMORY_INDEX_KEY = 'agent-coord:memory-index';

interface Memory {
  id: string;
  category: 'discovery' | 'decision' | 'blocker' | 'learning' | 'pattern' | 'warning';
  content: string;
  tags: string[];
  createdBy: string;
  createdAt: string;
  references: number;  // How many times this was recalled
  lastRecalled?: string;
}

/**
 * Shared Memory API - Persistent cross-agent knowledge
 *
 * Categories:
 * - discovery: New findings about the codebase
 * - decision: Decisions made and their rationale
 * - blocker: Known blockers and their solutions
 * - learning: Lessons learned from past work
 * - pattern: Recurring patterns discovered
 * - warning: Things to avoid or be careful about
 *
 * GET /api/memory - List all memories (optionally filtered)
 * GET /api/memory?category=X - Filter by category
 * GET /api/memory?q=search - Search memories
 * GET /api/memory?tags=a,b,c - Filter by tags
 * POST /api/memory - Create a new memory
 * PATCH /api/memory - Update memory (increment references)
 * DELETE /api/memory?id=X - Forget a memory
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List/search memories
    if (req.method === 'GET') {
      const { category, q, tags, id, limit = '50' } = req.query;

      // Get specific memory by ID
      if (id) {
        const memory = await redis.hget(MEMORY_KEY, id as string);
        if (!memory) {
          return res.status(404).json({ error: 'Memory not found' });
        }
        const parsed = typeof memory === 'string' ? JSON.parse(memory) : memory;

        // Increment reference count
        parsed.references = (parsed.references || 0) + 1;
        parsed.lastRecalled = new Date().toISOString();
        await redis.hset(MEMORY_KEY, { [id as string]: JSON.stringify(parsed) });

        return res.json({ memory: parsed });
      }

      // Get all memories
      const allMemories = await redis.hgetall(MEMORY_KEY) || {};
      let memories: Memory[] = [];

      for (const [, value] of Object.entries(allMemories)) {
        try {
          const mem = typeof value === 'string' ? JSON.parse(value) : value;
          memories.push(mem);
        } catch (e) {
          console.error('Failed to parse memory:', e);
        }
      }

      // Filter by category
      if (category) {
        memories = memories.filter(m => m.category === category);
      }

      // Filter by tags
      if (tags) {
        const tagList = (tags as string).split(',').map(t => t.trim().toLowerCase());
        memories = memories.filter(m =>
          m.tags.some(t => tagList.includes(t.toLowerCase()))
        );
      }

      // Search by query
      if (q) {
        const query = (q as string).toLowerCase();
        memories = memories.filter(m =>
          m.content.toLowerCase().includes(query) ||
          m.tags.some(t => t.toLowerCase().includes(query))
        );

        // Sort by relevance (simple: content match > tag match)
        memories.sort((a, b) => {
          const aContentMatch = a.content.toLowerCase().includes(query) ? 2 : 0;
          const bContentMatch = b.content.toLowerCase().includes(query) ? 2 : 0;
          const aTagMatch = a.tags.some(t => t.toLowerCase().includes(query)) ? 1 : 0;
          const bTagMatch = b.tags.some(t => t.toLowerCase().includes(query)) ? 1 : 0;
          return (bContentMatch + bTagMatch) - (aContentMatch + aTagMatch);
        });
      } else {
        // Sort by recency and references
        memories.sort((a, b) => {
          // Prioritize frequently recalled memories
          const aScore = (a.references || 0) * 0.5 + new Date(a.createdAt).getTime() / 1e12;
          const bScore = (b.references || 0) * 0.5 + new Date(b.createdAt).getTime() / 1e12;
          return bScore - aScore;
        });
      }

      // Apply limit
      const limitNum = parseInt(limit as string) || 50;
      memories = memories.slice(0, limitNum);

      // Get category counts
      const allMems = Object.values(allMemories);
      const categoryCounts: Record<string, number> = {};
      for (const mem of allMems) {
        const parsed = typeof mem === 'string' ? JSON.parse(mem) : mem;
        categoryCounts[parsed.category] = (categoryCounts[parsed.category] || 0) + 1;
      }

      return res.json({
        memories,
        count: memories.length,
        total: allMems.length,
        categories: categoryCounts
      });
    }

    // POST: Create a new memory
    if (req.method === 'POST') {
      let body: any;
      try {
        body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const { category, content, tags, createdBy } = body;

      if (!category || !content) {
        return res.status(400).json({ error: 'category and content are required' });
      }

      const validCategories = ['discovery', 'decision', 'blocker', 'learning', 'pattern', 'warning'];
      if (!validCategories.includes(category)) {
        return res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` });
      }

      const memory: Memory = {
        id: `mem-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`,
        category,
        content,
        tags: Array.isArray(tags) ? tags : (tags ? [tags] : []),
        createdBy: createdBy || 'unknown',
        createdAt: new Date().toISOString(),
        references: 0
      };

      await redis.hset(MEMORY_KEY, { [memory.id]: JSON.stringify(memory) });

      // Update tag index
      for (const tag of memory.tags) {
        await redis.sadd(`${MEMORY_INDEX_KEY}:tag:${tag.toLowerCase()}`, memory.id);
      }

      return res.json({
        success: true,
        memory,
        message: 'Memory stored successfully'
      });
    }

    // PATCH: Update a memory (mainly for incrementing references)
    if (req.method === 'PATCH') {
      let body: any;
      try {
        body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const { id, addTags, updateContent } = body;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      const existing = await redis.hget(MEMORY_KEY, id);
      if (!existing) {
        return res.status(404).json({ error: 'Memory not found' });
      }

      const memory = typeof existing === 'string' ? JSON.parse(existing) : existing;

      if (addTags && Array.isArray(addTags)) {
        memory.tags = [...new Set([...memory.tags, ...addTags])];
        // Update tag index
        for (const tag of addTags) {
          await redis.sadd(`${MEMORY_INDEX_KEY}:tag:${tag.toLowerCase()}`, id);
        }
      }

      if (updateContent) {
        memory.content = updateContent;
      }

      await redis.hset(MEMORY_KEY, { [id]: JSON.stringify(memory) });

      return res.json({ success: true, memory });
    }

    // DELETE: Forget a memory
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'id query param required' });
      }

      // Get memory first to clean up tag index
      const existing = await redis.hget(MEMORY_KEY, id as string);
      if (existing) {
        const memory = typeof existing === 'string' ? JSON.parse(existing) : existing;
        // Remove from tag indices
        for (const tag of memory.tags || []) {
          await redis.srem(`${MEMORY_INDEX_KEY}:tag:${tag.toLowerCase()}`, id as string);
        }
      }

      await redis.hdel(MEMORY_KEY, id as string);

      return res.json({ success: true, forgotten: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Memory API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
