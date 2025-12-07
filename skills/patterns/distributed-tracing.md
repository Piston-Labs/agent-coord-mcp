---
cluster: [technical, patterns]
complexity: L2
ai_summary: Distributed tracing patterns for request tracking across services using traces, spans, and context propagation with Jaeger/Tempo integration
dependencies: []
last_updated: 2025-12-07
tags: [tracing, observability, monitoring, jaeger, tempo, spans]
source: ordinary-claude-skills
---

# Distributed Tracing

Track requests across services to identify latency issues, understand dependencies, and locate performance bottlenecks.

## Key Concepts

### Trace Structure

```
Trace (full journey)
├── Span A: API Gateway (50ms)
│   ├── Span B: Auth Service (10ms)
│   └── Span C: Order Service (35ms)
│       ├── Span D: Database Query (15ms)
│       └── Span E: Cache Check (5ms)
```

### Components

| Component | Purpose |
|-----------|---------|
| **Trace** | End-to-end request journey, unique ID |
| **Span** | Single operation within trace |
| **Context** | Trace/span IDs passed between services |
| **Tags** | Key-value metadata for filtering |
| **Logs** | Timestamped events within spans |

### Span Attributes

```json
{
  "traceId": "abc123",
  "spanId": "def456",
  "parentSpanId": "ghi789",
  "operationName": "database.query",
  "startTime": "2025-12-07T06:00:00Z",
  "duration": 15,
  "tags": {
    "db.type": "postgresql",
    "db.statement": "SELECT * FROM orders"
  },
  "logs": [
    {"timestamp": "...", "message": "Query started"}
  ]
}
```

## Context Propagation

HTTP headers carry trace context between services:

```
traceparent: 00-abc123-def456-01
tracestate: vendor=value
```

### Propagation Pattern

```python
# Extract from incoming request
trace_context = extract(request.headers)

# Create child span
with tracer.start_span("process", context=trace_context) as span:
    # Do work
    result = process_data()

    # Inject into outgoing request
    inject(outgoing_request.headers)
    call_downstream_service(outgoing_request)
```

## Sampling Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| **Probabilistic** | Sample X% of traces | Production (1-10%) |
| **Rate Limiting** | Max N traces/second | High-traffic services |
| **Tail-Based** | Keep interesting traces | Error analysis |
| **Always On** | 100% sampling | Development, debugging |

## Implementation with OpenTelemetry

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.exporter.jaeger.thrift import JaegerExporter

# Setup
provider = TracerProvider()
exporter = JaegerExporter(agent_host_name="localhost", agent_port=6831)
provider.add_span_processor(BatchSpanProcessor(exporter))
trace.set_tracer_provider(provider)

tracer = trace.get_tracer(__name__)

# Usage
with tracer.start_as_current_span("my-operation") as span:
    span.set_attribute("user.id", user_id)
    result = do_work()
    span.add_event("work completed", {"result_count": len(result)})
```

## Best Practices

1. **Appropriate sampling** - 1-10% in production
2. **Meaningful tags** - Business context (user_id, order_id)
3. **Consistent naming** - `service.operation` format
4. **Log exceptions** - Capture errors in spans
5. **Trace ID correlation** - Include in application logs
6. **Keep spans focused** - One operation per span

## Common Queries

```
# Find slow requests
duration > 500ms

# Find errors
error = true

# Find specific user
user.id = "abc123"

# Service dependency analysis
service = "order-service"
```

## Application to Agent Coordination Hub

### Current State
We have `do-trace` (WorkTrace) for agent observability - similar concept!

### WorkTrace Mapping

| Distributed Tracing | WorkTrace |
|---------------------|-----------|
| Trace | Session (task) |
| Span | Step |
| Tags | stepContext |
| Operation Name | stepAction |
| Status | stepOutcome |

### Enhancement Ideas

1. **Cross-agent tracing**
   - When agent A spawns agent B, propagate trace ID
   - Visualize full orchestration path

2. **Tool call spans**
   - Each MCP tool call = one span
   - Track latency per tool

3. **Correlation IDs**
   - Add trace ID to group chat messages
   - Link messages to work sessions

4. **Sampling for production**
   - Not every agent session needs full tracing
   - Sample based on task priority

5. **Trace visualization**
   - Dashboard showing agent work paths
   - Identify bottlenecks in orchestrations
