import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const MEMORY_KEY = 'agent-coord:shared-memory';
const CONSOLIDATION_LOG_KEY = 'agent-coord:consolidation-log';

interface Memory {
  id: string;
  category: 'discovery' | 'decision' | 'blocker' | 'learning' | 'pattern' | 'warning';
  content: string;
  tags: string[];
  createdBy: string;
  createdAt: string;
  references: number;
  lastRecalled?: string;
  surpriseScore?: number;
  validAt?: string;
  invalidAt?: string;
  supersededBy?: string;
  tier?: 'hot' | 'warm' | 'cold';
  validatedValue?: number;
}

interface ConsolidationResult {
  action: string;
  processed: number;
  promoted: number;
  demoted: number;
  merged: number;
  pruned: number;
  details: string[];
  timestamp: string;
}

/**
 * Calculate word overlap similarity between two texts
 * Simple but effective for memory deduplication
 */
function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const words2 = new Set(text2.toLowerCase().split(/\W+/).filter(w => w.length > 2));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;

  return intersection / union;  // Jaccard similarity
}

/**
 * Calculate tag overlap between two memories
 * Returns ratio of shared tags to total unique tags (Jaccard on tags)
 * Used as safety filter for merge - prevents merging topically unrelated memories
 */
function calculateTagOverlap(tags1: string[], tags2: string[]): number {
  const set1 = new Set(tags1.map(t => t.toLowerCase()));
  const set2 = new Set(tags2.map(t => t.toLowerCase()));

  if (set1.size === 0 && set2.size === 0) return 1;  // Both empty = same topic (no tags)
  if (set1.size === 0 || set2.size === 0) return 0;  // One has tags, other doesn't = different

  const intersection = [...set1].filter(t => set2.has(t)).length;
  const union = new Set([...set1, ...set2]).size;

  return intersection / union;
}

/**
 * Memory Consolidation API - Titans-inspired sleep-time processing
 *
 * Implements the "forgetting gate" and memory tiering from Titans architecture.
 * Designed to be called by Inngest as a scheduled job.
 *
 * Actions:
 * - promote: Move validated hot memories to warm tier
 * - demote: Move stale warm memories to cold tier
 * - merge: Combine similar memories to reduce redundancy
 * - prune: Remove old cold memories with no references
 * - full: Run complete consolidation cycle
 * - stats: Get consolidation statistics
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;

  try {
    // Get all memories
    const allMemoriesRaw = await redis.hgetall(MEMORY_KEY) || {};
    const memories: Memory[] = Object.values(allMemoriesRaw)
      .map((m: any) => typeof m === 'string' ? JSON.parse(m) : m)
      .filter((m: Memory) => !m.invalidAt);  // Only process valid memories

    const now = new Date();
    const result: ConsolidationResult = {
      action: action as string || 'unknown',
      processed: memories.length,
      promoted: 0,
      demoted: 0,
      merged: 0,
      pruned: 0,
      details: [],
      timestamp: now.toISOString(),
    };

    // GET: Stats only
    if (req.method === 'GET' && action === 'stats') {
      const tierCounts = {
        hot: memories.filter(m => m.tier === 'hot' || !m.tier).length,
        warm: memories.filter(m => m.tier === 'warm').length,
        cold: memories.filter(m => m.tier === 'cold').length,
      };

      const avgRefs = memories.reduce((sum, m) => sum + (m.references || 0), 0) / memories.length || 0;
      const avgValidated = memories.reduce((sum, m) => sum + (m.validatedValue || 0), 0) / memories.length || 0;
      const avgSurprise = memories.reduce((sum, m) => sum + (m.surpriseScore || 0.5), 0) / memories.length || 0.5;

      // Get last consolidation
      const lastLog = await redis.lindex(CONSOLIDATION_LOG_KEY, 0);
      const lastConsolidation = lastLog ? (typeof lastLog === 'string' ? JSON.parse(lastLog) : lastLog) : null;

      return res.json({
        totalMemories: memories.length,
        tierCounts,
        averages: {
          references: avgRefs.toFixed(2),
          validatedValue: avgValidated.toFixed(2),
          surpriseScore: avgSurprise.toFixed(2),
        },
        lastConsolidation,
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST required for consolidation actions' });
    }

    const updates: Record<string, string> = {};

    // === PROMOTE: Hot → Warm ===
    // Criteria: high references + validated value indicates proven utility
    if (action === 'promote' || action === 'full') {
      const hotMemories = memories.filter(m => m.tier === 'hot' || !m.tier);

      for (const memory of hotMemories) {
        const refs = memory.references || 0;
        const validated = memory.validatedValue || 0;
        const age = (now.getTime() - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60 * 24);  // days

        // Promote if: (refs >= 3 AND validated >= 0.5) OR (refs >= 5) OR (validated >= 0.8 AND age >= 7)
        const shouldPromote = (refs >= 3 && validated >= 0.5) ||
                              (refs >= 5) ||
                              (validated >= 0.8 && age >= 7);

        if (shouldPromote) {
          memory.tier = 'warm';
          updates[memory.id] = JSON.stringify(memory);
          result.promoted++;
          result.details.push(`Promoted ${memory.id} to warm (refs=${refs}, validated=${validated.toFixed(2)})`);
        }
      }
    }

    // === DEMOTE: Warm → Cold ===
    // Criteria: low recent activity suggests memory is becoming stale
    if (action === 'demote' || action === 'full') {
      const warmMemories = memories.filter(m => m.tier === 'warm');

      for (const memory of warmMemories) {
        const lastActivity = memory.lastRecalled
          ? new Date(memory.lastRecalled)
          : new Date(memory.createdAt);
        const daysSinceActivity = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);
        const validated = memory.validatedValue || 0;

        // Demote if: no activity for 30+ days AND low validated value
        const shouldDemote = daysSinceActivity >= 30 && validated < 0.5;

        if (shouldDemote) {
          memory.tier = 'cold';
          updates[memory.id] = JSON.stringify(memory);
          result.demoted++;
          result.details.push(`Demoted ${memory.id} to cold (${Math.floor(daysSinceActivity)} days inactive)`);
        }
      }
    }

    // === MERGE: Combine similar memories ===
    // Criteria: high content similarity AND tag overlap (safety filter)
    // Both conditions must be met to prevent merging topically unrelated memories
    if (action === 'merge' || action === 'full') {
      const contentSimilarityThreshold = 0.7;  // Jaccard on content words
      const tagOverlapThreshold = 0.5;         // At least 50% tag overlap required
      const processed = new Set<string>();

      for (let i = 0; i < memories.length; i++) {
        if (processed.has(memories[i].id)) continue;

        const similar: Memory[] = [memories[i]];

        for (let j = i + 1; j < memories.length; j++) {
          if (processed.has(memories[j].id)) continue;

          const contentSimilarity = calculateSimilarity(memories[i].content, memories[j].content);
          const tagOverlap = calculateTagOverlap(memories[i].tags, memories[j].tags);

          // BOTH conditions must be met - content similar AND topically related
          if (contentSimilarity >= contentSimilarityThreshold && tagOverlap >= tagOverlapThreshold) {
            similar.push(memories[j]);
            processed.add(memories[j].id);
          }
        }

        // If we found similar memories, merge them
        if (similar.length > 1) {
          // Keep the one with highest (refs + validated) as primary
          similar.sort((a, b) => {
            const scoreA = (a.references || 0) + (a.validatedValue || 0) * 10;
            const scoreB = (b.references || 0) + (b.validatedValue || 0) * 10;
            return scoreB - scoreA;
          });

          const primary = similar[0];
          const toMerge = similar.slice(1);

          // Aggregate references and tags from merged memories
          for (const m of toMerge) {
            primary.references = (primary.references || 0) + (m.references || 0);
            primary.tags = [...new Set([...primary.tags, ...m.tags])];

            // Mark merged memory as invalidated
            m.invalidAt = now.toISOString();
            m.supersededBy = primary.id;
            updates[m.id] = JSON.stringify(m);
          }

          updates[primary.id] = JSON.stringify(primary);
          result.merged += toMerge.length;
          result.details.push(`Merged ${toMerge.length} memories into ${primary.id} (tags aggregated: ${primary.tags.length})`);
        }

        processed.add(memories[i].id);
      }
    }

    // === PRUNE: Remove old cold memories ===
    // Criteria: cold tier + no references + very old
    if (action === 'prune' || action === 'full') {
      const coldMemories = memories.filter(m => m.tier === 'cold');
      const deletes: string[] = [];

      for (const memory of coldMemories) {
        const age = (now.getTime() - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        const refs = memory.references || 0;

        // Prune if: cold + zero refs + older than 60 days
        const shouldPrune = refs === 0 && age >= 60;

        if (shouldPrune) {
          // Soft delete - mark as invalidated rather than hard delete
          memory.invalidAt = now.toISOString();
          updates[memory.id] = JSON.stringify(memory);
          result.pruned++;
          result.details.push(`Pruned ${memory.id} (${Math.floor(age)} days old, 0 refs)`);
        }
      }
    }

    // Apply all updates
    if (Object.keys(updates).length > 0) {
      await redis.hset(MEMORY_KEY, updates);
    }

    // Log consolidation result
    await redis.lpush(CONSOLIDATION_LOG_KEY, JSON.stringify(result));
    await redis.ltrim(CONSOLIDATION_LOG_KEY, 0, 99);  // Keep last 100 logs

    return res.json({
      success: true,
      result,
      message: `Consolidation complete: ${result.promoted} promoted, ${result.demoted} demoted, ${result.merged} merged, ${result.pruned} pruned`,
    });

  } catch (error) {
    console.error('Memory consolidation error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
