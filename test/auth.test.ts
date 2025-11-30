/**
 * Auth System Tests
 *
 * Tests the authentication endpoints against the deployed Vercel API.
 * Run with: npx tsx test/auth.test.ts
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

// Generate unique test user
const testUsername = `testuser_${Date.now()}`;
const testPassword = 'TestPass123!';
let testSessionCookie = '';

async function main() {
  console.log('=== Auth System Tests ===');
  console.log(`API: ${API_BASE}\n`);

  // Test 1: Session check without login
  await test('Session check without auth returns 401', async () => {
    const res = await fetch(`${API_BASE}/api/auth/session`);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
    const data = await res.json();
    assert(data.authenticated === false, 'Expected authenticated: false');
  });

  // Test 2: Login with invalid credentials
  await test('Login with invalid credentials fails', async () => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'invalid', password: 'wrong' })
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // Test 3: Login with env var admin
  await test('Login with admin credentials succeeds', async () => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'piston2025' })
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.success === true, 'Expected success: true');
    assert(data.session?.username === 'admin', 'Expected username: admin');

    // Save session cookie for later tests
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      testSessionCookie = setCookie.split(';')[0];
    }
  });

  // Test 4: Session check with valid cookie
  await test('Session check with valid cookie succeeds', async () => {
    assert(testSessionCookie !== '', 'Need session cookie from login');
    const res = await fetch(`${API_BASE}/api/auth/session`, {
      headers: { 'Cookie': testSessionCookie }
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.authenticated === true, 'Expected authenticated: true');
  });

  // Test 5: Register without invite code
  await test('Register without invite code fails', async () => {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: testPassword
      })
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  // Test 6: Register with wrong invite code
  await test('Register with wrong invite code fails', async () => {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: testPassword,
        inviteCode: 'wrong-code'
      })
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  // Test 7: Register with valid invite code
  await test('Register with valid invite code succeeds', async () => {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: testPassword,
        inviteCode: 'piston-team-2025'
      })
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const data = await res.json();
    assert(data.success === true, 'Expected success: true');
    assert(data.user?.username === testUsername, `Expected username: ${testUsername}`);
    assert(data.user?.role === 'user', 'Expected role: user');
  });

  // Test 8: Register duplicate username
  await test('Register duplicate username fails', async () => {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: testPassword,
        inviteCode: 'piston-team-2025'
      })
    });
    assert(res.status === 409, `Expected 409, got ${res.status}`);
  });

  // Test 9: Login with newly registered user
  let newUserSessionCookie = '';
  await test('Login with registered user succeeds', async () => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: testUsername, password: testPassword })
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.success === true, 'Expected success: true');
    assert(data.session?.username === testUsername, `Expected username: ${testUsername}`);
    assert(data.session?.role === 'user', 'Expected role: user');

    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      newUserSessionCookie = setCookie.split(';')[0];
    }
  });

  // Test 10: List users as admin
  await test('List users as admin succeeds', async () => {
    assert(testSessionCookie !== '', 'Need admin session cookie');
    const res = await fetch(`${API_BASE}/api/auth/users`, {
      headers: { 'Cookie': testSessionCookie }
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data.users), 'Expected users array');
  });

  // Test 11: List users as non-admin fails
  await test('List users as non-admin fails', async () => {
    assert(newUserSessionCookie !== '', 'Need non-admin session cookie');
    const res = await fetch(`${API_BASE}/api/auth/users`, {
      headers: { 'Cookie': newUserSessionCookie }
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  // Test 12: Logout
  await test('Logout clears session', async () => {
    const res = await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Cookie': newUserSessionCookie }
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);

    // Verify session is invalid now
    const checkRes = await fetch(`${API_BASE}/api/auth/session`, {
      headers: { 'Cookie': newUserSessionCookie }
    });
    assert(checkRes.status === 401, `Expected session to be invalid after logout`);
  });

  // Test 13: Username validation
  await test('Username validation enforced', async () => {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'ab', // too short
        password: testPassword,
        inviteCode: 'piston-team-2025'
      })
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  // Test 14: Password validation
  await test('Password validation enforced', async () => {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'validuser123',
        password: 'short', // too short
        inviteCode: 'piston-team-2025'
      })
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
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
