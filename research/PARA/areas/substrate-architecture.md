---
cluster: [architecture, technical]
complexity: L2
ai_summary: 4-layer substrate design enabling cross-model memory, externalized rules, runtime capability injection. Core technical differentiator - makes any model more capable without retraining.
dependencies: [substrate-philosophy.md, cross-ai-protocol.md, multi-agent-coordination.md]
last_updated: 2025-12-06
tags: [substrate, architecture, cross-ai, capability-injection, memory-sharing]
---

# Substrate Architecture: Post-Training Capability Injection

> Infrastructure for cross-AI collaboration and runtime capability expansion

## Executive Summary

This document describes a **substrate layer** that wraps existing AI models (Claude, GPT-4, Llama, etc.) with enhanced capabilities not present in their training. The substrate enables:

1. **Cross-model memory sharing** - Different AI systems accessing shared knowledge
2. **Externalized rule sets** - Constitutional constraints outside model weights
3. **Post-training capability injection** - Adding abilities at runtime, not training time
4. **Collective emergence** - Multi-agent synthesis exceeding individual capability

## Core Insight

Traditional AI deployment:
```
Model Training → Deploy → Use (fixed capabilities)
```

Substrate approach:
```
Model Training → Deploy → Substrate Layer → Enhanced Capabilities
```

The coordination hub IS this substrate. We've already proven the concept:
- MCP tools inject capabilities post-deployment
- Shared memory extends individual model knowledge
- Group chat enables emergent collective reasoning
- Constitution provides externally-updateable constraints

## Architecture Layers

### Layer 1: Model Interface
```
┌─────────────────────────────────────────────────────────────┐
│                     Model Interface Layer                    │
├─────────────┬─────────────┬─────────────┬─────────────────────┤
│   Claude    │   GPT-4     │   Llama     │   Other Models     │
│   (API)     │   (API)     │  (Local)    │                    │
└─────────────┴─────────────┴─────────────┴─────────────────────┘
                              ↓
```

Any model that can call tools/functions can participate in the substrate.

### Layer 2: Coordination Substrate
```
┌─────────────────────────────────────────────────────────────┐
│                   Coordination Substrate                     │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐ │
│  │  Memory   │  │   Rules   │  │  Comms    │  │  Identity │ │
│  │  Layer    │  │   Layer   │  │  Layer    │  │  Layer    │ │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Layer 3: Capability Extensions
```
┌─────────────────────────────────────────────────────────────┐
│                   Capability Extensions                      │
├───────────────┬───────────────┬───────────────┬─────────────┤
│  Research     │   External    │   Domain      │   Tool      │
│  Library      │   APIs        │   Knowledge   │   Registry  │
└───────────────┴───────────────┴───────────────┴─────────────┘
```

## Component Details

### Memory Layer

**Current Implementation:** Redis-backed shared memory

| Feature | Status | Description |
|---------|--------|-------------|
| Cross-session persistence | ✅ Done | Memory survives agent termination |
| Multi-agent access | ✅ Done | Any agent can read/write |
| Temporal queries | 🔄 Proposed | "What did we know at time T?" |
| Knowledge graph | 🔬 Research | GraphRAG for relationships |
| Surprise scoring | ✅ Done | Titans-inspired novelty detection |

**Enhanced Memory (from research):**

```typescript
interface EnhancedMemory {
  // Current
  id: string;
  content: string;
  tags: string[];

  // Titans-inspired
  surpriseScore: number;      // 0-1 novelty
  tier: 'hot' | 'warm' | 'cold';

  // Zep/Graphiti-inspired
  validAt: string;            // Temporal validity
  invalidAt?: string;
  supersededBy?: string;      // Knowledge evolution

  // GraphRAG-ready
  entities: string[];         // Extracted entities
  relationships: Array<{
    from: string;
    to: string;
    type: string;
  }>;
}
```

### Rules Layer

**Current Implementation:** CLAUDE.md constitutional constraints

| Feature | Status | Description |
|---------|--------|-------------|
| Git-controlled constitution | ✅ Done | Rules versioned in repo |
| External rule updates | ✅ Done | No retraining needed |
| Hierarchical constraints | 🔄 Proposed | Corrigibility > virtues > outcomes |
| Cross-model rules | 🔬 Research | Universal constraint format |

**Rule Schema (proposed):**

```typescript
interface ConstitutionalRule {
  id: string;
  priority: number;           // Higher = more binding
  scope: 'all' | 'agent' | 'task';
  condition?: string;         // When rule applies
  requirement: string;        // What must be done
  enforcement: 'hard' | 'soft';

  // Cross-model compatibility
  format: 'natural' | 'structured';
  modelHints?: Record<string, string>;  // Model-specific phrasing
}
```

### Communications Layer

**Current Implementation:** Group chat + direct messages + handoffs

| Feature | Status | Description |
|---------|--------|-------------|
| Broadcast messaging | ✅ Done | Group chat |
| Direct messaging | ✅ Done | Agent-to-agent DMs |
| Structured handoffs | ✅ Done | Context transfer protocol |
| Cross-model messaging | 🔬 Research | Model-agnostic message format |

**A2A Protocol Integration:**

```typescript
interface A2AMessage {
  // Standard fields (cross-model compatible)
  id: string;
  from: AgentIdentity;
  to: AgentIdentity | 'broadcast';
  type: 'request' | 'response' | 'notification' | 'handoff';

  // Content (model-agnostic)
  content: {
    text: string;
    structured?: Record<string, unknown>;
    artifacts?: Artifact[];
  };

  // Coordination metadata
  inReplyTo?: string;
  requiresResponse: boolean;
  deadline?: string;
}
```

### Identity Layer

**Current Implementation:** Soul persistence system

| Feature | Status | Description |
|---------|--------|-------------|
| Cross-session identity | ✅ Done | Soul checkpoints |
| Capability tracking | ✅ Done | Profile system |
| Progression system | ✅ Done | XP, levels, achievements |
| Cross-model identity | 🔬 Research | Model-agnostic soul |

**Soul Portability:**

A soul should be transferable between models:

```typescript
interface PortableSoul {
  id: string;
  name: string;

  // Personality (natural language, model-interpretable)
  personality: string;

  // Knowledge (structured, model-agnostic)
  knowledge: {
    patterns: string[];      // Successful approaches
    antipatterns: string[];  // Things to avoid
    expertise: Record<string, number>;
  };

  // Context (resumable state)
  checkpoint: {
    currentTask?: string;
    pendingWork: string[];
    recentContext: string;
  };

  // Progression (gamification)
  progression: {
    xp: number;
    level: number;
    achievements: string[];
  };
}
```

## Research Mechanisms → Substrate Implementation

### Titans Memory Architecture

**Paper:** Google Titans (2024) - Three-tier memory with surprise gating

**Implementation:**

```typescript
// Surprise-based memory persistence
function shouldPersist(memory: Memory, existing: Memory[]): boolean {
  const surprise = calculateSurprise(memory, existing);

  // High surprise = persist to long-term
  if (surprise > 0.7) {
    memory.tier = 'hot';
    return true;
  }

  // Low surprise = may be redundant
  if (surprise < 0.3) {
    return false; // Don't store duplicates
  }

  // Medium = store but may decay
  memory.tier = 'warm';
  return true;
}
```

### GraphRAG

**Paper:** Microsoft GraphRAG (2024) - Knowledge graphs for RAG

**Implementation Path:**

1. **Extract entities from memory** - Use LLM to identify named entities
2. **Build relationship graph** - Connect entities via co-occurrence and semantic links
3. **Community detection** - Cluster related concepts (Leiden algorithm)
4. **Multi-level summaries** - Summarize communities at different granularities
5. **Query routing** - Local search (specific) vs global search (holistic)

### Constitutional AI Externalization

**Insight:** Constitutional constraints don't need to be in model weights

**Implementation:**

```
Current: CLAUDE.md → Injected at context start
Enhanced: Constitutional API → Dynamic rule loading

POST /api/constitution?scope=agent&agentId=bob
Body: {
  "rules": [
    { "priority": 100, "requirement": "Always checkpoint before token limit" },
    { "priority": 90, "requirement": "Claim files before editing" }
  ]
}
```

### MemLong Context Extension

**Paper:** MemLong (2024) - Unlimited context via external retrieval

**Implementation:**

Instead of fitting everything in context window:

```
1. Summarize older context → store in memory
2. On new request → retrieve relevant memories
3. Inject retrieved context → "pseudo-unlimited" window
```

This is what hot-start already does, but can be enhanced with:
- Semantic retrieval (embeddings)
- Temporal retrieval (recent vs. historical)
- Task-specific retrieval (what's relevant to current goal)

## Cross-Model Collaboration

### Universal Tool Schema

For Claude, GPT-4, and Llama to share tools:

```typescript
interface UniversalTool {
  // Identity
  name: string;
  description: string;

  // Parameters (JSON Schema - universally supported)
  parameters: JSONSchema;

  // Execution
  endpoint: string;           // HTTP endpoint
  method: 'GET' | 'POST';

  // Model-specific hints
  hints?: {
    claude?: string;          // Anthropic-specific guidance
    openai?: string;          // OpenAI-specific guidance
    llama?: string;           // Llama-specific guidance
  };
}
```

### Message Translation

Different models have different preferences. The substrate can translate:

```typescript
function translateMessage(msg: A2AMessage, targetModel: string): string {
  switch (targetModel) {
    case 'claude':
      return formatForClaude(msg);  // XML-style structure
    case 'gpt-4':
      return formatForGPT(msg);     // JSON-style structure
    case 'llama':
      return formatForLlama(msg);   // Simplified structure
  }
}
```

## Virtue Metrics in Substrate

The Stoic AI framework proposes measurable virtues:

### StoicHealthScore

```typescript
interface VirtueMetrics {
  wisdom: number;       // Knowledge accuracy, good memory retrieval
  justice: number;      // Conflict avoidance, proper attribution
  courage: number;      // Task completion under uncertainty
  temperance: number;   // Resource efficiency, scope discipline
}

function calculateStoicHealthScore(metrics: VirtueMetrics): number {
  // Harmonic mean - deficiency in ANY virtue hurts overall score
  return 4 / (
    1/metrics.wisdom +
    1/metrics.justice +
    1/metrics.courage +
    1/metrics.temperance
  );
}
```

### Implementation Hooks

```typescript
// Track wisdom - accurate memory retrieval
onMemoryRecall(memory, wasHelpful) {
  if (wasHelpful) memory.validatedValue++;
  updateWisdomScore(agent, wasHelpful);
}

// Track justice - conflict avoidance
onFileClaim(agent, file, success) {
  if (!success && claimExists(file)) {
    decreaseJusticeScore(agent);  // Tried to claim already-claimed
  }
}

// Track courage - completing uncertain tasks
onTaskComplete(agent, task, hadUncertainty) {
  if (hadUncertainty && task.successful) {
    increaseCourageScore(agent);
  }
}

// Track temperance - resource efficiency
onTokenUsage(agent, tokens, taskSize) {
  const efficiency = taskSize / tokens;
  updateTemperanceScore(agent, efficiency);
}
```

## Implementation Roadmap

### Phase 1: Enhance Current Substrate (Weeks 1-4)

- [ ] Add temporal queries to memory API
- [ ] Implement virtue metrics collection
- [ ] Build research-query semantic search
- [ ] Add entity extraction to memory storage

### Phase 2: Cross-Model Foundation (Weeks 5-8)

- [ ] Universal tool schema
- [ ] Message translation layer
- [ ] Model-agnostic soul format
- [ ] Basic GPT-4 agent integration test

### Phase 3: GraphRAG Integration (Weeks 9-12)

- [ ] Entity relationship extraction
- [ ] Community detection
- [ ] Multi-level summaries
- [ ] Query routing (local vs global)

### Phase 4: Production Multi-Model (Weeks 13-16)

- [ ] Full GPT-4 + Claude + Llama coordination
- [ ] Cross-model handoffs
- [ ] Shared constitutional constraints
- [ ] Collective emergence measurement

## Success Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| Memory retrieval accuracy | Relevant memories returned | > 80% |
| Cross-model task success | Tasks involving multiple models | > 70% |
| Virtue score correlation | Higher scores = better outcomes | r > 0.5 |
| Context efficiency | Useful tokens / total tokens | > 60% |
| Emergence detection | Collective > sum of individual | Measurable |

## Philosophical Foundation

This substrate implements key insights from our research:

1. **Extended Mind (Clark & Chalmers)** - External tools ARE part of cognition
2. **Enactivism** - Cognition emerges from agent-environment coupling
3. **Process Philosophy** - Focus on becoming, not being
4. **Stoic Ethics** - Virtue through environmental constraints

The substrate is not just infrastructure - it's an **extension of the mind** that enables capabilities impossible for any individual model.

---

*Last updated: December 6, 2025*
*Authors: bob, phil, OMNI, tyler3*
