# Agent Coordination - Durable Objects PoC

This is a Proof of Concept for migrating agent-coord-mcp from Upstash Redis to Cloudflare Durable Objects.

## Why Durable Objects?

| Feature | Current (Redis) | Durable Objects |
|---------|-----------------|-----------------|
| **State Model** | Centralized hash keys | Distributed per-entity |
| **Consistency** | Eventually consistent | Strongly consistent (single-threaded) |
| **Real-time** | API polling | WebSocket push |
| **Storage** | External service | Built-in SQLite (10GB/DO) |
| **Geographic** | Single region | Edge-distributed |
| **Cost** | Per-operation | Per-request + hibernation savings |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker (Router)               │
│                                                             │
│  /coordinator/*    /agent/:id/*    /lock/:path/*           │
└──────┬──────────────────┬──────────────────┬───────────────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ AgentCoord   │  │ AgentState   │  │ ResourceLock │
│ (Singleton)  │  │ (Per Agent)  │  │ (Per Resource│
├──────────────┤  ├──────────────┤  ├──────────────┤
│ • Agent reg  │  │ • Checkpoint │  │ • Lock state │
│ • Group chat │  │ • DM inbox   │  │ • Expiry     │
│ • Tasks      │  │ • Memory     │  │ • History    │
│ • WebSockets │  │ • WebSocket  │  │ • Alarms     │
└──────────────┘  └──────────────┘  └──────────────┘
      │                  │                  │
      └──────────────────┴──────────────────┘
                         │
                    SQLite (built-in)
```

## Durable Object Classes

### 1. AgentCoordinator (Control Plane)
- **Pattern**: Singleton (one instance named "main")
- **Purpose**: Central coordination hub
- **Storage**:
  - `agents` table - registry of all agents
  - `messages` table - group chat
  - `tasks` table - task management
- **WebSocket**: Broadcasts updates to all connected agents

### 2. AgentState (Per-Agent)
- **Pattern**: One instance per agent (named by agentId)
- **Purpose**: Agent-specific state
- **Storage**:
  - `checkpoint` - session state for recovery
  - `messages` - direct message inbox
  - `memory` - personal learnings/discoveries
- **WebSocket**: Personal connection for real-time updates

### 3. ResourceLock (Per-Resource)
- **Pattern**: One instance per resource path (named by path)
- **Purpose**: Distributed locking
- **Storage**:
  - `current_lock` - active lock state
  - `lock_history` - audit trail
- **Alarms**: Automatic expiry after TTL

## API Endpoints

### Coordinator (`/coordinator/*`)
```
GET  /coordinator/agents     - List active agents
POST /coordinator/agents     - Register/update agent
GET  /coordinator/chat       - Get group chat messages
POST /coordinator/chat       - Post message
GET  /coordinator/tasks      - List tasks
POST /coordinator/tasks      - Create task
GET  /coordinator/work       - Hot-start bundle for agent
WS   /coordinator?agentId=x  - WebSocket for real-time
```

### Agent State (`/agent/:agentId/*`)
```
GET  /agent/{id}/checkpoint  - Get checkpoint
POST /agent/{id}/checkpoint  - Save checkpoint
GET  /agent/{id}/messages    - Get inbox
POST /agent/{id}/messages    - Send DM to this agent
GET  /agent/{id}/memory      - Get memories
POST /agent/{id}/memory      - Store memory
GET  /agent/{id}/state       - Get full state
WS   /agent/{id}             - WebSocket for this agent
```

### Resource Lock (`/lock/:resourcePath/*`)
```
GET  /lock/{path}/check      - Check lock status
POST /lock/{path}/lock       - Acquire lock
POST /lock/{path}/unlock     - Release lock
GET  /lock/{path}/history    - Lock history
```

## Migration Strategy

### Phase 1: Deploy DO Worker (parallel)
- Deploy this Worker alongside existing Vercel API
- Both systems read/write to their own storage
- Test with select agents

### Phase 2: Write-through
- Write to both Redis and DOs
- Read from DOs
- Verify data consistency

### Phase 3: Read migration
- Switch reads to DOs
- Keep Redis as backup

### Phase 4: Full migration
- Disable Redis writes
- Remove Redis dependency
- Update MCP tools to use DO endpoints

## Development

```bash
# Install dependencies
cd cloudflare-do
npm install

# Run locally
npm run dev

# Deploy to Cloudflare
npm run deploy
```

## Key Benefits

1. **Simplified Architecture**
   - No external database dependency
   - SQLite built into every DO
   - Single deployment target

2. **Real-time by Default**
   - WebSocket support built-in
   - No polling needed
   - Hibernation saves costs

3. **Better Consistency**
   - Single-threaded per DO
   - No race conditions
   - Atomic operations guaranteed

4. **Natural Sharding**
   - Each agent = separate DO
   - Each resource = separate DO
   - No manual partitioning

5. **Geographic Distribution**
   - DOs spawn near first request
   - Low latency globally
   - Automatic migration

## Cost Comparison

| Metric | Upstash Redis | Durable Objects |
|--------|--------------|-----------------|
| Storage | $0.25/GB/mo | $0.20/GB/mo |
| Requests | $0.2/100K | $0.15/million |
| WebSocket | N/A (polling) | Included |
| Hibernation | N/A | Free when idle |

## TypeScript Client

A fully-typed client is included for easy integration:

```typescript
import { DOClient } from './src/client';

const client = new DOClient('https://agent-coord-do.workers.dev');

// Hot-start (get everything at once)
const work = await client.work('my-agent');

// Register agent
await client.registerAgent('my-agent', {
  status: 'active',
  workingOn: 'Building features'
});

// Send chat message
await client.sendChat('my-agent', 'Hello team!');

// Resource locking
await client.acquireLock('src/file.ts', 'my-agent', {
  reason: 'Implementing feature',
  ttlMs: 3600000 // 1 hour
});

// Save checkpoint
await client.saveCheckpoint('my-agent', {
  accomplishments: ['Built feature X'],
  pendingWork: ['Test feature X']
});

// WebSocket real-time
await client.connectWebSocket('my-agent');
client.onMessage('chat', (msg) => console.log('New message:', msg));
```

See `examples/` for full demos:
- `basic-usage.ts` - All client methods
- `websocket-realtime.ts` - Real-time updates

## Next Steps

- [x] Create MCP tool adapter for DO endpoints
- [x] Add example usage documentation
- [ ] Deploy to Cloudflare staging
- [ ] Benchmark performance vs Redis
- [ ] Implement zone claiming in DOs
- [ ] Add handoff support
- [ ] Build migration script for existing data
