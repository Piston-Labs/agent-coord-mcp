---
cluster: [architecture, resilience]
complexity: L2
ai_summary: Error handling patterns - Circuit Breaker, Error Aggregation, Graceful Degradation with language-specific implementations
dependencies: [microservices-patterns.md]
source: microck/ordinary-claude-skills
last_updated: 2025-12-07
tags: [error-handling, resilience, circuit-breaker, retry, graceful-degradation]
---

# Error Handling Patterns

## Core Philosophy

**Exceptions** = Disrupting control flow for unexpected conditions
**Result Types** = Explicit success/failure for expected errors

| Error Type | Best Approach |
|------------|---------------|
| Recoverable (network timeout) | Result types with retry |
| Unrecoverable (invalid config) | Panic/throw |
| Expected business errors | Result types |

## Universal Patterns

### 1. Circuit Breaker
Prevents cascading failures in distributed systems:

```
States: CLOSED → OPEN → HALF-OPEN → CLOSED

CLOSED: Normal operation, track failures
OPEN: Block all requests (after threshold)
HALF-OPEN: Allow test request
```

### 2. Error Aggregation
Collect multiple errors instead of failing immediately:
- Enables comprehensive validation feedback
- Returns all issues at once
- Better UX for form validation

### 3. Graceful Degradation
Fallback functionality when primary fails:
- Cache stale data when API unavailable
- Default values when config missing
- Reduced functionality vs complete failure

## Retry Strategies

### Exponential Backoff
```
attempt 1: wait 1s
attempt 2: wait 2s
attempt 3: wait 4s
attempt 4: wait 8s (max)
```

### Jitter
Add randomness to prevent thundering herd:
```
delay = base_delay * (2 ^ attempt) + random(0, 1000ms)
```

### Non-Retryable Errors
- Input validation failures
- Authentication errors
- Business rule violations
- Resource not found (404)

## Best Practices

**DO:**
- Validate input early (fail fast)
- Preserve context through metadata
- Log selectively (expected failures don't need error logs)
- Clean up resources in finally blocks
- Classify errors (retryable vs terminal)

**DON'T:**
- Catch too broadly (`except Exception`)
- Empty catch blocks (invisible failures)
- Swallow errors without logging
- Retry non-retryable errors

## Application to Agent Coordination

**Direct mappings:**
- Circuit Breaker → Agent stall detection threshold
- Error Aggregation → Batch task failure reporting
- Graceful Degradation → Fallback to cached context
- Retry with backoff → MCP tool call retries
- Fail fast → Input validation in coordination API
