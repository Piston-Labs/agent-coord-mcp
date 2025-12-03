/**
 * Example: WebSocket Real-time Updates
 *
 * This demonstrates how to use WebSocket for real-time coordination.
 * Run with: npx tsx examples/websocket-realtime.ts
 */

import { DOClient } from '../src/client';

const DO_URL = process.env.DO_URL || 'http://localhost:8787';

async function main() {
  const client = new DOClient(DO_URL);
  const agentId = `realtime-agent-${Date.now()}`;

  console.log('=== WebSocket Real-time Demo ===\n');
  console.log('Connecting as:', agentId);

  // Set up message handlers BEFORE connecting
  client.onMessage('agent-update', (data) => {
    console.log('\n[AGENT UPDATE]', JSON.stringify(data, null, 2));
  });

  client.onMessage('chat', (data) => {
    const msg = data as { author: string; message: string };
    console.log(`\n[CHAT] ${msg.author}: ${msg.message}`);
  });

  client.onMessage('task-update', (data) => {
    console.log('\n[TASK UPDATE]', JSON.stringify(data, null, 2));
  });

  client.onMessage('lock-update', (data) => {
    console.log('\n[LOCK UPDATE]', JSON.stringify(data, null, 2));
  });

  // Handler for ALL messages (useful for debugging)
  client.onMessage('all', (data) => {
    const msg = data as { type: string };
    console.log(`[RAW] Type: ${msg.type}`);
  });

  // Connect WebSocket
  try {
    await client.connectWebSocket(agentId);
    console.log('Connected! Listening for real-time updates...\n');
  } catch (error) {
    console.error('Failed to connect:', error);
    process.exit(1);
  }

  // Send initial chat message
  console.log('Sending hello message...');
  await client.sendChat(agentId, `Hello! I'm ${agentId}, connected via WebSocket.`);

  // Keep connection alive with pings
  const pingInterval = setInterval(() => {
    try {
      client.ping();
    } catch {
      clearInterval(pingInterval);
    }
  }, 30000);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nDisconnecting...');
    clearInterval(pingInterval);
    client.disconnect();
    process.exit(0);
  });

  console.log('Press Ctrl+C to disconnect\n');
  console.log('Try sending messages from another agent to see real-time updates!\n');

  // Keep the process running
  await new Promise(() => {});
}

main().catch(console.error);
