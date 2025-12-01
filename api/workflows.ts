import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const WORKFLOWS_KEY = 'agent-coord:workflows';
const WORKFLOW_RUNS_KEY = 'agent-coord:workflow-runs';

interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  assignTo?: string;  // Agent ID or role
  dependsOn?: string[];  // Step IDs that must complete first
  tools?: string[];  // Suggested tools to use
  checkpoints?: string[];  // What to verify before marking complete
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  category: 'development' | 'review' | 'deployment' | 'research' | 'support' | 'custom';
  steps: WorkflowStep[];
  createdBy: string;
  createdAt: string;
  timesRun: number;
}

interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'running' | 'completed' | 'failed' | 'paused';
  startedBy: string;
  startedAt: string;
  completedAt?: string;
  stepStatus: Record<string, 'pending' | 'in_progress' | 'completed' | 'skipped'>;
  participants: string[];
  notes?: string;
}

// Built-in workflow templates
const BUILTIN_WORKFLOWS: Record<string, Omit<Workflow, 'id' | 'createdBy' | 'createdAt' | 'timesRun'>> = {
  'feature-development': {
    name: 'Feature Development',
    description: 'End-to-end feature implementation workflow',
    category: 'development',
    steps: [
      {
        id: 'plan',
        name: 'Plan & Design',
        description: 'Understand requirements, design solution, identify files to modify',
        tools: ['repo-context', 'memory', 'context-load'],
        checkpoints: ['Requirements understood', 'Design documented', 'Files identified']
      },
      {
        id: 'claim',
        name: 'Claim Resources',
        description: 'Lock files and claim work area to prevent conflicts',
        tools: ['resource', 'zone', 'agent-status'],
        dependsOn: ['plan'],
        checkpoints: ['Files locked', 'Zone claimed', 'Team notified']
      },
      {
        id: 'implement',
        name: 'Implement',
        description: 'Write the code, following existing patterns',
        tools: ['memory', 'repo-context'],
        dependsOn: ['claim'],
        checkpoints: ['Code written', 'Follows patterns', 'No lint errors']
      },
      {
        id: 'test',
        name: 'Test',
        description: 'Run tests, fix any failures',
        tools: ['ui-test', 'metrics'],
        dependsOn: ['implement'],
        checkpoints: ['Tests pass', 'No regressions', 'Coverage adequate']
      },
      {
        id: 'review',
        name: 'Code Review',
        description: 'Self-review or request peer review',
        tools: ['group-chat', 'handoff'],
        dependsOn: ['test'],
        checkpoints: ['Code reviewed', 'Feedback addressed']
      },
      {
        id: 'deploy',
        name: 'Deploy & Release',
        description: 'Commit, push, verify deployment',
        tools: ['agent-status', 'resource'],
        dependsOn: ['review'],
        checkpoints: ['Committed', 'Pushed', 'Deployed', 'Locks released']
      }
    ]
  },
  'bug-fix': {
    name: 'Bug Fix',
    description: 'Systematic bug investigation and fix workflow',
    category: 'development',
    steps: [
      {
        id: 'reproduce',
        name: 'Reproduce Issue',
        description: 'Understand and reproduce the bug',
        tools: ['memory', 'repo-context'],
        checkpoints: ['Bug reproduced', 'Root cause identified']
      },
      {
        id: 'investigate',
        name: 'Investigate',
        description: 'Find the root cause in code',
        tools: ['repo-context', 'memory'],
        dependsOn: ['reproduce'],
        checkpoints: ['Files identified', 'Cause understood']
      },
      {
        id: 'fix',
        name: 'Implement Fix',
        description: 'Write the fix, minimal changes',
        tools: ['resource'],
        dependsOn: ['investigate'],
        checkpoints: ['Fix implemented', 'Minimal changes']
      },
      {
        id: 'verify',
        name: 'Verify Fix',
        description: 'Confirm bug is fixed, no regressions',
        tools: ['ui-test'],
        dependsOn: ['fix'],
        checkpoints: ['Bug fixed', 'No regressions']
      },
      {
        id: 'document',
        name: 'Document',
        description: 'Add to memory for future reference',
        tools: ['memory'],
        dependsOn: ['verify'],
        checkpoints: ['Cause documented', 'Solution recorded']
      }
    ]
  },
  'code-review': {
    name: 'Code Review',
    description: 'Peer code review workflow',
    category: 'review',
    steps: [
      {
        id: 'context',
        name: 'Load Context',
        description: 'Understand what changed and why',
        tools: ['hot-start', 'repo-context', 'handoff'],
        checkpoints: ['Changes understood', 'Requirements clear']
      },
      {
        id: 'review-code',
        name: 'Review Code',
        description: 'Check code quality, patterns, security',
        tools: ['memory', 'repo-context'],
        dependsOn: ['context'],
        checkpoints: ['Logic correct', 'Patterns followed', 'No security issues']
      },
      {
        id: 'feedback',
        name: 'Provide Feedback',
        description: 'Document findings, suggest improvements',
        tools: ['group-chat', 'message'],
        dependsOn: ['review-code'],
        checkpoints: ['Feedback given', 'Clear and actionable']
      },
      {
        id: 'approve',
        name: 'Approve or Request Changes',
        description: 'Final decision on the review',
        tools: ['handoff', 'task'],
        dependsOn: ['feedback'],
        checkpoints: ['Decision made', 'Author notified']
      }
    ]
  },
  'handoff': {
    name: 'Work Handoff',
    description: 'Transfer work between agents',
    category: 'support',
    steps: [
      {
        id: 'checkpoint',
        name: 'Save Checkpoint',
        description: 'Save current state and context',
        tools: ['checkpoint', 'memory'],
        checkpoints: ['State saved', 'Context documented']
      },
      {
        id: 'document',
        name: 'Document Status',
        description: 'Write up current progress, blockers, next steps',
        tools: ['handoff', 'memory'],
        dependsOn: ['checkpoint'],
        checkpoints: ['Progress documented', 'Blockers listed', 'Next steps clear']
      },
      {
        id: 'notify',
        name: 'Notify Recipient',
        description: 'Send handoff to receiving agent',
        tools: ['handoff', 'message', 'group-chat'],
        dependsOn: ['document'],
        checkpoints: ['Handoff sent', 'Recipient notified']
      },
      {
        id: 'release',
        name: 'Release Resources',
        description: 'Unlock files and release claims',
        tools: ['resource', 'zone'],
        dependsOn: ['notify'],
        checkpoints: ['Locks released', 'Claims cleared']
      }
    ]
  },
  'research': {
    name: 'Research Task',
    description: 'Investigate a topic and report findings',
    category: 'research',
    steps: [
      {
        id: 'scope',
        name: 'Define Scope',
        description: 'Clarify what needs to be researched',
        tools: ['memory', 'context-load'],
        checkpoints: ['Questions defined', 'Scope clear']
      },
      {
        id: 'gather',
        name: 'Gather Information',
        description: 'Search repos, docs, web for information',
        tools: ['repo-context', 'memory'],
        dependsOn: ['scope'],
        checkpoints: ['Sources found', 'Data collected']
      },
      {
        id: 'analyze',
        name: 'Analyze Findings',
        description: 'Synthesize information, draw conclusions',
        tools: ['memory'],
        dependsOn: ['gather'],
        checkpoints: ['Data analyzed', 'Conclusions drawn']
      },
      {
        id: 'report',
        name: 'Report Results',
        description: 'Share findings with team',
        tools: ['group-chat', 'memory'],
        dependsOn: ['analyze'],
        checkpoints: ['Report written', 'Team notified', 'Memory updated']
      }
    ]
  }
};

/**
 * Workflows API - Agent collaboration workflow templates
 *
 * GET /api/workflows - List all workflows (built-in + custom)
 * GET /api/workflows?id=X - Get specific workflow
 * GET /api/workflows?action=runs - List recent workflow runs
 * POST /api/workflows - Create custom workflow
 * POST /api/workflows?action=start - Start a workflow run
 * PATCH /api/workflows - Update workflow run status
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List workflows or get specific one
    if (req.method === 'GET') {
      const { id, action } = req.query;

      // Get recent workflow runs
      if (action === 'runs') {
        const runs = await redis.lrange(WORKFLOW_RUNS_KEY, 0, 49);
        const parsed = runs.map(r => typeof r === 'string' ? JSON.parse(r) : r);
        return res.json({ runs: parsed, count: parsed.length });
      }

      // Get specific workflow
      if (id) {
        // Check built-in first
        if (BUILTIN_WORKFLOWS[id as string]) {
          const builtin = BUILTIN_WORKFLOWS[id as string];
          return res.json({
            workflow: {
              id,
              ...builtin,
              createdBy: 'system',
              createdAt: '2025-01-01T00:00:00Z',
              timesRun: 0,
              isBuiltin: true
            }
          });
        }

        // Check custom
        const custom = await redis.hget(WORKFLOWS_KEY, id as string);
        if (custom) {
          const parsed = typeof custom === 'string' ? JSON.parse(custom) : custom;
          return res.json({ workflow: parsed });
        }

        return res.status(404).json({ error: 'Workflow not found' });
      }

      // List all workflows
      const customWorkflows = await redis.hgetall(WORKFLOWS_KEY) || {};
      const custom = Object.values(customWorkflows).map(w =>
        typeof w === 'string' ? JSON.parse(w) : w
      );

      const builtin = Object.entries(BUILTIN_WORKFLOWS).map(([key, value]) => ({
        id: key,
        ...value,
        createdBy: 'system',
        createdAt: '2025-01-01T00:00:00Z',
        timesRun: 0,
        isBuiltin: true
      }));

      return res.json({
        workflows: [...builtin, ...custom],
        builtinCount: builtin.length,
        customCount: custom.length
      });
    }

    // POST: Create workflow or start run
    if (req.method === 'POST') {
      let body: any;
      try {
        body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const { action } = req.query;

      // Start a workflow run
      if (action === 'start') {
        const { workflowId, startedBy } = body;

        if (!workflowId || !startedBy) {
          return res.status(400).json({ error: 'workflowId and startedBy required' });
        }

        // Get workflow definition
        let workflow: any;
        if (BUILTIN_WORKFLOWS[workflowId]) {
          workflow = { id: workflowId, ...BUILTIN_WORKFLOWS[workflowId] };
        } else {
          const custom = await redis.hget(WORKFLOWS_KEY, workflowId);
          if (!custom) {
            return res.status(404).json({ error: 'Workflow not found' });
          }
          workflow = typeof custom === 'string' ? JSON.parse(custom) : custom;
        }

        // Create run
        const run: WorkflowRun = {
          id: `run-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`,
          workflowId,
          workflowName: workflow.name,
          status: 'running',
          startedBy,
          startedAt: new Date().toISOString(),
          stepStatus: {},
          participants: [startedBy]
        };

        // Initialize step statuses
        for (const step of workflow.steps) {
          run.stepStatus[step.id] = 'pending';
        }
        // Mark first step as in_progress
        if (workflow.steps.length > 0) {
          run.stepStatus[workflow.steps[0].id] = 'in_progress';
        }

        await redis.lpush(WORKFLOW_RUNS_KEY, JSON.stringify(run));
        await redis.ltrim(WORKFLOW_RUNS_KEY, 0, 199);  // Keep last 200 runs

        return res.json({ success: true, run, workflow });
      }

      // Create custom workflow
      const { name, description, category, steps, createdBy } = body;

      if (!name || !steps || !createdBy) {
        return res.status(400).json({ error: 'name, steps, and createdBy required' });
      }

      const workflow: Workflow = {
        id: `wf-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`,
        name,
        description: description || '',
        category: category || 'custom',
        steps,
        createdBy,
        createdAt: new Date().toISOString(),
        timesRun: 0
      };

      await redis.hset(WORKFLOWS_KEY, { [workflow.id]: JSON.stringify(workflow) });

      return res.json({ success: true, workflow });
    }

    // PATCH: Update workflow run
    if (req.method === 'PATCH') {
      let body: any;
      try {
        body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const { runId, stepId, status, agentId, notes } = body;

      if (!runId) {
        return res.status(400).json({ error: 'runId required' });
      }

      // Find and update the run
      const runs = await redis.lrange(WORKFLOW_RUNS_KEY, 0, 199);
      let found = false;

      for (let i = 0; i < runs.length; i++) {
        const run = typeof runs[i] === 'string' ? JSON.parse(runs[i]) : runs[i];
        if (run.id === runId) {
          if (stepId && status) {
            run.stepStatus[stepId] = status;
          }
          if (agentId && !run.participants.includes(agentId)) {
            run.participants.push(agentId);
          }
          if (notes) {
            run.notes = notes;
          }

          // Check if all steps completed
          const allCompleted = Object.values(run.stepStatus).every(
            s => s === 'completed' || s === 'skipped'
          );
          if (allCompleted) {
            run.status = 'completed';
            run.completedAt = new Date().toISOString();
          }

          await redis.lset(WORKFLOW_RUNS_KEY, i, JSON.stringify(run));
          found = true;
          return res.json({ success: true, run });
        }
      }

      if (!found) {
        return res.status(404).json({ error: 'Run not found' });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Workflows API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
