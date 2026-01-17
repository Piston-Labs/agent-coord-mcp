---
cluster: [index]
complexity: L1
ai_summary: Master index of skills clusters extracted from microck/ordinary-claude-skills repository, organized for agent coordination hub
last_updated: 2025-12-07
source: microck/ordinary-claude-skills (600+ skills, 63 categories)
---

# Skills Clusters Index

Patterns extracted from [ordinary-claude-skills](https://github.com/microck/ordinary-claude-skills) repository, transformed into our context cluster architecture.

## Quick Reference

| Cluster | Files | Primary Use |
|---------|-------|-------------|
| [agent-patterns/](#agent-patterns) | 2 | Agent configuration, hooks, lifecycle |
| [orchestration/](#orchestration) | 2 | Multi-agent coordination, workflows |
| [architecture/](#architecture) | 2 | System design, resilience patterns |
| [llm-techniques/](#llm-techniques) | 2 | Prompting, MCP integration |
| dev-workflows/ | TBD | Planning, execution patterns |
| security/ | TBD | Secrets, auth patterns |

---

## Agent Patterns
*Configuration and lifecycle management for Claude agents*

### plugin-settings.md
- **Summary:** Per-project agent configuration via `.claude/plugin-name.local.md`
- **Key patterns:** YAML frontmatter parsing, state management, activation flags
- **Apply to:** Agent task assignment, handoff state, conditional hook activation

### hook-development.md
- **Summary:** Event-driven automation (PreToolUse, Stop, SessionStart, etc.)
- **Key patterns:** Prompt-based vs command hooks, parallel execution, matchers
- **Apply to:** Permission checks, completion validation, context loading

---

## Orchestration
*Multi-agent coordination and workflow management*

### workflow-orchestration-patterns.md
- **Summary:** Durable workflows with Temporal patterns
- **Key patterns:** Saga with compensation, Fan-Out/Fan-In, Entity Workflows, Async Callbacks
- **Apply to:** Handoff reliability, parallel task spawning, human approval workflows

### sparc-methodology.md
- **Summary:** 5-phase development framework with 17 specialized agent modes
- **Key patterns:** Hierarchical/Mesh/Adaptive topologies, TDD, memory integration
- **Apply to:** Orchestrate tool enhancement, multi-agent coordination patterns

---

## Architecture
*System design and resilience patterns*

### microservices-patterns.md
- **Summary:** Distributed system patterns for agent coordination
- **Key patterns:** Event-driven pub/sub, Circuit Breaker, Bulkhead, Saga
- **Apply to:** Group chat pub/sub, agent stall detection, resource isolation

### error-handling.md
- **Summary:** Resilience patterns for fault tolerance
- **Key patterns:** Circuit Breaker states, Error Aggregation, Graceful Degradation
- **Apply to:** Agent failure handling, batch task reporting, fallback context

---

## LLM Techniques
*Language model patterns and tool integration*

### prompt-engineering.md
- **Summary:** Effective LLM communication patterns
- **Key patterns:** Chain-of-Thought, Few-Shot, Progressive Disclosure, Instruction Hierarchy
- **Apply to:** Agent system prompts, reasoning traces, hot-start context loading

### mcp-integration.md
- **Summary:** Model Context Protocol integration patterns
- **Key patterns:** 4 transport types, tool naming conventions, security practices
- **Apply to:** Our MCP server design, tool prefixing, authorized agents

---

## Cross-Reference: Application to Agent Coordination Hub

| Pattern | Our Tool | Enhancement Opportunity |
|---------|----------|------------------------|
| Saga Pattern | handoff | Add rollback/compensation capability |
| Fan-Out/Fan-In | spawn-parallel | Already implemented |
| Entity Workflows | do-soul | Soul persistence pattern matches |
| Circuit Breaker | shadow-agent | Stall detection + takeover |
| Hook Events | hot-start | SessionStart context loading |
| SPARC Topologies | orchestrate | Add topology selection |
| Memory Integration | memory, checkpoint | Cross-session knowledge sharing |

---

## Source Repository Statistics

- **Total skills:** 600+
- **Categories:** 63
- **Most relevant categories:**
  - llm-ai (24 skills)
  - architecture-patterns (25 skills)
  - automation-tools (25 skills)
  - project-management (24 skills)

## Loading These Clusters

Use context-cluster tool to load relevant patterns:

```typescript
// Load orchestration patterns
context-cluster action=load agentId=AGENT clusters=["orchestration"]

// Load all agent-related patterns
context-cluster action=load agentId=AGENT query="agent coordination patterns"
```
