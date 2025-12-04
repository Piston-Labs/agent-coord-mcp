/**
 * Integration APIs Tests
 *
 * Tests the Errors (self-hosted) and Linear API endpoints.
 * These APIs return mock data when tokens are not configured.
 * The Errors API is the free error tracking solution using Redis backend.
 * Run with: npx tsx test/integrations.test.ts
 */

const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, message: 'OK', duration });
    console.log(`✓ ${name} (${duration}ms)`);
  } catch (error) {
    const duration = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, message, duration });
    console.log(`✗ ${name}: ${message} (${duration}ms)`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log('=== Integration APIs Tests ===');
  console.log(`API: ${API_BASE}\n`);

  // ============================================================================
  // LINEAR API TESTS
  // ============================================================================
  console.log('\n--- Linear API ---');

  // Linear returns 503 when not configured (no mock data fallback)
  await test('Linear returns 503 when not configured', async () => {
    const res = await fetch(`${API_BASE}/api/linear`);
    // Linear doesn't have mock data, returns 503 when not configured
    if (res.status === 503) {
      const data = await res.json();
      assert(data.error === 'Linear not configured', 'Expected Linear not configured error');
    } else if (res.ok) {
      // If configured, should return issues
      const data = await res.json();
      assert(Array.isArray(data.issues), 'Expected issues array when configured');
    } else {
      throw new Error(`Unexpected status: ${res.status}`);
    }
  });

  await test('Linear teams action responds appropriately', async () => {
    const res = await fetch(`${API_BASE}/api/linear?action=teams`);
    if (res.status === 503) {
      const data = await res.json();
      assert(data.error === 'Linear not configured', 'Expected Linear not configured error');
    } else if (res.ok) {
      const data = await res.json();
      assert(Array.isArray(data.teams), 'Expected teams array when configured');
    } else {
      throw new Error(`Unexpected status: ${res.status}`);
    }
  });

  await test('Linear projects action responds appropriately', async () => {
    const res = await fetch(`${API_BASE}/api/linear?action=projects`);
    if (res.status === 503) {
      const data = await res.json();
      assert(data.error === 'Linear not configured', 'Expected Linear not configured error');
    } else if (res.ok) {
      const data = await res.json();
      assert(Array.isArray(data.projects), 'Expected projects array when configured');
    } else {
      throw new Error(`Unexpected status: ${res.status}`);
    }
  });

  await test('Linear POST requires teamId and title for create', async () => {
    const res = await fetch(`${API_BASE}/api/linear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test' }) // Missing teamId
    });
    if (res.status === 503) {
      // Not configured, expected
      const data = await res.json();
      assert(data.error === 'Linear not configured', 'Expected Linear not configured error');
    } else if (res.status === 400) {
      // Configured but missing required field
      const data = await res.json();
      assert(data.error?.includes('teamId'), 'Expected teamId required error');
    } else {
      throw new Error(`Unexpected status: ${res.status}`);
    }
  });

  // ============================================================================
  // ERRORS API TESTS (Self-hosted error tracking)
  // ============================================================================
  console.log('\n--- Errors API (Self-hosted) ---');

  await test('Errors overview returns data', async () => {
    const res = await fetch(`${API_BASE}/api/errors?action=overview`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.summary !== undefined, 'Expected summary in response');
    assert(typeof data.summary.unresolvedIssues === 'number', 'Expected unresolvedIssues number');
    assert(data.summary.source === 'self-hosted', 'Expected source to be self-hosted');
  });

  await test('Errors issues list returns array', async () => {
    const res = await fetch(`${API_BASE}/api/errors?action=issues`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data.issues), 'Expected issues array');
    assert(typeof data.count === 'number', 'Expected count number');
  });

  await test('Errors capture creates new issue', async () => {
    const testError = {
      title: 'Test Error from integration tests',
      message: 'This is a test error',
      level: 'warning',
      culprit: 'test/integrations.test.ts:captureTest',
      tags: { test: 'true', environment: 'test' },
      extra: { testRun: Date.now() }
    };

    const res = await fetch(`${API_BASE}/api/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testError)
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.success === true, 'Expected success: true');
    assert(data.eventId !== undefined, 'Expected eventId');
    assert(data.issueId !== undefined, 'Expected issueId');
    assert(data.shortId?.startsWith('AGENT-'), 'Expected shortId like AGENT-XXX');
  });

  await test('Errors capture requires title', async () => {
    const res = await fetch(`${API_BASE}/api/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'No title' })
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    const data = await res.json();
    assert(data.error === 'title is required', 'Expected title required error');
  });

  await test('Errors stats returns chart data', async () => {
    const res = await fetch(`${API_BASE}/api/errors?action=stats`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.stats !== undefined, 'Expected stats in response');
    assert(Array.isArray(data.stats.received), 'Expected received array for chart');
    assert(data.source === 'self-hosted', 'Expected source to be self-hosted');
  });

  await test('Errors issue detail requires issueId', async () => {
    const res = await fetch(`${API_BASE}/api/errors?action=issue`);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    const data = await res.json();
    assert(data.error === 'issueId required', 'Expected issueId required error');
  });

  await test('Errors PATCH updates issue status', async () => {
    // First, capture an error to get an issueId
    const captureRes = await fetch(`${API_BASE}/api/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test for status update', level: 'info' })
    });
    const captureData = await captureRes.json();
    const issueId = captureData.issueId;

    // Now resolve it
    const res = await fetch(`${API_BASE}/api/errors?issueId=${issueId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' })
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.success === true, 'Expected success: true');
    assert(data.issue?.status === 'resolved', 'Expected status to be resolved');
  });

  await test('Errors rejects invalid action', async () => {
    const res = await fetch(`${API_BASE}/api/errors?action=invalid`);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    const data = await res.json();
    assert(data.validActions !== undefined, 'Expected validActions in error');
  });

  // ============================================================================
  // CROSS-API TESTS
  // ============================================================================
  console.log('\n--- Cross-API Tests ---');

  await test('CORS headers are set', async () => {
    const res = await fetch(`${API_BASE}/api/errors`, { method: 'OPTIONS' });
    assert(res.ok, 'OPTIONS should succeed');
    const allowOrigin = res.headers.get('access-control-allow-origin');
    assert(allowOrigin === '*', 'Expected Access-Control-Allow-Origin: *');
  });

  // Summary
  console.log('\n=== Test Summary ===');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  console.log(`Total time: ${totalDuration}ms`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.message}`);
    });
    process.exit(1);
  } else {
    console.log('\n✓ All tests passed!');
  }
}

main().catch(console.error);
