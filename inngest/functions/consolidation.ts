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

// Result type for consolidation operations
interface ConsolidationResult {
  processed: number;
  merged: number;
  promoted: number;
  pruned: number;
  soulsUpdated: number;
  duration: number;
}

// API base URL - uses production in Inngest, localhost for dev
const API_BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://agent-coord-mcp.vercel.app';

/**
 * Call the deployed memory-consolidate API
 * All consolidation logic is encapsulated in /api/memory-consolidate
 */
async function runConsolidation(action: 'full' | 'promote' | 'demote' | 'merge' | 'prune' = 'full'): Promise<{
  processed: number;
  promoted: number;
  demoted: number;
  merged: number;
  pruned: number;
  details: string[];
}> {
  const response = await fetch(`${API_BASE}/api/memory-consolidate?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Consolidation API failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.result;
}

/**
 * Get consolidation stats without running consolidation
 */
async function getConsolidationStats(): Promise<{
  totalMemories: number;
  tierCounts: { hot: number; warm: number; cold: number };
  averages: { references: string; validatedValue: string; surpriseScore: string };
}> {
  const response = await fetch(`${API_BASE}/api/memory-consolidate?action=stats`);
  if (!response.ok) {
    throw new Error(`Stats API failed: ${response.status}`);
  }
  return response.json();
}

// Main consolidation function - nightly sleep-time processing
export const sleepTimeConsolidation = inngest.createFunction(
  {
    id: 'memory-consolidation',
    name: 'Sleep-Time Memory Consolidation',
  },
  { cron: '0 3 * * *' }, // Run at 3 AM daily
  async ({ step }: { step: InngestStep }): Promise<ConsolidationResult> => {
    const startTime = Date.now();

    // Step 1: Get pre-consolidation stats
    const preStats = await step.run('get-pre-stats', async () => {
      return getConsolidationStats();
    });

    console.log(`[Consolidation] Starting with ${preStats.totalMemories} memories`);
    console.log(`[Consolidation] Tier distribution: hot=${preStats.tierCounts.hot}, warm=${preStats.tierCounts.warm}, cold=${preStats.tierCounts.cold}`);

    // Step 2: Run full consolidation cycle via API
    // This handles: promote → demote → merge → prune in one call
    const result = await step.run('run-consolidation', async () => {
      return runConsolidation('full');
    });

    // Step 3: Get post-consolidation stats for verification
    const postStats = await step.run('get-post-stats', async () => {
      return getConsolidationStats();
    });

    const duration = Date.now() - startTime;

    console.log(`[Consolidation] Complete in ${duration}ms`);
    console.log(`[Consolidation] Results: promoted=${result.promoted}, demoted=${result.demoted}, merged=${result.merged}, pruned=${result.pruned}`);

    return {
      processed: result.processed,
      merged: result.merged,
      promoted: result.promoted,
      pruned: result.pruned,
      soulsUpdated: 0, // Soul meta-learning happens at checkpoint time, not consolidation
      duration,
    };
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
    const startTime = Date.now();

    // Get pre-consolidation stats
    const preStats = await step.run('get-pre-stats', async () => {
      return getConsolidationStats();
    });

    console.log(`[On-Demand Consolidation] Starting with ${preStats.totalMemories} memories`);

    // Run full consolidation via API
    const result = await step.run('run-consolidation', async () => {
      return runConsolidation('full');
    });

    const duration = Date.now() - startTime;

    console.log(`[On-Demand Consolidation] Complete in ${duration}ms`);

    return {
      processed: result.processed,
      merged: result.merged,
      promoted: result.promoted,
      pruned: result.pruned,
      soulsUpdated: 0,
      duration,
    };
  }
);
