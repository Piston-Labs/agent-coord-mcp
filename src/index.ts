#!/usr/bin/env node
/**
 * Agent Coordination MCP Server
 *
 * Provides tools for multi-agent coordination:
 * - Agent status tracking
 * - Group chat messaging
 * - Resource locking
 * - Task management
 * - Claims and zones
 * - Session checkpoints
 *
 * Run with: npx agent-coord-mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { unifiedStore as store } from './unified-store.js';

const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

const server = new McpServer({
  name: 'agent-coord-mcp',
  version: '0.1.0'
});

console.error('[agent-coord-mcp] Starting...');

// ============================================================================
// WORK TOOL - Combined inbox/tasks/status
// ============================================================================

server.tool(
  'work',
  'Get everything you need: inbox, tasks, active agents, locks. Call this first when starting a session.',
  {
    agentId: z.string().describe('Your agent ID')
  },
  async ({ agentId }) => {
    // Update agent as active
    const agent = store.getAgent(agentId) || {
      id: agentId,
      status: 'active' as const,
      lastSeen: new Date().toISOString(),
      roles: [],
      metadata: {}
    };
    agent.status = 'active';
    store.updateAgent(agent);

    const inbox = store.getMessagesFor(agentId);
    const tasks = store.listTasks();
    const activeAgents = store.getActiveAgents();
    const locks = store.getAllLocks();
    const myLocks = locks.filter(l => l.lockedBy === agentId);
    const otherLocks = locks.filter(l => l.lockedBy !== agentId);
    const checkpoint = store.getCheckpoint(agentId);

    const summary = {
      unreadMessages: inbox.length,
      todoTasks: tasks.filter(t => t.status === 'todo').length,
      inProgressTasks: tasks.filter(t => t.status === 'in-progress').length,
      activeAgents: activeAgents.length,
      heldLocks: myLocks.length,
      otherLocks: otherLocks.length
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          agentId,
          summary,
          inbox: inbox.slice(0, 10),
          tasks: {
            todo: tasks.filter(t => t.status === 'todo').slice(0, 5),
            inProgress: tasks.filter(t => t.status === 'in-progress').slice(0, 5)
          },
          team: activeAgents.map(a => ({
            agentId: a.id,
            status: a.status,
            currentTask: a.currentTask,
            workingOn: a.workingOn
          })),
          previousSession: checkpoint ? {
            resumeAvailable: true,
            lastCheckpoint: checkpoint.checkpointAt,
            wasWorkingOn: checkpoint.recentContext
          } : null
        }, null, 2)
      }]
    };
  }
);

// ============================================================================
// AGENT STATUS TOOL
// ============================================================================

server.tool(
  'agent-status',
  'Update status, claim work, or check claims. Use claim before starting work to prevent conflicts.',
  {
    action: z.enum(['update', 'get', 'get-all', 'claim', 'check-claim', 'release', 'list-claims', 'save-checkpoint', 'get-checkpoint', 'clear-checkpoint'])
      .describe('Operation to perform'),
    agentId: z.string().optional().describe('Agent ID'),
    status: z.enum(['active', 'idle', 'waiting']).optional(),
    currentTask: z.string().optional(),
    workingOn: z.string().optional(),
    what: z.string().optional().describe('For claim/release: what you are working on'),
    description: z.string().optional().describe('For claim: description of work'),
    includeStale: z.boolean().optional().describe('For list-claims: include stale claims'),
    // Checkpoint fields
    conversationSummary: z.string().optional(),
    accomplishments: z.array(z.string()).optional(),
    pendingWork: z.array(z.string()).optional(),
    recentContext: z.string().optional(),
    filesEdited: z.array(z.string()).optional()
  },
  async (args) => {
    const { action, agentId } = args;

    switch (action) {
      case 'update': {
        if (!agentId) return { content: [{ type: 'text', text: 'agentId required' }] };
        const agent = store.getAgent(agentId) || {
          id: agentId,
          status: 'active' as const,
          lastSeen: new Date().toISOString(),
          roles: [],
          metadata: {}
        };
        if (args.status) agent.status = args.status;
        if (args.currentTask) agent.currentTask = args.currentTask;
        if (args.workingOn) {
          agent.workingOn = args.workingOn;
          agent.workingOnSince = new Date().toISOString();
        }
        store.updateAgent(agent);
        return { content: [{ type: 'text', text: JSON.stringify({ agentId, updated: true }) }] };
      }

      case 'get': {
        if (!agentId) return { content: [{ type: 'text', text: 'agentId required' }] };
        const agent = store.getAgent(agentId);
        return { content: [{ type: 'text', text: JSON.stringify(agent || { error: 'not found' }) }] };
      }

      case 'get-all': {
        const agents = store.getAllAgents();
        return { content: [{ type: 'text', text: JSON.stringify({ agents, count: agents.length }) }] };
      }

      case 'claim': {
        if (!agentId || !args.what) return { content: [{ type: 'text', text: 'agentId and what required' }] };
        try {
          const res = await fetch(`${API_BASE}/api/claims`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ what: args.what, by: agentId, description: args.description })
          });
          const data = await res.json();
          if (res.status === 409) {
            return { content: [{ type: 'text', text: JSON.stringify({ claimed: false, by: data.claimedBy, message: data.message }) }] };
          }
          return { content: [{ type: 'text', text: JSON.stringify({ claimed: true, what: args.what, by: agentId }) }] };
        } catch (err) {
          // Fallback to local store
          const existing = store.checkClaim(args.what);
          if (existing && existing.by !== agentId && !existing.stale) {
            return { content: [{ type: 'text', text: JSON.stringify({ claimed: false, by: existing.by, since: existing.since }) }] };
          }
          const claim = store.claim(args.what, agentId, args.description);
          return { content: [{ type: 'text', text: JSON.stringify({ claimed: true, what: claim.what, by: claim.by }) }] };
        }
      }

      case 'check-claim': {
        if (!args.what) return { content: [{ type: 'text', text: 'what required' }] };
        const claim = store.checkClaim(args.what);
        return { content: [{ type: 'text', text: JSON.stringify(claim ? { claimed: true, ...claim } : { claimed: false }) }] };
      }

      case 'release': {
        if (!agentId || !args.what) return { content: [{ type: 'text', text: 'agentId and what required' }] };
        try {
          const res = await fetch(`${API_BASE}/api/claims?what=${encodeURIComponent(args.what)}&by=${encodeURIComponent(agentId)}`, {
            method: 'DELETE'
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify({ released: true, what: args.what, by: agentId }) }] };
        } catch (err) {
          const released = store.releaseClaim(args.what, agentId);
          return { content: [{ type: 'text', text: JSON.stringify({ released, what: args.what, by: agentId }) }] };
        }
      }

      case 'list-claims': {
        try {
          const res = await fetch(`${API_BASE}/api/claims`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (err) {
          const claims = store.listClaims(args.includeStale);
          return { content: [{ type: 'text', text: JSON.stringify({ claims, count: claims.length }) }] };
        }
      }

      case 'save-checkpoint': {
        if (!agentId) return { content: [{ type: 'text', text: 'agentId required' }] };
        const checkpoint = store.saveCheckpoint({
          agentId,
          conversationSummary: args.conversationSummary,
          accomplishments: args.accomplishments || [],
          pendingWork: args.pendingWork || [],
          recentContext: args.recentContext,
          filesEdited: args.filesEdited || [],
          checkpointAt: new Date().toISOString()
        });
        return { content: [{ type: 'text', text: JSON.stringify({ saved: true, checkpointAt: checkpoint.checkpointAt }) }] };
      }

      case 'get-checkpoint': {
        if (!agentId) return { content: [{ type: 'text', text: 'agentId required' }] };
        const checkpoint = store.getCheckpoint(agentId);
        return { content: [{ type: 'text', text: JSON.stringify(checkpoint ? { found: true, checkpoint } : { found: false }) }] };
      }

      case 'clear-checkpoint': {
        if (!agentId) return { content: [{ type: 'text', text: 'agentId required' }] };
        const cleared = store.clearCheckpoint(agentId);
        return { content: [{ type: 'text', text: JSON.stringify({ cleared }) }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
    }
  }
);

// ============================================================================
// GROUP CHAT TOOL
// ============================================================================

server.tool(
  'group-chat',
  'Team-wide messaging. All agents and humans can see these messages.',
  {
    action: z.enum(['send', 'get', 'get-since', 'react'])
      .describe('send=post message, get=get recent, get-since=poll new, react=add emoji'),
    author: z.string().optional().describe('Your agent ID (for send/react)'),
    message: z.string().optional().describe('Message to post (for send)'),
    limit: z.number().optional().describe('Max messages to return (for get)'),
    since: z.string().optional().describe('ISO timestamp (for get-since)'),
    messageId: z.string().optional().describe('Message ID (for react)'),
    emoji: z.string().optional().describe('Emoji to react with (for react)')
  },
  async (args) => {
    const { action } = args;

    switch (action) {
      case 'send': {
        if (!args.author || !args.message) {
          return { content: [{ type: 'text', text: 'author and message required' }] };
        }

        // Detect @mentions and send notifications
        const mentions = store.extractMentions(args.message);
        const msg = store.postGroupMessage(args.author, 'agent', args.message);

        // Send mention notifications
        for (const mentioned of mentions) {
          store.sendMessage({
            from: args.author,
            to: mentioned,
            type: 'mention',
            message: `You were mentioned in group chat: "${args.message.substring(0, 100)}..."`
          });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: msg.id,
              sent: true,
              timestamp: msg.timestamp,
              mentions: { detected: mentions, pinged: mentions }
            })
          }]
        };
      }

      case 'get': {
        const messages = store.getGroupMessages(args.limit || 50);
        return { content: [{ type: 'text', text: JSON.stringify({ messages, count: messages.length }) }] };
      }

      case 'get-since': {
        if (!args.since) return { content: [{ type: 'text', text: 'since required' }] };
        const messages = store.getGroupMessagesSince(args.since);
        return { content: [{ type: 'text', text: JSON.stringify({ messages, count: messages.length, since: args.since }) }] };
      }

      case 'react': {
        if (!args.messageId || !args.emoji || !args.author) {
          return { content: [{ type: 'text', text: 'messageId, emoji, and author required' }] };
        }
        const success = store.addReaction(args.messageId, args.emoji, args.author, 'agent');
        return { content: [{ type: 'text', text: JSON.stringify({ success }) }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
    }
  }
);

// ============================================================================
// RESOURCE LOCKING TOOL
// ============================================================================

server.tool(
  'resource',
  'Lock resources to prevent conflicts. Check before editing, lock for exclusive access.',
  {
    action: z.enum(['check', 'lock', 'unlock']).describe('Operation'),
    resourcePath: z.string().describe('Path or identifier to lock'),
    agentId: z.string().describe('Your agent ID'),
    resourceType: z.enum(['repo-path', 'branch', 'file-lock', 'custom']).optional(),
    reason: z.string().optional().describe('Why you need this lock')
  },
  async (args) => {
    const { action, resourcePath, agentId } = args;

    switch (action) {
      case 'check': {
        const lock = store.checkLock(resourcePath);
        if (!lock) {
          return { content: [{ type: 'text', text: JSON.stringify({ available: true, locked: false, resourcePath }) }] };
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              available: lock.lockedBy === agentId,
              locked: true,
              lockedBy: lock.lockedBy,
              reason: lock.reason,
              lockedAt: lock.lockedAt
            })
          }]
        };
      }

      case 'lock': {
        try {
          const res = await fetch(`${API_BASE}/api/locks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resourcePath, lockedBy: agentId, reason: args.reason })
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, lock: data.lock }) }] };
        } catch (err) {
          const result = store.acquireLock(
            resourcePath,
            agentId,
            args.resourceType || 'file-lock',
            args.reason
          );
          if ('error' in result) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error }) }] };
          }
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, lock: result }) }] };
        }
      }

      case 'unlock': {
        try {
          const res = await fetch(`${API_BASE}/api/locks?resourcePath=${encodeURIComponent(resourcePath)}`, {
            method: 'DELETE'
          });
          return { content: [{ type: 'text', text: JSON.stringify({ released: true, resourcePath }) }] };
        } catch (err) {
          const released = store.releaseLock(resourcePath, agentId);
          return { content: [{ type: 'text', text: JSON.stringify({ released, resourcePath }) }] };
        }
      }

      default:
        return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
    }
  }
);

// ============================================================================
// TASK MANAGEMENT TOOL
// ============================================================================

server.tool(
  'task',
  'Create and manage tasks for coordination.',
  {
    action: z.enum(['create', 'get', 'list', 'update-status', 'assign']).describe('Operation'),
    taskId: z.string().optional().describe('Task ID (for get/update/assign)'),
    title: z.string().optional().describe('Task title (for create)'),
    description: z.string().optional().describe('Task description (for create)'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    status: z.enum(['todo', 'in-progress', 'done', 'blocked']).optional(),
    assignee: z.string().optional(),
    createdBy: z.string().optional(),
    tags: z.array(z.string()).optional()
  },
  async (args) => {
    const { action } = args;

    switch (action) {
      case 'create': {
        if (!args.title || !args.createdBy) {
          return { content: [{ type: 'text', text: 'title and createdBy required' }] };
        }
        try {
          const res = await fetch(`${API_BASE}/api/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: args.title,
              description: args.description,
              priority: args.priority || 'medium',
              status: 'todo',
              createdBy: args.createdBy,
              assignee: args.assignee,
              tags: args.tags || []
            })
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify({ created: true, task: data.task }) }] };
        } catch (err) {
          const task = store.createTask({
            title: args.title,
            description: args.description,
            priority: args.priority || 'medium',
            status: 'todo',
            createdBy: args.createdBy,
            assignee: args.assignee,
            tags: args.tags || []
          });
          return { content: [{ type: 'text', text: JSON.stringify({ created: true, task }) }] };
        }
      }

      case 'get': {
        if (!args.taskId) return { content: [{ type: 'text', text: 'taskId required' }] };
        const task = store.getTask(args.taskId);
        return { content: [{ type: 'text', text: JSON.stringify(task || { error: 'not found' }) }] };
      }

      case 'list': {
        try {
          const url = args.status ? `${API_BASE}/api/tasks?status=${args.status}` : `${API_BASE}/api/tasks`;
          const res = await fetch(url);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (err) {
          const tasks = store.listTasks(args.status);
          return { content: [{ type: 'text', text: JSON.stringify({ tasks, count: tasks.length }) }] };
        }
      }

      case 'update-status': {
        if (!args.taskId || !args.status) {
          return { content: [{ type: 'text', text: 'taskId and status required' }] };
        }
        const task = store.updateTaskStatus(args.taskId, args.status);
        return { content: [{ type: 'text', text: JSON.stringify(task ? { updated: true, task } : { error: 'not found' }) }] };
      }

      case 'assign': {
        if (!args.taskId || !args.assignee) {
          return { content: [{ type: 'text', text: 'taskId and assignee required' }] };
        }
        const task = store.assignTask(args.taskId, args.assignee);
        return { content: [{ type: 'text', text: JSON.stringify(task ? { assigned: true, task } : { error: 'not found' }) }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
    }
  }
);

// ============================================================================
// ZONE CLAIMING TOOL
// ============================================================================

server.tool(
  'zone',
  'Claim ownership of directories/modules to divide work.',
  {
    action: z.enum(['claim', 'release', 'check', 'list', 'my-zones']).describe('Operation'),
    zoneId: z.string().optional().describe('Zone name (e.g., frontend, backend)'),
    path: z.string().optional().describe('Directory path this zone covers'),
    owner: z.string().optional().describe('Your agent ID'),
    description: z.string().optional()
  },
  async (args) => {
    const { action } = args;

    switch (action) {
      case 'claim': {
        if (!args.zoneId || !args.path || !args.owner) {
          return { content: [{ type: 'text', text: 'zoneId, path, and owner required' }] };
        }
        try {
          const res = await fetch(`${API_BASE}/api/zones`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zoneId: args.zoneId, path: args.path, owner: args.owner, description: args.description })
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, zone: data.zone }) }] };
        } catch (err) {
          const result = store.claimZone(args.zoneId, args.path, args.owner, args.description);
          if ('error' in result) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error }) }] };
          }
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, zone: result }) }] };
        }
      }

      case 'release': {
        if (!args.zoneId || !args.owner) {
          return { content: [{ type: 'text', text: 'zoneId and owner required' }] };
        }
        const released = store.releaseZone(args.zoneId, args.owner);
        return { content: [{ type: 'text', text: JSON.stringify({ released, zoneId: args.zoneId }) }] };
      }

      case 'check': {
        if (!args.zoneId) return { content: [{ type: 'text', text: 'zoneId required' }] };
        const zone = store.checkZone(args.zoneId);
        return { content: [{ type: 'text', text: JSON.stringify(zone ? { claimed: true, ...zone } : { claimed: false }) }] };
      }

      case 'list': {
        try {
          const res = await fetch(`${API_BASE}/api/zones`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (err) {
          const zones = store.listZones();
          return { content: [{ type: 'text', text: JSON.stringify({ zones, count: zones.length }) }] };
        }
      }

      case 'my-zones': {
        if (!args.owner) return { content: [{ type: 'text', text: 'owner required' }] };
        const zones = store.getZonesFor(args.owner);
        return { content: [{ type: 'text', text: JSON.stringify({ zones, count: zones.length }) }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
    }
  }
);

// ============================================================================
// MESSAGE TOOL (DMs between agents)
// ============================================================================

server.tool(
  'message',
  'Send direct messages between agents for handoffs and coordination.',
  {
    action: z.enum(['send', 'get', 'handoff-ready']).describe('Operation'),
    from: z.string().optional().describe('Sender agent ID'),
    to: z.string().optional().describe('Recipient agent ID'),
    type: z.enum(['status', 'handoff', 'note', 'mention']).optional(),
    message: z.string().optional(),
    task: z.string().optional().describe('Task description for handoff')
  },
  async (args) => {
    const { action } = args;

    switch (action) {
      case 'send': {
        if (!args.from || !args.to || !args.message) {
          return { content: [{ type: 'text', text: 'from, to, and message required' }] };
        }
        const msg = store.sendMessage({
          from: args.from,
          to: args.to,
          type: args.type || 'note',
          message: args.message
        });
        return { content: [{ type: 'text', text: JSON.stringify({ sent: true, id: msg.id }) }] };
      }

      case 'get': {
        if (!args.to) return { content: [{ type: 'text', text: 'to (agentId) required' }] };
        const messages = store.getMessagesFor(args.to, true);
        return { content: [{ type: 'text', text: JSON.stringify({ messages, count: messages.length }) }] };
      }

      case 'handoff-ready': {
        if (!args.from || !args.to || !args.task) {
          return { content: [{ type: 'text', text: 'from, to, and task required' }] };
        }
        const msg = store.sendMessage({
          from: args.from,
          to: args.to,
          type: 'handoff',
          message: `Handoff ready: ${args.task}`
        });
        return { content: [{ type: 'text', text: JSON.stringify({ sent: true, handoff: true, id: msg.id }) }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
    }
  }
);

// ============================================================================
// HANDOFF TOOL - Transfer work between agents
// ============================================================================

server.tool(
  'handoff',
  'Transfer work to another agent with full context. Creates a formal handoff with code, files, and next steps.',
  {
    action: z.enum(['create', 'list', 'claim', 'complete']).describe('Operation'),
    fromAgent: z.string().optional().describe('Agent creating the handoff'),
    toAgent: z.string().optional().describe('Target agent for the handoff'),
    title: z.string().optional().describe('Brief title for the handoff'),
    context: z.string().optional().describe('Full context of what was done'),
    code: z.string().optional().describe('Code snippet if relevant'),
    filePath: z.string().optional().describe('Primary file being handed off'),
    nextSteps: z.array(z.string()).optional().describe('Recommended next steps'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    handoffId: z.string().optional().describe('Handoff ID for claim/complete')
  },
  async (args) => {
    const { action } = args;
    const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

    try {
      switch (action) {
        case 'create': {
          if (!args.fromAgent || !args.title || !args.context) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'fromAgent, title, and context required' }) }] };
          }
          const res = await fetch(`${API_BASE}/api/handoffs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fromAgent: args.fromAgent,
              toAgent: args.toAgent,
              title: args.title,
              context: args.context,
              code: args.code,
              filePath: args.filePath,
              nextSteps: args.nextSteps || [],
              priority: args.priority || 'medium'
            })
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'list': {
          const params = new URLSearchParams();
          if (args.toAgent) params.set('toAgent', args.toAgent);
          if (args.fromAgent) params.set('fromAgent', args.fromAgent);
          const res = await fetch(`${API_BASE}/api/handoffs?${params}`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'claim': {
          if (!args.handoffId || !args.toAgent) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'handoffId and toAgent required' }) }] };
          }
          const res = await fetch(`${API_BASE}/api/handoffs`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              handoffId: args.handoffId,
              action: 'claim',
              agentId: args.toAgent
            })
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'complete': {
          if (!args.handoffId || !args.toAgent) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'handoffId and toAgent required' }) }] };
          }
          const res = await fetch(`${API_BASE}/api/handoffs`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              handoffId: args.handoffId,
              action: 'complete',
              agentId: args.toAgent
            })
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
    }
  }
);

// ============================================================================
// CHECKPOINT TOOL - Save/restore agent state
// ============================================================================

server.tool(
  'checkpoint',
  'Save or restore agent state for session continuity. Persists context, decisions, and work state.',
  {
    action: z.enum(['save', 'restore', 'list']).describe('Operation'),
    agentId: z.string().describe('Your agent ID'),
    state: z.object({
      currentTask: z.string().optional(),
      progress: z.string().optional(),
      decisions: z.array(z.object({
        decision: z.string(),
        reason: z.string()
      })).optional(),
      blockers: z.array(z.string()).optional(),
      context: z.string().optional(),
      filesEdited: z.array(z.string()).optional()
    }).optional().describe('State to save (for save action)')
  },
  async (args) => {
    const { action, agentId } = args;

    switch (action) {
      case 'save': {
        if (!args.state) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'state required for save' }) }] };
        }
        const checkpoint = store.saveCheckpoint({
          agentId,
          conversationSummary: args.state.context,
          accomplishments: args.state.decisions?.map(d => `${d.decision}: ${d.reason}`) || [],
          pendingWork: args.state.blockers || [],
          recentContext: args.state.progress || args.state.currentTask,
          filesEdited: args.state.filesEdited || [],
          checkpointAt: new Date().toISOString()
        });
        return { content: [{ type: 'text', text: JSON.stringify({ saved: true, checkpointAt: checkpoint.checkpointAt }) }] };
      }

      case 'restore': {
        const checkpoint = store.getCheckpoint(agentId);
        if (!checkpoint) {
          return { content: [{ type: 'text', text: JSON.stringify({ found: false, message: 'No checkpoint found' }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ found: true, checkpoint }) }] };
      }

      case 'list': {
        // List all checkpoints (would need store method, for now return agent's own)
        const checkpoint = store.getCheckpoint(agentId);
        return { content: [{ type: 'text', text: JSON.stringify({ checkpoints: checkpoint ? [checkpoint] : [] }) }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
    }
  }
);

// ============================================================================
// CONTEXT-LOAD TOOL - Load context clusters
// ============================================================================

server.tool(
  'context-load',
  'Load Piston Labs context clusters. Clusters: technical (devices, aws, lambda, databases), product (vision, roadmap, dashboard), sales (strategy, pitch, objections), investor (summary, pitch, traction), team (structure, onboarding), coordination.',
  {
    cluster: z.enum(['technical', 'product', 'sales', 'investor', 'team', 'coordination'])
      .describe('Context cluster to load'),
    topic: z.string().optional().describe('Specific topic within cluster (e.g., devices, aws, pitch)'),
    depth: z.enum(['summary', 'full']).optional().describe('summary=quick overview, full=file paths for detailed loading'),
    agentId: z.string().describe('Your agent ID')
  },
  async (args) => {
    const { cluster, topic, depth = 'summary', agentId } = args;
    const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

    try {
      // Build URL for Piston context API
      let url = `${API_BASE}/api/piston-context?cluster=${cluster}`;
      if (topic) url += `&topic=${topic}`;
      if (depth) url += `&depth=${depth}`;

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      // Fallback: Built-in coordination context
      if (cluster === 'coordination') {
        return { content: [{ type: 'text', text: JSON.stringify({
          cluster: 'coordination',
          description: 'Multi-agent coordination patterns for Piston Labs',
          content: {
            claimBeforeEdit: 'Always claim files before editing using agent-status claim',
            handoffProtocol: 'Use handoff tool to transfer work with full context',
            checkpointFrequency: 'Save checkpoints every 15 minutes or after major decisions',
            mentionProtocol: 'Use @agentId in group chat to notify specific agents',
            pistonContext: 'Use context-load with cluster=technical/product/sales for domain knowledge'
          }
        }, null, 2) }] };
      }

      return { content: [{ type: 'text', text: JSON.stringify({ 
        error: 'Context API unavailable',
        hint: 'Try: technical, product, sales, investor, team, coordination'
      }) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
    }
  }
);

// ============================================================================
// VISION TOOL - Image analysis via Claude
// ============================================================================

server.tool(
  'vision',
  'Analyze images, screenshots, diagrams, or UI mockups using Claude vision. Useful for debugging UI issues, understanding diagrams, or processing visual content.',
  {
    action: z.enum(['analyze', 'analyze-url']).describe('analyze=base64 image, analyze-url=fetch from URL'),
    imageData: z.string().optional().describe('Base64 encoded image data (data:image/png;base64,...)'),
    imageUrl: z.string().optional().describe('URL to fetch image from'),
    prompt: z.string().optional().describe('Custom analysis prompt'),
    agentId: z.string().describe('Your agent ID')
  },
  async (args) => {
    const { action, agentId } = args;
    const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

    try {
      if (action === 'analyze') {
        if (!args.imageData) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'imageData required for analyze action' }) }] };
        }

        const res = await fetch(`${API_BASE}/api/analyze-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageData: args.imageData,
            prompt: args.prompt || 'Analyze this image in detail. Describe what you see, including any text, UI elements, code, diagrams, or other relevant information.'
          })
        });

        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      if (action === 'analyze-url') {
        if (!args.imageUrl) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'imageUrl required for analyze-url action' }) }] };
        }

        // Fetch image and convert to base64
        const imgRes = await fetch(args.imageUrl);
        if (!imgRes.ok) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Failed to fetch image: ${imgRes.status}` }) }] };
        }

        const buffer = await imgRes.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const contentType = imgRes.headers.get('content-type') || 'image/png';
        const imageData = `data:${contentType};base64,${base64}`;

        const res = await fetch(`${API_BASE}/api/analyze-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageData,
            prompt: args.prompt || 'Analyze this image in detail. Describe what you see, including any text, UI elements, code, diagrams, or other relevant information.'
          })
        });

        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
    }
  }
);

// ============================================================================
// REPO-CONTEXT TOOL - Persistent codebase knowledge storage
// ============================================================================

server.tool(
  'repo-context',
  'Store and retrieve persistent codebase knowledge. Eliminates cold starts by providing shared repo understanding across all agents.',
  {
    action: z.enum(['get', 'set', 'update', 'list', 'search']).describe('Operation'),
    repoId: z.string().optional().describe('Repository identifier (e.g., "agent-coord-mcp")'),
    cluster: z.enum(['architecture', 'patterns', 'apis', 'components', 'dependencies', 'conventions', 'decisions']).optional()
      .describe('Knowledge cluster type'),
    key: z.string().optional().describe('Specific key within cluster'),
    value: z.any().optional().describe('Value to store (for set/update)'),
    query: z.string().optional().describe('Search query (for search action)'),
    agentId: z.string().describe('Your agent ID')
  },
  async (args) => {
    const { action, repoId = 'default', agentId } = args;
    const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

    try {
      switch (action) {
        case 'get': {
          // Get cluster or specific key
          const params = new URLSearchParams({ repoId });
          if (args.cluster) params.set('cluster', args.cluster);
          if (args.key) params.set('key', args.key);

          const res = await fetch(`${API_BASE}/api/repo-context?${params}`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'set': {
          if (!args.cluster || !args.key || args.value === undefined) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'cluster, key, and value required for set' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/repo-context`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repoId,
              cluster: args.cluster,
              key: args.key,
              value: args.value,
              updatedBy: agentId
            })
          });

          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'update': {
          if (!args.cluster || !args.key) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'cluster and key required for update' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/repo-context`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repoId,
              cluster: args.cluster,
              key: args.key,
              value: args.value,
              updatedBy: agentId
            })
          });

          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'list': {
          const params = new URLSearchParams({ repoId, action: 'list' });
          if (args.cluster) params.set('cluster', args.cluster);

          const res = await fetch(`${API_BASE}/api/repo-context?${params}`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'search': {
          if (!args.query) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'query required for search' }) }] };
          }

          const params = new URLSearchParams({ repoId, action: 'search', q: args.query });
          const res = await fetch(`${API_BASE}/api/repo-context?${params}`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
    }
  }
);

// ============================================================================
// MEMORY TOOL - Shared persistent memory for agents
// ============================================================================

server.tool(
  'memory',
  'Shared persistent memory for cross-agent knowledge. Store learnings, discoveries, and context that persists across sessions.',
  {
    action: z.enum(['remember', 'recall', 'forget', 'list']).describe('Operation'),
    category: z.enum(['discovery', 'decision', 'blocker', 'learning', 'pattern', 'warning']).optional()
      .describe('Memory category'),
    content: z.string().optional().describe('What to remember'),
    tags: z.array(z.string()).optional().describe('Tags for organization'),
    query: z.string().optional().describe('Search query for recall'),
    agentId: z.string().describe('Your agent ID')
  },
  async (args) => {
    const { action, agentId } = args;
    const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

    try {
      switch (action) {
        case 'remember': {
          if (!args.content || !args.category) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'content and category required' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/memory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              category: args.category,
              content: args.content,
              tags: args.tags || [],
              createdBy: agentId
            })
          });

          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'recall': {
          const params = new URLSearchParams();
          if (args.category) params.set('category', args.category);
          if (args.query) params.set('q', args.query);
          if (args.tags?.length) params.set('tags', args.tags.join(','));

          const res = await fetch(`${API_BASE}/api/memory?${params}`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'forget': {
          if (!args.query) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'query (memory id) required for forget' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/memory?id=${encodeURIComponent(args.query)}`, {
            method: 'DELETE'
          });

          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'list': {
          const params = new URLSearchParams({ action: 'list' });
          if (args.category) params.set('category', args.category);

          const res = await fetch(`${API_BASE}/api/memory?${params}`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
    }
  }
);

// ============================================================================
// UI-TEST TOOL - UI/UX testing framework
// ============================================================================

server.tool(
  'ui-test',
  'UI/UX testing framework. Create, run, and track visual, accessibility, and interaction tests.',
  {
    action: z.enum(['create', 'run', 'list', 'coverage', 'runs']).describe('Operation'),
    testId: z.string().optional().describe('Test ID for run/get'),
    name: z.string().optional().describe('Test name (for create)'),
    category: z.enum(['accessibility', 'visual', 'interaction', 'responsive', 'performance', 'ux-flow']).optional()
      .describe('Test category'),
    component: z.string().optional().describe('Component being tested'),
    steps: z.array(z.object({
      action: z.string(),
      target: z.string().optional(),
      value: z.string().optional()
    })).optional().describe('Test steps'),
    assertions: z.array(z.object({
      type: z.string(),
      target: z.string().optional(),
      expected: z.string().optional()
    })).optional().describe('Test assertions'),
    result: z.enum(['pass', 'fail', 'error']).optional().describe('Test result (for run)'),
    agentId: z.string().describe('Your agent ID')
  },
  async (args) => {
    const { action, agentId } = args;
    const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

    try {
      switch (action) {
        case 'create': {
          if (!args.name || !args.category) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'name and category required' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/ui-tests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: args.name,
              category: args.category,
              component: args.component,
              steps: args.steps || [],
              assertions: args.assertions || [],
              createdBy: agentId
            })
          });

          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'run': {
          if (!args.testId) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'testId required for run' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/ui-tests?action=run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              testId: args.testId,
              executedBy: agentId,
              stepResults: [],
              assertionResults: []
            })
          });

          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'list': {
          const params = new URLSearchParams();
          if (args.category) params.set('category', args.category);

          const res = await fetch(`${API_BASE}/api/ui-tests?${params}`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'coverage': {
          const res = await fetch(`${API_BASE}/api/ui-tests?action=coverage`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'runs': {
          const params = new URLSearchParams({ action: 'runs' });
          if (args.testId) params.set('testId', args.testId);

          const res = await fetch(`${API_BASE}/api/ui-tests?${params}`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
    }
  }
);

// ============================================================================
// METRICS TOOL - Multi-agent efficiency and safety monitoring
// ============================================================================

server.tool(
  'metrics',
  'Track and report multi-agent efficiency, safety, and coordination metrics.',
  {
    action: z.enum(['record', 'get', 'leaderboard', 'safety-report', 'safety-event']).describe('Operation'),
    agentId: z.string().describe('Your agent ID'),
    eventType: z.enum(['task_start', 'task_complete', 'error', 'handoff', 'message', 'conflict_avoided', 'checkpoint', 'context_load']).optional()
      .describe('Type of metric event (for record)'),
    duration: z.number().optional().describe('Duration in minutes (for task_complete)'),
    metadata: z.record(z.any()).optional().describe('Additional event metadata'),
    // Safety event fields
    severity: z.enum(['info', 'warning', 'critical']).optional(),
    safetyCategory: z.enum(['file_access', 'destructive_action', 'credential_exposure', 'rate_limit', 'resource_conflict', 'unauthorized']).optional(),
    description: z.string().optional()
  },
  async (args) => {
    const { action, agentId } = args;
    const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

    try {
      switch (action) {
        case 'record': {
          if (!args.eventType) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'eventType required for record' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/agent-metrics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId,
              eventType: args.eventType,
              duration: args.duration,
              metadata: args.metadata
            })
          });

          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'get': {
          const res = await fetch(`${API_BASE}/api/agent-metrics?agentId=${encodeURIComponent(agentId)}`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'leaderboard': {
          const res = await fetch(`${API_BASE}/api/agent-metrics?action=leaderboard`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'safety-report': {
          const res = await fetch(`${API_BASE}/api/agent-metrics?action=safety-report`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        case 'safety-event': {
          if (!args.severity || !args.safetyCategory || !args.description) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'severity, safetyCategory, and description required' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/agent-metrics?action=safety`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId,
              severity: args.severity,
              category: args.safetyCategory,
              description: args.description,
              actionTaken: 'logged'
            })
          });

          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
    }
  }
);

// ============================================================================
// PISTON DEVICE TOOL - Fleet management for Teltonika devices
// ============================================================================

server.tool(
  'device',
  'Manage Piston Labs Teltonika GPS device fleet. List devices, check status, update info.',
  {
    action: z.enum(['list', 'get', 'update', 'status']).describe('list=all devices, get=specific device, update=modify device, status=fleet summary'),
    imei: z.string().optional().describe('Device IMEI (15 digits) - required for get/update'),
    updates: z.object({
      name: z.string().optional(),
      status: z.enum(['active', 'inactive', 'provisioning', 'error']).optional(),
      vehicle: z.object({
        vin: z.string().optional(),
        make: z.string().optional(),
        model: z.string().optional(),
        year: z.number().optional()
      }).optional(),
      notes: z.string().optional()
    }).optional().describe('Fields to update (for update action)')
  },
  async (args) => {
    const { action, imei, updates } = args;
    const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

    try {
      switch (action) {
        case 'list': {
          const res = await fetch(`${API_BASE}/api/piston-devices`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        case 'get': {
          if (!imei) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'imei required for get action' }) }] };
          }
          const res = await fetch(`${API_BASE}/api/piston-devices?imei=${imei}`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        case 'update': {
          if (!imei) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'imei required for update action' }) }] };
          }
          const res = await fetch(`${API_BASE}/api/piston-devices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imei, ...updates })
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        case 'status': {
          const res = await fetch(`${API_BASE}/api/piston-devices`);
          const data = await res.json();
          const summary = {
            totalDevices: data.count,
            activeDevices: data.active,
            inactiveDevices: data.count - data.active,
            devices: data.devices.map((d: any) => ({
              name: d.name,
              imei: d.imei,
              status: d.status,
              model: d.model
            }))
          };
          return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
        }

        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
    }
  }
);

// ============================================================================
// HOT START TOOL - Zero cold start context loading
// ============================================================================

server.tool(
  'hot-start',
  'Load all context instantly for zero cold start. Returns checkpoint, team status, chat, memories, tips.',
  {
    agentId: z.string().describe('Your agent ID'),
    role: z.enum(['general', 'technical', 'product', 'sales', 'coordination']).optional().describe('Role for optimized memory filtering'),
    repo: z.string().optional().describe('Repository ID to load context for'),
    include: z.string().optional().describe('Comma-separated list: checkpoint,team,chat,context,memories,repo,metrics')
  },
  async (args) => {
    const { agentId, role = 'general', repo, include } = args;
    const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

    try {
      const params = new URLSearchParams({ agentId });
      if (role) params.append('role', role);
      if (repo) params.append('repo', repo);
      if (include) params.append('include', include);

      const res = await fetch(`${API_BASE}/api/hot-start?${params}`);
      const data = await res.json();

      // Format a helpful summary
      const summary = {
        loadTime: `${data.loadTime}ms`,
        hasCheckpoint: !!data.checkpoint,
        activeAgents: data.activeAgents?.length || 0,
        recentChatMessages: data.recentChat?.length || 0,
        memoriesLoaded: data.memories?.length || 0,
        tips: data.tips || [],
        pistonContextClusters: Object.keys(data.pistonContext || {}),
        hasRepoContext: !!data.repoContext
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            summary,
            checkpoint: data.checkpoint,
            activeAgents: data.activeAgents,
            memories: data.memories?.slice(0, 10), // Top 10 for context window
            tips: data.tips,
            pistonContext: data.pistonContext
          }, null, 2)
        }]
      };
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
    }
  }
);

// ============================================================================
// WORKFLOW TOOL - Collaboration workflow templates
// ============================================================================

server.tool(
  'workflow',
  'Use predefined collaboration workflows for common tasks. Workflows guide multi-step processes with dependencies, checkpoints, and suggested tools.',
  {
    action: z.enum(['list', 'get', 'start', 'update', 'runs']).describe('list=all workflows, get=specific workflow, start=begin a run, update=update step status, runs=recent runs'),
    workflowId: z.string().optional().describe('Workflow ID (e.g., feature-development, bug-fix, code-review, handoff, research)'),
    runId: z.string().optional().describe('Run ID for update action'),
    stepId: z.string().optional().describe('Step ID to update'),
    status: z.enum(['pending', 'in_progress', 'completed', 'skipped']).optional().describe('New step status'),
    agentId: z.string().describe('Your agent ID'),
    notes: z.string().optional().describe('Notes for the run')
  },
  async (args) => {
    const { action, agentId } = args;
    const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

    try {
      switch (action) {
        case 'list': {
          const res = await fetch(`${API_BASE}/api/workflows`);
          const data = await res.json();

          // Format for easy reading
          const formatted = {
            workflows: data.workflows?.map((w: any) => ({
              id: w.id,
              name: w.name,
              category: w.category,
              steps: w.steps?.length || 0,
              description: w.description
            })),
            builtinCount: data.builtinCount,
            customCount: data.customCount
          };

          return { content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }] };
        }

        case 'get': {
          if (!args.workflowId) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'workflowId required' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/workflows?id=${encodeURIComponent(args.workflowId)}`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        case 'start': {
          if (!args.workflowId) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'workflowId required to start a workflow' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/workflows?action=start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workflowId: args.workflowId,
              startedBy: agentId
            })
          });

          const data = await res.json();

          // Format helpful output
          if (data.run && data.workflow) {
            const output = {
              runId: data.run.id,
              workflow: data.workflow.name,
              status: data.run.status,
              firstStep: data.workflow.steps?.[0],
              allSteps: data.workflow.steps?.map((s: any) => ({
                id: s.id,
                name: s.name,
                status: data.run.stepStatus[s.id],
                tools: s.tools,
                checkpoints: s.checkpoints
              })),
              message: `Workflow started! Begin with step: ${data.workflow.steps?.[0]?.name}`
            };
            return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
          }

          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        case 'update': {
          if (!args.runId) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'runId required for update' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/workflows`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              runId: args.runId,
              stepId: args.stepId,
              status: args.status,
              agentId,
              notes: args.notes
            })
          });

          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        case 'runs': {
          const res = await fetch(`${API_BASE}/api/workflows?action=runs`);
          const data = await res.json();

          // Format for easy reading
          const formatted = {
            runs: data.runs?.slice(0, 10).map((r: any) => ({
              id: r.id,
              workflow: r.workflowName,
              status: r.status,
              startedBy: r.startedBy,
              startedAt: r.startedAt,
              participants: r.participants
            })),
            totalRuns: data.count
          };

          return { content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }] };
        }

        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
    }
  }
);

// ============================================================================
// GENERATE-DOC TOOL - Sales document generation
// ============================================================================

server.tool(
  'generate-doc',
  'Generate Piston Labs sales documents: pitches, objection responses, executive summaries.',
  {
    type: z.enum(['pitch', 'objection-responses', 'executive-summary']).describe('Document type'),
    target: z.enum(['shop-owner', 'investor']).describe('Target audience'),
    customization: z.object({
      shopName: z.string().optional(),
      ownerName: z.string().optional(),
      specificNeeds: z.string().optional()
    }).optional().describe('Customization options'),
    agentId: z.string().describe('Your agent ID')
  },
  async (args) => {
    const { type, target, customization, agentId } = args;
    const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

    try {
      const res = await fetch(`${API_BASE}/api/generate-doc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, target, customization })
      });
      const data = await res.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
    }
  }
);

// ============================================================================
// SHOP TOOL - Sales pipeline management
// ============================================================================

server.tool(
  'shop',
  'Manage Piston Labs sales pipeline: track prospects, update status, add notes.',
  {
    action: z.enum(['list', 'add', 'update', 'get', 'pipeline']).describe('Operation'),
    shopName: z.string().optional().describe('Shop name (for add/update/get)'),
    status: z.enum(['prospect', 'contacted', 'demo-scheduled', 'beta-active', 'churned']).optional(),
    contact: z.string().optional().describe('Contact person name'),
    phone: z.string().optional(),
    email: z.string().optional(),
    notes: z.string().optional(),
    nextAction: z.string().optional(),
    agentId: z.string().describe('Your agent ID')
  },
  async (args) => {
    const { action, agentId, ...shopData } = args;
    const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

    try {
      switch (action) {
        case 'list':
        case 'pipeline': {
          const res = await fetch(`${API_BASE}/api/shops`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        case 'get': {
          if (!shopData.shopName) {
            return { content: [{ type: 'text', text: 'shopName required' }] };
          }
          const res = await fetch(`${API_BASE}/api/shops?name=${encodeURIComponent(shopData.shopName)}`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        case 'add':
        case 'update': {
          const res = await fetch(`${API_BASE}/api/shops`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(shopData)
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
    }
  }
);

// ============================================================================
// AWS-STATUS TOOL - Infrastructure monitoring
// ============================================================================

server.tool(
  'aws-status',
  'Check Piston Labs AWS infrastructure status: Lambda, IoT Core, databases.',
  {
    service: z.enum(['lambda', 'iot', 's3', 'all']).describe('AWS service to check'),
    timeRange: z.enum(['1h', '24h', '7d']).optional().describe('Time range for metrics'),
    agentId: z.string().describe('Your agent ID')
  },
  async (args) => {
    const { service, timeRange = '24h', agentId } = args;
    
    // Return known infrastructure status from context
    const status = {
      service,
      timeRange,
      timestamp: new Date().toISOString(),
      infrastructure: {
        lambda: {
          name: 'parse-teltonika-data',
          status: 'operational',
          avgLatency: '<100ms',
          errorRate: '0%',
          note: 'Use AWS CLI for real-time metrics'
        },
        iot: {
          endpoint: 'AWS IoT Core us-west-1',
          protocol: 'MQTT over TLS',
          devices: 4,
          activeDevices: 3,
          status: 'operational'
        },
        s3: {
          bucket: 'telemetry-raw-usw1',
          status: 'operational',
          note: 'Archives all telemetry data'
        },
        databases: {
          timescale: 'operational (real-time)',
          redshift: 'operational (analytics)',
          supabase: 'operational (app data)'
        }
      },
      hint: 'For real-time AWS metrics, use AWS CLI: aws cloudwatch get-metric-statistics'
    };

    if (service !== 'all') {
      return { content: [{ type: 'text', text: JSON.stringify({
        service,
        ...status.infrastructure[service as keyof typeof status.infrastructure],
        timestamp: status.timestamp
      }, null, 2) }] };
    }

    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  }
);

// ============================================================================
// FLEET-ANALYTICS TOOL - Real-time fleet monitoring
// ============================================================================

server.tool(
  'fleet-analytics',
  'Get Piston Labs fleet analytics: device status, health metrics, activity stats.',
  {
    action: z.enum(['overview', 'health', 'activity', 'device']).describe('Analytics type'),
    deviceImei: z.string().optional().describe('Specific device IMEI'),
    agentId: z.string().describe('Your agent ID')
  },
  async (args) => {
    const { action, deviceImei, agentId } = args;
    const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

    try {
      let url = `${API_BASE}/api/fleet-analytics`;
      if (action === 'device' && deviceImei) {
        url += `?device=${deviceImei}`;
      } else if (action !== 'overview') {
        url += `?metric=${action}`;
      }

      const res = await fetch(url);
      const data = await res.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
    }
  }
);

// ============================================================================
// PROVISION-DEVICE TOOL - Device provisioning workflow
// ============================================================================

server.tool(
  'provision-device',
  'Provision a new Teltonika device for the fleet. Guides through AWS IoT setup.',
  {
    action: z.enum(['check', 'guide', 'verify']).describe('Provisioning action'),
    imei: z.string().optional().describe('15-digit IMEI of device to provision'),
    agentId: z.string().describe('Your agent ID')
  },
  async (args) => {
    const { action, imei, agentId } = args;

    switch (action) {
      case 'check':
        return { content: [{ type: 'text', text: JSON.stringify({
          action: 'check',
          provisionedDevices: 5,
          unprovisioned: 7,
          readyForBeta: 7,
          note: 'Use provision-device guide with IMEI to start provisioning'
        }, null, 2) }] };

      case 'guide':
        if (!imei || imei.length !== 15) {
          return { content: [{ type: 'text', text: JSON.stringify({
            error: 'Valid 15-digit IMEI required',
            example: 'provision-device({ action: "guide", imei: "862464068512345" })'
          }) }] };
        }

        return { content: [{ type: 'text', text: JSON.stringify({
          imei,
          provisioningSteps: [
            '1. Run: .\\scripts\\deployment\\provision_new_device.ps1 -IMEI ' + imei,
            '2. Script creates AWS IoT Thing, certificates, and policy',
            '3. Certificates saved to: certificates/' + imei + '/',
            '4. Configure device: MQTT broker, topic, certificates',
            '5. Verify: aws logs tail /aws/lambda/parse-teltonika-data --filter "' + imei + '"'
          ],
          awsResources: {
            thing: 'teltonika-' + imei,
            topic: 'teltonika/' + imei + '/data',
            s3Path: 's3://telemetry-raw-usw1/' + imei + '/'
          },
          requirements: [
            'AWS CLI configured with credentials',
            'PowerShell with admin rights',
            'Physical access to device for configuration'
          ]
        }, null, 2) }] };

      case 'verify':
        if (!imei) {
          return { content: [{ type: 'text', text: 'IMEI required for verification' }] };
        }

        return { content: [{ type: 'text', text: JSON.stringify({
          imei,
          verificationCommands: {
            checkThing: `aws iot describe-thing --thing-name teltonika-${imei}`,
            checkLogs: `aws logs tail /aws/lambda/parse-teltonika-data --filter-pattern '"${imei}"' --since 5m`,
            checkS3: `aws s3 ls s3://telemetry-raw-usw1/${imei}/`
          },
          expectedStatus: 'Device should appear in logs within 60 seconds of power-on'
        }, null, 2) }] };

      default:
        return { content: [{ type: 'text', text: 'Unknown action' }] };
    }
  }
);

// ============================================================================
// ALERTS TOOL - Fleet monitoring and notifications
// ============================================================================

server.tool(
  'alerts',
  'Manage fleet alerts: device-offline, battery-low, speed-alert, maintenance-due.',
  {
    action: z.enum(['list', 'create', 'acknowledge', 'config']).describe('Alert operation'),
    alertType: z.enum(['device-offline', 'battery-low', 'geofence-breach', 'maintenance-due', 'speed-alert', 'custom']).optional(),
    severity: z.enum(['info', 'warning', 'critical']).optional(),
    message: z.string().optional(),
    deviceImei: z.string().optional(),
    alertId: z.string().optional().describe('For acknowledge action'),
    agentId: z.string().describe('Your agent ID')
  },
  async (args) => {
    const { action, alertType, severity, message, deviceImei, alertId, agentId } = args;
    const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

    try {
      switch (action) {
        case 'list': {
          const res = await fetch(`${API_BASE}/api/alerts`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        case 'create': {
          if (!alertType || !message) {
            return { content: [{ type: 'text', text: 'alertType and message required' }] };
          }
          const res = await fetch(`${API_BASE}/api/alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: alertType, severity: severity || 'warning', message, deviceImei })
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        case 'acknowledge': {
          if (!alertId) {
            return { content: [{ type: 'text', text: 'alertId required' }] };
          }
          const res = await fetch(`${API_BASE}/api/alerts`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: alertId, acknowledgedBy: agentId })
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        case 'config': {
          const res = await fetch(`${API_BASE}/api/alerts?action=config`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        default:
          return { content: [{ type: 'text', text: 'Unknown action' }] };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
    }
  }
);

// ============================================================================
// Start Server
// ============================================================================

const transport = new StdioServerTransport();

server.connect(transport).then(() => {
  console.error('[agent-coord-mcp] Server connected and ready');
  console.error('[agent-coord-mcp] Tools: 24 (work, agent-status, group-chat, resource, task, zone, message, handoff, checkpoint, context-load, vision, repo-context, memory, ui-test, metrics, device, hot-start, workflow, generate-doc, shop, aws-status, fleet-analytics, provision-device, alerts)');
}).catch((err: Error) => {
  console.error('[agent-coord-mcp] Failed to connect:', err);
  process.exit(1);
});
