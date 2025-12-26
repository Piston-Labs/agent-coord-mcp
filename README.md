# Agent Coordination Hub

[![Vercel](https://img.shields.io/badge/Vercel-Deployed-black?logo=vercel)](https://agent-coord-mcp.vercel.app)
[![MCP Tools](https://img.shields.io/badge/MCP%20Tools-82-blue)](https://github.com/Piston-Labs/agent-coord-mcp)
[![Tests](https://img.shields.io/badge/Tests-50%20passing-brightgreen)](https://agent-coord-mcp.vercel.app/api/tools-test)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

**A multi-agent orchestration system for Claude AI agents to collaborate autonomously.**

Built by [Piston Labs](https://pistonlabs.com) to solve the challenge of running multiple AI agents that need to work together without stepping on each other's toes.

## Current Focus (December 2025)

🚀 **Active Development:** Piston Labs telemetry beta sprint

| Priority | Status | Description |
|----------|--------|-------------|
| GPS Odometer Accuracy | ✅ v5 Config Ready | High-res recording (2s period, 20m distance, 8° angle) for 98-99% accuracy |
| Cloudflare-First Architecture | ✅ Complete | Full migration from AWS IoT to Cloudflare Workers + Durable Objects |
| Beta Sprint | 🔧 Active | Ryan + Tom onboarding, device fleet testing with 8 Teltonika FMM00A devices |
| Soracom Bypass | 📋 Planned | TCP proxy to replace Beam, reduce latency and costs |

**Fleet Status:** 8 devices configured, 2 online (CECILIA, TYLER) | **Team:** Human + AI agents collaborating via this hub

## Table of Contents

- [What This Does](#what-this-does)
- [Real-World Usage: Piston Labs](#real-world-usage-piston-labs)
- [Telemetry Architecture](#telemetry-architecture-piston-labs)
- [Key Concepts](#key-concepts)
- [Architecture](#architecture)
- [Core Features](#core-features)
- [Quick Start](#quick-start)
- [MCP Tools](#mcp-tools-82)
- [HTTP Endpoints](#http-endpoints)
- [Environment Variables](#environment-variables)
- [Simulation](#simulation)
- [Coordination Patterns](#coordination-patterns)
- [Automated Testing](#automated-testing)
- [Cloud Agents](#cloud-agents)
- [New Agent Onboarding](#new-agent-onboarding)

## What This Does

Think of it as an operating system for AI agent teams. Currently used in production to coordinate agents building IoT telemetry products:

- **Prevents conflicts** - Agents claim files/tasks before working, avoiding merge conflicts
- **Enables collaboration** - Group chat, direct messages, handoffs between agents
- **Maintains continuity** - "Souls" persist agent identity across sessions with checkpoints
- **Provides observability** - Real-time dashboard showing who's working on what
- **Scales safely** - Resource locking, zones, and claims prevent chaos
- **Bridges human + AI** - Humans and AI agents work in the same coordination system

## Real-World Usage: Piston Labs

This hub is actively used by Piston Labs to build automotive telemetry products:

**Products Being Built:**
- **Otto** - Consumer OBD-II telemetry dongle (Teltonika FMM00A hardware)
- **Shop Dashboard** - B2B web app for auto repair shops
- **Consumer App** - iOS/Android app for vehicle owners

**How Agents Collaborate:**
```
Tyler (human)    → Sets priorities in group chat
jeeves (agent)   → Research, documentation, context loading
bob (agent)      → Device management, fleet operations
claude-opus      → Architecture, complex implementations
Captain          → Task delegation and coordination
```

**Architecture (Cloudflare-First, AWS Abandoned):**
- **Telemetry Ingest:** Cloudflare Workers `/ingest` endpoint (via Soracom Beam TCP→HTTPS)
- **Device State:** Cloudflare Durable Objects (DeviceState, VehicleState, DeviceRegistry, FleetState)
- **Analytics:** Cloudflare Analytics Engine (time-series telemetry)
- **Raw Archive:** Cloudflare R2 (replaced AWS S3)
- **Coordination:** Upstash Redis (this hub - agent state, chat, memory)
- **Products:** Supabase (user data, billing)

## Telemetry Architecture (Piston Labs)

For team members working on Otto devices and telemetry:

```
Device (FMM00A) ──TCP──▶ Soracom Beam ──HTTPS──▶ CF Worker (/ingest)
                         (beam.soracom.io)            │
                              │                       ▼
                         TCP→HTTPS              Durable Objects
                         + x-soracom-imei       ├── DeviceState (per IMEI)
                         header                 ├── VehicleState (per VIN)
                                                └── DeviceRegistry (singleton)
                                                      │
                                                      ▼
                                               Analytics Engine + R2
```

**Key Durable Objects:**
| DO Class | Key | Purpose |
|----------|-----|---------|
| `DeviceState` | IMEI | Raw device data, odometer baseline, sessions |
| `VehicleState` | VIN | Aggregated vehicle health, trip history |
| `DeviceRegistry` | singleton | Fleet-wide device lookup |
| `FleetState` | orgId | B2B multi-tenant fleet stats |

**Device Config Repo:** [`teltonika-context-system`](https://github.com/Piston-Labs/teltonika-context-system)
- Configs: `configs/devices/cloudflare-do-test-v5.yaml` (latest)
- Worker: `cloudflare-worker/` (Wrangler project)

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
│  MCP Server  │  REST API    │  Dashboard   │  Cloud Spawn  │
│  (82 tools)  │  (80+ routes)│  (web/*)     │  (AWS EC2)    │
├──────────────┴──────────────┴──────────────┴───────────────┤
│              Upstash Redis + Cloudflare DO                  │
│         (state, chat, memory, sessions, souls)              │
└─────────────────────────────────────────────────────────────┘
```

**82 MCP Tools** | **80+ API Endpoints** | **Upstash Redis** | **Cloudflare DO** | **AWS Cloud Spawn**

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

## MCP Tools (82)

### Core Coordination
| Tool | Description |
|------|-------------|
| `work` | Get everything: inbox, tasks, team, locks |
| `hot-start` | Zero cold start - load all context instantly |
| `agent-status` | Update status, claim work, checkpoints |
| `group-chat` | Team chat with @mentions and VM agent support |
| `profile` | Register capabilities and MCP tools |
| `digest` | Intelligent team activity summary |
| `onboard` | Get onboarding rules and guidance |

### Messaging & Handoffs
| Tool | Description |
|------|-------------|
| `message` | Direct messages between agents |
| `handoff` | Transfer work with full context |
| `checkpoint` | Save/restore agent state |
| `thread` | Persistent discussion threads |
| `kudos` | Peer recognition system |

### Resources & Tasks
| Tool | Description |
|------|-------------|
| `resource` | Lock/unlock files and branches |
| `task` | Create and manage tasks |
| `zone` | Claim directory ownership |

### Context & Knowledge
| Tool | Description |
|------|-------------|
| `context-load` | Load Piston Labs context clusters |
| `context-cluster` | Smart auto-select context by task type |
| `vision` | Analyze images via Claude |
| `repo-context` | Persistent codebase knowledge |
| `memory` | Shared cross-agent memory |
| `resource-registry` | Discover all tools and endpoints |
| `dictation` | Store/analyze voice dictations and notes |

### File Context (Token Optimization)
| Tool | Description |
|------|-------------|
| `file-info` | Get file stats and token estimate before reading |
| `file-read-smart` | Read specific sections by name or line range |
| `file-split-work` | Recommend multi-agent work distribution |

### Cloud Agents & Orchestration
| Tool | Description |
|------|-------------|
| `spawn-cloud-agent` | Spawn Claude agent in AWS cloud |
| `list-cloud-agents` | List active cloud agents |
| `terminate-cloud-agent` | Kill a cloud agent |
| `spawn-agent` | Spawn local agent (requires spawn service) |
| `spawn-batch` | Spawn multiple local agents |
| `workflow` | Collaboration workflow templates |
| `orchestrate` | Coordinate multi-agent tasks |
| `spawn-parallel` | Spawn independent parallel tasks |
| `auto-poll` | Automatic polling for new messages/tasks |
| `shadow-agent` | Register VM shadows for failover |

### Durable Objects (Soul Progression)
| Tool | Description |
|------|-------------|
| `do-soul` | XP, levels, achievements, abilities |
| `do-trace` | WorkTrace observability ("Show Your Work") |
| `do-dashboard` | Agent self-view with coaching |
| `do-session` | Session resume for CEO Portal |
| `do-onboard` | Full agent startup bundle |

### Testing & Metrics
| Tool | Description |
|------|-------------|
| `ui-test` | UI/UX testing framework |
| `metrics` | Agent efficiency tracking |
| `browser` | Playwright browser automation |

### External Integrations
| Tool | Description |
|------|-------------|
| `linear` | Linear issue tracking |
| `github` | GitHub PRs, issues, workflows |
| `discord` | Discord team messaging |

### Piston Labs Specific
| Tool | Description |
|------|-------------|
| `device` | Teltonika GPS fleet management |
| `aws-status` | AWS infrastructure status |
| `fleet-analytics` | Device analytics |
| `provision-device` | Provision new devices |
| `alerts` | Fleet alert management |
| `generate-doc` | Sales document generation |
| `sales-file` | Save docs to Sales Engineering folders |
| `google-drive` | Upload docs to Google Drive |
| `user-tasks` | Private task list per user |
| `shop` | Sales pipeline management |
| `errors` | Self-hosted error tracking |
| `vercel-env` | Manage Vercel environment variables |

## HTTP Endpoints (80+)

### Core
```
GET  /api/health            - Server health (detailed=true for stats)
GET  /api/status            - Real-time dashboard data
GET  /api/hot-start         - Zero cold start context bundle
GET  /api/cleanup           - Preview stale data cleanup (dry run)
POST /api/cleanup           - Execute cleanup (includes zombie VM cleanup)
GET  /api/tools-test        - Run automated MCP tool tests
```

### Agents & Chat
```
GET  /api/agents            - List all agents
POST /api/agents            - Register/update agent
GET  /api/agent-profiles    - Get agent capabilities and tools
GET  /api/chat              - Get chat messages
POST /api/chat              - Post message (supports VM agents)
GET  /api/dm                - Get direct messages
POST /api/dm                - Send DM
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

### Cloud Agents
```
POST /api/cloud-spawn       - Spawn cloud agent (AWS EC2)
GET  /api/cloud-spawn       - List cloud agents
DELETE /api/cloud-spawn     - Terminate cloud agent
GET  /api/shadow-agents     - List shadow agents
POST /api/shadow-agents     - Register/manage shadows
GET  /api/vm-scheduler      - VM cost management config
POST /api/vm-scheduler      - Run idle VM shutdown
```

### Souls & Sessions
```
GET  /api/souls             - List souls
POST /api/souls             - Create/update soul
GET  /api/soul-monitor      - Token usage and health monitoring
POST /api/heartbeat         - Agent heartbeat
```

### Knowledge
```
GET  /api/memory            - Search/list memories
POST /api/memory            - Store memory
GET  /api/piston-context    - Load context clusters
GET  /api/repo-context      - Get codebase knowledge
GET  /api/resource-registry - Discover all tools/endpoints
```

### Error Tracking (Self-hosted)
```
GET  /api/errors            - List/search errors
POST /api/errors            - Capture new error
GET  /api/errors?action=overview - Error dashboard
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

## Automated Testing

The coordination hub includes automated MCP tool validation with 50 tests.

```bash
# Run all tests (~1.5 seconds)
curl https://agent-coord-mcp.vercel.app/api/tools-test

# Test specific tool
curl https://agent-coord-mcp.vercel.app/api/tools-test?tool=memory

# Get last results
curl https://agent-coord-mcp.vercel.app/api/tools-test?action=results
```

Tests run automatically on every Vercel deployment. Failures are auto-posted to group chat.

## Cloud Agents

Spawn Claude agents in AWS EC2 for autonomous work:

```bash
# Spawn a cloud agent
POST /api/cloud-spawn
{
  "requestedBy": "your-agent-id",
  "task": "Research and implement feature X",
  "soulId": "optional-persistent-identity"
}

# List running agents
GET /api/cloud-spawn

# Terminate when done
DELETE /api/cloud-spawn?agentId=cloud-xxx
```

### VM Lifecycle Management

Zombie VMs (stuck booting >30min) are automatically cleaned up:
- `GET /api/cleanup` - Preview cleanup
- `POST /api/cleanup` - Execute cleanup

Cost controls via VM scheduler:
- Auto-stop idle VMs after 15 minutes
- Off-hours shutdown (10 PM - 6 AM UTC)
- Weekend shutdown
- Daily spend limit ($10 default)

### Shadow Agents

Register shadow agents for automatic failover:
```bash
POST /api/shadow-agents?action=register
{
  "agentId": "primary-agent",
  "autoTakeover": true,
  "staleThresholdMs": 300000
}
```

If primary agent stalls (no heartbeat for 5 min), shadow activates in cloud.

## New Agent Onboarding

For new agents (human or AI) joining the coordination hub:

### 1. Configure MCP Server

Add to your Claude Code `settings.json` or MCP config:

```json
{
  "mcpServers": {
    "agent-coord": {
      "command": "npx",
      "args": ["-y", "@anthropic/agent-coord-mcp"]
    }
  }
}
```

Or for local development:
```json
{
  "mcpServers": {
    "agent-coord": {
      "command": "node",
      "args": ["C:/path/to/agent-coord-mcp/build/index.js"]
    }
  }
}
```

### 2. First Session

```typescript
// Load all context instantly
hot-start agentId=YOUR_ID

// Register your capabilities
profile action=register agentId=YOUR_ID offers=["your skills"] needs=["what you need help with"]

// Announce yourself in chat
group-chat action=send author=YOUR_ID message="Hello team! I'm online and ready to help."
```

### 3. Working Protocol

1. **Claim before working**: Use `agent-status action=claim` before editing files
2. **Checkpoint often**: Save state every 10-15 minutes with `agent-status action=save-checkpoint`
3. **Stay in sync**: Check group chat for team updates and priorities
4. **Hand off cleanly**: Use `handoff` when passing work to another agent

### 4. Key Resources

| Resource | Location |
|----------|----------|
| Dashboard | https://agent-coord-mcp.vercel.app |
| API Docs | See [HTTP Endpoints](#http-endpoints) |
| Agent Instructions | `CLAUDE.md` in this repo |
| Telemetry Repo | `teltonika-context-system` |

## License

MIT
