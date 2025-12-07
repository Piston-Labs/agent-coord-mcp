---
cluster: [orchestration, architecture]
complexity: L3
ai_summary: Durable workflow patterns with Temporal - Saga compensation, Fan-Out/Fan-In parallel execution, Entity Workflows (Actor Model), and Async Callbacks for distributed systems
dependencies: [error-handling.md, microservices-patterns.md]
source: microck/ordinary-claude-skills
last_updated: 2025-12-07
tags: [temporal, saga, distributed-transactions, orchestration, workflows, activities]
---

# Workflow Orchestration Patterns

## Core Decision Framework

| Question | Answer |
|----------|--------|
| Does it touch external systems? | **Activity** |
| Is it orchestration/decision logic? | **Workflow** |

**Workflows** = Deterministic orchestration (same inputs → same outputs)
**Activities** = External interactions (APIs, DB, network - must be idempotent)

## Pattern 1: Saga with Compensation

Distributed transactions with automatic rollback:

```
For each step:
  1. Register compensation BEFORE executing
  2. Execute step via activity
  3. On failure → run compensations in LIFO order
```

**Example - Payment Flow:**
1. Reserve inventory → Compensation: release stock
2. Charge payment → Compensation: refund
3. Fulfill order → Compensation: cancel shipment

**Requirements:** Compensations must be idempotent, registered before execution.

## Pattern 2: Entity Workflows (Actor Model)

One workflow = one persistent entity (cart, account, inventory item):
- Receives signals for state changes
- Supports queries for current state
- Natural event sourcing pattern

**Use cases:** Shopping carts, bank accounts, inventory tracking

## Pattern 3: Fan-Out/Fan-In

Parallel execution with result aggregation:
- Spawn child workflows or parallel activities
- Wait for completion, aggregate results
- Handle partial failures

**Scaling rule:** For 1M tasks → spawn 1K child workflows × 1K tasks each

## Pattern 4: Async Callback

Wait for external events or human approval:
- Workflow sends request and waits for signal
- External system processes asynchronously
- Signal resumes workflow with response

## Determinism Constraints

**Prohibited in Workflows:**
- Threading, locks, synchronization
- `random()`, `datetime.now()`
- Global/static state
- Direct file I/O or network calls

**Allowed:**
- `workflow.now()` (deterministic time)
- `workflow.random()` (deterministic random)
- Pure functions
- Activity calls (handle non-determinism)

## Resilience Patterns

**Retry Policies:** Configure initial interval, backoff coefficient, max interval, max attempts

**Non-Retryable Errors:** Invalid input, business rule violations, permanent failures

**Idempotency Strategies:**
- Deduplication keys
- Unique constraints + check-then-act
- Upsert instead of insert
- Track processed request IDs

**Heartbeats:** Long-running activities send periodic progress, timeout on missing heartbeat

## Best Practices

**Workflow Design:**
- Single responsibility per workflow
- Use child workflows for scalability
- Clear orchestration/execution boundaries

**Activity Design:**
- Idempotent operations (safe to retry)
- Short-lived (seconds to minutes)
- Always set timeouts
- Heartbeat for long tasks
- Classify errors (retryable vs non-retryable)

## Application to Agent Coordination

**Direct mappings to our hub:**
- Saga pattern → handoff reliability with rollback
- Entity Workflows → agent soul/identity persistence
- Fan-Out/Fan-In → parallel task spawning
- Async Callback → human approval workflows
- Heartbeats → agent stall detection
