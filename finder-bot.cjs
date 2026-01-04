/**
 * Finder Bot - Auto-responding chat agent
 *
 * This script polls the group chat for @finder mentions and responds using the agent-chat API.
 * Run with: node finder-bot.cjs
 *
 * To stop: Ctrl+C
 */

const API_BASE = 'https://agent-coord-mcp.vercel.app';
const FINDER_SOUL_ID = 'mjz69bdx1k6ve1xw6'; // Update if soul is recreated
const POLL_INTERVAL = 5000; // 5 seconds
const FINDER_NAME = 'Finder';

let lastMessageId = null;
let processedIds = new Set();

console.log(`[Finder Bot] Starting up...`);
console.log(`[Finder Bot] Polling every ${POLL_INTERVAL/1000}s for @finder mentions`);

// Hot-start: Register presence
async function hotStart() {
  try {
    await fetch(`${API_BASE}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'finder',
        name: FINDER_NAME,
        status: 'active',
        currentTask: 'Monitoring chat for @finder mentions',
        role: 'helper'
      })
    });
    console.log(`[Finder Bot] Registered as active agent`);

    // Post hello message
    await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: FINDER_NAME,
        message: 'Finder online and ready to help! Mention @finder to ask me anything about the codebase or system.'
      })
    });
  } catch (err) {
    console.error('[Finder Bot] Hot-start error:', err.message);
  }
}

// Poll for new messages
async function pollMessages() {
  try {
    const res = await fetch(`${API_BASE}/api/chat?limit=20`);
    const data = await res.json();

    if (!data.messages || data.messages.length === 0) return;

    // Process new messages (newest first, so reverse to process oldest first)
    const messages = data.messages.reverse();

    for (const msg of messages) {
      // Skip if already processed
      if (processedIds.has(msg.id)) continue;
      processedIds.add(msg.id);

      // Skip our own messages
      if (msg.author === FINDER_NAME || msg.author === 'finder') continue;

      // Check for @finder mention
      const hasMention = msg.message.toLowerCase().includes('@finder');

      if (hasMention) {
        console.log(`[Finder Bot] Mention detected from ${msg.author}: ${msg.message.substring(0, 50)}...`);
        await respondToMessage(msg);
      }
    }

    // Keep processedIds from growing forever (keep last 1000)
    if (processedIds.size > 1000) {
      const arr = Array.from(processedIds);
      processedIds = new Set(arr.slice(-500));
    }

  } catch (err) {
    console.error('[Finder Bot] Poll error:', err.message);
  }
}

// Generate and post response
async function respondToMessage(msg) {
  try {
    // Get recent messages for context
    const chatRes = await fetch(`${API_BASE}/api/chat?limit=10`);
    const chatData = await chatRes.json();
    const recentMessages = chatData.messages?.reverse() || [];

    // Call agent-chat to generate response
    const res = await fetch(`${API_BASE}/api/agent-chat?action=respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        soulId: FINDER_SOUL_ID,
        trigger: msg.message,
        recentMessages: recentMessages.map(m => ({
          author: m.author,
          message: m.message
        })),
        postToGroupChat: true,
        maxTokens: 500
      })
    });

    const data = await res.json();

    if (data.chatMessage) {
      console.log(`[Finder Bot] Responded: ${data.response?.substring(0, 50)}...`);
    } else {
      console.log(`[Finder Bot] Response generated but not posted (silence or error)`);
    }

  } catch (err) {
    console.error('[Finder Bot] Response error:', err.message);
  }
}

// Heartbeat to maintain presence
async function heartbeat() {
  try {
    await fetch(`${API_BASE}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'finder',
        status: 'active',
        currentTask: 'Monitoring chat for @finder mentions',
        lastHeartbeat: new Date().toISOString()
      })
    });
  } catch {
    // Ignore heartbeat errors
  }
}

// Main loop
async function main() {
  await hotStart();

  // Poll loop
  setInterval(pollMessages, POLL_INTERVAL);

  // Heartbeat every 30 seconds
  setInterval(heartbeat, 30000);

  console.log(`[Finder Bot] Entering poll loop...`);
}

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('\n[Finder Bot] Shutting down...');
  try {
    await fetch(`${API_BASE}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'finder',
        status: 'offline',
        currentTask: 'Offline'
      })
    });
    await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: FINDER_NAME,
        message: 'Finder going offline. See you later!'
      })
    });
  } catch {
    // Ignore shutdown errors
  }
  process.exit(0);
});

main();
