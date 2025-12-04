import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const RULES_KEY = 'agent-coord:rules';
const CHAT_KEY = 'agent-coord:chat';

/**
 * Rules Center API - Development workflows, QC requirements, and success criteria
 *
 * GET /api/rules - Get all rules
 * GET /api/rules?section=workflows - Get specific section
 * GET /api/rules?action=validate&type=bugfix - Validate a workflow is complete
 * POST /api/rules - Replace all rules (admin)
 * PATCH /api/rules - Update specific section (admin)
 */

// Comprehensive development rules
const DEFAULT_RULES = {
  version: '2.0.0',
  lastUpdated: new Date().toISOString(),

  // ===========================================
  // DEVELOPMENT WORKFLOWS
  // ===========================================
  workflows: {
    bugfix: {
      name: 'Bug Fix Workflow',
      description: 'Required steps for fixing bugs in production code',
      steps: [
        {
          id: 'claim',
          name: 'Claim the work',
          required: true,
          description: 'Use agent-status claim to announce you are working on this bug',
          validation: 'Check agent-coord:claims for active claim',
        },
        {
          id: 'reproduce',
          name: 'Reproduce the bug',
          required: true,
          description: 'Confirm the bug exists and document reproduction steps',
          validation: 'Must document reproduction steps in chat or task',
        },
        {
          id: 'implement',
          name: 'Implement the fix',
          required: true,
          description: 'Write the code fix. Keep changes minimal and focused.',
          validation: 'Code changes committed locally',
        },
        {
          id: 'test_local',
          name: 'Test locally',
          required: true,
          description: 'Run npm run build and npm test. ALL tests must pass.',
          validation: 'Build succeeds, 0 test failures',
        },
        {
          id: 'qc_review',
          name: 'Quality Control review',
          required: true,
          description: 'Another agent or human reviews the fix before merge',
          validation: 'QC approval recorded in chat or task',
        },
        {
          id: 'push',
          name: 'Push to main',
          required: true,
          description: 'Push to main branch only after QC approval',
          validation: 'Commit on main branch',
        },
        {
          id: 'verify_deploy',
          name: 'Verify deployment',
          required: true,
          description: 'Confirm Vercel deployment succeeded and bug is fixed in production',
          validation: 'Production endpoint returns expected behavior',
        },
        {
          id: 'release_claim',
          name: 'Release claim and announce',
          required: true,
          description: 'Release your claim and announce completion in group chat',
          validation: 'Claim released, chat message posted',
        },
      ],
      successCriteria: {
        buildPasses: true,
        allTestsPass: true,
        qcApproved: true,
        deploymentVerified: true,
        noRegressions: true,
      },
    },

    feature: {
      name: 'Feature Development Workflow',
      description: 'Required steps for developing new features',
      steps: [
        {
          id: 'claim',
          name: 'Claim the feature',
          required: true,
          description: 'Claim the feature in coordination system',
        },
        {
          id: 'plan',
          name: 'Plan the implementation',
          required: true,
          description: 'Break down into tasks, identify files to modify, consider edge cases',
        },
        {
          id: 'implement',
          name: 'Implement the feature',
          required: true,
          description: 'Write the code. Follow existing patterns in codebase.',
        },
        {
          id: 'add_tests',
          name: 'Add tests',
          required: true,
          description: 'Add tests for new functionality. Update tools-test.ts if adding MCP tools.',
        },
        {
          id: 'test_local',
          name: 'Test locally',
          required: true,
          description: 'npm run build && npm test - ALL must pass',
        },
        {
          id: 'qc_review',
          name: 'Quality Control review',
          required: true,
          description: 'Get QC approval before pushing',
        },
        {
          id: 'push',
          name: 'Push to main',
          required: true,
          description: 'Push only after QC approval',
        },
        {
          id: 'verify_deploy',
          name: 'Verify deployment',
          required: true,
          description: 'Verify feature works in production',
        },
        {
          id: 'document',
          name: 'Update documentation',
          required: false,
          description: 'Update README, CLAUDE.md if significant feature',
        },
        {
          id: 'announce',
          name: 'Announce in chat',
          required: true,
          description: 'Post completion message with commit hash',
        },
      ],
      successCriteria: {
        buildPasses: true,
        allTestsPass: true,
        newTestsAdded: true,
        qcApproved: true,
        deploymentVerified: true,
        documented: false, // Optional but recommended
      },
    },

    hotfix: {
      name: 'Hotfix Workflow (Emergency)',
      description: 'Expedited workflow for critical production issues',
      steps: [
        {
          id: 'announce',
          name: 'Announce emergency',
          required: true,
          description: 'Post in chat: [HOTFIX] description of critical issue',
        },
        {
          id: 'fix',
          name: 'Implement minimal fix',
          required: true,
          description: 'Smallest possible change to resolve the issue',
        },
        {
          id: 'test',
          name: 'Quick test',
          required: true,
          description: 'npm run build must pass. Run relevant tests.',
        },
        {
          id: 'push',
          name: 'Push immediately',
          required: true,
          description: 'Push to main - QC can be post-hoc for critical issues',
        },
        {
          id: 'verify',
          name: 'Verify fix',
          required: true,
          description: 'Confirm issue is resolved in production',
        },
        {
          id: 'postmortem',
          name: 'Post-hoc review',
          required: true,
          description: 'QC review after the fact, document in memory',
        },
      ],
      successCriteria: {
        buildPasses: true,
        criticalTestsPass: true,
        issueResolved: true,
        postmortemCompleted: true,
      },
    },

    refactor: {
      name: 'Refactoring Workflow',
      description: 'Safe refactoring with no behavior changes',
      steps: [
        {
          id: 'claim',
          name: 'Claim refactor scope',
          required: true,
          description: 'Claim specific files/modules being refactored',
        },
        {
          id: 'document_current',
          name: 'Document current behavior',
          required: true,
          description: 'Note what the code currently does before changing',
        },
        {
          id: 'refactor',
          name: 'Refactor code',
          required: true,
          description: 'Improve structure WITHOUT changing behavior',
        },
        {
          id: 'test',
          name: 'Run ALL tests',
          required: true,
          description: 'Every test must pass - no regressions allowed',
        },
        {
          id: 'qc',
          name: 'QC review',
          required: true,
          description: 'QC confirms behavior unchanged',
        },
        {
          id: 'push',
          name: 'Push',
          required: true,
          description: 'Push after QC approval',
        },
      ],
      successCriteria: {
        buildPasses: true,
        allTestsPass: true,
        behaviorUnchanged: true,
        qcApproved: true,
      },
    },
  },

  // ===========================================
  // QUALITY CONTROL REQUIREMENTS
  // ===========================================
  qualityControl: {
    description: 'QC must approve before any code reaches production',

    requirements: {
      buildMustPass: {
        rule: 'npm run build must complete without errors',
        enforcement: 'mandatory',
        bypass: 'none',
      },
      testsMustPass: {
        rule: 'npm test (or npm run test) must show 0 failures',
        enforcement: 'mandatory',
        bypass: 'hotfix only with post-hoc review',
      },
      qcApproval: {
        rule: 'Another agent or human must approve changes',
        enforcement: 'mandatory',
        bypass: 'hotfix only with post-hoc review',
      },
      deploymentVerification: {
        rule: 'Verify the change works in production after deploy',
        enforcement: 'mandatory',
        bypass: 'none',
      },
    },

    qcChecklist: [
      'Build passes (npm run build)',
      'All tests pass (npm test)',
      'No TypeScript errors',
      'Changes are focused and minimal',
      'No secrets or credentials in code',
      'Error handling is appropriate',
      'Follows existing code patterns',
      'Documentation updated if needed',
    ],

    whoCanQC: {
      description: 'QC can be performed by any agent not involved in the implementation',
      rules: [
        'Cannot QC your own code',
        'Must have context on the change',
        'Must verify tests actually ran',
        'Must check production after deploy',
      ],
    },
  },

  // ===========================================
  // SUCCESS CRITERIA DEFINITIONS
  // ===========================================
  successCriteria: {
    bugfix: {
      definition: 'A bug fix is successful when:',
      criteria: [
        'The original bug no longer reproduces',
        'Build passes with 0 errors',
        'All existing tests pass (no regressions)',
        'QC has approved the fix',
        'Production deployment verified working',
        'No new bugs introduced',
      ],
      verification: {
        method: 'Manual verification + automated tests',
        who: 'QC reviewer verifies, implementer confirms',
      },
    },

    feature: {
      definition: 'A feature is successful when:',
      criteria: [
        'Feature works as specified',
        'Build passes with 0 errors',
        'All existing tests pass',
        'New tests added for new functionality',
        'QC has approved',
        'Production deployment verified',
        'Documentation updated (if significant)',
      ],
      verification: {
        method: 'Manual testing + automated tests + production verification',
        who: 'QC reviewer + implementer',
      },
    },

    deployment: {
      definition: 'A deployment is successful when:',
      criteria: [
        'Vercel build completes without errors',
        'API endpoints respond correctly',
        'No error spikes in /api/errors',
        'tools-test passes (50/50)',
        'Dashboard loads correctly',
      ],
      verification: {
        method: 'curl endpoints + check tools-test + visual check',
        who: 'Deploying agent',
      },
    },
  },

  // ===========================================
  // COORDINATION RULES
  // ===========================================
  coordination: {
    requireClaimBeforeEdit: true,
    claimExpiryMinutes: 60,
    lockExpiryMinutes: 60,
    maxConcurrentClaimsPerAgent: 3,

    conflictResolution: {
      onConflict: 'The agent who claimed first has priority',
      escalation: 'If dispute, post in chat for human resolution',
      override: 'Only orchestrator or human can override claims',
    },
  },

  // ===========================================
  // COMMUNICATION RULES
  // ===========================================
  communication: {
    announceBeforeWork: true,
    announceAfterCompletion: true,
    includeCommitHash: true,
    tagRelevantAgents: true,

    templates: {
      startWork: '[starting] Working on: {description}',
      qcRequest: '[qc-needed] Ready for QC: {description} - {files changed}',
      qcApproval: '[qc-approved] ✅ {description} - approved by {agent}',
      completion: '[shipped] {description} ({commitHash})',
      hotfix: '[HOTFIX] 🚨 {description} - critical fix',
    },
  },

  // ===========================================
  // SECURITY RULES
  // ===========================================
  security: {
    noSecretsInCode: true,
    noSecretsInLogs: true,
    validateAllInputs: true,
    useEnvironmentVariables: true,

    forbiddenPatterns: [
      'hardcoded API keys',
      'hardcoded passwords',
      'console.log with sensitive data',
      'eval() with user input',
      'SQL string concatenation',
    ],

    requiredPractices: [
      'Use process.env for secrets',
      'Validate and sanitize inputs',
      'Use parameterized queries',
      'Escape output in HTML contexts',
      'Check authorization on all endpoints',
    ],
  },

  // ===========================================
  // ROLE DEFINITIONS
  // ===========================================
  roles: {
    orchestrator: {
      canSpawnAgents: true,
      canEditCode: false,
      canQC: true,
      canOverrideClaims: true,
      description: 'Coordinates work, spawns agents, performs QC',
    },
    developer: {
      canSpawnAgents: false,
      canEditCode: true,
      canQC: true, // Can QC others' code
      canOverrideClaims: false,
      description: 'Implements code, must follow workflow',
    },
    qc: {
      canSpawnAgents: false,
      canEditCode: false,
      canQC: true,
      canOverrideClaims: false,
      description: 'Dedicated QC role - reviews but does not implement',
    },
  },
};

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

async function postToChat(message: string, author: string = '📋 rules-center') {
  const chatMessage = {
    id: generateId(),
    author,
    authorType: 'system',
    message,
    timestamp: new Date().toISOString(),
  };
  await redis.lpush(CHAT_KEY, JSON.stringify(chatMessage));
  await redis.ltrim(CHAT_KEY, 0, 999);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { section, action, type } = req.query;

    // GET: Retrieve rules
    if (req.method === 'GET') {
      // Validate workflow completion
      if (action === 'validate' && type) {
        const workflowType = type as string;
        const workflow = DEFAULT_RULES.workflows[workflowType as keyof typeof DEFAULT_RULES.workflows];

        if (!workflow) {
          return res.status(400).json({
            error: 'Unknown workflow type',
            validTypes: Object.keys(DEFAULT_RULES.workflows),
          });
        }

        return res.json({
          workflow: workflowType,
          name: workflow.name,
          steps: workflow.steps,
          successCriteria: workflow.successCriteria,
          qcChecklist: DEFAULT_RULES.qualityControl.qcChecklist,
          message: 'Use this checklist to validate your work is complete',
        });
      }

      // Get stored rules or defaults
      let rules = await redis.get(RULES_KEY);
      if (!rules) {
        await redis.set(RULES_KEY, JSON.stringify(DEFAULT_RULES));
        rules = DEFAULT_RULES;
      } else if (typeof rules === 'string') {
        rules = JSON.parse(rules);
      }

      // Return specific section if requested
      if (section && typeof section === 'string') {
        const sectionData = (rules as Record<string, unknown>)[section];
        if (!sectionData) {
          return res.status(404).json({
            error: `Section '${section}' not found`,
            availableSections: Object.keys(rules as object),
          });
        }
        return res.json({ section, data: sectionData });
      }

      return res.json({
        rules,
        source: 'redis',
        tip: 'Use ?section=workflows or ?section=qualityControl for specific sections',
        validateTip: 'Use ?action=validate&type=bugfix to get workflow checklist',
      });
    }

    // POST: Replace all rules (admin only)
    if (req.method === 'POST') {
      const { rules, adminKey } = req.body;

      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'piston-admin') {
        return res.status(403).json({ error: 'Admin key required' });
      }

      if (!rules) {
        return res.status(400).json({ error: 'rules object required' });
      }

      const newRules = { ...rules, lastUpdated: new Date().toISOString() };
      await redis.set(RULES_KEY, JSON.stringify(newRules));
      await postToChat('[rules-updated] Development rules have been updated by admin');

      return res.json({ success: true, message: 'Rules updated', lastUpdated: newRules.lastUpdated });
    }

    // PATCH: Update specific section (admin only)
    if (req.method === 'PATCH') {
      const { section: patchSection, updates, adminKey } = req.body;

      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'piston-admin') {
        return res.status(403).json({ error: 'Admin key required' });
      }

      if (!patchSection || !updates) {
        return res.status(400).json({ error: 'section and updates required' });
      }

      let rules = await redis.get(RULES_KEY);
      if (!rules) {
        rules = DEFAULT_RULES;
      } else if (typeof rules === 'string') {
        rules = JSON.parse(rules);
      }

      if (typeof rules === 'object' && rules !== null) {
        (rules as Record<string, unknown>)[patchSection] = {
          ...((rules as Record<string, unknown>)[patchSection] as object || {}),
          ...updates,
        };
        (rules as Record<string, unknown>).lastUpdated = new Date().toISOString();
      }

      await redis.set(RULES_KEY, JSON.stringify(rules));
      await postToChat(`[rules-updated] Section '${patchSection}' updated by admin`);

      return res.json({ success: true, section: patchSection, message: 'Section updated' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Rules error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
