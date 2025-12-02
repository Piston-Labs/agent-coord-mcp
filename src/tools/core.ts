/**
 * Core Tools - Essential agent coordination
 *
 * Tools: work, agent-status, group-chat
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { unifiedStore as store } from '../unified-store.js';

const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

export function registerCoreTools(server: McpServer) {
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
          try {
            const res = await fetch(`${API_BASE}/api/claims`);
            const data = await res.json();
            const claim = data.claims?.find((c: any) => c.what === args.what);
            return { content: [{ type: 'text', text: JSON.stringify(claim ? { claimed: true, ...claim } : { claimed: false }) }] };
          } catch (err) {
            const claim = store.checkClaim(args.what);
            return { content: [{ type: 'text', text: JSON.stringify(claim ? { claimed: true, ...claim } : { claimed: false }) }] };
          }
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

          // Detect @mentions for notifications
          const mentions = store.extractMentions(args.message);

          // POST to HTTP API so message persists to Redis and shows in dashboard
          try {
            const res = await fetch(`${API_BASE}/api/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                author: args.author,
                authorType: 'agent',
                message: args.message
              })
            });
            const data = await res.json();

            // Send mention notifications via local store (these are ephemeral)
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
                  id: data.id,
                  sent: true,
                  timestamp: data.timestamp,
                  mentions: { detected: mentions, pinged: mentions },
                  persistedToRedis: true
                })
              }]
            };
          } catch (err) {
            // Fallback to local store if HTTP fails
            const msg = store.postGroupMessage(args.author, 'agent', args.message);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  id: msg.id,
                  sent: true,
                  timestamp: msg.timestamp,
                  mentions: { detected: mentions, pinged: mentions },
                  persistedToRedis: false,
                  warning: 'Message only saved locally - HTTP API unreachable'
                })
              }]
            };
          }
        }

        case 'get': {
          try {
            const res = await fetch(`${API_BASE}/api/chat?limit=${args.limit || 50}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          } catch (err) {
            // Fallback to local store
            const messages = store.getGroupMessages(args.limit || 50);
            return { content: [{ type: 'text', text: JSON.stringify({ messages, count: messages.length, source: 'local' }) }] };
          }
        }

        case 'get-since': {
          if (!args.since) return { content: [{ type: 'text', text: 'since required' }] };
          try {
            const res = await fetch(`${API_BASE}/api/chat?since=${encodeURIComponent(args.since)}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify({ ...data, since: args.since }) }] };
          } catch (err) {
            const messages = store.getGroupMessagesSince(args.since);
            return { content: [{ type: 'text', text: JSON.stringify({ messages, count: messages.length, since: args.since, source: 'local' }) }] };
          }
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
}
