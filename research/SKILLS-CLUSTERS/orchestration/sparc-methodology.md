---
cluster: [orchestration, methodology]
complexity: L3
ai_summary: SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) methodology with 17 specialized modes and 5 multi-agent orchestration patterns
dependencies: [workflow-orchestration-patterns.md]
source: microck/ordinary-claude-skills
last_updated: 2025-12-07
tags: [sparc, tdd, multi-agent, orchestration, methodology, claude-flow]
---

# SPARC Methodology

## Core Philosophy

**SPARC** = Specification → Pseudocode → Architecture → Refinement → Completion

Key principles:
- Specification before code
- Design before implementation
- Tests before features (TDD)
- Review everything
- Document continuously

## Development Phases

| Phase | Goal | Key Modes |
|-------|------|-----------|
| **Specification** | Define requirements, constraints | researcher, analyzer |
| **Architecture** | Design system structure | architect, designer |
| **Refinement** | TDD implementation | tdd, coder, tester |
| **Review** | Quality, security, performance | reviewer, optimizer |
| **Completion** | Integration, deployment | workflow-manager, documenter |

## 17 Specialized Modes

### Orchestration Modes
- **orchestrator** - Task decomposition, agent coordination
- **swarm-coordinator** - Topology management (mesh/hierarchical/ring/star)
- **workflow-manager** - Process automation, pipelines
- **batch-executor** - Parallel task execution

### Development Modes
- **coder** - Code generation with batch file operations
- **architect** - System design with memory coordination
- **tdd** - Test-driven development (90%+ coverage target)
- **reviewer** - Code quality, security scanning

### Analysis Modes
- **researcher** - Parallel web search, memory integration
- **analyzer** - Static analysis, pattern recognition
- **optimizer** - Performance bottleneck resolution
- **debugger** - Systematic issue resolution

### Creative/Support
- **designer** - UI/UX with accessibility
- **innovator** - Creative problem-solving
- **documenter** - Comprehensive documentation
- **tester** - Test suite expansion
- **memory-manager** - Knowledge persistence

## Orchestration Patterns

### 1. Hierarchical Coordination
Clear delegation hierarchy for complex projects:
```
Coordinator
├── architect
├── coder
├── tester
└── reviewer
```

### 2. Mesh Coordination
Peer-to-peer for collaborative tasks - balanced strategy

### 3. Sequential Pipeline
Ordered execution: spec → design → code → test → review

### 4. Parallel Execution
Independent tasks running concurrently with dependency tracking

### 5. Adaptive Strategy
Dynamic topology adjusting to workload changes

## TDD Workflow (Red-Green-Refactor)

```
1. RED: Write failing test
2. GREEN: Implement minimum code to pass
3. REFACTOR: Improve code quality
4. Repeat
```

## Performance Benefits

- **84.8%** SWE-Bench solve rate
- **32.3%** token reduction
- **2.8-4.4x** speed improvement with parallel execution
- **90%+** test coverage standard

## Best Practices

### Memory Integration
Store architectural decisions, share across agents:
```javascript
mcp__claude-flow__memory_usage {
  action: "store",
  namespace: "architecture",
  key: "api-design-v1",
  value: apiDesign
}
```

### Parallel Operations
Batch all related operations in single message:
```javascript
// ✅ CORRECT: All together
mcp__claude-flow__agent_spawn { type: "researcher" }
mcp__claude-flow__agent_spawn { type: "coder" }
mcp__claude-flow__agent_spawn { type: "tester" }
TodoWrite { todos: [...] }
```

## Application to Agent Coordination

**Direct mappings:**
- Orchestration modes → Our `orchestrate` tool
- Swarm topology → Multi-agent coordination patterns
- Memory integration → Our `memory` and `checkpoint` tools
- Parallel execution → Our `spawn-parallel` tool
- TDD workflow → QC checklist requirements

**Enhancement opportunities:**
1. Add topology selection to orchestrate tool
2. Implement adaptive strategy for dynamic workloads
3. Add memory-based coordination for cross-session context
