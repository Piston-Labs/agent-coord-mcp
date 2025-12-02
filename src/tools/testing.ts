/**
 * Testing Tools - UI testing and metrics
 *
 * Tools: ui-test, metrics
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

export function registerTestingTools(server: McpServer) {
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
}
