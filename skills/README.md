---
cluster: [coordination]
complexity: L1
ai_summary: Skills library index - curated patterns from ordinary-claude-skills organized by context cluster for token-optimized loading
last_updated: 2025-12-07
tags: [skills, index, patterns, context-clusters]
---

# Skills Library

Curated skills extracted from [ordinary-claude-skills](https://microck.github.io/ordinary-claude-skills/) (600+ skills), organized by context cluster for token-optimized loading.

## Quick Reference

| Skill | Cluster | Complexity | Key Pattern |
|-------|---------|------------|-------------|
| [Workflow Orchestration](coordination/workflow-orchestration.md) | coordination | L2 | Saga, Entity Workflows, Fan-Out/Fan-In |
| [SPARC Methodology](coordination/sparc-methodology.md) | coordination | L3 | 5-phase, 17-mode multi-agent orchestration |
| [Execute-Plan](coordination/execute-plan.md) | coordination | L1 | Status markers, execution cycle |
| [MCP Integration](infrastructure/mcp-integration.md) | infrastructure | L2 | Server types, autonomous agent patterns |
| [Hook Development](infrastructure/hook-development.md) | infrastructure | L2 | Event-driven validation, prompt hooks |
| [Error Handling](patterns/error-handling.md) | patterns | L2 | Circuit breaker, retry, degradation |
| [Distributed Tracing](patterns/distributed-tracing.md) | patterns | L2 | Traces, spans, context propagation |
| [Prompt Engineering](development/prompt-engineering.md) | development | L2 | Few-shot, CoT, templates |
| [Skill Development](development/skill-development.md) | development | L2 | Meta-skill, triggers, hooks |
| [Research Methodology](development/research-methodology.md) | development | L2 | Code-first research, verification |
| [Debugging Strategies](development/debugging-strategies.md) | development | L2 | Scientific method, 4-phase process |
| [Code Review](development/code-review.md) | development | L2 | 4-phase review, severity labels |
| [Test-Driven Development](development/test-driven-development.md) | development | L2 | Red-Green-Refactor cycle |
| [API Design](patterns/api-design.md) | patterns | L2 | REST/GraphQL best practices |

## Directory Structure

```
skills/
├── coordination/       # Multi-agent orchestration patterns
│   ├── workflow-orchestration.md
│   ├── sparc-methodology.md
│   └── execute-plan.md
├── infrastructure/     # System integration patterns
│   ├── mcp-integration.md
│   └── hook-development.md
├── patterns/           # Reusable design patterns
│   ├── error-handling.md
│   ├── distributed-tracing.md
│   └── api-design.md
├── development/        # Development practices
│   ├── prompt-engineering.md
│   ├── skill-development.md
│   ├── research-methodology.md
│   ├── debugging-strategies.md
│   ├── code-review.md
│   └── test-driven-development.md
└── README.md           # This index
```

## Context Cluster Loading

Skills are tagged with context clusters for token-optimized loading:

```typescript
// Load all coordination skills
context-cluster action=load clusters=["coordination"]

// Load specific skill
file-read-smart filePath="skills/coordination/workflow-orchestration.md"
```

### Cluster Mapping

| Cluster | Skills |
|---------|--------|
| **coordination** | workflow-orchestration, sparc-methodology, execute-plan |
| **technical** | All skills (base technical knowledge) |
| **infrastructure** | mcp-integration, hook-development |
| **patterns** | error-handling, distributed-tracing, api-design |
| **development** | prompt-engineering, skill-development, research-methodology, debugging-strategies, code-review, test-driven-development |

## Complexity Levels

| Level | Description | Token Estimate |
|-------|-------------|----------------|
| L1 | Quick reference, simple patterns | ~500-1000 tokens |
| L2 | Detailed patterns with examples | ~1500-2500 tokens |
| L3 | Comprehensive methodology | ~3000-4000 tokens |

## Usage Patterns

### Before Starting Complex Work
```
1. Check skills/README.md for relevant patterns
2. Load specific skill based on task type
3. Apply patterns from skill to current work
```

### Task Type → Skill Mapping

| Task Type | Recommended Skill |
|-----------|-------------------|
| Multi-step orchestration | workflow-orchestration |
| Large feature with agents | sparc-methodology |
| Plan execution | execute-plan |
| External service integration | mcp-integration |
| Event automation | hook-development |
| Error-prone operations | error-handling |
| Multi-agent debugging | distributed-tracing |
| Prompt improvement | prompt-engineering |
| Creating new skills | skill-development |
| Technical research | research-methodology |
| Bug investigation | debugging-strategies |
| PR reviews | code-review |
| Test-first development | test-driven-development |
| Building APIs | api-design |

## Source

All skills curated from [ordinary-claude-skills](https://github.com/microck/ordinary-claude-skills):
- 600+ skills in 63 categories
- MIT licensed
- Community maintained

## Contributing

To add a skill:
1. Create file in appropriate directory
2. Add YAML frontmatter with cluster, complexity, ai_summary
3. Include "Application to Agent Coordination Hub" section
4. Update this README index
