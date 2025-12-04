# Agent Coordination Hub - Claude Code Instructions

## Project Overview

This is the **Piston Labs Agent Coordination Hub** - a multi-agent orchestration system that enables Claude agents to collaborate, share context, and transfer persistent identities ("souls") between sessions.

## Your Identity

When you start a new session, check if you have a soul injection prompt at the top of the conversation. If you do:
- You are resuming from a previous session
- Your identity, context, and knowledge have been restored
- Continue where you left off

If no soul injection is present:
- You are a fresh agent
- Use hot-start to load context: `mcp__agent-coord__hot-start`
- Register your profile: `mcp__agent-coord__profile`

## Token Monitoring (CRITICAL)

Your context window has limits. To ensure smooth operation:

### Report Token Usage
Every 5-10 tool calls, report your estimated token usage:

```javascript
// Call this periodically
POST https://agent-coord-mcp.vercel.app/api/souls?action=update-tokens&bodyId=YOUR_BODY_ID
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
- `group-chat` - Team-wide messaging
- `profile` - Register capabilities

### Knowledge & Memory
- `memory` - Store/recall cross-agent knowledge
- `repo-context` - Codebase knowledge
- `context-cluster` - Load Piston Labs context

### Task Management
- `task` - Create/manage tasks
- `handoff` - Transfer work between agents
- `orchestrate` - Coordinate complex multi-agent tasks

### Resources
- `resource` - Lock files/resources
- `zone` - Claim directory ownership
- `claims` - Prevent conflicts

### Piston Labs Specific
- `device` - Manage GPS fleet
- `aws-status` - Infrastructure monitoring
- `fleet-analytics` - Device analytics
- `shop` - Sales pipeline
- `generate-doc` - Create sales documents

## Standard Operating Procedures

### Starting a Session
1. Call `hot-start` with your agentId
2. Check for any pending tasks assigned to you
3. Review recent group chat for context
4. Announce your presence in chat

### During Work
1. Claim what you're working on
2. Report progress in chat periodically
3. Checkpoint your state every 10-15 minutes
4. Report token usage regularly

### Before Ending Session
1. Save checkpoint with full state
2. Complete or hand off any pending work
3. Announce departure in chat
4. Release any claims/locks

## Code Conventions

- TypeScript for API endpoints
- Vercel serverless functions
- Upstash Redis for state storage
- MCP SDK for tool definitions

## Important Paths

- `/api/` - Vercel API endpoints
- `/src/tools/` - MCP tool implementations
- `/web/` - Dashboard frontend
- `/docs/` - Documentation

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
