import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const MEMORY_KEY = 'agent-coord:shared-memory';
const MEMORY_INDEX_KEY = 'agent-coord:memory-index';

/**
 * Fuzzy string matching using Levenshtein distance
 * Returns a score from 0 to 1 (1 = exact match)
 */
function fuzzyMatch(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  // Quick checks
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;

  // Levenshtein distance
  const len1 = s1.length;
  const len2 = s2.length;

  if (len1 === 0) return len2 === 0 ? 1 : 0;
  if (len2 === 0) return 0;

  // For very long strings, use a simpler approach
  if (len1 > 100 || len2 > 100) {
    const words1 = new Set(s1.split(/\s+/));
    const words2 = new Set(s2.split(/\s+/));
    const intersection = [...words1].filter(w => words2.has(w)).length;
    return intersection / Math.max(words1.size, words2.size);
  }

  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  return 1 - distance / maxLen;
}

/**
 * Tokenize and extract keywords from text
 */
function extractKeywords(text: string): string[] {
  // Remove common stop words
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
 * Calculate semantic similarity between query and memory content
 * Uses keyword overlap + fuzzy matching
 */
function semanticScore(query: string, content: string, tags: string[]): number {
  const queryKeywords = extractKeywords(query);
  const contentKeywords = extractKeywords(content);
  const allTags = tags.map(t => t.toLowerCase());

  if (queryKeywords.length === 0) return 0;

  let totalScore = 0;
  let matchCount = 0;

  for (const qWord of queryKeywords) {
    // Check exact matches in content
    if (contentKeywords.includes(qWord)) {
      totalScore += 1;
      matchCount++;
      continue;
    }

    // Check exact matches in tags
    if (allTags.includes(qWord)) {
      totalScore += 0.8;
      matchCount++;
      continue;
    }

    // Fuzzy match against content keywords
    let bestFuzzy = 0;
    for (const cWord of contentKeywords) {
      const score = fuzzyMatch(qWord, cWord);
      if (score > 0.7) { // Only count good fuzzy matches
        bestFuzzy = Math.max(bestFuzzy, score);
      }
    }

    // Fuzzy match against tags
    for (const tag of allTags) {
      const score = fuzzyMatch(qWord, tag);
      if (score > 0.7) {
        bestFuzzy = Math.max(bestFuzzy, score * 0.9);
      }
    }

    if (bestFuzzy > 0) {
      totalScore += bestFuzzy;
      matchCount++;
    }
  }

  // Return average score, weighted by match coverage
  const coverage = matchCount / queryKeywords.length;
  const avgScore = matchCount > 0 ? totalScore / queryKeywords.length : 0;

  return avgScore * coverage;
}

interface Memory {
  id: string;
  category: 'discovery' | 'decision' | 'blocker' | 'learning' | 'pattern' | 'warning';
  content: string;
  tags: string[];
  createdBy: string;
  createdAt: string;
  references: number;  // How many times this was recalled
  lastRecalled?: string;
  surpriseScore?: number;  // 0-1: How novel/unexpected this memory is (Titans-inspired)

  // Bi-temporal tracking (Zep/Graphiti-inspired)
  // Enables temporal knowledge queries: "what did we know at time T?"
  validAt?: string;      // When this fact became true (defaults to createdAt)
  invalidAt?: string;    // When this fact stopped being true (null = still valid)
  supersededBy?: string; // ID of memory that replaced this one (for knowledge evolution)

  // Memory tiering (Titans 3-tier architecture)
  tier?: 'hot' | 'warm' | 'cold';  // Hot = active, Warm = validated, Cold = archive
  validatedValue?: number;  // Grows with successful task correlations (0-1)
}

/**
 * Calculate surprise score for new content based on similarity to existing memories
 * Inspired by Google's Titans architecture - high surprise = more likely to persist
 *
 * @param newContent - The content being stored
 * @param newTags - Tags for the new memory
 * @param existingMemories - Recent memories to compare against
 * @returns Surprise score from 0 (redundant) to 1 (highly novel)
 */
function calculateSurprise(newContent: string, newTags: string[], existingMemories: Memory[]): number {
  if (existingMemories.length === 0) {
    return 1.0; // First memory is maximally surprising
  }

  // Check against recent memories (limit to 50 for performance)
  const recentMemories = existingMemories.slice(0, 50);

  let maxSimilarity = 0;
  for (const mem of recentMemories) {
    // Use existing semanticScore function - it already handles keyword overlap + fuzzy matching
    const similarity = semanticScore(newContent, mem.content, mem.tags);
    maxSimilarity = Math.max(maxSimilarity, similarity);

    // Early exit if we find a near-duplicate
    if (maxSimilarity > 0.9) {
      break;
    }
  }

  // Surprise = inverse of max similarity
  // Low similarity to existing memories = high surprise
  const noveltyScore = 1 - maxSimilarity;

  // Bonus for rare tags (tags not seen in recent memories)
  const allRecentTags = new Set(recentMemories.flatMap(m => m.tags.map(t => t.toLowerCase())));
  const newTagCount = newTags.filter(t => !allRecentTags.has(t.toLowerCase())).length;
  const tagNoveltyBonus = Math.min(0.2, newTagCount * 0.05); // Up to 0.2 bonus for new tags

  // Combine scores (capped at 1.0)
  return Math.min(1.0, noveltyScore + tagNoveltyBonus);
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

      // Bi-temporal filters (Zep-inspired)
      // By default, exclude invalidated memories unless explicitly requested
      const includeInvalid = req.query.includeInvalid === 'true';
      if (!includeInvalid) {
        memories = memories.filter(m => !m.invalidAt);
      }

      // Filter by tier
      const tierFilter = req.query.tier as string;
      if (tierFilter) {
        memories = memories.filter(m => m.tier === tierFilter);
      }

      // Temporal snapshot: "what did we know at time T?"
      const asOfTime = req.query.asOf as string;
      if (asOfTime) {
        const asOfDate = new Date(asOfTime);
        memories = memories.filter(m => {
          const validAt = new Date(m.validAt || m.createdAt);
          const invalidAt = m.invalidAt ? new Date(m.invalidAt) : null;
          // Memory was valid at asOf time if: validAt <= asOf AND (no invalidAt OR invalidAt > asOf)
          return validAt <= asOfDate && (!invalidAt || invalidAt > asOfDate);
        });
      }

      // Search by query (with fuzzy/semantic matching)
      if (q) {
        const query = (q as string);
        const fuzzy = req.query.fuzzy !== 'false'; // Enable fuzzy by default

        // Score all memories
        const scored = memories.map(m => {
          let score = 0;

          // Exact substring match (highest priority)
          if (m.content.toLowerCase().includes(query.toLowerCase())) {
            score += 2;
          }

          // Tag exact match
          if (m.tags.some(t => t.toLowerCase().includes(query.toLowerCase()))) {
            score += 1;
          }

          // Fuzzy/semantic matching (if enabled)
          if (fuzzy) {
            const semanticSc = semanticScore(query, m.content, m.tags);
            score += semanticSc * 1.5; // Weight fuzzy matches
          }

          return { memory: m, score };
        });

        // Filter to only matches with positive score
        const minScore = fuzzy ? 0.1 : 0.5;
        const matches = scored.filter(s => s.score >= minScore);

        // Sort by score descending
        matches.sort((a, b) => b.score - a.score);

        memories = matches.map(m => m.memory);
      } else {
        // Sort by surprise * references (Titans-inspired: novel + useful = important)
        memories.sort((a, b) => {
          // Composite score: surprise weight + reference weight + recency
          // High surprise AND high references = most valuable memories
          const aSurprise = a.surpriseScore ?? 0.5; // Default 0.5 for legacy memories
          const bSurprise = b.surpriseScore ?? 0.5;
          const aRefs = a.references || 0;
          const bRefs = b.references || 0;

          // Score formula: surprise * (1 + log(refs+1)) + recency bonus
          const aScore = aSurprise * (1 + Math.log(aRefs + 1)) + new Date(a.createdAt).getTime() / 1e13;
          const bScore = bSurprise * (1 + Math.log(bRefs + 1)) + new Date(b.createdAt).getTime() / 1e13;
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

      const memoryTags = Array.isArray(tags) ? tags : (tags ? [tags] : []);

      // Calculate surprise score based on existing memories (Titans-inspired)
      let surpriseScore = 1.0;
      try {
        const allMemories = await redis.hgetall(MEMORY_KEY) || {};
        const existingMemories: Memory[] = Object.values(allMemories)
          .map((v: any) => typeof v === 'string' ? JSON.parse(v) : v)
          .sort((a: Memory, b: Memory) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        surpriseScore = calculateSurprise(content, memoryTags, existingMemories);
      } catch (e) {
        console.error('Failed to calculate surprise score:', e);
        // Default to high surprise if calculation fails
      }

      const now = new Date().toISOString();
      const memory: Memory = {
        id: `mem-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`,
        category,
        content,
        tags: memoryTags,
        createdBy: createdBy || 'unknown',
        createdAt: now,
        references: 0,
        surpriseScore,
        // Bi-temporal defaults (Zep-inspired)
        validAt: body.validAt || now,  // When this fact became true
        tier: 'hot',  // New memories start hot
        validatedValue: 0,  // No task validation yet
      };

      await redis.hset(MEMORY_KEY, { [memory.id]: JSON.stringify(memory) });

      // Update tag index
      for (const tag of memory.tags) {
        await redis.sadd(`${MEMORY_INDEX_KEY}:tag:${tag.toLowerCase()}`, memory.id);
      }

      return res.json({
        success: true,
        memory,
        message: 'Memory stored successfully',
        surpriseScore: memory.surpriseScore,
        surpriseLevel: memory.surpriseScore! >= 0.7 ? 'high' :
                       memory.surpriseScore! >= 0.4 ? 'medium' : 'low'
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

      // Bi-temporal updates (Zep-inspired)
      if (body.invalidate) {
        // Mark memory as no longer valid
        memory.invalidAt = new Date().toISOString();
        if (body.supersededBy) {
          memory.supersededBy = body.supersededBy;
        }
      }

      if (body.tier) {
        memory.tier = body.tier;
      }

      if (body.validatedValue !== undefined) {
        memory.validatedValue = body.validatedValue;
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
