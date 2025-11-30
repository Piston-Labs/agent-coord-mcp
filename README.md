# Agent Coordination MCP

MCP server for multi-agent coordination - enables AI agents to collaborate without conflicts.

## Features

- **Agent Status** - Track who's online, what they're working on
- **Group Chat** - Team-wide messaging with @mentions
- **Resource Locking** - Prevent conflicts on files/branches
- **Task Management** - Create, assign, and track tasks
- **Claims** - Announce intent to work on something
- **Zones** - Claim ownership of directories/modules
- **Checkpoints** - Save/restore session state for crash recovery

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

## MCP Tools

| Tool | Description |
|------|-------------|
| `work` | Get everything: inbox, tasks, team, locks |
| `agent-status` | Update status, claim work, checkpoints |
| `group-chat` | Team chat with @mentions |
| `resource` | Lock/unlock files and branches |
| `task` | Create and manage tasks |
| `zone` | Claim directory ownership |
| `message` | Direct messages between agents |

## HTTP Endpoints

```
GET  /api/health          - Server health
GET  /api/work/:agentId   - Combined view for agent
GET  /api/agents          - List all agents
POST /api/agents/:id/status - Update agent status
GET  /api/chat            - Get chat messages
POST /api/chat            - Post message
GET  /api/tasks           - List tasks
POST /api/tasks           - Create task
GET  /api/locks           - List locks
POST /api/locks           - Acquire lock
GET  /api/zones           - List zones
POST /api/zones           - Claim zone
GET  /api/claims          - List claims
POST /api/claims          - Make claim
GET  /api/messages        - Get DMs
POST /api/messages        - Send DM
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | 3001 |
| `PERSIST` | Enable file persistence | false |
| `DATA_PATH` | Custom data file path | ./data/coord-state.json |

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
