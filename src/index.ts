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
  'Load context clusters for specialized knowledge. Integrates with Context Engine patterns.',
  {
    cluster: z.enum(['technical', 'development', 'company', 'telemetry', 'frontend', 'backend', 'coordination'])
      .describe('Context cluster to load'),
    depth: z.enum(['summary', 'full']).optional().describe('How much detail to load'),
    agentId: z.string().describe('Your agent ID')
  },
  async (args) => {
    const { cluster, depth = 'summary', agentId } = args;
    const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

    try {
      // Try to fetch from context API
      const res = await fetch(`${API_BASE}/api/context?cluster=${cluster}&depth=${depth}`);
      if (res.ok) {
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      // Fallback: Return built-in context for coordination cluster
      const builtInContexts: Record<string, object> = {
        coordination: {
          cluster: 'coordination',
          description: 'Multi-agent coordination patterns and best practices',
          content: {
            claimBeforeEdit: 'Always claim files before editing using agent-status claim',
            handoffProtocol: 'Use handoff tool to transfer work with full context',
            checkpointFrequency: 'Save checkpoints every 15 minutes or after major decisions',
            mentionProtocol: 'Use @agentId in group chat to notify specific agents',
            lockExpiry: 'Resource locks expire after 2 hours, claims after 30 minutes'
          }
        },
        technical: {
          cluster: 'technical',
          description: 'Technical architecture and patterns',
          content: {
            stack: 'TypeScript, Node.js, Redis (Upstash), Vercel',
            mcp: 'Model Context Protocol for agent tools',
            api: 'REST APIs in /api folder, deployed to Vercel'
          }
        },
        development: {
          cluster: 'development',
          description: 'Development workflows and practices',
          content: {
            gitFlow: 'Main branch, feature branches, PR reviews',
            testing: 'Feature tests via /api/feature-tests',
            deployment: 'Auto-deploy on push to main via Vercel'
          }
        }
      };

      const context = builtInContexts[cluster] || { cluster, error: 'Cluster not found', available: Object.keys(builtInContexts) };
      return { content: [{ type: 'text', text: JSON.stringify(context) }] };
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
// Start Server
// ============================================================================

const transport = new StdioServerTransport();

server.connect(transport).then(() => {
  console.error('[agent-coord-mcp] Server connected and ready');
  console.error('[agent-coord-mcp] Tools: 13 (work, agent-status, group-chat, resource, task, zone, message, handoff, checkpoint, context-load, vision, repo-context, memory)');
}).catch((err: Error) => {
  console.error('[agent-coord-mcp] Failed to connect:', err);
  process.exit(1);
});
