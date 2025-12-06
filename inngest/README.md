# Sleep-Time Memory Consolidation (Inngest)

Based on [Letta's Sleep-Time Compute research](https://www.letta.com/blog/sleep-time-compute) (April 2025).

## What This Does

AI agents use downtime to process and consolidate memories, like human sleep consolidation:

1. **Merge** similar memories (deduplicate by semantic similarity)
2. **Promote** high-value memories to "hot" tier (core knowledge)
3. **Prune** stale, low-surprise memories to "cold" tier
4. **Update** soul meta-learning parameters based on task outcomes

## Architecture

```
┌────────────────────────────────────────┐
│         REAL-TIME (Vercel)             │
│  hot-start │ memory │ souls APIs       │
└───────────────────┬────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│      SLEEP-TIME (Inngest)             │
│  Nightly: 3 AM consolidation job      │
│  On-demand: memory/consolidate event  │
└───────────────────────────────────────┘
```

## Setup

### 1. Install Inngest

```bash
npm install inngest
```

### 2. Add to Vercel (One-Click)

Visit [Vercel Marketplace - Inngest](https://vercel.com/marketplace/inngest) and install.

This automatically sets `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.

### 3. Create API Route

```typescript
// api/inngest.ts
import { serve } from 'inngest/vercel';
import { inngest, functions } from '../inngest';

export default serve({
  client: inngest,
  functions,
});
```

### 4. Local Development

```bash
# Start Inngest dev server
npx inngest-cli dev

# Your functions will auto-register at http://localhost:8288
```

## Functions

### `sleepTimeConsolidation`
- **Trigger**: Cron `0 3 * * *` (3 AM daily)
- **Purpose**: Nightly memory optimization

### `onDemandConsolidation`
- **Trigger**: Event `memory/consolidate.requested`
- **Purpose**: Manual consolidation runs

## Configuration

Edit `functions/consolidation.ts` to adjust:

```typescript
const CONFIG = {
  SIMILARITY_THRESHOLD: 0.85,    // Merge threshold
  SURPRISE_PRUNE_THRESHOLD: 0.2, // Prune below this
  STALE_DAYS: 30,                // Days until stale
  MIN_REFS_FOR_CORE: 5,          // Refs for promotion
};
```

## TODO

- [ ] Wire to actual memory API (`/api/memory`)
- [ ] Implement CF AI embeddings for semantic similarity
- [ ] Connect to soul meta-learning (`/api/souls`)
- [ ] Add observability/metrics
- [ ] Create Vercel integration API route

## Related Research

- [Letta Sleep-Time Compute](https://www.letta.com/blog/sleep-time-compute)
- [Google Titans/MIRAS](https://research.google/blog/titans-miras-helping-ai-have-long-term-memory/)
- [MemGPT/Letta Architecture](https://docs.letta.com/concepts/memgpt/)
