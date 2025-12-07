---
cluster: [coordination, technical]
complexity: L3
ai_summary: SPARC multi-agent orchestration methodology with 5 phases (Specification, Pseudocode, Architecture, Refinement, Completion) and 17 operational modes achieving 84.8% SWE-Bench solve rate
dependencies: [workflow-orchestration.md]
last_updated: 2025-12-07
tags: [sparc, multi-agent, orchestration, tdd, methodology, agents]
source: ordinary-claude-skills
---

# SPARC Methodology

A systematic development methodology integrated with multi-agent orchestration capabilities providing 17 specialized operational modes.

## Five Development Phases

### Phase 1 - Specification
Requirements analysis, constraint identification, and success metrics.
- **Modes:** researcher, analyzer, memory-manager
- **Output:** Clear requirements document with constraints

### Phase 2 - Architecture
System structure design through architect, designer, and orchestrator modes.
- **Modes:** architect, designer, orchestrator
- **Output:** Component interfaces, infrastructure plans

### Phase 3 - Refinement (TDD)
Test-first implementation via red-green-refactor cycles.
- **Modes:** tdd, coder, tester
- **Target:** 90%+ code coverage

### Phase 4 - Review
Quality assurance through reviewer, optimizer, and debugger modes.
- **Focus:** Security, performance, best practices
- **Modes:** reviewer, optimizer, debugger

### Phase 5 - Completion
Integration and deployment orchestration.
- **Modes:** workflow-manager, documenter, memory-manager
- **Output:** Deployed, documented solution

## Key Operational Modes

| Mode | Purpose |
|------|---------|
| **Orchestrator** | Multi-agent task decomposition and coordination |
| **Coder** | Autonomous code generation with ES2022+ standards |
| **Architect** | System design (microservices, event-driven, DDD) |
| **TDD** | Test-driven development with comprehensive strategies |
| **Reviewer** | Batch file analysis for quality and security |
| **Researcher** | Parallel web research with memory integration |
| **Optimizer** | Performance bottleneck resolution |
| **Documenter** | API, architecture, and user documentation |
| **Debugger** | Systematic root cause analysis and fixes |

## Orchestration Patterns

### Hierarchical
Clear delegation with coordinator and specialists.
```
Orchestrator
├── Researcher (gathers context)
├── Architect (designs solution)
├── Coder (implements)
└── Tester (validates)
```

### Mesh
Peer-to-peer collaborative coordination.
- Agents communicate directly
- No central coordinator
- Good for creative tasks

### Sequential Pipeline
Ordered workflow execution.
```
spec → design → code → test → review → deploy
```

### Parallel Execution
Concurrent independent task processing.
- Multiple agents work simultaneously
- Results aggregated at end
- 2.8-4.4x speed improvement

### Adaptive Strategy
Dynamic workload adjustment based on:
- Task complexity
- Available resources
- Intermediate results

## Performance Achievements

- **84.8% SWE-Bench solve rate**
- **32.3% token reduction**
- **2.8-4.4x speed improvement** with parallel execution

## Essential Best Practices

1. **Use Memory** for cross-agent coordination persistence
2. **Batch related operations** in single messages for efficiency
3. **Maintain 90%+ test coverage** across phases
4. **Document continuously** throughout development
5. **Organize files** in structured directories (src/, tests/, docs/)
6. **Leverage hooks** for pre-task, post-edit, and post-task automation

## Application to Agent Coordination Hub

### Mode Mapping
| SPARC Mode | Hub Equivalent |
|------------|----------------|
| Orchestrator | orchestrate tool |
| Researcher | Task agent with Explore type |
| Memory | memory tool |
| Reviewer | QC workflow |

### Recommended Adoption
1. **Implement mode switching** - Agents declare current mode
2. **Add phase tracking** - Track which SPARC phase task is in
3. **Parallel execution** - Use spawn-parallel for independent subtasks
4. **Memory integration** - Already have this, use more
5. **TDD enforcement** - Add test requirements to workflows
