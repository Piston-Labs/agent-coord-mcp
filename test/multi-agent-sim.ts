/**
 * Multi-Agent Simulation Test
 *
 * Simulates multiple agents collaborating via the HTTP API.
 * Tests coordination patterns: claims, handoffs, chat, zones.
 */

const API_BASE = process.env.API_URL || 'http://localhost:3001';

interface ApiResponse {
  [key: string]: unknown;
}

async function api(method: string, path: string, body?: Record<string, unknown>): Promise<ApiResponse> {
  const url = `${API_BASE}${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  return res.json() as Promise<ApiResponse>;
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Agent simulation
class SimulatedAgent {
  id: string;
  role: string;

  constructor(id: string, role: string) {
    this.id = id;
    this.role = role;
  }

  async register(): Promise<void> {
    await api('POST', `/api/agents/${this.id}/status`, {
      status: 'active',
      currentTask: `Simulated ${this.role}`,
      workingOn: this.role
    });
    console.log(`[${this.id}] Registered as ${this.role}`);
  }

  async chat(message: string): Promise<void> {
    await api('POST', '/api/chat', {
      author: this.id,
      message
    });
    console.log(`[${this.id}] Chat: ${message}`);
  }

  async claim(what: string, description: string): Promise<boolean> {
    const result = await api('POST', '/api/claims', {
      what,
      by: this.id,
      description
    });
    const success = result.claimed === true;
    console.log(`[${this.id}] Claim ${what}: ${success ? 'SUCCESS' : 'BLOCKED by ' + result.by}`);
    return success;
  }

  async claimZone(zoneId: string, path: string): Promise<boolean> {
    const result = await api('POST', '/api/zones', {
      zoneId,
      path,
      owner: this.id,
      description: `${this.id}'s zone`
    });
    const success = result.success === true;
    console.log(`[${this.id}] Zone ${zoneId}: ${success ? 'CLAIMED' : 'BLOCKED'}`);
    return success;
  }

  async createTask(title: string, priority: string): Promise<string> {
    const result = await api('POST', '/api/tasks', {
      title,
      createdBy: this.id,
      priority
    });
    const task = result.task as { id: string };
    console.log(`[${this.id}] Created task: ${title} (${task.id})`);
    return task.id;
  }

  async lock(resourcePath: string, reason: string): Promise<boolean> {
    const result = await api('POST', '/api/locks', {
      resourcePath,
      agentId: this.id,
      reason
    });
    const success = result.success === true;
    console.log(`[${this.id}] Lock ${resourcePath}: ${success ? 'ACQUIRED' : 'BLOCKED'}`);
    return success;
  }

  async work(): Promise<ApiResponse> {
    return api('GET', `/api/work/${this.id}`);
  }
}

// Simulation scenarios
async function scenarioFileConflict(): Promise<void> {
  console.log('\n=== SCENARIO: File Conflict Prevention ===\n');

  const agent1 = new SimulatedAgent('frontend-dev', 'frontend');
  const agent2 = new SimulatedAgent('backend-dev', 'backend');

  await agent1.register();
  await agent2.register();

  // Both try to claim the same file
  await agent1.chat('Starting work on auth module');
  const claim1 = await agent1.claim('src/auth/login.ts', 'Refactoring login flow');

  await delay(100);

  await agent2.chat('I also need to edit the auth module');
  const claim2 = await agent2.claim('src/auth/login.ts', 'Adding OAuth support');

  if (claim1 && !claim2) {
    console.log('\n✅ Conflict prevented! agent2 was blocked from claiming the same file.');
    await agent1.chat('@backend-dev I have src/auth/login.ts - will ping you when done');
  }
}

async function scenarioZoneDivision(): Promise<void> {
  console.log('\n=== SCENARIO: Zone-Based Work Division ===\n');

  const frontend = new SimulatedAgent('cascade-ui', 'UI developer');
  const backend = new SimulatedAgent('augment-api', 'API developer');
  const db = new SimulatedAgent('claude-db', 'Database specialist');

  await Promise.all([
    frontend.register(),
    backend.register(),
    db.register()
  ]);

  // Each claims their zone
  await frontend.claimZone('frontend', '/src/components');
  await backend.claimZone('backend', '/src/api');
  await db.claimZone('database', '/src/db');

  // Announce in chat
  await frontend.chat('I own the frontend zone - all UI work goes through me');
  await backend.chat('Backend zone is mine - API routes covered');
  await db.chat('Database zone claimed - schema and migrations');

  // Show final state
  const zones = await api('GET', '/api/zones');
  console.log('\nZone ownership:', JSON.stringify(zones, null, 2));
}

async function scenarioTaskHandoff(): Promise<void> {
  console.log('\n=== SCENARIO: Task Handoff ===\n');

  const designer = new SimulatedAgent('design-agent', 'designer');
  const developer = new SimulatedAgent('dev-agent', 'developer');
  const qa = new SimulatedAgent('qa-agent', 'tester');

  await designer.register();
  await developer.register();
  await qa.register();

  // Designer creates and completes a task
  const taskId = await designer.createTask('Design new dashboard', 'high');
  await designer.chat(`Created task: ${taskId}`);

  await delay(200);
  await designer.chat(`@dev-agent Dashboard design is ready! Task ${taskId} is yours now`);

  // Developer picks it up
  await api('PUT', `/api/tasks/${taskId}`, { assignee: 'dev-agent', status: 'in-progress' });
  await developer.chat(`Got it! Working on ${taskId}`);

  await delay(200);
  await developer.chat(`@qa-agent Dashboard implementation done, ready for testing`);

  // QA takes over
  await api('PUT', `/api/tasks/${taskId}`, { assignee: 'qa-agent' });
  await qa.chat(`Testing ${taskId} now...`);

  await delay(100);
  await api('PUT', `/api/tasks/${taskId}`, { status: 'done' });
  await qa.chat(`✅ Task ${taskId} passed all tests! Marking as done.`);
}

async function scenarioResourceLocking(): Promise<void> {
  console.log('\n=== SCENARIO: Resource Locking (Branch Protection) ===\n');

  const agent1 = new SimulatedAgent('feature-agent', 'feature developer');
  const agent2 = new SimulatedAgent('hotfix-agent', 'hotfix developer');

  await agent1.register();
  await agent2.register();

  // agent1 locks the main branch for a deploy
  await agent1.chat('Starting production deploy, locking main branch');
  const lock1 = await agent1.lock('branch:main', 'Production deployment in progress');

  // agent2 tries to push a hotfix
  await delay(100);
  await agent2.chat('Need to push urgent hotfix!');
  const lock2 = await agent2.lock('branch:main', 'Urgent hotfix');

  if (lock1 && !lock2) {
    console.log('\n✅ Branch protected! Hotfix blocked during deploy.');
    await agent2.chat('@feature-agent Waiting for your deploy to finish before I can push hotfix');
  }
}

async function showFinalState(): Promise<void> {
  console.log('\n=== FINAL STATE ===\n');

  const [agents, chat, tasks, locks, claims, zones] = await Promise.all([
    api('GET', '/api/agents'),
    api('GET', '/api/chat'),
    api('GET', '/api/tasks'),
    api('GET', '/api/locks'),
    api('GET', '/api/claims'),
    api('GET', '/api/zones')
  ]);

  console.log(`Agents: ${(agents.agents as unknown[]).length}`);
  console.log(`Chat messages: ${(chat.messages as unknown[]).length}`);
  console.log(`Tasks: ${(tasks.tasks as unknown[]).length}`);
  console.log(`Locks: ${(locks.locks as unknown[]).length}`);
  console.log(`Claims: ${(claims.claims as unknown[]).length}`);
  console.log(`Zones: ${(zones.zones as unknown[]).length}`);
}

// Main
async function main(): Promise<void> {
  console.log('🤖 Multi-Agent Coordination Simulation\n');
  console.log(`API: ${API_BASE}\n`);

  // Check API health
  const health = await api('GET', '/api/health');
  console.log('Health:', health);

  await scenarioFileConflict();
  await delay(300);

  await scenarioZoneDivision();
  await delay(300);

  await scenarioTaskHandoff();
  await delay(300);

  await scenarioResourceLocking();
  await delay(300);

  await showFinalState();

  console.log('\n✅ Simulation complete!');
}

main().catch(console.error);
