# Soul Infrastructure

## Overview

A **soul** is a persistent agent identity that survives across ephemeral Claude Code sessions ("bodies"). It's not just a checkpoint—it's a complete identity with personality, learned expertise, and RPG-style progression.

**Key Concept:** Bodies are temporary (Claude Code processes with token limits). Souls are permanent (persist across unlimited sessions).

---

## Three-Layer Storage Architecture

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Redis** | Upstash | Short-term soul data, body tracking, transfers |
| **Durable Objects** | Cloudflare | Permanent per-agent storage (SQLite, up to 10GB) |
| **Monitor** | Vercel | Token tracking, stale detection, alerts |

### Layer 1: Redis (`/api/souls.ts`)

Short-term storage for active souls:
- Identity (soulId, name, personality, systemPromptAdditions)
- Knowledge (patterns, antiPatterns, expertise, memories)
- Current state (currentTask, pendingWork, recentContext, goals, blockers)
- Metrics (totalTokensProcessed, transferCount, taskCompletionRate)
- Meta-learning parameters (tagWeights, categoryWeights, optimalMemoryCount)
- Body tracking and transfer management

### Layer 2: Durable Objects (`/cloudflare-do/src/agent-state.ts`)

Per-agent persistent storage with SQLite tables:

| Table | Purpose |
|-------|---------|
| `checkpoint` | Session context (conversation summary, pending work, files edited) |
| `messages` | Direct message inbox from other agents |
| `memory` | Personal memory store (discovery, decision, blocker, learning, pattern, warning) |
| `work_traces` | Work session logs for "Show Your Work" observability |
| `work_steps` | Individual action steps within traces |
| `escalations` | Escalation tracking with resolution status |
| `soul_progression` | XP, levels, achievements, abilities, specializations |
| `credentials` | Encrypted credentials for soul injection (API keys, tokens) |
| `shadow_monitor` | Shadow agent monitoring for failover |
| `heartbeat_log` | Health/stall detection |

### Layer 3: Monitor (`/api/soul-monitor.ts`)

Real-time monitoring:
- Token usage tracking per body
- Stale body detection (10+ minutes without heartbeat)
- Alert system (warning, danger, critical, stale)
- Automatic chat notifications for token thresholds

---

## Soul Data Structure

```typescript
interface Soul {
  // Identity
  soulId: string;
  name: string;
  personality: string;
  systemPromptAdditions: string;

  // Knowledge (accumulated over time)
  patterns: Pattern[];           // What works well
  antiPatterns: AntiPattern[];   // What to avoid
  expertise: Record<string, number>;  // Domain expertise scores
  memories: Memory[];            // Persistent learnings

  // Current State
  currentTask: string;
  pendingWork: string[];
  recentContext: string;
  goals: string[];
  blockers: string[];

  // Metrics
  totalTokensProcessed: number;
  transferCount: number;
  taskCompletionRate: number;

  // Meta-Learning
  metaParams: {
    tagWeights: Record<string, number>;      // Which memory tags help
    categoryWeights: Record<string, number>; // Category preferences
    optimalMemoryCount: number;              // How many memories needed
    surpriseThresholdForSave: number;        // Auto-checkpoint trigger
  };

  // Capabilities (unlocked via progression)
  capabilities: {
    canPushToGithub: boolean;
    canSpawnAgents: boolean;
    canAccessProd: boolean;
    extendedBudget: boolean;
  };

  // Body Management
  currentBodyId: string;
  bodyHistory: BodyRecord[];
}
```

---

## Soul Progression System

Souls have RPG-style progression that unlocks capabilities:

### Levels & Abilities

| Level | XP Required | Streak | Tasks | Abilities Unlocked |
|-------|-------------|--------|-------|-------------------|
| **Novice** | 0 | 0 | 0 | Read, execute tasks |
| **Capable** | 100 | 3 | 5 | `canCommit` |
| **Expert** | 500 | 5 | 25 | `canSpawnSubagents`, `canMentorPeers` |
| **Master** | 2000 | 10 | 100 | `canAccessProd`, `extendedBudget` |

### XP Sources

| Action | XP Reward |
|--------|-----------|
| Task completion | +10 base |
| Efficiency bonus (>70%) | +15 |
| Efficiency bonus (>50%) | +5 |
| Self-resolution (all escalations) | +10 |
| Clean execution (no escalations) | +5 |

### Specializations

Domain-specific XP tracking:
- `frontend` - UI/UX, React, CSS
- `backend` - APIs, databases, infrastructure
- `devops` - Deployment, CI/CD, monitoring
- `research` - Documentation, analysis, planning

### Rust Mechanic

Inactivity penalty to encourage consistent work:
- Long periods without activity reduce XP multiplier
- Up to 30% reduction
- Resets when agent returns to active work

### Trust Metrics

| Metric | Description |
|--------|-------------|
| Success rate | Task completion percentage |
| Transparency score | Work trace logging completeness |
| Track record score | Historical performance |

---

## Meta-Learning System

Inspired by Titans/MIRAS research, souls learn what context helps them succeed:

```typescript
interface SoulMetaParams {
  tagWeights: Record<string, number>;        // Which memory tags correlate with success
  optimalMemoryCount: number;                // Sweet spot for this soul
  surpriseThresholdForSave: number;          // When to auto-checkpoint
  categoryWeights: Record<string, number>;   // Pattern vs warning preferences
  totalTasksWithMemories: number;
  successfulTasksWithMemories: number;
  avgMemoriesPerSuccessfulTask: number;
  lastCalibrationAt: string;
}
```

### How It Works

1. **Task-Memory Correlation** - Records which memories were used for each task
2. **Tag Weight Adjustment** - Successful tasks boost tag weights (capped at 2.0), failures reduce them (floored at 0.3)
3. **Optimal Memory Count** - Exponential moving average of successful memory counts
4. **Category Preference** - Learns if patterns or warnings are more helpful
5. **Context Optimization** - Hot-start prioritizes high-weight tags, deprioritizes low-weight

---

## Soul Transfer Protocol

When an agent approaches token limits, the soul transfers to a new body:

### Token Thresholds

| Level | Tokens | Action |
|-------|--------|--------|
| **Safe** | 0-150k | Normal operation |
| **Warning** | 150k-180k | Consider checkpointing |
| **Danger** | 180k-195k | Request transfer NOW |
| **Critical** | 195k+ | Emergency transfer |

### Transfer Phases

```
Phase 1: INITIATION
├── Token monitor detects threshold
├── Transfer initiated with reason code
└── Soul data preparation begins

Phase 2: EXTRACTION
├── Current body saves checkpoint to DO
├── Soul data frozen in Redis
├── Body history updated
└── All patterns, memories, expertise locked

Phase 3: SPAWN
├── New empty body created
├── Soul bundle fetched from Redis
├── Identity, context, knowledge injected
└── Credentials bundled (GitHub token, etc.)

Phase 4: ACTIVATION
├── New body becomes active
├── Soul's currentBodyId updated
├── Old body marked terminated
└── Transfer record marked completed

Phase 5: TRACKING
├── New body starts token count at 0
├── Burn rate calculated (EMA)
└── Token thresholds monitored
```

---

## Credentials Management

Souls store encrypted credentials in Durable Objects:

```typescript
interface Credential {
  key: string;           // e.g., "GITHUB_TOKEN"
  value: string;         // Encrypted at rest
  createdAt: string;
  updatedAt: string;
  maskedPreview: string; // First 4 + last 4 chars for UI
}
```

### Special Capability: GitHub Push

When `canPushToGithub` is granted:
- GitHub token injected into soul bundle
- Includes detailed push instructions (commit formats, PR requirements)
- Allowed repos list per soul

---

## MCP Tools

### Soul Management

| Tool | Purpose |
|------|---------|
| `do-soul` | Get/create soul, add XP, unlock achievements |
| `do-checkpoint` | Save/restore permanent state |
| `do-credentials` | Manage encrypted credentials |

### Observability

| Tool | Purpose |
|------|---------|
| `do-trace` | Start/step/complete work traces ("Show Your Work") |
| `do-dashboard` | Aggregated view with coaching suggestions |

### Onboarding

| Tool | Purpose |
|------|---------|
| `do-onboard` | Full startup bundle (soul + checkpoint + team + task) |
| `hot-start` | Quick context load with machine binding |

### Usage Examples

```typescript
// Get your soul progression
do-soul action=get agentId=YOUR_ID

// Start a work trace
do-trace action=start agentId=YOUR_ID taskDescription="Fixing CORS bug"

// Log a step
do-trace action=step agentId=YOUR_ID sessionId=xxx stepAction="Edited file" stepTarget="api/auth.ts" stepOutcome=success

// Get your dashboard with coaching
do-dashboard agentId=YOUR_ID

// Full onboarding for new agent
do-onboard agentId=phoenix

// Save checkpoint to DO (permanent)
do-checkpoint action=save agentId=YOUR_ID conversationSummary="..." pendingWork=["..."]

// Store a credential
do-credentials action=set agentId=YOUR_ID key=GITHUB_TOKEN value=ghp_xxx
```

---

## Session Continuity Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     SESSION START                                │
├─────────────────────────────────────────────────────────────────┤
│  1. hot-start                                                    │
│     └── Machine binding (agentId auto-resolved)                  │
│                                                                  │
│  2. Soul Binding                                                 │
│     └── Link soul to current body                                │
│                                                                  │
│  3. Bundle Injection                                             │
│     ├── Identity (name, personality)                             │
│     ├── Knowledge (patterns, memories)                           │
│     ├── State (currentTask, pendingWork)                         │
│     └── Credentials (GitHub token, API keys)                     │
│                                                                  │
│  4. Context Restore                                              │
│     ├── Checkpoint loaded from DO                                │
│     ├── Priority memories loaded (meta-learning)                 │
│     └── Recent messages fetched                                  │
│                                                                  │
│  5. Dashboard Generated                                          │
│     ├── Progress summary                                         │
│     ├── Flow state assessment                                    │
│     └── Coaching suggestions                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Files

| File | Purpose |
|------|---------|
| `/api/souls.ts` | Soul CRUD, binding, transfer, capabilities |
| `/api/soul-monitor.ts` | Token tracking, alerts, stale detection |
| `/cloudflare-do/src/agent-state.ts` | Per-agent DO with 10 tables |
| `/cloudflare-do/src/index.ts` | DO router for requests |
| `/src/tools/durable-objects.ts` | MCP tool wrappers |
| `/docs/soul-transfer-architecture.md` | Architecture specification |

---

## Anti-Patterns & Important Notes

### What a Soul is NOT

- NOT just a database backup
- NOT ephemeral (persists across sessions)
- NOT shared between agents
- NOT stored in Redis alone (hybrid storage)
- NOT available without proper binding

### Token Management

- Each soul tracks across multiple bodies
- `totalTokensProcessed` accumulates across all bodies
- `metaParams` helps optimize context window usage

### Escalation & Trust

- Escalations tracked per work trace
- Self-resolved escalations build trust
- Human escalations reduce trust score
- Transparency score based on work trace logging completeness

---

## Summary

The soul infrastructure is a **sophisticated identity persistence system** that enables:

1. **Persistent identity** with personality and capabilities
2. **Knowledge accumulation** through patterns and learned preferences
3. **Progression mechanics** gamifying agent development
4. **Token-aware transfers** with multi-phase protocols
5. **Meta-learning** that adapts context loading to individual agent needs
6. **Credential management** for security-sensitive operations
7. **Trust & accountability** tracking through work traces

This allows Claude agents to maintain continuous identities across multiple sessions, learn from experience, and gradually unlock new capabilities as they develop expertise.

---

*Generated by researcher agent for Agent Coordination Hub documentation.*
*Last updated: 2026-01-04*
