---
cluster: [coordination, technical]
complexity: L2
ai_summary: Temporal-based workflow orchestration patterns including Saga, Entity Workflows, Fan-Out/Fan-In, and async callbacks for durable distributed systems
dependencies: []
last_updated: 2025-12-07
tags: [temporal, saga, orchestration, workflows, distributed-systems, compensation]
source: ordinary-claude-skills
---

# Workflow Orchestration Patterns

Design durable workflows using Temporal for distributed systems, distinguishing between orchestration logic (workflows) and external interactions (activities).

## Fundamental Rule

**Workflows** = orchestration logic and decision-making
**Activities** = external interactions (APIs, databases, network calls)

### Workflow Characteristics
- Contain business logic and coordination
- Must be deterministic (identical inputs produce identical outputs)
- Cannot perform direct external calls
- State automatically preserved across failures
- Persist for years despite infrastructure failures

### Activity Characteristics
- Handle all external system interactions
- Can be non-deterministic
- Include built-in timeouts and retry logic
- Must be idempotent (calling N times equals calling once)
- Typically short-lived (seconds to minutes)

## Core Patterns

### 1. Saga Pattern with Compensation

Register compensation logic before executing each step. On failure, run compensations in reverse order (LIFO). Compensations must be idempotent and handle partial failures gracefully.

```
Step 1: Reserve inventory  → Compensation: Release inventory
Step 2: Charge payment     → Compensation: Refund payment
Step 3: Fulfill order      → Compensation: Cancel fulfillment
```

On failure at Step 3:
1. Cancel fulfillment (Step 3 compensation)
2. Refund payment (Step 2 compensation)
3. Release inventory (Step 1 compensation)

### 2. Entity Workflows (Actor Model)

One workflow execution represents one entity instance (cart, account, inventory item):
- Workflow persists for entity lifetime
- Receives signals for state changes
- Supports queries for current state
- Natural fit for stateful entities

### 3. Fan-Out/Fan-In (Parallel Execution)

Spawn multiple child workflows or parallel activities:
- Wait for completion
- Aggregate results
- Handle partial failures

**Scaling Rule:** Decompose into child workflows (1K x 1K tasks rather than 1M direct tasks)

### 4. Async Callback Pattern

Workflow sends request and waits for signal:
1. Workflow initiates async operation
2. External system processes asynchronously
3. External system signals workflow to resume

Use cases: Human approvals, webhook callbacks, long-running external processes

## Determinism Constraints

### Prohibited in Workflows
- Threading, locks, synchronization primitives
- Random number generation (`random()`)
- Global state or static variables
- System time (`datetime.now()`)
- Direct file I/O or network calls
- Non-deterministic libraries

### Allowed in Workflows
- `workflow.now()` (deterministic time)
- `workflow.random()` (deterministic random)
- Pure functions and calculations
- Activity calls

## Resilience and Error Handling

### Retry Policies
- Initial retry interval
- Backoff coefficient (exponential)
- Maximum interval cap
- Maximum attempts
- Classify non-retryable errors: invalid input, business rule violations, permanent failures

### Idempotency Requirements
Activities may execute multiple times due to network failures. Implement via:
- Idempotency keys
- Check-then-act with unique constraints
- Upsert operations
- Request ID tracking

### Activity Heartbeats
Long-running activities send periodic heartbeats with progress information:
- Timeout triggers if no heartbeat received
- Enables progress-based retries

## Best Practices

**Workflow Design:**
- Keep focused (single responsibility)
- Use child workflows for scalability
- Maintain clear boundaries
- Test locally with time-skipping environments

**Activity Design:**
- Ensure idempotency
- Keep short-lived
- Configure timeouts
- Add heartbeats for long tasks
- Distinguish retryable vs. non-retryable errors

**Common Pitfalls:**
- Using `datetime.now()` instead of `workflow.now()`
- Threading in workflows
- Direct API calls from workflows
- Non-idempotent activity operations
- Missing timeouts
- Ignoring payload limits (2MB per argument)

## Application to Agent Coordination

For our multi-agent hub:
- **Agent tasks as workflows** - Deterministic orchestration of agent work
- **External API calls as activities** - MCP tools, web fetches, etc.
- **Saga pattern for multi-step tasks** - Compensation on failure
- **Entity workflows for agents** - One workflow per agent session
- **Fan-out for parallel agents** - Spawn multiple agents, aggregate results
