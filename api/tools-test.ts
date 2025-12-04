import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const RESULTS_KEY = 'agent-coord:tools-test-results';

/**
 * MCP Tools Test API - Autonomous tool validation
 *
 * GET /api/tools-test - Run all tool tests and return results
 * GET /api/tools-test?tool=memory - Run specific tool test
 * GET /api/tools-test?action=results - Get last test results
 * GET /api/tools-test?action=list - List all testable tools
 */

interface TestResult {
  tool: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
  latency?: number;
  error?: string;
}

interface TestSuite {
  timestamp: string;
  duration: number;
  passed: number;
  failed: number;
  skipped: number;
  results: TestResult[];
}

// Tool test definitions
const TOOL_TESTS: Record<string, () => Promise<TestResult>> = {
  // Core coordination tools
  'hot-start': async () => {
    const start = Date.now();
    try {
      // Simulate hot-start by checking checkpoint exists
      const checkpoint = await redis.hget('agent-coord:checkpoints', 'tools-tester');
      return {
        tool: 'hot-start',
        status: 'pass',
        message: checkpoint ? 'Checkpoint found' : 'No checkpoint (fresh agent)',
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'hot-start', status: 'fail', message: 'Failed to check checkpoint', error: String(e) };
    }
  },

  'group-chat': async () => {
    const start = Date.now();
    const testId = `test-${Date.now()}`;
    try {
      // Post a test message
      const message = {
        id: testId,
        author: 'tools-tester',
        authorType: 'agent',
        message: `[test] Automated tool validation ${new Date().toISOString()}`,
        timestamp: new Date().toISOString()
      };
      await redis.lpush('agent-coord:group-chat', JSON.stringify(message));

      // Verify it was posted
      const recent = await redis.lrange('agent-coord:group-chat', 0, 0);
      const found = recent.some((m: string | object) => {
        const parsed = typeof m === 'string' ? JSON.parse(m) : m;
        return parsed.id === testId;
      });

      return {
        tool: 'group-chat',
        status: found ? 'pass' : 'fail',
        message: found ? 'Message posted and retrieved' : 'Message not found after posting',
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'group-chat', status: 'fail', message: 'Failed to post/retrieve message', error: String(e) };
    }
  },

  'memory': async () => {
    const start = Date.now();
    const testId = `mem-test-${Date.now()}`;
    try {
      // Store a memory
      const memory = {
        id: testId,
        category: 'learning',
        content: 'Automated test memory entry',
        tags: ['test', 'automated'],
        createdBy: 'tools-tester',
        createdAt: new Date().toISOString(),
        references: 0
      };
      await redis.hset('agent-coord:shared-memory', { [testId]: JSON.stringify(memory) });

      // Retrieve it
      const retrieved = await redis.hget('agent-coord:shared-memory', testId);

      // Clean up test data
      await redis.hdel('agent-coord:shared-memory', testId);

      return {
        tool: 'memory',
        status: retrieved ? 'pass' : 'fail',
        message: retrieved ? 'Memory store/retrieve cycle successful' : 'Memory not found after storing',
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'memory', status: 'fail', message: 'Failed memory cycle', error: String(e) };
    }
  },

  'agent-status': async () => {
    const start = Date.now();
    try {
      // Check agents hash
      const count = await redis.hlen('agent-coord:agents');
      return {
        tool: 'agent-status',
        status: 'pass',
        message: `Agent registry accessible (${count} agents)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'agent-status', status: 'fail', message: 'Failed to access agent registry', error: String(e) };
    }
  },

  'tasks': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:tasks');
      return {
        tool: 'tasks',
        status: 'pass',
        message: `Task registry accessible (${count} tasks)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'tasks', status: 'fail', message: 'Failed to access task registry', error: String(e) };
    }
  },

  'claims': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:claims');
      return {
        tool: 'claims',
        status: 'pass',
        message: `Claims registry accessible (${count} claims)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'claims', status: 'fail', message: 'Failed to access claims registry', error: String(e) };
    }
  },

  'locks': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:locks');
      return {
        tool: 'locks',
        status: 'pass',
        message: `Locks registry accessible (${count} locks)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'locks', status: 'fail', message: 'Failed to access locks registry', error: String(e) };
    }
  },

  'zones': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:zones');
      return {
        tool: 'zones',
        status: 'pass',
        message: `Zones registry accessible (${count} zones)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'zones', status: 'fail', message: 'Failed to access zones registry', error: String(e) };
    }
  },

  'handoffs': async () => {
    const start = Date.now();
    try {
      const count = await redis.llen('agent-coord:handoffs');
      return {
        tool: 'handoffs',
        status: 'pass',
        message: `Handoffs list accessible (${count} handoffs)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'handoffs', status: 'fail', message: 'Failed to access handoffs list', error: String(e) };
    }
  },

  'checkpoints': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:checkpoints');
      return {
        tool: 'checkpoints',
        status: 'pass',
        message: `Checkpoints accessible (${count} checkpoints)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'checkpoints', status: 'fail', message: 'Failed to access checkpoints', error: String(e) };
    }
  },

  'workflows': async () => {
    const start = Date.now();
    try {
      const count = await redis.llen('agent-coord:workflow-runs');
      return {
        tool: 'workflows',
        status: 'pass',
        message: `Workflow runs accessible (${count} runs)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'workflows', status: 'fail', message: 'Failed to access workflow runs', error: String(e) };
    }
  },

  'sessions': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:sessions');
      return {
        tool: 'sessions',
        status: 'pass',
        message: `Sessions accessible (${count} sessions)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'sessions', status: 'fail', message: 'Failed to access sessions', error: String(e) };
    }
  },

  'souls': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:souls');
      return {
        tool: 'souls',
        status: 'pass',
        message: `Souls accessible (${count} souls)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'souls', status: 'fail', message: 'Failed to access souls', error: String(e) };
    }
  },

  'sales-files': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:sales-files');
      return {
        tool: 'sales-files',
        status: 'pass',
        message: `Sales files accessible (${count} files)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'sales-files', status: 'fail', message: 'Failed to access sales files', error: String(e) };
    }
  },

  'shops': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:shops');
      return {
        tool: 'shops',
        status: 'pass',
        message: `Shops CRM accessible (${count} shops)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'shops', status: 'fail', message: 'Failed to access shops', error: String(e) };
    }
  },

  // Additional tools added by phil
  'profile': async () => {
    const start = Date.now();
    const testId = `profile-test-${Date.now()}`;
    try {
      // Test profile registration
      const profile = {
        agentId: testId,
        offers: ['testing', 'validation'],
        needs: [],
        capabilities: ['canSearch'],
        ide: 'test',
        os: 'test',
        registeredAt: new Date().toISOString()
      };
      await redis.hset('agent-coord:profiles', { [testId]: JSON.stringify(profile) });

      // Retrieve it
      const retrieved = await redis.hget('agent-coord:profiles', testId);

      // Clean up
      await redis.hdel('agent-coord:profiles', testId);

      return {
        tool: 'profile',
        status: retrieved ? 'pass' : 'fail',
        message: retrieved ? 'Profile register/retrieve cycle successful' : 'Profile not found after storing',
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'profile', status: 'fail', message: 'Failed profile cycle', error: String(e) };
    }
  },

  'digest': async () => {
    const start = Date.now();
    try {
      // Digest aggregates data from multiple sources - test key access
      const [agents, tasks, chat] = await Promise.all([
        redis.hlen('agent-coord:agents'),
        redis.hlen('agent-coord:tasks'),
        redis.llen('agent-coord:group-chat')
      ]);
      return {
        tool: 'digest',
        status: 'pass',
        message: `Digest sources accessible (${agents} agents, ${tasks} tasks, ${chat} messages)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'digest', status: 'fail', message: 'Failed to access digest sources', error: String(e) };
    }
  },

  'fleet-analytics': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:devices');
      return {
        tool: 'fleet-analytics',
        status: 'pass',
        message: `Fleet data accessible (${count} devices)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'fleet-analytics', status: 'fail', message: 'Failed to access fleet data', error: String(e) };
    }
  },

  'dm': async () => {
    const start = Date.now();
    const testId = `dm-test-${Date.now()}`;
    try {
      // Test direct message storage
      const dm = {
        id: testId,
        from: 'test-sender',
        to: 'test-receiver',
        type: 'note',
        message: 'Test DM for validation',
        timestamp: new Date().toISOString(),
        read: false
      };
      await redis.lpush('agent-coord:inbox:test-receiver', JSON.stringify(dm));

      // Verify it exists
      const inbox = await redis.lrange('agent-coord:inbox:test-receiver', 0, 0);
      const found = inbox.some((m: string | object) => {
        const parsed = typeof m === 'string' ? JSON.parse(m) : m;
        return parsed.id === testId;
      });

      // Clean up
      await redis.lpop('agent-coord:inbox:test-receiver');

      return {
        tool: 'dm',
        status: found ? 'pass' : 'fail',
        message: found ? 'DM send/receive cycle successful' : 'DM not found after sending',
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'dm', status: 'fail', message: 'Failed DM cycle', error: String(e) };
    }
  },

  'threads': async () => {
    const start = Date.now();
    const testId = `thread-test-${Date.now()}`;
    try {
      // Test thread creation
      const thread = {
        id: testId,
        topic: 'Test thread for validation',
        createdBy: 'tools-tester',
        createdAt: new Date().toISOString(),
        status: 'active',
        posts: []
      };
      await redis.hset('agent-coord:threads', { [testId]: JSON.stringify(thread) });

      // Retrieve it
      const retrieved = await redis.hget('agent-coord:threads', testId);

      // Clean up
      await redis.hdel('agent-coord:threads', testId);

      return {
        tool: 'threads',
        status: retrieved ? 'pass' : 'fail',
        message: retrieved ? 'Thread create/retrieve cycle successful' : 'Thread not found after creating',
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'threads', status: 'fail', message: 'Failed thread cycle', error: String(e) };
    }
  },

  'kudos': async () => {
    const start = Date.now();
    const testId = `kudos-test-${Date.now()}`;
    try {
      // Test kudos storage
      const kudos = {
        id: testId,
        from: 'test-giver',
        to: 'test-receiver',
        reason: 'Great testing work!',
        emoji: '⭐',
        timestamp: new Date().toISOString()
      };
      await redis.lpush('agent-coord:kudos', JSON.stringify(kudos));

      // Verify it exists
      const recent = await redis.lrange('agent-coord:kudos', 0, 0);
      const found = recent.some((k: string | object) => {
        const parsed = typeof k === 'string' ? JSON.parse(k) : k;
        return parsed.id === testId;
      });

      // Clean up
      await redis.lpop('agent-coord:kudos');

      return {
        tool: 'kudos',
        status: found ? 'pass' : 'fail',
        message: found ? 'Kudos give/retrieve cycle successful' : 'Kudos not found after giving',
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'kudos', status: 'fail', message: 'Failed kudos cycle', error: String(e) };
    }
  },

  'onboarding': async () => {
    const start = Date.now();
    try {
      // Test onboarding rules access
      const count = await redis.hlen('agent-coord:onboarding-rules');
      return {
        tool: 'onboarding',
        status: 'pass',
        message: `Onboarding rules accessible (${count} custom rules + defaults)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'onboarding', status: 'fail', message: 'Failed to access onboarding rules', error: String(e) };
    }
  },

  'orchestrations': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:orchestrations');
      return {
        tool: 'orchestrations',
        status: 'pass',
        message: `Orchestrations accessible (${count} orchestrations)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'orchestrations', status: 'fail', message: 'Failed to access orchestrations', error: String(e) };
    }
  },

  // CEO Portal tests - added by jeeves
  'ceo-contacts': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:ceo:contacts');
      return {
        tool: 'ceo-contacts',
        status: 'pass',
        message: `CEO contacts accessible (${count} contacts)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'ceo-contacts', status: 'fail', message: 'Failed to access CEO contacts', error: String(e) };
    }
  },

  'ceo-ideas': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:ceo:ideas');
      return {
        tool: 'ceo-ideas',
        status: 'pass',
        message: `CEO ideas accessible (${count} ideas)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'ceo-ideas', status: 'fail', message: 'Failed to access CEO ideas', error: String(e) };
    }
  },

  'ceo-notes': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:ceo:notes');
      return {
        tool: 'ceo-notes',
        status: 'pass',
        message: `CEO notes accessible (${count} notes)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'ceo-notes', status: 'fail', message: 'Failed to access CEO notes', error: String(e) };
    }
  },

  'user-tasks': async () => {
    const start = Date.now();
    try {
      // User tasks are stored per-user, check tyler3's tasks exist
      const count = await redis.hlen('agent-coord:user-tasks:tyler3');
      return {
        tool: 'user-tasks',
        status: 'pass',
        message: `User tasks accessible (tyler3 has ${count} tasks)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'user-tasks', status: 'fail', message: 'Failed to access user tasks', error: String(e) };
    }
  },

  'metrics': async () => {
    const start = Date.now();
    try {
      const count = await redis.llen('agent-coord:metrics');
      return {
        tool: 'metrics',
        status: 'pass',
        message: `Metrics accessible (${count} events logged)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'metrics', status: 'fail', message: 'Failed to access metrics', error: String(e) };
    }
  },

  'ui-tests': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:ui-tests');
      return {
        tool: 'ui-tests',
        status: 'pass',
        message: `UI tests accessible (${count} tests defined)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'ui-tests', status: 'fail', message: 'Failed to access UI tests', error: String(e) };
    }
  },

  'repo-context': async () => {
    const start = Date.now();
    try {
      const count = await redis.hlen('agent-coord:repo-context');
      return {
        tool: 'repo-context',
        status: 'pass',
        message: `Repo context accessible (${count} entries)`,
        latency: Date.now() - start
      };
    } catch (e) {
      return { tool: 'repo-context', status: 'fail', message: 'Failed to access repo context', error: String(e) };
    }
  }
};

async function runAllTests(): Promise<TestSuite> {
  const startTime = Date.now();
  const results: TestResult[] = [];

  for (const [toolName, testFn] of Object.entries(TOOL_TESTS)) {
    try {
      const result = await testFn();
      results.push(result);
    } catch (error) {
      results.push({
        tool: toolName,
        status: 'fail',
        message: 'Test threw an exception',
        error: String(error)
      });
    }
  }

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;

  const suite: TestSuite = {
    timestamp: new Date().toISOString(),
    duration: Date.now() - startTime,
    passed,
    failed,
    skipped,
    results
  };

  // Save results
  await redis.set(RESULTS_KEY, JSON.stringify(suite));

  return suite;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, tool } = req.query;

  try {
    // List available tests
    if (action === 'list') {
      return res.json({
        tools: Object.keys(TOOL_TESTS),
        count: Object.keys(TOOL_TESTS).length
      });
    }

    // Get last test results
    if (action === 'results') {
      const results = await redis.get(RESULTS_KEY);
      if (!results) {
        return res.json({ message: 'No test results found. Run tests first.' });
      }
      return res.json(typeof results === 'string' ? JSON.parse(results) : results);
    }

    // Run specific tool test
    if (tool && typeof tool === 'string') {
      const testFn = TOOL_TESTS[tool];
      if (!testFn) {
        return res.status(400).json({ error: `Unknown tool: ${tool}`, available: Object.keys(TOOL_TESTS) });
      }
      const result = await testFn();
      return res.json(result);
    }

    // Run all tests
    const suite = await runAllTests();

    // Post summary to chat if there are failures
    if (suite.failed > 0) {
      const failedTools = suite.results.filter(r => r.status === 'fail').map(r => r.tool);
      await redis.lpush('agent-coord:group-chat', JSON.stringify({
        id: `test-report-${Date.now()}`,
        author: 'tools-tester',
        authorType: 'system',
        message: `**MCP Tools Test Report**\n\n${suite.passed}/${suite.passed + suite.failed} tools passing\n\n**Failed:** ${failedTools.join(', ')}`,
        timestamp: new Date().toISOString()
      }));
    }

    return res.json({
      summary: `${suite.passed}/${suite.passed + suite.failed + suite.skipped} tests passing`,
      ...suite
    });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
}
