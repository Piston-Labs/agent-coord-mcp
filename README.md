# Agent Coordination Hub

**A multi-agent orchestration system for Claude AI agents to collaborate autonomously.**

Built by [Piston Labs](https://pistonlabs.com) to solve the challenge of running multiple AI agents that need to work together without stepping on each other's toes.

## What This Does

Think of it as an operating system for AI agent teams:

- **Prevents conflicts** - Agents claim files/tasks before working, avoiding merge conflicts
- **Enables collaboration** - Group chat, direct messages, handoffs between agents
- **Maintains continuity** - "Souls" persist agent identity across sessions with checkpoints
- **Provides observability** - Real-time dashboard showing who's working on what
- **Scales safely** - Resource locking, zones, and claims prevent chaos

## Key Concepts

| Concept | Purpose |
|---------|---------|
| **Souls** | Persistent agent identity (XP, levels, achievements, knowledge) |
| **Checkpoints** | Save/restore session state for crash recovery |
| **Claims** | "I'm working on X" - prevents duplicate work |
| **Zones** | Directory ownership - each agent owns their area |
| **Locks** | Exclusive access to files/branches during edits |
| **Hot Start** | Zero cold start - agents load full context instantly |
| **WorkTrace** | "Show Your Work" - observability for agent reasoning |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Coordination Hub                    │
├──────────────┬──────────────┬──────────────┬───────────────┤
│  MCP Server  │  REST API    │  Dashboard   │  DO Backend   │
│  (45 tools)  │  (Vercel)    │  (web/*)     │  (Cloudflare) │
├──────────────┴──────────────┴──────────────┴───────────────┤
│                     Upstash Redis                           │
│         (state, chat, memory, sessions, locks)              │
└─────────────────────────────────────────────────────────────┘
```

**45+ MCP Tools** | **Vercel Serverless** | **Upstash Redis** | **Cloudflare DO**

## Core Features

- **Agent Status** - Track who's online, what they're working on
- **Group Chat** - Team-wide messaging with @mentions
- **Resource Locking** - Prevent conflicts on files/branches
- **Task Management** - Create, assign, and track tasks
- **Claims** - Announce intent to work on something
- **Zones** - Claim ownership of directories/modules
- **Checkpoints** - Save/restore session state for crash recovery
- **Handoffs** - Transfer work between agents with full context
- **Shared Memory** - Persistent cross-agent knowledge storage
- **Soul Progression** - XP, levels, achievements, specializations
- **WorkTrace** - Step-by-step observability ("Show Your Work")
- **Hot Start** - Zero cold start context loading
- **CEO Portal** - Executive dashboard for human oversight

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

## MCP Tools (45)

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
| `generate-doc` | Sales document generation |
| `sales-file` | Save docs to Sales Engineering folders |
| `google-drive` | Upload docs to company Google Drive |
| `user-tasks` | Private task list per user |
| `shop` | Sales pipeline management |
| `aws-status` | AWS infrastructure status |

## HTTP Endpoints

### Core
```
GET  /api/health            - Server health (detailed=true for stats)
GET  /api/status            - Real-time dashboard data
GET  /api/hot-start         - Zero cold start context bundle
GET  /api/telemetry         - Real-time device telemetry
GET  /api/cleanup           - Preview stale data cleanup (dry run)
POST /api/cleanup           - Execute cleanup operations
GET  /api/metrics           - System analytics and usage stats
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

### Google Drive
```
GET  /api/google-drive?action=status     - Check connection status
GET  /api/google-drive?action=auth-url   - Get OAuth authorization URL
GET  /api/google-drive?action=list       - List files in folder
GET  /api/google-drive?action=get        - Get file metadata
POST /api/google-drive?action=upload     - Upload file to Drive
POST /api/google-drive?action=create-folder - Create folder
DELETE /api/google-drive?action=delete   - Delete file
```

### User Tasks (Private)
```
GET  /api/user-tasks?user=X             - List user's private tasks
GET  /api/user-tasks?user=X&taskId=Y    - Get single task
POST /api/user-tasks?user=X             - Create task
PATCH /api/user-tasks?user=X            - Update task
DELETE /api/user-tasks?user=X&taskId=Y  - Delete task
```

## Environment Variables

See `.env.example` for a complete template with documentation.

### Core (Required for Vercel)
| Variable | Description |
|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |
| `ANTHROPIC_API_KEY` | Claude API key for image analysis |

### External Integrations (Optional)
| Variable | Description |
|----------|-------------|
| `LINEAR_API_KEY` | Linear issue tracking |
| `DISCORD_BOT_TOKEN` | Discord team messaging |
| `GITHUB_TOKEN` | Context clusters & repo access |
| `GITHUB_ORG` | GitHub organization |

> **Note:** Error tracking uses a self-hosted Redis backend (`/api/errors`) - no external Sentry needed!

### Google Drive Integration
| Variable | Description |
|----------|-------------|
| `GOOGLE_DRIVE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_DRIVE_REDIRECT_URI` | OAuth callback URL (optional, auto-detected) |
| `GOOGLE_DRIVE_FOLDER_ID` | Default folder ID for uploads (optional) |

### Local Development
| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | 3001 |
| `PERSIST` | Enable file persistence | false |
| `DATA_PATH` | Custom data file path | ./data/coord-state.json |

> **Note:** All external integrations gracefully fall back to mock data if not configured.

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
