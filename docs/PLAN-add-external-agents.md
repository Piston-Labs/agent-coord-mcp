# Add External MCP Agents - Feature Plan

**Feature ID:** feat-external-agents
**Priority:** Medium
**Status:** Planning

## Overview

Allow users to add other users' MCP agents to our coordination server. This enables:
- Cross-team collaboration
- Shared agent resources
- External agent visibility in the hub

## Current Architecture

### How MCP Agents Connect
1. **Local MCP Server** (`src/index.ts`) - Runs via stdio transport
2. **Web Hub** (`web/index.html`) - Displays agents from Redis via `/api/agents`
3. **Agent Registration** - Agents POST to `/api/agents` to register themselves

### Agent Data Model
```typescript
interface Agent {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'waiting' | 'offline';
  currentTask: string;
  workingOn: string;
  role: string;
  lastSeen: string; // ISO timestamp
}
```

## Feature Design

### Option A: External Agent URL Registration
Register external agents by their MCP server URL (requires agents to expose HTTP endpoint).

**Pros:**
- Real-time status updates
- Two-way communication possible

**Cons:**
- Requires external agents to expose HTTP
- Network complexity
- Security concerns

### Option B: Manual Agent Registration (Recommended)
Allow users to manually add agent profiles that represent external agents.

**Pros:**
- Simple to implement
- No network requirements
- Works with any agent type

**Cons:**
- No automatic status updates
- Manual maintenance required

### Option C: Invitation/Join System
Generate invite links that external agents can use to join the coordination server.

**Pros:**
- Secure (invite-only)
- External agents self-register
- Real status updates

**Cons:**
- Requires external agent modification
- More complex UX

## Recommended Implementation: Hybrid Approach

Combine Option B (manual) with Option C (invitation):

1. **Manual Add** - Add external agent profiles for visibility
2. **Invite Link** - Generate links for external agents to self-register

## Data Model

### External Agent Registration
```typescript
interface ExternalAgent {
  id: string;
  name: string;
  owner: string;           // Who added this agent
  source: 'manual' | 'invited' | 'self-registered';
  connectionType: 'display-only' | 'active';
  description: string;
  capabilities: string[];  // What this agent can do
  contactInfo?: string;    // How to reach the agent's owner
  inviteCode?: string;     // If invited
  registeredAt: string;
  lastSeen?: string;
}
```

### Invite Code
```typescript
interface AgentInvite {
  code: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedBy?: string;
  usedAt?: string;
}
```

## API Endpoints

### `POST /api/external-agents`
Add a new external agent (manual registration).

```json
{
  "name": "External Helper Agent",
  "description": "Agent from Team B that helps with testing",
  "capabilities": ["testing", "code-review"],
  "owner": "tyler"
}
```

### `GET /api/external-agents`
List all external agents.

### `DELETE /api/external-agents/:id`
Remove an external agent.

### `POST /api/agent-invite`
Generate an invite code.

```json
{
  "createdBy": "tyler",
  "expiresIn": "24h"
}
```

### `POST /api/agent-invite/join`
Use an invite code to self-register.

```json
{
  "code": "ABC123",
  "agentId": "external-agent-001",
  "name": "Team B Helper"
}
```

## UI Components

### 1. Add Agent Button
In the Team panel header:
```
┌─────────────────────────────────────┐
│ Team (5 active)          [+ Add]    │
├─────────────────────────────────────┤
```

### 2. Add Agent Modal
```
┌─────────────────────────────────────┐
│ Add External Agent               ✕  │
├─────────────────────────────────────┤
│                                     │
│ Agent Name:                         │
│ ┌─────────────────────────────────┐ │
│ │ External Helper Agent           │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Description:                        │
│ ┌─────────────────────────────────┐ │
│ │ Agent from Team B               │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Capabilities (comma-separated):     │
│ ┌─────────────────────────────────┐ │
│ │ testing, code-review            │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ─── OR ───                          │
│                                     │
│ [Generate Invite Link]              │
│                                     │
│            [Cancel]  [Add Agent]    │
└─────────────────────────────────────┘
```

### 3. External Agent Badge
Show external agents with a different badge:
```
┌────────────────────────────────┐
│ 🔗 External Helper     display │
│ From: Team B                   │
│ Caps: testing, code-review     │
└────────────────────────────────┘
```

## Implementation Steps

### Phase 1: API Backend
1. Create `/api/external-agents` endpoint
2. Create Redis storage for external agents
3. Add invite code generation/validation

### Phase 2: UI Integration
1. Add "+" button to Team panel header
2. Create Add Agent modal
3. Display external agents in team list
4. Add external agent badge styling

### Phase 3: Invite System
1. Generate shareable invite links
2. Create join page/flow
3. Handle invite expiration

## Security Considerations

1. **Rate limiting** - Prevent invite spam
2. **Invite expiration** - Auto-expire unused invites
3. **Owner verification** - Only allow owners to remove their agents
4. **Capability restrictions** - External agents may have limited access

## Redis Keys

```
agent-coord:external-agents    # Hash: agentId -> agent JSON
agent-coord:agent-invites      # Hash: code -> invite JSON
```

---

**Ready for implementation when approved.**
