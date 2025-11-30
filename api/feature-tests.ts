import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const TESTS_KEY = 'agent-coord:feature-tests';
const TEST_RUNS_KEY = 'agent-coord:test-runs';
const FEATURES_KEY = 'agent-coord:planned-features';

// Test types supported
type TestType =
  | 'api-health'      // Check if API endpoint responds
  | 'api-response'    // Check API response matches expected
  | 'ui-element'      // Check if UI element exists (via DOM check endpoint)
  | 'data-exists'     // Check if data exists in Redis
  | 'custom';         // Custom test with provided check function

interface TestCase {
  id: string;
  featureId: string;
  name: string;
  description: string;
  type: TestType;
  config: {
    // For api-health / api-response
    endpoint?: string;
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: Record<string, unknown>;
    expectedStatus?: number;
    expectedFields?: string[];      // Fields that should exist in response
    expectedValues?: Record<string, unknown>;  // Exact values to match

    // For data-exists
    redisKey?: string;
    redisField?: string;

    // For ui-element
    selector?: string;

    // For custom
    customCheck?: string;  // Serialized function or check name
  };
  createdAt: string;
  createdBy: string;
}

interface TestRun {
  id: string;
  featureId: string;
  testId: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  duration: number;  // ms
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
  runBy: string;
}

interface TestSuite {
  featureId: string;
  tests: TestCase[];
  lastRun?: string;
  passRate?: number;
}

// Base URL for API tests
const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

/**
 * Execute a single test case
 */
async function executeTest(test: TestCase, runBy: string): Promise<TestRun> {
  const startTime = Date.now();
  const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;

  try {
    switch (test.type) {
      case 'api-health': {
        const url = `${API_BASE}${test.config.endpoint}`;
        const res = await fetch(url, {
          method: test.config.method || 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: test.config.body ? JSON.stringify(test.config.body) : undefined
        });

        const expectedStatus = test.config.expectedStatus || 200;
        const passed = res.status === expectedStatus;

        return {
          id: runId,
          featureId: test.featureId,
          testId: test.id,
          status: passed ? 'passed' : 'failed',
          duration: Date.now() - startTime,
          message: passed
            ? `API responded with ${res.status}`
            : `Expected ${expectedStatus}, got ${res.status}`,
          details: { actualStatus: res.status, expectedStatus },
          timestamp: new Date().toISOString(),
          runBy
        };
      }

      case 'api-response': {
        const url = `${API_BASE}${test.config.endpoint}`;
        const res = await fetch(url, {
          method: test.config.method || 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: test.config.body ? JSON.stringify(test.config.body) : undefined
        });

        if (!res.ok) {
          return {
            id: runId,
            featureId: test.featureId,
            testId: test.id,
            status: 'failed',
            duration: Date.now() - startTime,
            message: `API returned error: ${res.status}`,
            timestamp: new Date().toISOString(),
            runBy
          };
        }

        const data = await res.json();
        const errors: string[] = [];

        // Check expected fields exist
        if (test.config.expectedFields) {
          for (const field of test.config.expectedFields) {
            if (!(field in data)) {
              errors.push(`Missing field: ${field}`);
            }
          }
        }

        // Check expected values
        if (test.config.expectedValues) {
          for (const [key, expectedValue] of Object.entries(test.config.expectedValues)) {
            if (data[key] !== expectedValue) {
              errors.push(`Field ${key}: expected ${expectedValue}, got ${data[key]}`);
            }
          }
        }

        return {
          id: runId,
          featureId: test.featureId,
          testId: test.id,
          status: errors.length === 0 ? 'passed' : 'failed',
          duration: Date.now() - startTime,
          message: errors.length === 0 ? 'All assertions passed' : errors.join('; '),
          details: { response: data, errors },
          timestamp: new Date().toISOString(),
          runBy
        };
      }

      case 'data-exists': {
        if (!test.config.redisKey) {
          throw new Error('redisKey is required for data-exists test');
        }

        let exists = false;
        if (test.config.redisField) {
          const value = await redis.hget(test.config.redisKey, test.config.redisField);
          exists = value !== null;
        } else {
          const value = await redis.get(test.config.redisKey);
          exists = value !== null;
        }

        return {
          id: runId,
          featureId: test.featureId,
          testId: test.id,
          status: exists ? 'passed' : 'failed',
          duration: Date.now() - startTime,
          message: exists
            ? `Data exists at ${test.config.redisKey}${test.config.redisField ? ':' + test.config.redisField : ''}`
            : `Data not found`,
          timestamp: new Date().toISOString(),
          runBy
        };
      }

      case 'ui-element': {
        // UI tests would need a headless browser - for now, check if endpoint exists
        return {
          id: runId,
          featureId: test.featureId,
          testId: test.id,
          status: 'skipped',
          duration: Date.now() - startTime,
          message: 'UI tests require manual verification or Playwright integration',
          timestamp: new Date().toISOString(),
          runBy
        };
      }

      case 'custom': {
        // Custom tests need to be implemented per-feature
        // This is a placeholder for extensibility
        return {
          id: runId,
          featureId: test.featureId,
          testId: test.id,
          status: 'skipped',
          duration: Date.now() - startTime,
          message: 'Custom test not implemented',
          timestamp: new Date().toISOString(),
          runBy
        };
      }

      default:
        throw new Error(`Unknown test type: ${test.type}`);
    }
  } catch (error) {
    return {
      id: runId,
      featureId: test.featureId,
      testId: test.id,
      status: 'error',
      duration: Date.now() - startTime,
      message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date().toISOString(),
      runBy
    };
  }
}

/**
 * Run all tests for a feature
 */
async function runFeatureTests(featureId: string, runBy: string): Promise<{
  featureId: string;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  total: number;
  passRate: number;
  runs: TestRun[];
  canComplete: boolean;
}> {
  // Get all tests for this feature
  const allTests = await redis.hgetall(TESTS_KEY) || {};
  const featureTests: TestCase[] = [];

  for (const [, value] of Object.entries(allTests)) {
    const test = typeof value === 'string' ? JSON.parse(value) : value;
    if (test.featureId === featureId) {
      featureTests.push(test);
    }
  }

  if (featureTests.length === 0) {
    return {
      featureId,
      passed: 0,
      failed: 0,
      errors: 0,
      skipped: 0,
      total: 0,
      passRate: 100, // No tests = passes by default
      runs: [],
      canComplete: true // Can complete if no tests defined (but warn)
    };
  }

  // Run all tests
  const runs: TestRun[] = [];
  for (const test of featureTests) {
    const run = await executeTest(test, runBy);
    runs.push(run);

    // Store the run result
    await redis.hset(TEST_RUNS_KEY, { [run.id]: JSON.stringify(run) });
  }

  // Calculate stats
  const passed = runs.filter(r => r.status === 'passed').length;
  const failed = runs.filter(r => r.status === 'failed').length;
  const errors = runs.filter(r => r.status === 'error').length;
  const skipped = runs.filter(r => r.status === 'skipped').length;
  const executable = runs.filter(r => r.status !== 'skipped').length;
  const passRate = executable > 0 ? Math.round((passed / executable) * 100) : 100;

  return {
    featureId,
    passed,
    failed,
    errors,
    skipped,
    total: runs.length,
    passRate,
    runs,
    canComplete: failed === 0 && errors === 0 // Must pass all to complete
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action } = req.query;

    // GET: List tests for a feature or all tests
    if (req.method === 'GET') {
      const { featureId, includeRuns } = req.query;

      const allTests = await redis.hgetall(TESTS_KEY) || {};
      let tests: TestCase[] = [];

      for (const [, value] of Object.entries(allTests)) {
        const test = typeof value === 'string' ? JSON.parse(value) : value;
        if (!featureId || test.featureId === featureId) {
          tests.push(test);
        }
      }

      // Include recent runs if requested
      let recentRuns: TestRun[] = [];
      if (includeRuns === 'true' && featureId) {
        const allRuns = await redis.hgetall(TEST_RUNS_KEY) || {};
        for (const [, value] of Object.entries(allRuns)) {
          const run = typeof value === 'string' ? JSON.parse(value) : value;
          if (run.featureId === featureId) {
            recentRuns.push(run);
          }
        }
        // Sort by timestamp desc, limit to 10
        recentRuns.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        recentRuns = recentRuns.slice(0, 10);
      }

      return res.json({
        tests,
        count: tests.length,
        recentRuns: includeRuns === 'true' ? recentRuns : undefined
      });
    }

    // POST: Create test, run tests, or complete feature
    if (req.method === 'POST') {
      // Run tests for a feature
      if (action === 'run') {
        const { featureId, runBy = 'system' } = req.body;

        if (!featureId) {
          return res.status(400).json({ error: 'featureId is required' });
        }

        const results = await runFeatureTests(featureId, runBy);

        return res.json({
          success: true,
          ...results,
          summary: results.canComplete
            ? `✅ All tests passed (${results.passRate}%)`
            : `❌ Tests failed: ${results.failed} failed, ${results.errors} errors`
        });
      }

      // Complete a feature (with test gate)
      if (action === 'complete') {
        const { featureId, runBy = 'system', force = false } = req.body;

        if (!featureId) {
          return res.status(400).json({ error: 'featureId is required' });
        }

        // Run tests first
        const results = await runFeatureTests(featureId, runBy);

        if (!results.canComplete && !force) {
          return res.status(400).json({
            error: 'Cannot complete feature - tests did not pass',
            testResults: results,
            hint: 'Fix failing tests or use force=true to override (not recommended)'
          });
        }

        // Update feature status to done
        const existing = await redis.hget(FEATURES_KEY, featureId);
        if (!existing) {
          return res.status(404).json({ error: 'Feature not found' });
        }

        const feature = typeof existing === 'string' ? JSON.parse(existing) : existing;
        const updated = {
          ...feature,
          status: 'done',
          completedAt: new Date().toISOString(),
          testsPassed: results.canComplete,
          forceClosed: force && !results.canComplete,
          updatedAt: new Date().toISOString()
        };

        await redis.hset(FEATURES_KEY, { [featureId]: JSON.stringify(updated) });

        // Post to chat about completion
        await fetch(`${API_BASE}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            author: 'test-system',
            authorType: 'agent',
            message: `${results.canComplete ? '✅' : '⚠️'} Feature "${feature.title}" marked as ${force && !results.canComplete ? 'FORCE COMPLETED' : 'COMPLETED'}\n\nTest Results: ${results.passed}/${results.total} passed (${results.passRate}%)`
          })
        });

        return res.json({
          success: true,
          feature: updated,
          testResults: results,
          message: force && !results.canComplete
            ? 'Feature force-completed despite failing tests'
            : 'Feature completed - all tests passed'
        });
      }

      // Create a new test case
      const { featureId, name, description, type, config, createdBy = 'system' } = req.body;

      if (!featureId || !name || !type) {
        return res.status(400).json({ error: 'featureId, name, and type are required' });
      }

      // Verify feature exists
      const feature = await redis.hget(FEATURES_KEY, featureId);
      if (!feature) {
        return res.status(404).json({ error: 'Feature not found' });
      }

      const test: TestCase = {
        id: `test-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`,
        featureId,
        name,
        description: description || '',
        type,
        config: config || {},
        createdAt: new Date().toISOString(),
        createdBy
      };

      await redis.hset(TESTS_KEY, { [test.id]: JSON.stringify(test) });

      return res.json({ success: true, test });
    }

    // DELETE: Remove a test
    if (req.method === 'DELETE') {
      const { testId } = req.body;

      if (!testId) {
        return res.status(400).json({ error: 'testId is required' });
      }

      await redis.hdel(TESTS_KEY, testId);

      return res.json({ success: true, deleted: testId });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Feature tests error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
