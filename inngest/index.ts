/**
 * Inngest Functions Export
 *
 * This file exports all Inngest functions for the Agent Coordination Hub.
 * Used by the Vercel integration to register functions.
 *
 * When Inngest is installed, create an API route:
 *
 * ```typescript
 * // api/inngest.ts
 * import { serve } from 'inngest/vercel';
 * import { inngest } from '../inngest/client';
 * import { functions } from '../inngest';
 *
 * export default serve({
 *   client: inngest,
 *   functions,
 * });
 * ```
 */

import { sleepTimeConsolidation, onDemandConsolidation } from './functions/consolidation';

// Export all functions for Inngest serve
export const functions = [
  sleepTimeConsolidation,
  onDemandConsolidation,
];

// Re-export individual functions for testing
export { sleepTimeConsolidation, onDemandConsolidation };

// Re-export client
export { inngest } from './client';
