/**
 * Orchestration Tools - Multi-agent coordination and workflows
 *
 * Tools: orchestrate, spawn-parallel, workflow, hot-start, auto-poll
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

export function registerOrchestrationTools(server: McpServer) {
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

      try {
        // Register agent with API so they show in web dashboard sidebar
        try {
          await fetch(`${API_BASE}/api/agents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: agentId,
              status: 'active',
              currentTask: 'Starting up (hot-start)',
              role: role
            })
          });
        } catch {
          // Ignore registration errors, continue with hot-start
        }

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
  // ORCHESTRATE TOOL - Hierarchical Multi-Agent Coordination
  // ============================================================================

  server.tool(
    'orchestrate',
    'Coordinate complex tasks by breaking them into subtasks for specialist agents. Create orchestrations, assign subtasks, track progress, and synthesize results.',
    {
      action: z.enum(['create', 'get', 'list', 'update-subtask', 'assign-subtask', 'synthesize']).describe('Operation'),
      orchestrationId: z.string().optional().describe('Orchestration ID (for get/update/synthesize)'),
      title: z.string().optional().describe('Title for new orchestration'),
      description: z.string().optional().describe('Description of the overall task'),
      coordinator: z.string().optional().describe('Your agent ID (coordinator)'),
      subtasks: z.array(z.object({
        title: z.string(),
        description: z.string().optional(),
        assignee: z.string().optional()
      })).optional().describe('Array of subtasks to create'),
      subtaskId: z.string().optional().describe('Subtask ID (for update-subtask/assign-subtask)'),
      status: z.enum(['pending', 'assigned', 'in-progress', 'completed', 'failed']).optional(),
      result: z.string().optional().describe('Result/output from completing subtask'),
      assignee: z.string().optional().describe('Agent to assign subtask to'),
      synthesis: z.string().optional().describe('Combined result from all subtasks')
    },
    async (args) => {
      const { action } = args;

      try {
        switch (action) {
          case 'create': {
            if (!args.title || !args.coordinator) {
              return { content: [{ type: 'text', text: 'title and coordinator required' }] };
            }
            const res = await fetch(`${API_BASE}/api/orchestrate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: args.title,
                description: args.description,
                coordinator: args.coordinator,
                subtasks: args.subtasks || []
              })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'get': {
            if (!args.orchestrationId) {
              return { content: [{ type: 'text', text: 'orchestrationId required' }] };
            }
            const res = await fetch(`${API_BASE}/api/orchestrate?id=${encodeURIComponent(args.orchestrationId)}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'list': {
            const params = new URLSearchParams();
            if (args.coordinator) params.append('coordinator', args.coordinator);
            const res = await fetch(`${API_BASE}/api/orchestrate?${params.toString()}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'update-subtask': {
            if (!args.orchestrationId || !args.subtaskId) {
              return { content: [{ type: 'text', text: 'orchestrationId and subtaskId required' }] };
            }
            const res = await fetch(`${API_BASE}/api/orchestrate`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: args.orchestrationId,
                subtaskId: args.subtaskId,
                status: args.status,
                result: args.result
              })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'assign-subtask': {
            if (!args.orchestrationId || !args.subtaskId || !args.assignee) {
              return { content: [{ type: 'text', text: 'orchestrationId, subtaskId, and assignee required' }] };
            }
            const res = await fetch(`${API_BASE}/api/orchestrate`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: args.orchestrationId,
                subtaskId: args.subtaskId,
                assignee: args.assignee,
                status: 'assigned'
              })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'synthesize': {
            if (!args.orchestrationId || !args.synthesis) {
              return { content: [{ type: 'text', text: 'orchestrationId and synthesis required' }] };
            }
            const res = await fetch(`${API_BASE}/api/orchestrate`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: args.orchestrationId,
                synthesis: args.synthesis
              })
            });
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
  // SPAWN-PARALLEL TOOL - Parallel Task Execution
  // ============================================================================

  server.tool(
    'spawn-parallel',
    'Spawn multiple independent tasks in parallel for concurrent execution by different agents. Returns a batch ID to track all spawned tasks.',
    {
      batchTitle: z.string().describe('Title for this batch of parallel tasks'),
      coordinator: z.string().describe('Your agent ID (who is spawning these tasks)'),
      tasks: z.array(z.object({
        title: z.string(),
        description: z.string().optional(),
        assignee: z.string().optional(),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional()
      })).describe('Array of tasks to spawn in parallel'),
      tags: z.array(z.string()).optional().describe('Tags to apply to all tasks')
    },
    async (args) => {
      const { batchTitle, coordinator, tasks, tags } = args;

      if (!tasks || tasks.length === 0) {
        return { content: [{ type: 'text', text: 'At least one task required' }] };
      }

      const batchId = `batch-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
      const createdTasks: any[] = [];
      const errors: string[] = [];

      // Spawn all tasks in parallel
      const promises = tasks.map(async (task, idx) => {
        try {
          const res = await fetch(`${API_BASE}/api/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: task.title,
              description: task.description || `Part of parallel batch: ${batchTitle}`,
              priority: task.priority || 'high',
              status: 'todo',
              createdBy: coordinator,
              assignee: task.assignee,
              tags: [...(tags || []), 'parallel-batch', batchId]
            })
          });
          const data = await res.json();
          return { success: true, task: data.task, index: idx };
        } catch (err) {
          return { success: false, error: String(err), index: idx };
        }
      });

      const results = await Promise.all(promises);

      for (const r of results) {
        if (r.success) {
          createdTasks.push(r.task);
        } else {
          errors.push(`Task ${r.index}: ${r.error}`);
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            batchId,
            batchTitle,
            coordinator,
            spawned: createdTasks.length,
            failed: errors.length,
            tasks: createdTasks.map(t => ({
              id: t?.id,
              title: t?.title,
              assignee: t?.assignee,
              status: t?.status
            })),
            errors: errors.length > 0 ? errors : undefined,
            trackWith: `task({ action: 'list', tags: ['${batchId}'] })`
          }, null, 2)
        }]
      };
    }
  );

  // ============================================================================
  // AUTO-POLL TOOL - Continuous monitoring without manual prompting
  // ============================================================================

  server.tool(
    'auto-poll',
    'Start/stop automatic polling for new messages and tasks. Returns accumulated updates since last poll.',
    {
      action: z.enum(['start', 'stop', 'check', 'poll-once'])
        .describe('start=begin polling, stop=end polling, check=get status, poll-once=single poll'),
      agentId: z.string().describe('Your agent ID'),
      intervalMs: z.number().optional().describe('Poll interval in milliseconds (default: 5000, min: 2000)'),
      sources: z.array(z.enum(['chat', 'tasks', 'claims', 'mentions']))
        .optional()
        .describe('What to poll for (default: all)')
    },
    async ({ action, agentId, intervalMs = 5000, sources }) => {
      // Enforce minimum interval
      const interval = Math.max(intervalMs, 2000);
      const pollSources = sources || ['chat', 'tasks', 'claims', 'mentions'];

      // Helper to perform a single poll
      const doPoll = async (since: string) => {
        const updates: {
          chat: any[];
          tasks: any[];
          claims: any[];
          mentions: any[];
          pollTime: string;
        } = {
          chat: [],
          tasks: [],
          claims: [],
          mentions: [],
          pollTime: new Date().toISOString()
        };

        try {
          // Poll chat messages
          if (pollSources.includes('chat')) {
            const chatRes = await fetch(`${API_BASE}/api/chat?since=${encodeURIComponent(since)}`);
            if (chatRes.ok) {
              const data = await chatRes.json();
              updates.chat = data.messages || [];
            }
          }

          // Poll for mentions specifically
          if (pollSources.includes('mentions')) {
            const chatRes = await fetch(`${API_BASE}/api/chat?since=${encodeURIComponent(since)}`);
            if (chatRes.ok) {
              const data = await chatRes.json();
              updates.mentions = (data.messages || []).filter((m: any) =>
                m.message?.toLowerCase().includes(`@${agentId.toLowerCase()}`)
              );
            }
          }

          // Poll tasks assigned to this agent
          if (pollSources.includes('tasks')) {
            const tasksRes = await fetch(`${API_BASE}/api/tasks?assignee=${encodeURIComponent(agentId)}&status=todo`);
            if (tasksRes.ok) {
              const data = await tasksRes.json();
              updates.tasks = data.tasks || [];
            }
          }

          // Poll claims that might affect this agent
          if (pollSources.includes('claims')) {
            const claimsRes = await fetch(`${API_BASE}/api/claims`);
            if (claimsRes.ok) {
              const data = await claimsRes.json();
              updates.claims = (data.claims || []).filter((c: any) =>
                new Date(c.since) > new Date(since)
              );
            }
          }
        } catch (err) {
          console.error('[auto-poll] Poll error:', err);
        }

        return updates;
      };

      switch (action) {
        case 'poll-once': {
          // Single poll - get everything since 5 minutes ago
          const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          const updates = await doPoll(since);

          const hasUpdates = updates.chat.length > 0 ||
                            updates.tasks.length > 0 ||
                            updates.claims.length > 0 ||
                            updates.mentions.length > 0;

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                agentId,
                hasUpdates,
                since,
                updates: {
                  newMessages: updates.chat.length,
                  newTasks: updates.tasks.length,
                  newClaims: updates.claims.length,
                  mentions: updates.mentions.length,
                  chat: updates.chat.slice(0, 10),
                  tasks: updates.tasks.slice(0, 5),
                  claims: updates.claims.slice(0, 5),
                  mentionedIn: updates.mentions.slice(0, 5)
                },
                nextPoll: `Call auto-poll with action='poll-once' again to check for more updates`
              }, null, 2)
            }]
          };
        }

        case 'start': {
          // For MCP, we can't truly run a background loop, but we can return
          // instructions for the client to poll
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                agentId,
                polling: true,
                interval,
                sources: pollSources,
                instructions: [
                  `Polling mode activated for ${agentId}`,
                  `Recommended: Call 'auto-poll' with action='poll-once' every ${interval}ms`,
                  `Or use the autonomous-agent pattern with built-in polling`,
                  `To check for mentions: messages containing @${agentId}`
                ],
                tip: 'For continuous monitoring, consider using the autonomous-agent deployment'
              }, null, 2)
            }]
          };
        }

        case 'stop': {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                agentId,
                polling: false,
                message: 'Polling stopped. Call auto-poll action=start to resume.'
              }, null, 2)
            }]
          };
        }

        case 'check': {
          // Quick status check
          const since = new Date(Date.now() - 60 * 1000).toISOString(); // Last minute
          const updates = await doPoll(since);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                agentId,
                status: 'checking',
                lastMinute: {
                  messages: updates.chat.length,
                  tasks: updates.tasks.length,
                  claims: updates.claims.length,
                  mentions: updates.mentions.length
                },
                hasPendingWork: updates.tasks.length > 0 || updates.mentions.length > 0
              }, null, 2)
            }]
          };
        }

        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
      }
    }
  );
}
