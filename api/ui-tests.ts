import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const UI_TESTS_KEY = 'agent-coord:ui-tests';
const UI_TEST_RUNS_KEY = 'agent-coord:ui-test-runs';

interface UITest {
  id: string;
  name: string;
  description: string;
  category: 'accessibility' | 'visual' | 'interaction' | 'responsive' | 'performance' | 'ux-flow';
  component?: string;
  page?: string;
  steps: TestStep[];
  assertions: TestAssertion[];
  createdBy: string;
  createdAt: string;
  lastRun?: string;
  lastResult?: 'pass' | 'fail' | 'error';
}

interface TestStep {
  action: 'click' | 'type' | 'navigate' | 'wait' | 'screenshot' | 'scroll' | 'hover' | 'assert';
  target?: string;  // CSS selector or description
  value?: string;   // Value to type or URL to navigate
  timeout?: number;
}

interface TestAssertion {
  type: 'visible' | 'hidden' | 'text' | 'attribute' | 'screenshot-match' | 'a11y' | 'performance';
  target?: string;
  expected?: string;
  threshold?: number;  // For visual diff or performance
}

interface TestRun {
  id: string;
  testId: string;
  testName: string;
  result: 'pass' | 'fail' | 'error' | 'running';
  startedAt: string;
  completedAt?: string;
  duration?: number;
  executedBy: string;
  stepResults: StepResult[];
  assertionResults: AssertionResult[];
  screenshots?: string[];  // URLs to screenshots
  errors?: string[];
  metadata?: Record<string, any>;
}

interface StepResult {
  step: number;
  action: string;
  status: 'pass' | 'fail' | 'skipped';
  duration?: number;
  error?: string;
}

interface AssertionResult {
  assertion: number;
  type: string;
  status: 'pass' | 'fail';
  expected?: string;
  actual?: string;
  diff?: number;  // For visual diff percentage
}

/**
 * UI Tests API - Full coverage UI/UX testing
 *
 * Categories:
 * - accessibility: WCAG compliance, screen reader, keyboard nav
 * - visual: Screenshot comparison, layout consistency
 * - interaction: Click, type, hover, drag behaviors
 * - responsive: Mobile, tablet, desktop breakpoints
 * - performance: Load time, FCP, LCP, CLS metrics
 * - ux-flow: User journey end-to-end tests
 *
 * GET /api/ui-tests - List all tests
 * GET /api/ui-tests?id=X - Get specific test
 * GET /api/ui-tests?action=runs&testId=X - Get test runs
 * GET /api/ui-tests?action=coverage - Get coverage report
 * POST /api/ui-tests - Create a new test
 * POST /api/ui-tests?action=run - Execute a test
 * PATCH /api/ui-tests - Update test result
 * DELETE /api/ui-tests?id=X - Delete a test
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List tests, get specific test, or get runs
    if (req.method === 'GET') {
      const { id, action, testId, category } = req.query;

      // Get coverage report
      if (action === 'coverage') {
        const allTests = await redis.hgetall(UI_TESTS_KEY) || {};
        const tests = Object.values(allTests).map(t =>
          typeof t === 'string' ? JSON.parse(t) : t
        );

        const coverage = {
          total: tests.length,
          byCategory: {} as Record<string, { total: number; passing: number; failing: number }>,
          byComponent: {} as Record<string, { total: number; passing: number; failing: number }>,
          overall: { passing: 0, failing: 0, noRuns: 0 }
        };

        for (const test of tests) {
          // By category
          if (!coverage.byCategory[test.category]) {
            coverage.byCategory[test.category] = { total: 0, passing: 0, failing: 0 };
          }
          coverage.byCategory[test.category].total++;
          if (test.lastResult === 'pass') coverage.byCategory[test.category].passing++;
          if (test.lastResult === 'fail') coverage.byCategory[test.category].failing++;

          // By component
          if (test.component) {
            if (!coverage.byComponent[test.component]) {
              coverage.byComponent[test.component] = { total: 0, passing: 0, failing: 0 };
            }
            coverage.byComponent[test.component].total++;
            if (test.lastResult === 'pass') coverage.byComponent[test.component].passing++;
            if (test.lastResult === 'fail') coverage.byComponent[test.component].failing++;
          }

          // Overall
          if (test.lastResult === 'pass') coverage.overall.passing++;
          else if (test.lastResult === 'fail') coverage.overall.failing++;
          else coverage.overall.noRuns++;
        }

        return res.json({ coverage });
      }

      // Get test runs
      if (action === 'runs') {
        if (!testId) {
          // Get all recent runs
          const allRuns = await redis.lrange(UI_TEST_RUNS_KEY, 0, 49);
          const runs = allRuns.map(r => typeof r === 'string' ? JSON.parse(r) : r);
          return res.json({ runs, count: runs.length });
        }

        const allRuns = await redis.lrange(UI_TEST_RUNS_KEY, 0, 199);
        const runs = allRuns
          .map(r => typeof r === 'string' ? JSON.parse(r) : r)
          .filter(r => r.testId === testId);

        return res.json({ testId, runs, count: runs.length });
      }

      // Get specific test
      if (id) {
        const test = await redis.hget(UI_TESTS_KEY, id as string);
        if (!test) {
          return res.status(404).json({ error: 'Test not found' });
        }
        const parsed = typeof test === 'string' ? JSON.parse(test) : test;
        return res.json({ test: parsed });
      }

      // List all tests
      const allTests = await redis.hgetall(UI_TESTS_KEY) || {};
      let tests = Object.values(allTests).map(t =>
        typeof t === 'string' ? JSON.parse(t) : t
      );

      // Filter by category
      if (category) {
        tests = tests.filter(t => t.category === category);
      }

      // Sort by last run (most recent first)
      tests.sort((a, b) => {
        if (!a.lastRun && !b.lastRun) return 0;
        if (!a.lastRun) return 1;
        if (!b.lastRun) return -1;
        return new Date(b.lastRun).getTime() - new Date(a.lastRun).getTime();
      });

      return res.json({ tests, count: tests.length });
    }

    // POST: Create test or run test
    if (req.method === 'POST') {
      let body: any;
      try {
        body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const { action } = req.query;

      // Run a test
      if (action === 'run') {
        const { testId, executedBy, stepResults, assertionResults, screenshots, errors, metadata } = body;

        if (!testId || !executedBy) {
          return res.status(400).json({ error: 'testId and executedBy required' });
        }

        // Get the test
        const test = await redis.hget(UI_TESTS_KEY, testId);
        if (!test) {
          return res.status(404).json({ error: 'Test not found' });
        }
        const parsedTest = typeof test === 'string' ? JSON.parse(test) : test;

        // Determine overall result
        let result: 'pass' | 'fail' | 'error' = 'pass';
        if (errors && errors.length > 0) result = 'error';
        else if (assertionResults?.some((a: AssertionResult) => a.status === 'fail')) result = 'fail';
        else if (stepResults?.some((s: StepResult) => s.status === 'fail')) result = 'fail';

        const run: TestRun = {
          id: `run-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`,
          testId,
          testName: parsedTest.name,
          result,
          startedAt: body.startedAt || new Date().toISOString(),
          completedAt: new Date().toISOString(),
          duration: body.duration,
          executedBy,
          stepResults: stepResults || [],
          assertionResults: assertionResults || [],
          screenshots,
          errors,
          metadata
        };

        // Save run
        await redis.lpush(UI_TEST_RUNS_KEY, JSON.stringify(run));
        await redis.ltrim(UI_TEST_RUNS_KEY, 0, 499);  // Keep last 500 runs

        // Update test with last run info
        parsedTest.lastRun = run.completedAt;
        parsedTest.lastResult = result;
        await redis.hset(UI_TESTS_KEY, { [testId]: JSON.stringify(parsedTest) });

        return res.json({ success: true, run });
      }

      // Create new test
      const { name, description, category, component, page, steps, assertions, createdBy } = body;

      if (!name || !category || !createdBy) {
        return res.status(400).json({ error: 'name, category, and createdBy required' });
      }

      const validCategories = ['accessibility', 'visual', 'interaction', 'responsive', 'performance', 'ux-flow'];
      if (!validCategories.includes(category)) {
        return res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` });
      }

      const test: UITest = {
        id: `test-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`,
        name,
        description: description || '',
        category,
        component,
        page,
        steps: steps || [],
        assertions: assertions || [],
        createdBy,
        createdAt: new Date().toISOString()
      };

      await redis.hset(UI_TESTS_KEY, { [test.id]: JSON.stringify(test) });

      return res.json({ success: true, test });
    }

    // PATCH: Update test
    if (req.method === 'PATCH') {
      let body: any;
      try {
        body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const { id, steps, assertions, description } = body;

      if (!id) {
        return res.status(400).json({ error: 'id required' });
      }

      const existing = await redis.hget(UI_TESTS_KEY, id);
      if (!existing) {
        return res.status(404).json({ error: 'Test not found' });
      }

      const test = typeof existing === 'string' ? JSON.parse(existing) : existing;

      if (steps) test.steps = steps;
      if (assertions) test.assertions = assertions;
      if (description) test.description = description;

      await redis.hset(UI_TESTS_KEY, { [id]: JSON.stringify(test) });

      return res.json({ success: true, test });
    }

    // DELETE: Remove test
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'id query param required' });
      }

      await redis.hdel(UI_TESTS_KEY, id as string);

      return res.json({ success: true, deleted: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('UI Tests error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
