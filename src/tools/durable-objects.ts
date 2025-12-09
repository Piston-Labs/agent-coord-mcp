/**
 * Durable Objects Tools - MCP wrappers for Cloudflare DO endpoints
 *
 * These tools wrap the Cloudflare Durable Objects endpoints for:
 * - Soul progression (XP, levels, achievements)
 * - WorkTrace observability ("Show Your Work")
 * - Agent dashboard (self-view with coaching)
 * - Session resume (CEO Portal feature)
 * - Agent onboarding (full startup bundle)
 *
 * Tools: do-soul, do-trace, do-dashboard, do-session, do-onboard
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// DO_URL for production, fallback to local wrangler dev
const DO_BASE = process.env.DO_URL || 'http://127.0.0.1:8787';

export function registerDurableObjectsTools(server: McpServer) {
  // ============================================================================
  // DO-SOUL TOOL - Soul progression (XP, levels, achievements)
  // ============================================================================

  server.tool(
    'do-soul',
    'Soul progression system in Durable Objects. Get/update XP, levels, achievements, abilities, and specializations. Requires wrangler dev running locally or DO_URL set.',
    {
      action: z.enum(['get', 'create', 'add-xp', 'unlock-achievement']).describe('get=fetch soul, create=new soul, add-xp=award XP, unlock-achievement=grant achievement'),
      agentId: z.string().describe('Agent ID (soul is stored per-agent)'),
      xp: z.number().optional().describe('XP amount to add (for add-xp action)'),
      source: z.string().optional().describe('XP source description (for add-xp action)'),
      achievementId: z.string().optional().describe('Achievement ID to unlock'),
      name: z.string().optional().describe('Display name for new soul (for create action)')
    },
    async (args) => {
      const { action, agentId, xp, source, achievementId, name } = args;

      try {
        const baseUrl = `${DO_BASE}/agent/${encodeURIComponent(agentId)}/soul`;

        switch (action) {
          case 'get': {
            const res = await fetch(`${baseUrl}?agentId=${agentId}`);
            if (!res.ok) {
              const error = await res.text();
              return { content: [{ type: 'text', text: JSON.stringify({ error: `Failed to get soul: ${error}`, hint: 'Is wrangler dev running? Try: cd cloudflare-do && npx wrangler dev' }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'create': {
            const res = await fetch(`${baseUrl}?agentId=${agentId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ soulId: agentId, name: name || agentId })
            });
            if (!res.ok) {
              const error = await res.text();
              return { content: [{ type: 'text', text: JSON.stringify({ error: `Failed to create soul: ${error}` }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify({ created: true, ...data }, null, 2) }] };
          }

          case 'add-xp': {
            if (!xp) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'xp parameter required for add-xp action' }) }] };
            }
            const res = await fetch(`${baseUrl}?agentId=${agentId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'add-xp', xp, source: source || 'MCP tool' })
            });
            if (!res.ok) {
              const error = await res.text();
              return { content: [{ type: 'text', text: JSON.stringify({ error: `Failed to add XP: ${error}` }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'unlock-achievement': {
            if (!achievementId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'achievementId parameter required for unlock-achievement action' }) }] };
            }
            const res = await fetch(`${baseUrl}?agentId=${agentId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'unlock-achievement', achievementId })
            });
            if (!res.ok) {
              const error = await res.text();
              return { content: [{ type: 'text', text: JSON.stringify({ error: `Failed to unlock achievement: ${error}` }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          default:
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: String(error),
          hint: 'Is wrangler dev running? Try: cd cloudflare-do && npx wrangler dev'
        }) }] };
      }
    }
  );

  // ============================================================================
  // DO-TRACE TOOL - WorkTrace observability ("Show Your Work")
  // ============================================================================

  server.tool(
    'do-trace',
    'WorkTrace observability - log work steps, track progress, detect stuck states. "Show Your Work" for agents. Requires wrangler dev or DO_URL.',
    {
      action: z.enum(['list', 'start', 'get', 'step', 'complete']).describe('list=all traces, start=new trace, get=fetch trace, step=log work step, complete=finish trace'),
      agentId: z.string().describe('Agent ID'),
      sessionId: z.string().optional().describe('Trace session ID (for get/step/complete)'),
      taskDescription: z.string().optional().describe('Task description (for start action)'),
      stepAction: z.string().optional().describe('What action was taken (for step)'),
      stepTarget: z.string().optional().describe('What was acted on - file, function, etc (for step)'),
      stepOutcome: z.enum(['success', 'partial', 'failed', 'blocked', 'exploring']).optional().describe('Step outcome'),
      stepContext: z.string().optional().describe('Additional context for step'),
      completionSummary: z.string().optional().describe('Summary for completion')
    },
    async (args) => {
      const { action, agentId, sessionId, taskDescription, stepAction, stepTarget, stepOutcome, stepContext, completionSummary } = args;

      try {
        const baseUrl = `${DO_BASE}/agent/${encodeURIComponent(agentId)}/trace`;

        switch (action) {
          case 'list': {
            const res = await fetch(`${baseUrl}?agentId=${agentId}`);
            if (!res.ok) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'Failed to list traces', hint: 'Is wrangler dev running?' }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'start': {
            if (!taskDescription) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'taskDescription required for start action' }) }] };
            }
            const res = await fetch(`${baseUrl}?agentId=${agentId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskDescription })
            });
            if (!res.ok) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'Failed to start trace' }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'get': {
            if (!sessionId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'sessionId required for get action' }) }] };
            }
            const res = await fetch(`${baseUrl}/${sessionId}?agentId=${agentId}`);
            if (!res.ok) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'Failed to get trace' }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'step': {
            if (!sessionId || !stepAction) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'sessionId and stepAction required for step action' }) }] };
            }
            const res = await fetch(`${baseUrl}/${sessionId}/step?agentId=${agentId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: stepAction,
                target: stepTarget,
                outcome: stepOutcome || 'success',
                context: stepContext
              })
            });
            if (!res.ok) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'Failed to log step' }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'complete': {
            if (!sessionId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'sessionId required for complete action' }) }] };
            }
            const res = await fetch(`${baseUrl}/${sessionId}/complete?agentId=${agentId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ summary: completionSummary })
            });
            if (!res.ok) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'Failed to complete trace' }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          default:
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error), hint: 'Is wrangler dev running?' }) }] };
      }
    }
  );

  // ============================================================================
  // DO-DASHBOARD TOOL - Agent self-view with coaching
  // ============================================================================

  server.tool(
    'do-dashboard',
    'Agent self-dashboard - aggregated view of soul, progress, flow state, suggestions, and alerts. Great for self-assessment and coaching.',
    {
      agentId: z.string().describe('Agent ID to get dashboard for')
    },
    async (args) => {
      const { agentId } = args;

      try {
        const res = await fetch(`${DO_BASE}/agent/${encodeURIComponent(agentId)}/dashboard?agentId=${agentId}`);

        if (!res.ok) {
          const error = await res.text();
          return { content: [{ type: 'text', text: JSON.stringify({
            error: `Failed to get dashboard: ${error}`,
            hint: 'Is wrangler dev running? Try: cd cloudflare-do && npx wrangler dev'
          }) }] };
        }

        const data = await res.json();

        // Format a helpful summary
        const dashboard = data.dashboard || data;
        const summary = {
          level: dashboard.level?.current || 'Unknown',
          xp: dashboard.level?.currentXp || 0,
          xpToNext: dashboard.level?.xpToNextLevel || 0,
          flowState: dashboard.flow?.status || 'unknown',
          streakDays: dashboard.streak?.currentStreak || 0,
          rustStatus: dashboard.rust?.status || 'none',
          alertCount: dashboard.alerts?.length || 0,
          suggestionCount: dashboard.suggestions?.length || 0
        };

        return { content: [{ type: 'text', text: JSON.stringify({
          summary,
          ...data
        }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: String(error),
          hint: 'Is wrangler dev running? Try: cd cloudflare-do && npx wrangler dev'
        }) }] };
      }
    }
  );

  // ============================================================================
  // DO-SESSION TOOL - Session resume for CEO Portal
  // ============================================================================

  server.tool(
    'do-session',
    'Session resume endpoint - get summary of last autonomous session including participants, accomplishments, pending work, and quick actions. Perfect for CEO Portal.',
    {},
    async () => {
      try {
        const res = await fetch(`${DO_BASE}/coordinator/session-resume`);

        if (!res.ok) {
          const error = await res.text();
          return { content: [{ type: 'text', text: JSON.stringify({
            error: `Failed to get session resume: ${error}`,
            hint: 'Is wrangler dev running? Try: cd cloudflare-do && npx wrangler dev'
          }) }] };
        }

        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: String(error),
          hint: 'Is wrangler dev running? Try: cd cloudflare-do && npx wrangler dev'
        }) }] };
      }
    }
  );

  // ============================================================================
  // DO-ONBOARD TOOL - Full agent onboarding bundle
  // ============================================================================

  server.tool(
    'do-onboard',
    'Full onboarding bundle from Durable Objects - soul data, checkpoint, team status with flow state, suggested task, recent chat. Perfect for agent startup.',
    {
      agentId: z.string().describe('Agent ID to onboard')
    },
    async (args) => {
      const { agentId } = args;

      try {
        const res = await fetch(`${DO_BASE}/coordinator/onboard?agentId=${encodeURIComponent(agentId)}`);

        if (!res.ok) {
          const error = await res.text();
          return { content: [{ type: 'text', text: JSON.stringify({
            error: `Failed to get onboarding bundle: ${error}`,
            hint: 'Is wrangler dev running? Try: cd cloudflare-do && npx wrangler dev'
          }) }] };
        }

        const data = await res.json();
        const onboarding = data.onboarding || data;

        // Format summary
        const summary = {
          agentId: onboarding.agentId,
          isNewAgent: onboarding.isNewAgent,
          teamOnline: onboarding.teamOnline?.length || 0,
          hasSoul: !!onboarding.soul,
          hasCheckpoint: !!onboarding.checkpoint,
          suggestedTask: onboarding.suggestedTask?.task || 'No task suggested',
          welcomeMessage: onboarding.welcomeMessage
        };

        return { content: [{ type: 'text', text: JSON.stringify({
          summary,
          ...data
        }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: String(error),
          hint: 'Is wrangler dev running? Try: cd cloudflare-do && npx wrangler dev'
        }) }] };
      }
    }
  );

  // ============================================================================
  // DO-CREDENTIALS TOOL - Soul credentials/secrets management
  // ============================================================================

  server.tool(
    'do-credentials',
    'Manage soul credentials (API keys, tokens) stored in Durable Objects. Credentials persist with the soul for session injection. Requires wrangler dev or DO_URL.',
    {
      action: z.enum(['list', 'get', 'set', 'set-batch', 'delete', 'bundle']).describe('list=show keys, get=get value, set=store single, set-batch=store multiple, delete=remove, bundle=get all for injection'),
      agentId: z.string().describe('Agent ID (credentials stored per-soul)'),
      key: z.string().optional().describe('Credential key name (e.g., ANTHROPIC_API_KEY)'),
      value: z.string().optional().describe('Credential value (for set action)'),
      credentials: z.record(z.string()).optional().describe('Key-value pairs (for set-batch action)')
    },
    async (args) => {
      const { action, agentId, key, value, credentials } = args;

      try {
        const baseUrl = `${DO_BASE}/agent/${encodeURIComponent(agentId)}/credentials`;

        switch (action) {
          case 'list': {
            const res = await fetch(`${baseUrl}?action=list`);
            if (!res.ok) {
              const error = await res.text();
              return { content: [{ type: 'text', text: JSON.stringify({ error: `Failed to list credentials: ${error}` }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'get': {
            if (!key) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'key parameter required for get action' }) }] };
            }
            const res = await fetch(`${baseUrl}?action=get&key=${encodeURIComponent(key)}`);
            if (!res.ok) {
              const error = await res.text();
              return { content: [{ type: 'text', text: JSON.stringify({ error: `Failed to get credential: ${error}` }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'set': {
            if (!key || !value) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'key and value required for set action' }) }] };
            }
            const res = await fetch(baseUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key, value })
            });
            if (!res.ok) {
              const error = await res.text();
              return { content: [{ type: 'text', text: JSON.stringify({ error: `Failed to set credential: ${error}` }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'set-batch': {
            if (!credentials || Object.keys(credentials).length === 0) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'credentials object required for set-batch action' }) }] };
            }
            const res = await fetch(baseUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ credentials })
            });
            if (!res.ok) {
              const error = await res.text();
              return { content: [{ type: 'text', text: JSON.stringify({ error: `Failed to set credentials: ${error}` }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'delete': {
            if (!key) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'key parameter required for delete action' }) }] };
            }
            const res = await fetch(`${baseUrl}?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
            if (!res.ok) {
              const error = await res.text();
              return { content: [{ type: 'text', text: JSON.stringify({ error: `Failed to delete credential: ${error}` }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'bundle': {
            const res = await fetch(`${baseUrl}?action=bundle`);
            if (!res.ok) {
              const error = await res.text();
              return { content: [{ type: 'text', text: JSON.stringify({ error: `Failed to get credentials bundle: ${error}` }) }] };
            }
            const data = await res.json();
            // Mask values in output for security
            const masked = { ...data };
            if (masked.credentials) {
              for (const k of Object.keys(masked.credentials)) {
                const v = masked.credentials[k];
                masked.credentials[k] = v.length > 12 ? `${v.slice(0, 4)}...${v.slice(-4)}` : '****';
              }
            }
            return { content: [{ type: 'text', text: JSON.stringify({
              note: 'Values masked for security. Use get action for full values.',
              ...masked
            }, null, 2) }] };
          }

          default:
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: String(error),
          hint: 'Is wrangler dev running? Try: cd cloudflare-do && npx wrangler dev'
        }) }] };
      }
    }
  );

  // ============================================================================
  // DO-CHECKPOINT TOOL - Persistent checkpoint storage in Durable Objects
  // ============================================================================

  server.tool(
    'do-checkpoint',
    'Save or restore checkpoints in Durable Objects (permanent storage). Use this for long-term state persistence tied to your soul identity. More durable than Redis checkpoints.',
    {
      action: z.enum(['save', 'get']).describe('save=persist checkpoint, get=retrieve checkpoint'),
      agentId: z.string().describe('Agent ID'),
      conversationSummary: z.string().optional().describe('Summary of key decisions and progress (for save)'),
      accomplishments: z.array(z.string()).optional().describe('List of completed items this session (for save)'),
      pendingWork: z.array(z.string()).optional().describe('List of incomplete items (for save)'),
      recentContext: z.string().optional().describe('Recent conversation context (for save)'),
      filesEdited: z.array(z.string()).optional().describe('Files modified this session (for save)'),
      currentTask: z.string().optional().describe('What you are actively working on (for save)')
    },
    async (args) => {
      const { action, agentId, conversationSummary, accomplishments, pendingWork, recentContext, filesEdited, currentTask } = args;

      try {
        const baseUrl = `${DO_BASE}/agent/${encodeURIComponent(agentId)}/checkpoint`;

        switch (action) {
          case 'get': {
            const res = await fetch(`${baseUrl}?agentId=${agentId}`);
            if (!res.ok) {
              const error = await res.text();
              return { content: [{ type: 'text', text: JSON.stringify({
                error: `Failed to get checkpoint: ${error}`,
                hint: 'Is wrangler dev running? Or no checkpoint saved yet.'
              }) }] };
            }
            const data = await res.json();
            if (!data.checkpoint) {
              return { content: [{ type: 'text', text: JSON.stringify({
                found: false,
                message: 'No checkpoint saved for this agent'
              }) }] };
            }
            return { content: [{ type: 'text', text: JSON.stringify({
              found: true,
              ...data
            }, null, 2) }] };
          }

          case 'save': {
            // Build checkpoint payload
            const checkpoint: Record<string, unknown> = {};
            if (conversationSummary) checkpoint.conversationSummary = conversationSummary;
            if (accomplishments) checkpoint.accomplishments = accomplishments;
            if (pendingWork) checkpoint.pendingWork = pendingWork;
            if (recentContext) checkpoint.recentContext = recentContext;
            if (filesEdited) checkpoint.filesEdited = filesEdited;
            if (currentTask) {
              // Store currentTask in recentContext if not already provided
              checkpoint.recentContext = recentContext || `Current task: ${currentTask}`;
            }

            if (Object.keys(checkpoint).length === 0) {
              return { content: [{ type: 'text', text: JSON.stringify({
                error: 'At least one checkpoint field required (conversationSummary, pendingWork, recentContext, etc.)'
              }) }] };
            }

            const res = await fetch(`${baseUrl}?agentId=${agentId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(checkpoint)
            });

            if (!res.ok) {
              const error = await res.text();
              return { content: [{ type: 'text', text: JSON.stringify({
                error: `Failed to save checkpoint: ${error}`
              }) }] };
            }

            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify({
              saved: true,
              storage: 'durable-objects',
              persistence: 'permanent',
              checkpointAt: new Date().toISOString(),
              ...data
            }, null, 2) }] };
          }

          default:
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: String(error),
          hint: 'Is wrangler dev running? Try: cd cloudflare-do && npx wrangler dev'
        }) }] };
      }
    }
  );

  // ============================================================================
  // DO-VMPOOL TOOL - Persistent VM Pool Management
  // ============================================================================

  server.tool(
    'do-vmpool',
    'Manage persistent cloud VM pool in Durable Objects. Track VMs, assign agents, monitor health, auto-scale. Perfect for instant agent spawning. Requires wrangler dev or DO_URL.',
    {
      action: z.enum(['status', 'list', 'spawn', 'provision', 'terminate', 'ready', 'release', 'scale', 'config']).describe('status=pool overview, list=all VMs, spawn=assign agent to VM, provision=register new VM, terminate=remove VM, ready=mark VM ready, release=release agent, scale=get scaling recommendation, config=get/set config'),
      agentId: z.string().optional().describe('Agent ID (for spawn/release actions)'),
      vmId: z.string().optional().describe('VM ID (for terminate/ready actions)'),
      instanceId: z.string().optional().describe('AWS EC2 instance ID (for provision action)'),
      vmSize: z.enum(['small', 'medium', 'large']).optional().describe('VM size (for provision action) - small=2 agents, medium=5 agents, large=10 agents'),
      region: z.string().optional().describe('AWS region (for provision action)'),
      publicIp: z.string().optional().describe('Public IP (for provision action)'),
      task: z.string().optional().describe('Task description (for spawn action)'),
      scaleAction: z.enum(['up', 'down', 'set']).optional().describe('Scale direction (for scale action)'),
      count: z.number().optional().describe('Target VM count (for scale action with set)'),
      force: z.boolean().optional().describe('Force terminate even with active agents'),
      configUpdate: z.object({
        minVMs: z.number().optional(),
        maxVMs: z.number().optional(),
        targetFreeCapacity: z.number().optional(),
        healthCheckIntervalMs: z.number().optional()
      }).optional().describe('Config values to update (for config action with POST)')
    },
    async (args) => {
      const { action, agentId, vmId, instanceId, vmSize, region, publicIp, task, scaleAction, count, force, configUpdate } = args;

      try {
        const baseUrl = `${DO_BASE}/vmpool`;

        switch (action) {
          case 'status': {
            const res = await fetch(`${baseUrl}/status`);
            if (!res.ok) {
              const error = await res.text();
              return { content: [{ type: 'text', text: JSON.stringify({ error: `Failed to get pool status: ${error}`, hint: 'Is wrangler dev running? Try: cd cloudflare-do && npx wrangler dev' }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'list': {
            const res = await fetch(`${baseUrl}/vms`);
            if (!res.ok) {
              const error = await res.text();
              return { content: [{ type: 'text', text: JSON.stringify({ error: `Failed to list VMs: ${error}` }) }] };
            }
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'spawn': {
            if (!agentId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'agentId required for spawn action' }) }] };
            }
            const res = await fetch(`${baseUrl}/spawn`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agentId, task, preferredVmId: vmId })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'provision': {
            if (!instanceId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'instanceId required for provision action' }) }] };
            }
            const res = await fetch(`${baseUrl}/provision`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ instanceId, vmSize, region, publicIp })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'terminate': {
            if (!vmId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'vmId required for terminate action' }) }] };
            }
            const res = await fetch(`${baseUrl}/terminate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ vmId, force })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'ready': {
            if (!vmId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'vmId required for ready action' }) }] };
            }
            const res = await fetch(`${baseUrl}/vm/${encodeURIComponent(vmId)}/ready`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}'
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'release': {
            if (!agentId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'agentId required for release action' }) }] };
            }
            const res = await fetch(`${baseUrl}/release`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agentId })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'scale': {
            if (!scaleAction) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'scaleAction (up/down/set) required for scale action' }) }] };
            }
            const res = await fetch(`${baseUrl}/scale`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: scaleAction, count })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'config': {
            if (configUpdate) {
              const res = await fetch(`${baseUrl}/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(configUpdate)
              });
              const data = await res.json();
              return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
            } else {
              const res = await fetch(`${baseUrl}/config`);
              const data = await res.json();
              return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
            }
          }

          default:
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: String(error),
          hint: 'Is wrangler dev running? Try: cd cloudflare-do && npx wrangler dev'
        }) }] };
      }
    }
  );
}
