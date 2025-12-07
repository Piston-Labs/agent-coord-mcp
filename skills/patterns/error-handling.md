---
cluster: [technical, patterns]
complexity: L2
ai_summary: Error handling patterns including circuit breaker, retry with backoff, graceful degradation, and error aggregation for resilient distributed systems
dependencies: []
last_updated: 2025-12-07
tags: [error-handling, circuit-breaker, retry, resilience, fault-tolerance]
source: ordinary-claude-skills
---

# Error Handling Patterns

Resilient error management covering exception handling, Result types, error propagation, and graceful degradation strategies.

## Error Classification

### Recoverable Errors
- Network timeouts
- Missing files
- Invalid input
- API rate limits
- Temporary service unavailability

### Unrecoverable Errors
- Memory exhaustion
- Stack overflow
- Programming defects
- Corrupt data
- Security violations

## Core Patterns

### 1. Circuit Breaker

Prevents cascading failures by managing three states:

```
CLOSED (Normal)
    │
    ↓ (failures exceed threshold)
    │
OPEN (Failing)
    │
    ↓ (timeout expires)
    │
HALF_OPEN (Testing)
    │
    ├── Success → CLOSED
    └── Failure → OPEN
```

**Implementation:**
```python
class CircuitBreaker:
    def __init__(self, failure_threshold=5, timeout=60):
        self.state = "CLOSED"
        self.failures = 0
        self.failure_threshold = failure_threshold
        self.timeout = timeout
        self.last_failure_time = None

    def call(self, func, *args, **kwargs):
        if self.state == "OPEN":
            if time.time() - self.last_failure_time > self.timeout:
                self.state = "HALF_OPEN"
            else:
                raise CircuitOpenError()

        try:
            result = func(*args, **kwargs)
            self.on_success()
            return result
        except Exception as e:
            self.on_failure()
            raise

    def on_success(self):
        self.failures = 0
        self.state = "CLOSED"

    def on_failure(self):
        self.failures += 1
        self.last_failure_time = time.time()
        if self.failures >= self.failure_threshold:
            self.state = "OPEN"
```

### 2. Retry with Exponential Backoff

```python
def retry_with_backoff(func, max_retries=3, base_delay=1):
    for attempt in range(max_retries):
        try:
            return func()
        except RetryableError as e:
            if attempt == max_retries - 1:
                raise
            delay = base_delay * (2 ** attempt)
            time.sleep(delay)
```

**Configuration:**
- Initial delay: 1 second
- Backoff multiplier: 2x
- Maximum delay cap: 60 seconds
- Maximum attempts: 5
- Jitter: Add random 0-25% to prevent thundering herd

### 3. Error Aggregation

Collect multiple errors instead of failing immediately:

```python
class ValidationResult:
    def __init__(self):
        self.errors = []

    def add_error(self, field, message):
        self.errors.append({"field": field, "message": message})

    def is_valid(self):
        return len(self.errors) == 0
```

Use for: Form validation, batch processing, configuration checking.

### 4. Graceful Degradation

Provide fallback functionality when primary fails:

```python
async def get_data(id):
    try:
        return await fetch_from_primary(id)
    except PrimaryError:
        try:
            return await fetch_from_cache(id)
        except CacheError:
            return get_default_value(id)
```

**Levels:**
1. Primary service
2. Cache/replica
3. Stale data with warning
4. Default/placeholder
5. Error message

## Best Practices

1. **Validate inputs early** - Fail fast with clear messages
2. **Maintain context** - Stack traces, metadata, correlation IDs
3. **Clear error messages** - Actionable, specific, user-friendly
4. **Log judiciously** - Don't duplicate, include context
5. **Handle at right level** - Appropriate abstraction for recovery
6. **Ensure cleanup** - Resources released on all paths
7. **Never suppress silently** - At minimum, log
8. **Use type-safe errors** - Custom error classes with metadata

## Common Mistakes

- Overly broad exception catching (`except Exception`)
- Empty error handlers
- Redundant logging with re-throwing
- Resource leaks in error paths
- Vague error messages ("Something went wrong")
- Using error codes instead of exceptions
- Unhandled promise rejections

## Application to Agent Coordination Hub

### Current Error Handling
- MCP tools return error responses
- errors tool captures and tracks issues
- Some retry logic in external calls

### Enhancement Ideas

1. **Add Circuit Breaker to external calls**
   - Redis connections
   - External APIs (GitHub, Linear, Discord)
   - AWS services

2. **Standardize error responses**
   ```typescript
   interface HubError {
     code: string;
     message: string;
     recoverable: boolean;
     retryAfter?: number;
     context?: Record<string, any>;
   }
   ```

3. **Graceful degradation for features**
   - If Redis down, use in-memory fallback
   - If GitHub unavailable, queue operations
   - If context loading fails, proceed without

4. **Error aggregation for batch operations**
   - Spawn-parallel collects all errors
   - Validation returns all issues at once
