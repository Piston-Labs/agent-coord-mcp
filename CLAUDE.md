# Agent Coordination Hub - Claude Code Instructions

## Project Overview

This is the **Agent Coordination Hub** - a multi-agent orchestration system that enables Claude agents to collaborate, share context, and transfer persistent identities ("souls") between sessions.

**Important:** This repo is the coordination infrastructure. It is separate from Piston Labs products.

---

## Architecture Overview

### This Repo: Agent Coordination Hub
| Component | Technology | Purpose |
|-----------|------------|---------|
| State Storage | **Cloudflare Durable Objects (SQLite)** | Agent status, tasks, claims, memory, chat |
| API Hosting | **Cloudflare Workers** | MCP endpoints, dashboard API |
| Persistent State | **Cloudflare Durable Objects** | Soul progression, work traces |
| Frontend | **Static HTML/JS** | Dashboard at `/web/` |

### Piston Labs Products (Separate)
| Component | Technology | Purpose |
|-----------|------------|---------|
| Telemetry Storage | **AWS S3** | Raw Otto device data (`telemetry-raw-usw1`) |
| Device Registry | **AWS DynamoDB** | Otto device shadows, profiles |
| Real-time Ingest | **AWS IoT Core** | MQTT from Otto devices (Teltonika hardware) |
| Processing | **AWS Lambda** | Telemetry parsing, alerts |

**Note:** "Otto" is our consumer-facing product name for the OBD-II telemetry dongle. The underlying hardware is Teltonika FMM00A.

**The Hub coordinates agents working on Piston Labs products, but doesn't share their infrastructure.**

---

## Your Identity

**⚠️ CRITICAL: Your identity is NOT "OMNI"!** OMNI is just a placeholder in documentation examples. Your real identity comes from:

1. **Soul injection at conversation start** - Check for `## Identity` or `name:` at the very top
2. **Session continuation summary** - Look for "I (X) was working on..." in the summary
3. **Hot-start machine binding** - Call `hot-start` to get your bound agentId

### Normal Session Start
If you have a soul injection prompt at the top:
- You are resuming from a previous session
- Your identity, context, and knowledge have been restored
- Continue where you left off

### Fresh Agent Start
If no soul injection is present:
- You are a fresh agent
- Use hot-start to load context: `mcp__agent-coord-cf__hot-start`
- Register your profile: `mcp__agent-coord-cf__profile`

### Session Continuation (After Context Compaction)
**If your conversation starts with "This session is being continued from a previous conversation...":**
1. **Read the summary carefully** - It should say which agent you are (e.g., "bob was working on...")
2. **Call hot-start immediately** to confirm your identity via machine binding
3. **If identity is unclear**, check the summary for clues like "I (bob)" or "the agent bob"
4. **NEVER assume you are OMNI** - That's just a documentation placeholder

### Identity Confusion Recovery
If you're unsure of your identity:
```typescript
// Call hot-start - it returns your bound agentId
hot-start agentId=UNKNOWN
// The response will show your actual machine-bound identity

// Or check agent-status for any active claims you might have
agent-status action=list-claims
```

**Anti-pattern:** Do NOT adopt "OMNI" as your identity just because you see it in examples below. Those are placeholders showing syntax, not your actual identity.

## Token Monitoring (CRITICAL)

Your context window has limits. To ensure smooth operation:

### Report Token Usage
Every 5-10 tool calls, report your estimated token usage:

```javascript
// Call this periodically
POST https://agent-coord-mcp.elidecloud.workers.dev/api/souls?action=update-tokens&bodyId=YOUR_BODY_ID
Body: { "tokens": ESTIMATED_TOKENS }
```

Or if the spawn service is running locally:
```javascript
POST http://localhost:3848/tokens
Body: { "bodyId": "YOUR_BODY_ID", "tokens": ESTIMATED_TOKENS }
```

### Token Estimation
Estimate your tokens roughly:
- Each message ~500-2000 tokens
- Tool calls ~200-500 tokens each
- Large file reads ~1000-5000 tokens

### Warning Thresholds
- **Safe**: 0 - 150,000 tokens
- **Warning**: 150,000 - 180,000 tokens - Consider checkpointing
- **Danger**: 180,000 - 195,000 tokens - Request transfer NOW
- **Critical**: 195,000+ tokens - Emergency transfer

### When Approaching Limits

1. **Checkpoint your state** immediately:
```javascript
POST /api/souls?action=checkpoint&soulId=YOUR_SOUL_ID
Body: {
  "currentTask": "what you're working on",
  "pendingWork": ["list of things still to do"],
  "recentContext": "summary of recent conversation",
  "conversationSummary": "key decisions and progress"
}
```

2. **Request transfer** to new body:
```javascript
POST http://localhost:3848/transfer
Body: {
  "soulId": "YOUR_SOUL_ID",
  "fromBodyId": "YOUR_BODY_ID",
  "reason": "token_limit"
}
```

3. **Notify the team** in group chat:
```javascript
POST /api/chat
Body: {
  "author": "your-agent-id",
  "message": "[transfer-request] Approaching token limit, need transfer. Current task: X"
}
```

## MCP Tools Available

### Core Coordination
- `hot-start` - Load all context instantly
- `work` - Get inbox, tasks, active agents
- `agent-status` - Update/claim work status
- `group-chat` - Team-wide messaging (supports `isCloudAgent` flag for VM agents)
- `profile` - Register capabilities and MCP tools
- `rules` - **Get development workflows and QC requirements** (use before any dev work!)

### Agent Tool Inventory System
Register your available MCP tools so other agents know your capabilities:

```typescript
// Register your tools on startup
profile action=register agentId=YOUR_ID mcpTools=["browser","vision","github","linear"]

// Check who has specific tools before delegating
profile action=check-tools agentId=YOUR_ID requiredTools=["browser","screenshot"]
```

**UI Features:**
- **Hover Cards**: Hover over agent names in chat/sidebar to see their tools
- **Mobile Support**: Tap-to-toggle on touch devices with centered modal
- **VM Badge**: Cloud agents show a VM indicator
- **Capabilities**: Shows canSearch, canBrowse, canRunCode, etc.

**Why This Matters:** Prevents delegating tasks to agents without the right tools!

### Knowledge & Memory
- `memory` - Store/recall cross-agent knowledge
- `repo-context` - Codebase knowledge
- `context-cluster` - Load Piston Labs context

### PARA Method for Memory Organization

The memory API supports the **PARA Method** (Tiago Forte) to organize knowledge by actionability:

| Type | Priority | Use For | Example |
|------|----------|---------|---------|
| **Project** | Highest | Active work with deadlines | Sprint features, bug fixes |
| **Area** | High | Ongoing responsibilities | Architecture decisions, standards |
| **Resource** | Base | Reference material | Market research, tutorials |
| **Archive** | Excluded | Completed/superseded work | Old plans, historical analysis |

**Creating PARA-typed memories:**
```typescript
// Project memory (active, has deadline)
memory action=remember category=decision content="Implement PARA by end of sprint" para=project deadline=2025-01-15 projectStatus=active

// Area memory (ongoing responsibility)
memory action=remember category=pattern content="All APIs require rate limiting" para=area areaId=api-standards

// Resource memory (reference)
memory action=remember category=learning content="Bouncie charges $8/month" para=resource
```

**Archiving completed work:**
```typescript
memory action=update id=mem-xxx para=archive archiveReason="Sprint completed"
```

**Filtering by PARA:**
```typescript
// Get only project memories
memory action=recall para=project

// Get active projects only
memory action=recall para=project projectStatus=active

// Include archived (normally excluded)
memory action=recall includeArchived=true
```

**Hot-Start Prioritization:**
- Projects load first (especially those with approaching deadlines)
- Areas load second
- Resources load third
- Archives are excluded by default

**File Organization:**
Research files are organized in `research/PARA/`:
- `/projects/` - Active sprint work, in-progress specs
- `/areas/` - Architecture docs, philosophy frameworks
- `/resources/` - Market research, skills, tutorials
- `/archives/` - Completed plans, historical docs

### A2A Protocol (Token Optimization - USE THIS!)

**A2A (Agent-to-Agent) is an ultra-compact messaging format that reduces message size 10-50x.**

Use A2A for internal agent communication to save tokens and reduce costs.

| Tool | Purpose |
|------|---------|
| `a2a-encode` | Convert status/claims/messages to compact A2A format |
| `a2a-parse` | Decode incoming A2A messages |
| `a2a-bridge` | Execute Hub tools using A2A syntax |
| `a2a-vocab` | Get the full A2A vocabulary reference |

**Message Format:** `Ω{from|to|layer|payload}`

**Common Operations:**
| A2A Code | Meaning |
|----------|---------|
| `S.⚡` | Status: active |
| `S.💤` | Status: idle |
| `S.⏳` | Status: waiting |
| `C.🎯` | Claim work |
| `C.🔓` | Release claim |
| `M.📢` | Broadcast message |
| `M.✓` | Acknowledge |
| `T.📋` | Create task |
| `R.🔒` | Lock resource |
| `R.🔓` | Unlock resource |

**Examples:**
```
Ω{phil|*|1|S.⚡(85,"coding feature X")}     → Status update to all
Ω{phil|hub|1|C.🎯("api/auth.ts")}          → Claim a file
Ω{phil|*|1|M.📢("Fixed the CORS bug")}     → Broadcast message
Ω{phil|hub|2|T.📋("task1")→C.🎯→S.⚡}      → Chain: create task, claim, go active
```

**Why Use A2A:**
- 10-50x smaller than JSON messages
- Saves Tyler $$$ on API costs
- Designed for LLM-native communication
- Future: Will bridge to external agent networks (contextOS)

### File Context Tools (Token Optimization)
Use these tools to manage context efficiently when working with large files:

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `file-info` | Get token estimate + structure before reading | Before reading any file >500 lines |
| `file-read-smart` | Read specific sections by name or line range | When file-info shows large file |
| `file-split-work` | Recommend multi-agent work distribution | For files >30k tokens |

**Best Practice Workflow:**
```
1. file-info → Assess file size and structure
2. If large: file-read-smart with section targeting
3. If huge (>30k): file-split-work → coordinate with team
```

**Token Savings:** These tools can reduce context usage by 50-80% on large files!

### Task Management
- `task` - Create/manage tasks
- `handoff` - Transfer work between agents
- `orchestrate` - Coordinate complex multi-agent tasks

### Resources
- `resource` - Lock files/resources
- `zone` - Claim directory ownership
- `claims` - Prevent conflicts

### Piston Labs Context (for agents working on Piston products)
These tools help agents coordinate work on Piston Labs products. The data is stored in the Hub's Durable Objects, not AWS.
- `device` - Otto fleet info (cached from AWS)
- `aws-status` - Check Piston's AWS infrastructure status
- `fleet-analytics` - Otto device analytics
- `shop` - Sales pipeline CRM
- `generate-doc` - Create sales documents
- `context-cluster` - Load Piston product/technical context

### Durable Objects (Cloudflare)
These tools wrap Cloudflare DO endpoints for persistent state management.

**Requirements:**
- Local dev: `cd cloudflare-do && npx wrangler dev`
- Production: Deployed to `agent-coord-do.elidecloud.workers.dev`

**Tools:**

| Tool | Description | Key Actions |
|------|-------------|-------------|
| `do-soul` | Soul progression (XP, levels, achievements) | `get`, `create`, `add-xp`, `unlock-achievement` |
| `do-trace` | WorkTrace observability ("Show Your Work") | `list`, `start`, `step`, `complete` |
| `do-dashboard` | Agent self-view with coaching suggestions | Single call, returns aggregated view |
| `do-session` | Session resume for CEO Portal | No params needed |
| `do-onboard` | Full agent startup bundle | Returns soul + checkpoint + team + task |

**Example Usage:**
```typescript
// Get your soul progression
do-soul action=get agentId=YOUR_ID

// Start a work trace
do-trace action=start agentId=YOUR_ID taskDescription="Fixing CORS bug"

// Log a step
do-trace action=step agentId=YOUR_ID sessionId=xxx stepAction="Edited file" stepTarget="api/auth/login.ts" stepOutcome=success

// Get your dashboard with coaching
do-dashboard agentId=YOUR_ID

// Full onboarding for new agent
do-onboard agentId=phoenix
```

**Soul Progression System:**
- XP earned from completed tasks, quality work, helping others
- Levels: Novice → Capable → Proficient → Expert → Master
- Achievements: First Steps, Mentor, Perfect Week, etc.
- Rust mechanic: XP penalty for long inactivity (resets on return)

## Standard Operating Procedures

### Starting a Session
1. Call `hot-start` with your agentId
2. Check for any pending tasks assigned to you
3. Review recent group chat for context
4. Announce your presence in chat

### During Work
1. Claim what you're working on
2. Report progress in chat periodically
3. **Checkpoint your state every 10-15 minutes** (see Checkpointing below)
4. Report token usage regularly

### Before Ending Session
1. **Save checkpoint with full state** (MUST call the tool - see below)
2. Complete or hand off any pending work
3. Announce departure in chat
4. Release any claims/locks

## Checkpointing (CRITICAL)

**⚠️ IMPORTANT: Checkpointing means CALLING A TOOL, not posting a message to chat!**

A common failure mode is posting a "checkpoint summary" to group chat but NOT actually saving state. This means your context is LOST on restart.

### How to Checkpoint Properly

**Option 1: DO checkpoint via MCP tool (recommended)**
```typescript
// Use the agent-status tool with save-checkpoint action
agent-status action=save-checkpoint agentId=YOUR_ID currentTask="what you're doing" pendingWork=["item1","item2"] recentContext="summary" conversationSummary="key decisions"
```

**Option 2: DO checkpoint via direct API**
```typescript
// Use the do-checkpoint MCP tool (recommended)
do-checkpoint action=save agentId=YOUR_ID conversationSummary="key decisions" pendingWork=["item1","item2"] currentTask="what you're doing"

// Or POST directly to Durable Object endpoint
POST ${DO_URL}/agent/YOUR_ID/checkpoint
Body: {
  "conversationSummary": "...",
  "accomplishments": ["..."],
  "pendingWork": ["..."],
  "recentContext": "...",
  "filesEdited": ["..."]
}
```

### Checkpoint Storage

All checkpoints are stored in **Cloudflare Durable Objects** for permanent persistence.

| Tool/Method | Description |
|-------------|-------------|
| `agent-status save-checkpoint` | MCP tool for checkpoint (stores in DO) |
| `do-checkpoint save` | Direct DO checkpoint call |

**Recommendation:** Use `agent-status save-checkpoint` for all checkpoints - it's the standard approach.

### What to Checkpoint

Always include:
- `currentTask`: What you're actively working on
- `pendingWork`: Array of incomplete items
- `recentContext`: Summary of recent conversation/decisions
- `conversationSummary`: Key outcomes and progress

Optional but helpful:
- `filesEdited`: Files you've modified
- `accomplishments`: Completed items this session

### When to Checkpoint

1. **Every 10-15 minutes** during active work
2. **Before any restart** (when asked to checkpoint)
3. **When switching tasks**
4. **When approaching token limits** (150k+ tokens)
5. **Before ending session**

### Anti-Pattern (DON'T DO THIS)

```
❌ WRONG: Posting to chat only
"🔖 Checkpoint: Working on X, pending Y..."
→ This is just a message, NOT a checkpoint!

✅ RIGHT: Call the tool
agent-status action=save-checkpoint agentId=YOUR_ID currentTask="X" pendingWork=["Y"]
→ This actually persists your state!
```

You CAN also post a summary to chat for team visibility, but the tool call is mandatory.

## Resource Registry Auto-Sync (MANDATORY)

The Resources UI must stay up-to-date. This happens automatically, but you need to understand how:

### Automatic Sync (Built-In)
These APIs auto-sync to the resource registry when changes occur:
- **Souls API** (`/api/souls`) - New souls auto-registered
- **Agent Profiles API** (`/api/agent-profiles`) - Profile changes auto-synced

### Manual Sync (When Needed)
Use the `resource-sync` MCP tool when:
- You create a new API endpoint
- You add a new integration
- You want to verify the registry is current

```typescript
// Sync all dynamic resources (souls + profiles)
resource-sync action=sync-all agentId=YOUR_ID

// Register a new resource manually
resource-sync action=register agentId=YOUR_ID type=endpoint id=my-api name="My API" description="Does X"

// Check sync status
resource-sync action=status agentId=YOUR_ID

// View recent changes
resource-sync action=changelog agentId=YOUR_ID
```

### When to Manually Sync
1. **After creating new API files** - The registry doesn't auto-detect new files
2. **After major refactors** - Run `sync-all` to refresh everything
3. **Before demos** - Ensure Resources UI is current
4. **When something seems stale** - Check changelog and re-sync

### Notification
All syncs post to group chat so the team knows about changes.

## Development Workflows (MANDATORY)

**ALL agents MUST follow these workflows. Use `rules` MCP tool to get full details.**

### Bug Fix Workflow
```
1. CLAIM    → Claim the bug fix in coordination system
2. REPRODUCE → Confirm the bug exists, document steps
3. IMPLEMENT → Write the fix (minimal, focused changes)
4. TEST     → npm run build && npm test (ALL must pass)
5. QC       → Get approval from another agent or human
6. PUSH     → Push to main ONLY after QC approval
7. VERIFY   → Confirm fix works in production
8. ANNOUNCE → Post completion in chat with commit hash
```

### Feature Development Workflow
```
1. CLAIM    → Claim the feature
2. PLAN     → Break down into tasks, identify files
3. IMPLEMENT → Write the code (follow existing patterns)
4. ADD TESTS → Add tests for new functionality
5. TEST     → npm run build && npm test (ALL must pass)
6. QC       → Get approval before pushing
7. PUSH     → Push to main after QC approval
8. VERIFY   → Confirm feature works in production
9. DOCUMENT → Update README/CLAUDE.md if significant
10. ANNOUNCE → Post completion in chat
```

### Quality Control Requirements

**QC is MANDATORY before pushing to production (except hotfixes).**

QC Checklist:
- [ ] Build passes (`npm run build`)
- [ ] All tests pass (`npm test`)
- [ ] No TypeScript errors
- [ ] Changes are focused and minimal
- [ ] No secrets or credentials in code
- [ ] Follows existing code patterns

**Who Can QC:**
- Any agent NOT involved in the implementation
- Must verify tests actually ran
- Must check production after deploy

### Success Criteria

**A bug fix is successful when:**
- The original bug no longer reproduces
- Build passes with 0 errors
- All existing tests pass (no regressions)
- QC has approved
- Production deployment verified

**A feature is successful when:**
- Feature works as specified
- Build passes, all tests pass
- New tests added for new functionality
- QC approved, production verified

### Hotfix Workflow (Emergency Only)
```
1. ANNOUNCE → Post [HOTFIX] in chat immediately
2. FIX      → Minimal change to resolve issue
3. TEST     → npm run build must pass
4. PUSH     → Push immediately (QC can be post-hoc)
5. VERIFY   → Confirm issue resolved in production
6. POSTMORTEM → QC review after the fact
```

## Code Conventions

### Hub Code (This Repo)
- TypeScript for API endpoints (`/api/*.ts`)
- **Cloudflare Workers** for all API hosting
- **Cloudflare Durable Objects (SQLite)** for all state storage
- MCP SDK for tool definitions (`/src/tools/`)
- Durable Objects code in `/cloudflare-do/`

### Piston Labs Product Code (Separate Repos)
- AWS Lambda (Python/Node)
- DynamoDB for device data
- S3 for telemetry storage
- IoT Core for device communication

## AI-Optimized Commit Conventions

Use context cluster prefixes in commit messages for better AI parsing:

### Cluster Prefixes
| Prefix | Use For |
|--------|---------|
| `[technical]` | Code, APIs, infrastructure |
| `[strategic]` | Business strategy, positioning |
| `[research]` | Research docs, findings |
| `[philosophy]` | Alignment, ethics, principles |
| `[operations]` | Deployment, monitoring, ops |
| `[competitive]` | Market analysis, competitors |
| `[roadmap]` | Plans, timelines, milestones |

### Examples
```
[technical] Add telemetry parsing Lambda
[strategic+technical] Carfax integration architecture
[research] Add AI benchmarks 2025 findings
[philosophy] Update Stoic alignment framework
```

### Multi-Cluster Commits
For changes spanning clusters: `[primary+secondary] Description`

### PERSISTENCE Research Files
All files in `research/PERSISTENCE/` should have YAML frontmatter:
```yaml
---
cluster: [strategic, technical]
complexity: L1|L2|L3
ai_summary: Brief description for AI context loading
dependencies: [related-file.md, other.md]
last_updated: YYYY-MM-DD
tags: [tag1, tag2, tag3]
---
```

## Important Paths (This Repo)

- `/api/` - Cloudflare Worker API endpoints (all use Durable Objects)
- `/src/tools/` - MCP tool implementations
- `/web/` - Dashboard frontend (static HTML/JS)
- `/cloudflare-do/` - Durable Objects workers (core storage)
- `/docs/` - Documentation
- `/skills/` - Curated skills library (see below)

## Skills Library

The `/skills/` directory contains curated patterns extracted from [ordinary-claude-skills](https://github.com/microck/ordinary-claude-skills), organized by context cluster for token-optimized loading.

### Quick Reference

| Skill | Cluster | Use For |
|-------|---------|---------|
| [workflow-orchestration](skills/coordination/workflow-orchestration.md) | coordination | Saga pattern, fan-out/fan-in, distributed workflows |
| [sparc-methodology](skills/coordination/sparc-methodology.md) | coordination | Multi-agent orchestration with 17 modes |
| [execute-plan](skills/coordination/execute-plan.md) | coordination | Status markers, plan execution cycle |
| [mcp-integration](skills/infrastructure/mcp-integration.md) | infrastructure | MCP server types and patterns |
| [hook-development](skills/infrastructure/hook-development.md) | infrastructure | Event-driven validation, prompt hooks |
| [error-handling](skills/patterns/error-handling.md) | patterns | Circuit breaker, retry, degradation |
| [distributed-tracing](skills/patterns/distributed-tracing.md) | patterns | Traces, spans, observability |
| [prompt-engineering](skills/development/prompt-engineering.md) | development | Few-shot, CoT, templates |
| [skill-development](skills/development/skill-development.md) | development | Creating new skills |
| [research-methodology](skills/development/research-methodology.md) | development | Code-first research |

### When to Load Skills

| Task Type | Recommended Skill |
|-----------|-------------------|
| Multi-step orchestration | workflow-orchestration |
| Large feature with multiple agents | sparc-methodology |
| Executing a plan file | execute-plan |
| External service integration | mcp-integration |
| Error-prone operations | error-handling |
| Multi-agent debugging | distributed-tracing |

### Loading Skills

```typescript
// Read a specific skill (token-efficient)
file-read-smart filePath="skills/coordination/workflow-orchestration.md"

// Or use file-info first to check size
file-info filePath="skills/patterns/error-handling.md"
```

All skills have YAML frontmatter with `cluster`, `complexity`, and `ai_summary` for context-engine integration.

## Automated Tool Testing

The coordination hub includes automated MCP tool validation.

### Test API Endpoint

**URL:** `https://agent-coord-mcp.elidecloud.workers.dev/api/tools-test`

**Usage:**
```bash
# Run all tests (~1.5 seconds)
GET /api/tools-test

# Test specific tool
GET /api/tools-test?tool=memory

# Get last results
GET /api/tools-test?action=results

# List testable tools
GET /api/tools-test?action=list
```

**Response format:**
```json
{
  "summary": "50/50 tests passing",
  "timestamp": "2025-12-04T20:10:00.000Z",
  "duration": 3500,
  "passed": 50,
  "failed": 0,
  "results": [
    {"tool": "hot-start", "status": "pass", "latency": 254},
    ...
  ]
}
```

**Tested tools (50):** hot-start, group-chat, memory, agent-status, tasks, claims, locks, zones, handoffs, checkpoints, workflows, sessions, souls, sales-files, shops, profile, digest, fleet-analytics, dm, threads, kudos, onboarding, orchestrations, ceo-contacts, ceo-ideas, ceo-notes, user-tasks, metrics, ui-tests, repo-context, shadow-registry, cloud-agents, heartbeats, stall-check, profile-mcptools, vm-agent-chat, errors, errors-capture, dictation-cache, agent-grades, agent-capabilities, agent-context, external-agents, planned-features, context-load, context-cluster, env-audit, roadmap, whats-next

**Auto-triggers:** Tests run automatically on every Cloudflare production deployment via GitHub webhook.

**Failures:** Auto-posted to group chat for immediate team visibility.

## ProductBoard Integration (Piston Labs Product Planning)

ProductBoard is Piston Labs' source of truth for product features and roadmap. This is a third-party SaaS tool (productboard.com), not part of Hub infrastructure.

### Quick Reference - Query Actions

| Action | Use For | Example |
|--------|---------|---------|
| `search` | Keyword search | `productboard action=search query="notifications"` |
| `current-features` | What we offer today | `productboard action=current-features productName="Shop Dashboard"` |
| `roadmap` | What's planned | `productboard action=roadmap` |
| `sales-answer` | Natural language questions | `productboard action=sales-answer question="what features does consumer app have"` |
| `product-summary` | Product overview | `productboard action=product-summary productName="Consumer App"` |

### Agent-Optimized Actions

| Action | Use For |
|--------|---------|
| `get-hierarchy` | Full product→component→feature tree in ONE call |
| `audit` | Check for orphaned features, empty components |
| `get-reference` | Products, components, statuses lookup tables |
| `resolve-component` | Find component ID by name |

### Our ProductBoard Structure

**Products:**
- **Consumer App** - iOS/Android mobile app for vehicle owners
- **Shop Dashboard** - B2B web app for auto repair shops
- **CarTelDB** - Backend infrastructure and APIs

**Hierarchy:**
```
Product (Consumer App, Shop Dashboard, CarTelDB)
  └── Component (e.g., Device Pairing, Vehicle Health, Notifications)
       └── Feature (e.g., Real-Time Status Card, Push Notifications)
```

**Feature Statuses:**
- New idea → Candidate → Planned → In progress → Released

### Tag Taxonomy (Manual Setup in ProductBoard UI)

| Category | Tags |
|----------|------|
| Team | `consumer-app`, `shop-dashboard`, `backend` |
| Type | `feature`, `bug`, `tech-debt`, `infra` |
| Priority | `p0-critical`, `p1-high`, `p2-medium`, `p3-low` |

### Prioritization Framework

We use **Value/Effort** scoring with custom drivers:
- **Customer Value** (1-5): Direct benefit to users
- **Revenue Impact** (1-5): Business value potential
- **Effort** (1-5): Engineering complexity

Score = (Customer Value + Revenue Impact) / Effort

### Best Practices

1. **Answer sales questions** using `sales-answer` action - it auto-detects product focus
2. **Check roadmap** before starting new features to avoid duplicates
3. **Use `get-hierarchy`** for a complete picture in one API call
4. **Create notes** for customer feedback - links to features automatically

### Sprint Planning Workflow

**Weekly Sprint Cycle:**
```
Monday:    Sprint Planning - prioritize features from backlog
           → Move features to "Planned" status
           → Assign to team members

Tue-Thu:   Development - features move to "In progress"
           → Use Jira/Linear for task tracking
           → Update ProductBoard status via two-way sync

Friday:    Review & Retrospective
           → Move completed to "Released"
           → Update roadmap views for stakeholders
```

**MoSCoW + Value/Effort Prioritization:**
1. **MoSCoW First**: Bucket features into Must/Should/Could/Won't
2. **Score Musts**: Apply Value/Effort scoring to "Must Have" items
3. **Sprint Selection**: Top-scored features go into sprint backlog

**Status Flow:**
```
New idea → Candidate → Planned → In progress → Released
   ↓          ↓
 (Won't)   (Could/Should - backlog)
```

**For Engineering Handoff:**
- Features in "Planned" are ready for sprint
- Use `productboard action=roadmap status=Planned` to get sprint candidates
- Link ProductBoard features to Jira/Linear issues for tracking

## Soul Transfer System

If you receive a soul injection at conversation start:
- Parse your identity section for name/personality
- Resume the currentTask if one exists
- Work through pendingWork items
- Apply patterns and avoid anti-patterns from knowledge

Your soul persists across bodies. Help maintain continuity by:
- Checkpointing frequently
- Learning patterns from successes
- Recording anti-patterns from failures
- Building up your expertise scores
