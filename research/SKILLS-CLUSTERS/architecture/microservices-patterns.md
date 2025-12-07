---
cluster: [architecture, distributed-systems]
complexity: L2
ai_summary: Microservices patterns for multi-agent coordination - event-driven pub/sub, circuit breaker, bulkhead isolation, saga pattern
dependencies: [workflow-orchestration-patterns.md, error-handling.md]
source: microck/ordinary-claude-skills
last_updated: 2025-12-07
tags: [microservices, distributed-systems, event-driven, resilience, coordination]
---

# Microservices Patterns for Multi-Agent Coordination

## Event-Driven Communication

Asynchronous coordination via event streaming (Kafka) and Pub/Sub:
- Each agent publishes domain events
- Other agents subscribe to relevant topics
- Loose coupling, no direct dependencies
- Enables parallel agent operations

## Service Decomposition

Organize agents around distinct business functions:
- Each service owns its domain
- Independent data stores per agent
- Clear boundaries prevent bottlenecks
- Natural parallelization

## Saga Pattern for Coordination

Distributed transactions across multiple agents:

```
For each step:
  1. Execute agent action
  2. On success → continue
  3. On failure → compensate all previous steps
```

Example flow:
1. Agent A: Reserve resource → Compensation: Release resource
2. Agent B: Process data → Compensation: Rollback changes
3. Agent C: Notify → Compensation: Cancel notification

## Resilience Patterns

### Circuit Breaker
Fail fast on repeated errors:
- Track failure count for each agent interaction
- Trip circuit after threshold
- Allow recovery time before retry
- Prevents cascading failures

### Bulkhead Isolation
Isolate resources per agent:
- Separate thread pools/connections
- One agent's failure doesn't exhaust shared resources
- Graceful degradation

### API Gateway Aggregation
Central gateway for agent coordination:
- Route requests to appropriate agents
- Aggregate responses from multiple agents
- Handle partial failures gracefully
- Return partial results vs complete failure

## Application to Agent Coordination

**Direct mappings:**
- Event-driven → Group chat pub/sub for agent coordination
- Circuit Breaker → Agent stall detection and bypass
- Bulkhead → Resource locks per agent
- Saga → Handoff with rollback capability
- Gateway → Our coordination hub API
