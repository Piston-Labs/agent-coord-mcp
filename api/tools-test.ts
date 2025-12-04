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
