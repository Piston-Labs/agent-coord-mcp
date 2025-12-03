/**
 * Integration APIs Tests
 *
 * Tests the Sentry, Notion, and Linear API endpoints.
 * These APIs return mock data when tokens are not configured.
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
  // SENTRY API TESTS
  // ============================================================================
  console.log('--- Sentry API ---');

  await test('Sentry overview returns data', async () => {
    const res = await fetch(`${API_BASE}/api/sentry?action=overview`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.summary !== undefined, 'Expected summary in response');
    assert(typeof data.summary.unresolvedIssues === 'number', 'Expected unresolvedIssues number');
  });

  await test('Sentry issues list returns array', async () => {
    const res = await fetch(`${API_BASE}/api/sentry?action=issues`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data.issues), 'Expected issues array');
    assert(typeof data.count === 'number', 'Expected count number');
  });

  await test('Sentry issue detail works with mock ID', async () => {
    const res = await fetch(`${API_BASE}/api/sentry?action=issue&issueId=mock-1`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.id !== undefined, 'Expected id in response');
    assert(data.title !== undefined, 'Expected title in response');
  });

  await test('Sentry issue detail requires issueId', async () => {
    const res = await fetch(`${API_BASE}/api/sentry?action=issue`);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    const data = await res.json();
    assert(data.error === 'issueId required', 'Expected issueId required error');
  });

  await test('Sentry stats returns data', async () => {
    const res = await fetch(`${API_BASE}/api/sentry?action=stats`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.stats !== undefined, 'Expected stats in response');
  });

  await test('Sentry events requires issueId', async () => {
    const res = await fetch(`${API_BASE}/api/sentry?action=events`);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    const data = await res.json();
    assert(data.error === 'issueId required for events', 'Expected error message');
  });

  await test('Sentry events returns data with issueId', async () => {
    const res = await fetch(`${API_BASE}/api/sentry?action=events&issueId=mock-1`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data.events), 'Expected events array');
  });

  await test('Sentry rejects invalid action', async () => {
    const res = await fetch(`${API_BASE}/api/sentry?action=invalid`);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    const data = await res.json();
    assert(data.validActions !== undefined, 'Expected validActions in error');
  });

  // ============================================================================
  // NOTION API TESTS
  // ============================================================================
  console.log('\n--- Notion API ---');

  await test('Notion search returns results', async () => {
    const res = await fetch(`${API_BASE}/api/notion?action=search`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data.results), 'Expected results array');
    assert(typeof data.count === 'number', 'Expected count number');
  });

  await test('Notion search with query filters results', async () => {
    const res = await fetch(`${API_BASE}/api/notion?action=search&query=roadmap`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data.results), 'Expected results array');
  });

  await test('Notion page returns content', async () => {
    const res = await fetch(`${API_BASE}/api/notion?action=page&pageId=mock-page-1`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.title !== undefined, 'Expected title in response');
    assert(Array.isArray(data.content), 'Expected content array');
  });

  await test('Notion page requires pageId', async () => {
    const res = await fetch(`${API_BASE}/api/notion?action=page`);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    const data = await res.json();
    assert(data.error === 'pageId required', 'Expected pageId required error');
  });

  await test('Notion database returns info', async () => {
    const res = await fetch(`${API_BASE}/api/notion?action=database&databaseId=mock-db-1`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.title !== undefined, 'Expected title in response');
    assert(Array.isArray(data.properties), 'Expected properties array');
  });

  await test('Notion database requires databaseId', async () => {
    const res = await fetch(`${API_BASE}/api/notion?action=database`);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    const data = await res.json();
    assert(data.error === 'databaseId required', 'Expected databaseId required error');
  });

  await test('Notion query returns entries', async () => {
    const res = await fetch(`${API_BASE}/api/notion?action=query&databaseId=mock-db-1`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data.entries), 'Expected entries array');
    assert(typeof data.count === 'number', 'Expected count number');
  });

  await test('Notion query requires databaseId', async () => {
    const res = await fetch(`${API_BASE}/api/notion?action=query`);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    const data = await res.json();
    assert(data.error === 'databaseId required for query', 'Expected error message');
  });

  await test('Notion databases list returns array', async () => {
    const res = await fetch(`${API_BASE}/api/notion?action=databases`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data.databases), 'Expected databases array');
    assert(typeof data.count === 'number', 'Expected count number');
  });

  await test('Notion rejects invalid action', async () => {
    const res = await fetch(`${API_BASE}/api/notion?action=invalid`);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    const data = await res.json();
    assert(data.validActions !== undefined, 'Expected validActions in error');
  });

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
  // CROSS-API TESTS
  // ============================================================================
  console.log('\n--- Cross-API Tests ---');

  await test('All integration APIs reject non-GET methods (except Linear)', async () => {
    const sentryRes = await fetch(`${API_BASE}/api/sentry`, { method: 'POST' });
    assert(sentryRes.status === 405, `Sentry should reject POST: got ${sentryRes.status}`);

    const notionRes = await fetch(`${API_BASE}/api/notion`, { method: 'POST' });
    assert(notionRes.status === 405, `Notion should reject POST: got ${notionRes.status}`);
  });

  await test('CORS headers are set', async () => {
    const res = await fetch(`${API_BASE}/api/sentry`, { method: 'OPTIONS' });
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
