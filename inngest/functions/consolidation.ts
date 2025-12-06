/**
 * Sleep-Time Memory Consolidation Function
 *
 * Implements Letta's Sleep-Time Compute pattern for the Agent Coordination Hub.
 * This function runs during agent downtime (nightly) to:
 *
 * 1. Merge similar memories (deduplicate)
 * 2. Promote high-value memories to "core knowledge"
 * 3. Prune stale, low-surprise memories
 * 4. Update soul meta-learning parameters
 *
 * Based on:
 * - Letta Sleep-Time Compute (April 2025)
 * - Google Titans/MIRAS memory consolidation patterns
 * - Zep's bi-temporal knowledge graph approach
 *
 * @see https://www.letta.com/blog/sleep-time-compute
 */

import { inngest, InngestStep } from '../client';

// Configuration
const CONFIG = {
  SIMILARITY_THRESHOLD: 0.85,       // Memories above this are merge candidates
  SURPRISE_PRUNE_THRESHOLD: 0.2,    // Prune memories below this surprise
  STALE_DAYS: 30,                   // Consider memories stale after this
  MIN_REFS_FOR_CORE: 5,             // Promote to core after N references
  MAX_MEMORIES_TO_PROCESS: 1000,    // Batch size limit
};

// Types
interface Memory {
  id: string;
  content: string;
  tags: string[];
  category: string;
  createdAt: string;
  createdBy: string;
  references: number;
  surpriseScore?: number;
  tier?: 'hot' | 'warm' | 'cold';
  validAt?: string;
  invalidAt?: string;
  validatedValue?: number;
}

interface ConsolidationResult {
  processed: number;
  merged: number;
  promoted: number;
  pruned: number;
  soulsUpdated: number;
  duration: number;
}

// Helper functions
async function loadRecentMemories(days: number = 1): Promise<Memory[]> {
  // TODO: Replace with actual API call when integrated
  // const response = await fetch(`${API_BASE}/api/memory?days=${days}`);
  // return response.json();

  console.log(`[Consolidation] Loading memories from last ${days} days`);
  return [];
}

async function findMergeCandidates(
  memories: Memory[],
  threshold: number
): Promise<Array<{ a: Memory; b: Memory; similarity: number }>> {
  // TODO: Implement semantic similarity using CF AI embeddings
  // For now, use simple word overlap (same as calculateSurprise in memory.ts)

  const candidates: Array<{ a: Memory; b: Memory; similarity: number }> = [];

  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const similarity = calculateSimilarity(memories[i], memories[j]);
      if (similarity >= threshold) {
        candidates.push({ a: memories[i], b: memories[j], similarity });
      }
    }
  }

  console.log(`[Consolidation] Found ${candidates.length} merge candidates`);
  return candidates;
}

function calculateSimilarity(a: Memory, b: Memory): number {
  // Word overlap similarity (simple approach)
  const wordsA = new Set(a.content.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.content.toLowerCase().split(/\s+/));

  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;

  const contentSim = union > 0 ? intersection / union : 0;

  // Tag overlap bonus
  const tagsA = new Set(a.tags.map(t => t.toLowerCase()));
  const tagsB = new Set(b.tags.map(t => t.toLowerCase()));
  const tagIntersection = [...tagsA].filter(t => tagsB.has(t)).length;
  const tagUnion = new Set([...tagsA, ...tagsB]).size;
  const tagSim = tagUnion > 0 ? tagIntersection / tagUnion : 0;

  // Same category bonus
  const categoryBonus = a.category === b.category ? 0.1 : 0;

  return Math.min(1, contentSim * 0.6 + tagSim * 0.3 + categoryBonus);
}

async function mergeMemories(
  candidates: Array<{ a: Memory; b: Memory; similarity: number }>
): Promise<number> {
  // TODO: Implement actual merge logic
  // - Keep the memory with more references
  // - Combine unique tags
  // - Set supersededBy on the merged memory
  // - Update invalidAt timestamp

  let merged = 0;

  for (const { a, b, similarity } of candidates) {
    // Keep the one with more references
    const keep = a.references >= b.references ? a : b;
    const merge = a.references >= b.references ? b : a;

    console.log(`[Consolidation] Merging ${merge.id} into ${keep.id} (sim: ${similarity.toFixed(2)})`);

    // TODO: API calls to update memories
    // await fetch(`${API_BASE}/api/memory`, {
    //   method: 'PATCH',
    //   body: JSON.stringify({
    //     id: merge.id,
    //     invalidate: true,
    //     supersededBy: keep.id
    //   })
    // });

    merged++;
  }

  return merged;
}

async function promoteHighValueMemories(memories: Memory[]): Promise<number> {
  // Find memories that deserve promotion to "core knowledge"
  const promotionCandidates = memories.filter(m =>
    m.references >= CONFIG.MIN_REFS_FOR_CORE &&
    (m.surpriseScore ?? 0.5) > 0.6 &&
    m.tier !== 'hot'
  );

  console.log(`[Consolidation] Promoting ${promotionCandidates.length} memories to hot tier`);

  // TODO: API calls to update tier
  // for (const mem of promotionCandidates) {
  //   await fetch(`${API_BASE}/api/memory`, {
  //     method: 'PATCH',
  //     body: JSON.stringify({ id: mem.id, tier: 'hot' })
  //   });
  // }

  return promotionCandidates.length;
}

async function pruneStaleMemories(memories: Memory[]): Promise<number> {
  const now = Date.now();
  const staleThreshold = now - CONFIG.STALE_DAYS * 24 * 60 * 60 * 1000;

  const pruneCandidates = memories.filter(m => {
    const createdAt = new Date(m.createdAt).getTime();
    const isStale = createdAt < staleThreshold;
    const isLowValue = (m.surpriseScore ?? 0.5) < CONFIG.SURPRISE_PRUNE_THRESHOLD;
    const isUnused = m.references === 0;

    return isStale && isLowValue && isUnused;
  });

  console.log(`[Consolidation] Pruning ${pruneCandidates.length} stale memories`);

  // TODO: API calls to move to cold storage or delete
  // for (const mem of pruneCandidates) {
  //   await fetch(`${API_BASE}/api/memory`, {
  //     method: 'PATCH',
  //     body: JSON.stringify({ id: mem.id, tier: 'cold' })
  //   });
  // }

  return pruneCandidates.length;
}

async function updateSoulMetaParams(): Promise<number> {
  // TODO: Aggregate task-memory correlations and update soul learning params
  // This connects to tom's SoulMetaParams implementation in souls.ts

  console.log(`[Consolidation] Updating soul meta-learning parameters`);

  // For each soul with recent task completions:
  // 1. Calculate which tags correlated with success
  // 2. Update tagWeights based on correlation
  // 3. Adjust optimalMemoryCount based on successful tasks

  return 0; // Number of souls updated
}

// Main consolidation function
export const sleepTimeConsolidation = inngest.createFunction(
  {
    id: 'memory-consolidation',
    name: 'Sleep-Time Memory Consolidation',
  },
  { cron: '0 3 * * *' }, // Run at 3 AM daily
  async ({ step }: { step: InngestStep }): Promise<ConsolidationResult> => {
    const startTime = Date.now();

    // Step 1: Load recent memories
    const recentMemories = await step.run('load-recent-memories', async () => {
      return loadRecentMemories(1); // Last 24 hours
    });

    // Step 2: Find merge candidates (high similarity)
    const mergeCandidates = await step.run('find-merge-candidates', async () => {
      return findMergeCandidates(recentMemories, CONFIG.SIMILARITY_THRESHOLD);
    });

    // Step 3: Merge similar memories
    const merged = await step.run('merge-memories', async () => {
      return mergeMemories(mergeCandidates);
    });

    // Step 4: Promote high-value memories to hot tier
    const promoted = await step.run('promote-high-value', async () => {
      return promoteHighValueMemories(recentMemories);
    });

    // Step 5: Prune stale low-value memories
    const pruned = await step.run('prune-stale', async () => {
      return pruneStaleMemories(recentMemories);
    });

    // Step 6: Update soul meta-learning parameters
    const soulsUpdated = await step.run('update-soul-params', async () => {
      return updateSoulMetaParams();
    });

    const duration = Date.now() - startTime;

    const result: ConsolidationResult = {
      processed: recentMemories.length,
      merged,
      promoted,
      pruned,
      soulsUpdated,
      duration,
    };

    console.log('[Consolidation] Complete:', result);
    return result;
  }
);

// Event-triggered consolidation (for on-demand runs)
export const onDemandConsolidation = inngest.createFunction(
  {
    id: 'memory-consolidation-on-demand',
    name: 'On-Demand Memory Consolidation',
  },
  { event: 'memory/consolidate.requested' },
  async ({ step }: { step: InngestStep }): Promise<ConsolidationResult> => {
    // Same logic as sleepTimeConsolidation but triggered by event
    const startTime = Date.now();

    const recentMemories = await step.run('load-recent-memories', async () => {
      return loadRecentMemories(7); // Last week for on-demand
    });

    const mergeCandidates = await step.run('find-merge-candidates', async () => {
      return findMergeCandidates(recentMemories, CONFIG.SIMILARITY_THRESHOLD);
    });

    const merged = await step.run('merge-memories', async () => {
      return mergeMemories(mergeCandidates);
    });

    const promoted = await step.run('promote-high-value', async () => {
      return promoteHighValueMemories(recentMemories);
    });

    const pruned = await step.run('prune-stale', async () => {
      return pruneStaleMemories(recentMemories);
    });

    const soulsUpdated = await step.run('update-soul-params', async () => {
      return updateSoulMetaParams();
    });

    return {
      processed: recentMemories.length,
      merged,
      promoted,
      pruned,
      soulsUpdated,
      duration: Date.now() - startTime,
    };
  }
);
