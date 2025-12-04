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
}
