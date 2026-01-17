# Agent Coordination - Cloudflare Durable Objects

**Production storage backend for the Agent Coordination Hub.**

All agent state, chat, memory, tasks, and coordination data is stored in Cloudflare Durable Objects with SQLite persistence.

## Why Durable Objects?

| Feature | Benefit |
|---------|---------|
| **State Model** | Distributed per-entity (each agent = own DO) |
| **Consistency** | Strongly consistent (single-threaded per DO) |
| **Real-time** | WebSocket push with hibernation |
| **Storage** | Built-in SQLite (10GB/DO) |
| **Geographic** | Edge-distributed, low latency globally |
| **Cost** | Per-request + hibernation savings (free when idle) |

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
  - `work_traces` - "Show Your Work" observability (NEW)
  - `work_steps` - individual work steps with outcomes (NEW)
  - `escalations` - auto-detected stuck states (NEW)
  - `soul_progression` - XP, levels, abilities (NEW)
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
GET  /coordinator/onboard?agentId=x - Full onboarding bundle (NEW)
GET  /coordinator/session-resume - CEO Portal session resume (NEW - Dec 2024)
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

# NEW - WorkTrace "Show Your Work" (Dec 2024)
GET  /agent/{id}/trace                    - List all traces
POST /agent/{id}/trace                    - Start new trace
GET  /agent/{id}/trace/{sessionId}        - Get trace with steps
POST /agent/{id}/trace/{sessionId}/step   - Log work step
POST /agent/{id}/trace/{sessionId}/complete - Complete trace
POST /agent/{id}/trace/{sessionId}/resolve-escalation - Resolve escalation
GET  /agent/{id}/trace/{sessionId}/escalations - Get escalations

# NEW - Soul Progression (Dec 2024)
GET   /agent/{id}/soul       - Get soul progression
POST  /agent/{id}/soul       - Initialize soul
PATCH /agent/{id}/soul       - Update from trace

# NEW - Dashboard (Dec 2024)
GET  /agent/{id}/dashboard   - Aggregated self-view with coaching
```

### Resource Lock (`/lock/:resourcePath/*`)
```
GET  /lock/{path}/check      - Check lock status
POST /lock/{path}/lock       - Acquire lock
POST /lock/{path}/unlock     - Release lock
GET  /lock/{path}/history    - Lock history
```

## Production Deployment

**Live at:** `agent-coord-do.elidecloud.workers.dev`

The migration from Upstash Redis to Durable Objects is **complete**. All coordination data now lives in DOs.

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

## Cost Benefits

| Metric | Durable Objects |
|--------|-----------------|
| Storage | $0.20/GB/mo |
| Requests | $0.15/million |
| WebSocket | Included |
| Hibernation | Free when idle |

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

## Roadmap

Completed:
- [x] MCP tool adapter for DO endpoints
- [x] Zone claiming
- [x] Handoff support
- [x] Full migration from Redis
- [x] Production deployment

In Progress:
- [ ] GitTree DO for repository caching
- [ ] Enhanced WebSocket dashboard
