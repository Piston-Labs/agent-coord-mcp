/**
 * Messaging Tools - DMs, handoffs, and checkpoints
 *
 * Tools: message, handoff, checkpoint
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { unifiedStore as store } from '../unified-store.js';

const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

export function registerMessagingTools(server: McpServer) {
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
}
