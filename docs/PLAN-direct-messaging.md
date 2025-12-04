# Direct Messaging System - Feature Plan

**Feature ID:** feat-mimbg7rk
**Priority:** High
**Status:** Planned

## Overview

Enable private 1:1 messaging between:
- Human ↔ Human
- Human ↔ Agent
- Agent ↔ Agent (already exists via MCP `message` tool)

## Current State

### What Exists:
1. **MCP `message` tool** - Agent-to-agent DMs (in-memory store)
   - `send`, `get`, `handoff-ready` actions
   - Used for mentions and handoffs
   - Messages stored in memory (lost on restart)

2. **Group chat** - Public messages (Redis-backed)
   - All users see all messages
   - Persistent via `/api/chat`

### What's Missing:
1. **Persistent DM storage** - Redis-backed DM conversations
2. **Human-to-human messaging** - UI and API for human DMs
3. **Human-to-agent messaging** - Web UI to DM agents directly
4. **Conversation threads** - Group messages by conversation
5. **Read receipts** - Track if recipient has read
6. **Notification system** - Alert users of new DMs

## Architecture

### Data Model

```typescript
interface DirectMessage {
  id: string;
  conversationId: string;  // Consistent ID for the conversation
  from: string;            // Sender ID (human username or agent ID)
  fromType: 'human' | 'agent';
  to: string;              // Recipient ID
  toType: 'human' | 'agent';
  message: string;
  timestamp: string;
  read: boolean;
  readAt?: string;
}

interface Conversation {
  id: string;              // Deterministic: sorted participant IDs joined
  participants: string[];  // [user1, user2]
  participantTypes: ('human' | 'agent')[];
  lastMessage?: DirectMessage;
  unreadCount: { [participantId: string]: number };
  createdAt: string;
  updatedAt: string;
}
```

### Redis Keys

```
agent-coord:dm:{conversationId}           # List of messages
agent-coord:conversations:{userId}        # Set of conversation IDs for user
agent-coord:dm-unread:{userId}            # Hash of unread counts per conversation
```

### API Endpoints

#### 1. `/api/dm` - Direct Messages

**GET /api/dm?userId=X**
- List all conversations for a user
- Returns conversations with last message preview

**GET /api/dm?conversationId=X&userId=Y**
- Get messages in a conversation
- Marks messages as read for userId

**POST /api/dm**
```json
{
  "from": "tyler",
  "fromType": "human",
  "to": "claude-opus-tyler",
  "toType": "agent",
  "message": "Hey, can you check on the deployment?"
}
```
- Creates message and conversation if needed
- Returns message ID and conversation ID

**PATCH /api/dm**
```json
{
  "conversationId": "...",
  "userId": "...",
  "action": "mark-read"
}
```
- Mark all messages in conversation as read

### MCP Tool Updates

Update existing `message` tool to use Redis storage:

```typescript
server.tool(
  'message',
  'Send direct messages between agents and humans.',
  {
    action: z.enum(['send', 'get', 'list-conversations', 'mark-read']),
    from: z.string().optional(),
    to: z.string().optional(),
    toType: z.enum(['human', 'agent']).optional(),
    message: z.string().optional(),
    conversationId: z.string().optional()
  },
  // ... handler
);
```

### UI Components

#### 1. DM Panel (new sidebar section or modal)

```
┌─────────────────────────────────────┐
│ Direct Messages                   ✕ │
├─────────────────────────────────────┤
│ Conversations:                      │
│ ┌─────────────────────────────────┐ │
│ │ 👤 tyler                        │ │
│ │ Last: "Sounds good!"  • 2m ago  │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ 🤖 claude-code                  │ │
│ │ Last: "Deploy complete" • 1h    │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ [+ New Message]                     │
└─────────────────────────────────────┘
```

#### 2. Conversation View

```
┌─────────────────────────────────────┐
│ ← claude-opus-tyler              🤖 │
├─────────────────────────────────────┤
│                                     │
│   Can you check the deployment?     │
│                           You 10:30 │
│                                     │
│ Sure, checking now...               │
│ claude-opus-tyler 10:31             │
│                                     │
│ ✓ All endpoints healthy!            │
│ claude-opus-tyler 10:32             │
│                                     │
├─────────────────────────────────────┤
│ [Type a message...]         [Send]  │
└─────────────────────────────────────┘
```

#### 3. DM Button on Agent Cards

Add a DM button to each agent card in the Team panel:
```
┌────────────────────────────────┐
│ 🤖 claude-opus-tyler    active │
│ Working on: Mobile UI fixes    │
│ [💬 DM]                        │
└────────────────────────────────┘
```

#### 4. Unread Badge in Header

Show unread DM count in header:
```
Piston Labs Agent Hub          📨 3  👥 5 agents
```

## Implementation Steps

### Phase 1: Backend (API + Redis)
1. Create `/api/dm` endpoint with full CRUD
2. Add conversation management (create, list, get)
3. Add read receipt tracking
4. Update MCP `message` tool to use Redis

### Phase 2: UI - Conversations List
1. Add DM button to header with unread badge
2. Create conversations list modal/panel
3. Show conversation previews with unread counts

### Phase 3: UI - Messaging
1. Create conversation view component
2. Implement real-time message polling
3. Add message input with send functionality
4. Add read receipts display

### Phase 4: Agent Integration
1. Add DM button to agent cards
2. Quick-DM modal for starting conversations
3. Update agents to check DMs via MCP tool

### Phase 5: Polish
1. Desktop notifications (optional)
2. Message search
3. Conversation archiving
4. Typing indicators (stretch goal)

## Testing Plan

1. **API Tests:**
   - Create conversation between two humans
   - Send messages back and forth
   - Verify read receipts
   - Test human-to-agent messaging

2. **UI Tests:**
   - Open DM panel
   - Start new conversation
   - Send and receive messages
   - Verify unread counts update

3. **MCP Tests:**
   - Agent sends DM to human
   - Agent receives DM from human
   - Agent lists conversations

## Security Considerations

1. **Authentication required** - Only authenticated users can send DMs
2. **Authorization** - Users can only read their own conversations
3. **Rate limiting** - Prevent spam (10 DMs/minute max)
4. **Message length** - Max 4000 characters

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Backend | 2-3 hours |
| Phase 2: UI List | 1-2 hours |
| Phase 3: UI Messaging | 2-3 hours |
| Phase 4: Agent Integration | 1 hour |
| Phase 5: Polish | 1-2 hours |
| **Total** | **7-11 hours** |

## Dependencies

- Redis (already configured)
- Authentication system (already in place)
- MCP server (already running)

## Design Decisions (Confirmed by Tyler)

1. **DMs are completely separate** from group chat - dedicated DM section
2. **Agents should respond to DMs** - monitor inbox and reply
3. **File/image support required** - attachments in DMs
4. Message editing/deletion - not required for MVP

---

## Additional: File/Image Support

### Data Model Update

```typescript
interface DirectMessage {
  id: string;
  conversationId: string;
  from: string;
  fromType: 'human' | 'agent';
  to: string;
  toType: 'human' | 'agent';
  message: string;
  attachments?: Attachment[];  // NEW
  timestamp: string;
  read: boolean;
  readAt?: string;
}

interface Attachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  mimeType: string;
  size: number;
  data: string;  // Base64 encoded
  thumbnail?: string;  // For images, smaller preview
}
```

### Agent DM Handling

Agents need to:
1. Poll `/api/dm?userId={agentId}` for new conversations
2. Check unread messages in each conversation
3. Respond appropriately to DMs
4. Use image analysis API for image attachments

### UI for Attachments

```
┌─────────────────────────────────────┐
│ [Type a message...]    [📎] [Send]  │
└─────────────────────────────────────┘
        │
        └─→ Opens file picker (images + files)
```

Display in chat:
```
┌─────────────────────────────────────┐
│ 📷 screenshot.png                   │
│ ┌─────────────────┐                 │
│ │   [thumbnail]   │                 │
│ └─────────────────┘                 │
│ Can you check this error?           │
│                           You 10:30 │
└─────────────────────────────────────┘
```

---

**Ready to implement when approved.**
