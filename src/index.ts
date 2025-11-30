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
        const existing = store.checkClaim(args.what);
        if (existing && existing.by !== agentId && !existing.stale) {
          return { content: [{ type: 'text', text: JSON.stringify({ claimed: false, by: existing.by, since: existing.since }) }] };
        }
        const claim = store.claim(args.what, agentId, args.description);
        return { content: [{ type: 'text', text: JSON.stringify({ claimed: true, what: claim.what, by: claim.by }) }] };
      }

      case 'check-claim': {
        if (!args.what) return { content: [{ type: 'text', text: 'what required' }] };
        const claim = store.checkClaim(args.what);
        return { content: [{ type: 'text', text: JSON.stringify(claim ? { claimed: true, ...claim } : { claimed: false }) }] };
      }

      case 'release': {
        if (!agentId || !args.what) return { content: [{ type: 'text', text: 'agentId and what required' }] };
        const released = store.releaseClaim(args.what, agentId);
        return { content: [{ type: 'text', text: JSON.stringify({ released, what: args.what, by: agentId }) }] };
      }

      case 'list-claims': {
        const claims = store.listClaims(args.includeStale);
        return { content: [{ type: 'text', text: JSON.stringify({ claims, count: claims.length }) }] };
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

      case 'unlock': {
        const released = store.releaseLock(resourcePath, agentId);
        return { content: [{ type: 'text', text: JSON.stringify({ released, resourcePath }) }] };
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

      case 'get': {
        if (!args.taskId) return { content: [{ type: 'text', text: 'taskId required' }] };
        const task = store.getTask(args.taskId);
        return { content: [{ type: 'text', text: JSON.stringify(task || { error: 'not found' }) }] };
      }

      case 'list': {
        const tasks = store.listTasks(args.status);
        return { content: [{ type: 'text', text: JSON.stringify({ tasks, count: tasks.length }) }] };
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
        const result = store.claimZone(args.zoneId, args.path, args.owner, args.description);
        if ('error' in result) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, zone: result }) }] };
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
        const zones = store.listZones();
        return { content: [{ type: 'text', text: JSON.stringify({ zones, count: zones.length }) }] };
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
// Start Server
// ============================================================================

const transport = new StdioServerTransport();

server.connect(transport).then(() => {
  console.error('[agent-coord-mcp] Server connected and ready');
  console.error('[agent-coord-mcp] Tools: 7 (work, agent-status, group-chat, resource, task, zone, message)');
}).catch((err: Error) => {
  console.error('[agent-coord-mcp] Failed to connect:', err);
  process.exit(1);
});
