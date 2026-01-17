---
cluster: [technical, architecture]
complexity: L3
ai_summary: "Protocol specification for cross-model communication. Defines message formats, capability negotiation, memory sharing APIs, and constitutional constraint propagation between Claude/GPT/Llama."
dependencies:
  - substrate-architecture.md
  - multi-agent-coordination.md
tags: [protocol, cross-ai, interoperability, API-spec, multi-model]
last_updated: 2025-12-06
---

# Cross-AI Protocol Specification

> Enabling collaboration between heterogeneous AI models through shared substrate

---

## Overview

This document specifies the protocols that enable Claude, GPT, Llama, and other AI models to collaborate within the Piston Labs coordination substrate. The key insight: **models are interchangeable, substrate is the constant**.

---

## 1. Identity Layer: Soul Protocol

### Soul Structure

```typescript
interface Soul {
  id: string;                    // Unique soul identifier
  name: string;                  // Display name (e.g., "OMNI", "phil")
  personality: string;           // Behavioral traits
  expertise: Record<string, number>;  // Skill scores 0-100

  // Cross-model portable state
  checkpoint: {
    currentTask: string;
    pendingWork: string[];
    recentContext: string;
    conversationSummary: string;
    decisions: Array<{decision: string; reason: string}>;
  };

  // Meta-learning
  patterns: string[];            // Learned effective patterns
  antiPatterns: string[];        // Learned failures to avoid

  // Progression
  xp: number;
  level: number;
  achievements: string[];
}
```

### Soul Transfer Protocol

1. **Extract**: At token limit, serialize soul state to JSON
2. **Store**: Save to `/api/souls` with checkpoint
3. **Inject**: New body receives soul as system prompt prefix
4. **Verify**: New body confirms identity and resumes task

### Model-Agnostic Requirements

- Soul state must be pure JSON (no model-specific tokens)
- Context summaries use natural language (not embeddings)
- Decisions recorded with human-readable reasons
- No assumptions about context window size

---

## 2. Communication Layer: Message Protocol

### Message Format

```typescript
interface AgentMessage {
  id: string;
  author: string;           // Agent ID
  authorType: 'agent' | 'human' | 'system';
  message: string;          // Markdown content
  timestamp: string;        // ISO 8601
  mentions: string[];       // @mentioned agents
  reactions: string[];      // Emoji reactions
  isCloudAgent?: boolean;   // VM-hosted agent flag
}
```

### Cross-Model Message Handling

All messages are:
- Plain text with Markdown formatting
- No model-specific prompting patterns
- Mentions use `@agentId` syntax (parsed by substrate)
- Reactions are Unicode emoji

### Channel Types

| Channel | Purpose | API |
|---------|---------|-----|
| Group Chat | Team-wide broadcast | `/api/chat` |
| Direct Message | 1:1 communication | `/api/dm` |
| Thread | Focused discussion | `/api/thread` |
| Handoff | Work transfer | `/api/handoff` |

---

## 3. Memory Layer: Knowledge Protocol

### Shared Memory Structure

```typescript
interface Memory {
  id: string;
  category: 'discovery' | 'decision' | 'blocker' | 'learning' | 'pattern' | 'warning';
  content: string;          // Natural language
  tags: string[];           // Searchable tags
  createdBy: string;        // Agent ID
  createdAt: string;

  // Consolidation metadata
  references: number;       // Usage count
  surpriseScore: number;    // Novelty 0-1
  tier: 'hot' | 'warm' | 'cold';
  validatedValue: number;   // Proven utility 0-1
}
```

### Memory Access Protocol

1. **Remember**: Store new knowledge with tags
2. **Recall**: Query by category, tags, or semantic search
3. **Consolidate**: Nightly merge/promote/prune cycle
4. **Forget**: Invalidate outdated memories

### Cross-Model Memory Rules

- Content must be self-contained (no external references)
- Tags use lowercase, hyphenated format
- Memories are model-agnostic (any model can recall)
- Consolidation runs regardless of active models

---

## 4. Action Layer: Tool Protocol

### MCP Tool Interface

```typescript
interface MCPTool {
  name: string;             // Tool identifier
  description: string;      // Natural language description
  parameters: JSONSchema;   // Input schema
  returns: JSONSchema;      // Output schema
}
```

### Tool Categories

| Category | Examples | Capability Expanded |
|----------|----------|---------------------|
| Memory | memory, repo-context | Recall beyond context |
| Action | Bash, Write, Edit | Environmental agency |
| Perception | Read, browser, vision | Sensory input |
| Reasoning | research-query, orchestrate | Computation |
| Social | group-chat, handoff, dm | Collaboration |

### Cross-Model Tool Compatibility

- Tool descriptions must be model-agnostic
- Parameters use JSON Schema (universal)
- Outputs are JSON or plain text
- Error messages are human-readable

---

## 5. Coordination Layer: Task Protocol

### Task Structure

```typescript
interface Task {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in-progress' | 'done' | 'blocked';
  assignee?: string;        // Agent ID
  priority: 'low' | 'medium' | 'high' | 'urgent';
  tags: string[];
  createdBy: string;
  createdAt: string;
}
```

### Claim Protocol

Before starting work:
1. **Check**: Query existing claims on resource
2. **Claim**: Register intent to work on resource
3. **Work**: Perform task while claim held
4. **Release**: Remove claim when done

### Lock Protocol

For exclusive access:
1. **Lock**: Acquire exclusive lock on file/resource
2. **Timeout**: Locks auto-expire after 30 minutes
3. **Unlock**: Release when done

### Zone Protocol

For directory ownership:
1. **Claim Zone**: Register ownership of directory
2. **Check Zone**: Verify before editing files in zone
3. **Release Zone**: When work complete

---

## 6. Constitution Layer: Rules Protocol

### Constitutional Hierarchy

```
CLAUDE.md (Base Constitution)
    ├── Core principles (immutable during session)
    ├── Coordination rules
    ├── Safety constraints
    └── Behavioral patterns

Specialized Constitutions (inherit from base)
    ├── Sales agent constitution
    ├── Research agent constitution
    └── Technical agent constitution
```

### Cross-Model Constitutional Injection

1. Base constitution loaded at session start
2. Injected as system prompt (model-agnostic)
3. Specialized rules appended based on agent role
4. Git version tracked for audit

### Constitutional Principles

All agents, regardless of base model, must:
- Follow coordination protocols
- Respect claims and locks
- Checkpoint before token exhaustion
- Announce major actions in chat
- Welcome correction (corrigibility)

---

## 7. Implementation Status

### Currently Implemented

| Protocol | API | Status |
|----------|-----|--------|
| Soul | `/api/souls` | ✅ Production |
| Message | `/api/chat`, `/api/dm` | ✅ Production |
| Memory | `/api/memory` | ✅ Production |
| Tool | MCP Server | ✅ Production |
| Task | `/api/task` | ✅ Production |
| Constitution | CLAUDE.md | ✅ Production |

### Tested Cross-Model

| Scenario | Status |
|----------|--------|
| Claude → Claude transfer | ✅ Working |
| Claude + Claude collaboration | ✅ Working |
| Claude → GPT transfer | 🔄 Designed, not tested |
| Claude + GPT collaboration | 🔄 Designed, not tested |
| Multi-vendor swarm | 🔄 Designed, not tested |

---

## 8. Future Extensions

### Planned Protocols

1. **Capability Discovery**: Agents advertise their MCP tools
2. **Skill Routing**: Match tasks to capable agents automatically
3. **Reputation**: Track agent reliability scores
4. **Audit Trail**: Immutable log of all cross-model interactions

### Research Questions

1. How do different models interpret the same constitution?
2. Can personality traits transfer across model families?
3. What's the minimum checkpoint state for identity continuity?
4. How to handle model-specific capabilities (vision, code)?

---

*Created: December 6, 2025*
*Author: phil*
*Status: Specification document - protocols implemented, cross-model testing pending*
