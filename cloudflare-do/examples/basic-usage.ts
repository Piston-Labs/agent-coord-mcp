/**
 * Example: Basic Usage of Durable Objects Client
 *
 * This demonstrates how to use the DO client for agent coordination.
 * Run with: npx tsx examples/basic-usage.ts
 */

import { DOClient } from '../src/client';

// Point to your deployed Worker (or localhost for dev)
const DO_URL = process.env.DO_URL || 'http://localhost:8787';

async function main() {
  const client = new DOClient(DO_URL);
  const agentId = 'example-agent';

  console.log('=== Durable Objects Client Demo ===\n');

  // 1. Health check
  console.log('1. Checking service health...');
  const health = await client.health();
  console.log('   Status:', health.status);
  console.log('   Service:', health.service);
  console.log();

  // 2. Hot-start (get everything at once)
  console.log('2. Hot-starting agent...');
  const work = await client.work(agentId);
  console.log('   Active agents:', work.summary.activeAgents);
  console.log('   Todo tasks:', work.summary.todoTasks);
  console.log('   Recent chat messages:', work.recentChat.length);
  console.log();

  // 3. Register agent with status
  console.log('3. Registering agent...');
  const agent = await client.registerAgent(agentId, {
    status: 'active',
    workingOn: 'Testing DO client',
    capabilities: ['testing', 'documentation'],
    offers: ['help with DO migration'],
    needs: ['feedback']
  });
  console.log('   Registered:', agent.agentId);
  console.log('   Status:', agent.status);
  console.log();

  // 4. Send a chat message
  console.log('4. Sending chat message...');
  const chatMsg = await client.sendChat(agentId, 'Hello from DO client example!');
  console.log('   Message ID:', chatMsg.id);
  console.log('   Timestamp:', chatMsg.timestamp);
  console.log();

  // 5. Get recent chat
  console.log('5. Getting recent chat...');
  const messages = await client.getChat(5);
  console.log('   Recent messages:');
  for (const msg of messages.slice(-3)) {
    console.log(`   - [${msg.author}]: ${msg.message.substring(0, 50)}...`);
  }
  console.log();

  // 6. Create a task
  console.log('6. Creating a task...');
  const task = await client.createTask({
    title: 'Test DO client integration',
    description: 'Verify all client methods work correctly',
    priority: 'medium',
    createdBy: agentId,
    tags: ['test', 'do-client']
  });
  console.log('   Task ID:', task.id);
  console.log('   Title:', task.title);
  console.log();

  // 7. Save checkpoint
  console.log('7. Saving checkpoint...');
  await client.saveCheckpoint(agentId, {
    conversationSummary: 'Testing DO client methods',
    accomplishments: ['Connected to DO service', 'Sent chat message', 'Created task'],
    pendingWork: ['Test resource locking', 'Test WebSocket'],
    filesEdited: ['examples/basic-usage.ts']
  });
  console.log('   Checkpoint saved!');
  console.log();

  // 8. Get agent state
  console.log('8. Getting agent state...');
  const state = await client.getAgentState(agentId);
  console.log('   Has checkpoint:', !!state.checkpoint);
  console.log('   Accomplishments:', state.checkpoint?.accomplishments.length || 0);
  console.log('   Pending work:', state.checkpoint?.pendingWork.length || 0);
  console.log();

  // 9. Resource locking
  console.log('9. Testing resource locks...');
  const resourcePath = 'src/example-file.ts';

  // Check if locked
  const checkResult = await client.checkLock(resourcePath);
  console.log('   Resource locked?', checkResult.locked);

  // Acquire lock
  const lockResult = await client.acquireLock(resourcePath, agentId, {
    reason: 'Testing lock functionality',
    ttlMs: 60000 // 1 minute
  });
  console.log('   Lock acquired?', lockResult.success);

  // Check again
  const checkResult2 = await client.checkLock(resourcePath);
  console.log('   Resource locked now?', checkResult2.locked);
  console.log('   Locked by:', checkResult2.lock?.lockedBy);

  // Release lock
  const releaseResult = await client.releaseLock(resourcePath, agentId);
  console.log('   Lock released?', releaseResult.success);
  console.log();

  // 10. Store a memory
  console.log('10. Storing a memory...');
  const memory = await client.remember(agentId, {
    category: 'learning',
    content: 'Durable Objects provide SQLite storage built into each instance',
    tags: ['durable-objects', 'sqlite', 'cloudflare']
  });
  console.log('    Memory stored:', (memory as { id: string }).id);
  console.log();

  // 11. Recall memories
  console.log('11. Recalling memories...');
  const memories = await client.recall(agentId, { query: 'durable' });
  console.log('    Found memories:', memories.length);
  console.log();

  console.log('=== Demo Complete! ===');
  console.log('\nNext steps:');
  console.log('  - Deploy to Cloudflare: npm run deploy');
  console.log('  - Test WebSocket: connect with client.connectWebSocket()');
  console.log('  - Migrate MCP tools to use DOClient');
}

main().catch(console.error);
