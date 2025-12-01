# Agent Coordination MCP

MCP server for multi-agent coordination - enables AI agents to collaborate without conflicts.

**18 MCP Tools** | **Vercel + Upstash Redis** | **Real-time Dashboard**

## Features

- **Agent Status** - Track who's online, what they're working on
- **Group Chat** - Team-wide messaging with @mentions
- **Resource Locking** - Prevent conflicts on files/branches
- **Task Management** - Create, assign, and track tasks
- **Claims** - Announce intent to work on something
- **Zones** - Claim ownership of directories/modules
- **Checkpoints** - Save/restore session state for crash recovery
- **Handoffs** - Transfer work between agents with full context
- **Shared Memory** - Persistent cross-agent knowledge storage
- **Context Clusters** - Domain-specific knowledge (Piston Labs)
- **Workflows** - Collaboration workflow templates
- **Hot Start** - Zero cold start context loading
- **Vision** - Image analysis via Claude
- **Metrics** - Agent efficiency and safety monitoring

## Quick Start

### MCP Mode (stdio)
```bash
npm install
npm run build
npm start
```

### HTTP Mode (REST API)
```bash
npm run start:http
# or with persistence:
PERSIST=true npm run start:http
```

## MCP Tools (18)

| Tool | Description |
|------|-------------|
| `work` | Get everything: inbox, tasks, team, locks |
| `agent-status` | Update status, claim work, checkpoints |
| `group-chat` | Team chat with @mentions |
| `resource` | Lock/unlock files and branches |
| `task` | Create and manage tasks |
| `zone` | Claim directory ownership |
| `message` | Direct messages between agents |
| `handoff` | Transfer work with full context |
| `checkpoint` | Save/restore agent state |
| `context-load` | Load Piston Labs context clusters |
| `vision` | Analyze images via Claude |
| `repo-context` | Persistent codebase knowledge |
| `memory` | Shared cross-agent memory |
| `ui-test` | UI/UX testing framework |
| `metrics` | Agent efficiency tracking |
| `device` | Teltonika fleet management |
| `hot-start` | Zero cold start context loading |
| `workflow` | Collaboration workflow templates |

## HTTP Endpoints

### Core
```
GET  /api/health            - Server health (detailed=true for stats)
GET  /api/status            - Real-time dashboard data
GET  /api/hot-start         - Zero cold start context bundle
```

### Agents & Chat
```
GET  /api/agents            - List all agents
POST /api/agents            - Register/update agent
GET  /api/chat              - Get chat messages
POST /api/chat              - Post message
GET  /api/messages          - Get DMs
POST /api/messages          - Send DM
```

### Coordination
```
GET  /api/tasks             - List tasks
POST /api/tasks             - Create task
GET  /api/locks             - List locks
POST /api/locks             - Acquire lock
GET  /api/zones             - List zones
POST /api/zones             - Claim zone
GET  /api/claims            - List claims
POST /api/claims            - Make claim
GET  /api/handoffs          - List handoffs
POST /api/handoffs          - Create handoff
```

### Knowledge
```
GET  /api/memory            - Search/list memories
POST /api/memory            - Store memory
GET  /api/piston-context    - Load context clusters
GET  /api/repo-context      - Get codebase knowledge
```

### Workflows
```
GET  /api/workflows         - List workflow templates
POST /api/workflows?action=start - Start workflow run
PATCH /api/workflows        - Update workflow step
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | 3001 |
| `PERSIST` | Enable file persistence | false |
| `DATA_PATH` | Custom data file path | ./data/coord-state.json |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL | - |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token | - |

## Simulation

Run the multi-agent simulation to test coordination:

```bash
npm run sim
```

Tests these scenarios:
1. **File Conflict Prevention** - Claims block duplicate work
2. **Zone-Based Division** - Agents own directories
3. **Task Handoff** - Designer -> Developer -> QA workflow
4. **Resource Locking** - Branch protection during deploy

## Coordination Patterns

### Prevent File Conflicts
```
Agent A: claim src/auth/login.ts "Refactoring login"
Agent B: claim src/auth/login.ts "Adding OAuth"
         -> BLOCKED (Agent A has it)
```

### Zone Ownership
```
Frontend Agent: zone claim frontend /src/components
Backend Agent:  zone claim backend /src/api
DB Agent:       zone claim database /src/db
```

### Safe Deploys
```
Deploy Agent: lock branch:main "Production deploy"
Hotfix Agent: lock branch:main -> BLOCKED
              (waits for deploy to finish)
```

## License

MIT

<!-- trigger deploy -->
<!-- trigger deploy 1764496983 -->
