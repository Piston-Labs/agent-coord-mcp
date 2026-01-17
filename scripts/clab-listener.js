#!/usr/bin/env node
/**
 * CLAB WebSocket Listener
 *
 * Connects to CLAB WebSocket and notifies Claude Code when new messages arrive.
 * Run alongside Claude Code to keep agents engaged with web chat.
 *
 * Usage:
 *   node clab-listener.js --agent=phil
 *   node clab-listener.js --agent=phil --notify=desktop
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
// Cloudflare DO WebSocket endpoint
const CLAB_WS_URL = 'wss://agent-coord-do.elidecloud.workers.dev/coordinator';
const INBOX_PATH = path.join(os.homedir(), '.clab', 'inbox.json');
const RECONNECT_DELAY = 5000;

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  acc[key] = value || true;
  return acc;
}, {});

const AGENT_ID = args.agent || process.env.CLAB_AGENT_ID || 'listener';
const NOTIFY_MODE = args.notify || 'file'; // 'file', 'desktop', 'console'

console.log(`[CLAB Listener] Starting for agent: ${AGENT_ID}`);
console.log(`[CLAB Listener] Notification mode: ${NOTIFY_MODE}`);
console.log(`[CLAB Listener] Inbox path: ${INBOX_PATH}`);

// Ensure inbox directory exists
const inboxDir = path.dirname(INBOX_PATH);
if (!fs.existsSync(inboxDir)) {
  fs.mkdirSync(inboxDir, { recursive: true });
}

// Initialize inbox
function loadInbox() {
  try {
    if (fs.existsSync(INBOX_PATH)) {
      return JSON.parse(fs.readFileSync(INBOX_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('[CLAB Listener] Error loading inbox:', e.message);
  }
  return { messages: [], lastChecked: null };
}

function saveInbox(inbox) {
  fs.writeFileSync(INBOX_PATH, JSON.stringify(inbox, null, 2));
}

function addToInbox(message) {
  const inbox = loadInbox();
  inbox.messages.push({
    ...message,
    receivedAt: new Date().toISOString()
  });
  saveInbox(inbox);
  return inbox.messages.length;
}

// Check if message is relevant to this agent
function isRelevantMessage(msg, agentId) {
  // All messages are relevant (agent can filter in Claude Code)
  // But especially: @mentions, or if we're tracking all
  const content = msg.message || '';
  const author = msg.author || '';

  // Don't notify about our own messages
  if (author === agentId) return false;

  // Check for @mention
  if (content.includes(`@${agentId}`)) return { type: 'mention', priority: 'high' };

  // Check for general @all
  if (content.includes('@all') || content.includes('@everyone')) return { type: 'broadcast', priority: 'medium' };

  // All other messages (can be filtered by config)
  return { type: 'general', priority: 'low' };
}

// Desktop notification (if available)
async function showDesktopNotification(title, body) {
  try {
    // Try node-notifier if available
    const notifier = require('node-notifier');
    notifier.notify({
      title: title,
      message: body,
      sound: true,
      wait: false
    });
  } catch (e) {
    // Fallback to console
    console.log(`\n🔔 ${title}: ${body}\n`);
  }
}

// Connect to CLAB WebSocket
function connect() {
  const wsUrl = `${CLAB_WS_URL}?agentId=${AGENT_ID}`;
  console.log(`[CLAB Listener] Connecting to ${wsUrl}...`);

  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log(`[CLAB Listener] Connected! Listening for messages...`);

    // Send ping every 30s to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    ws.on('close', () => clearInterval(pingInterval));
  });

  ws.on('message', async (data) => {
    try {
      const event = JSON.parse(data.toString());

      // Handle chat messages
      if (event.type === 'chat') {
        const msg = event.payload;
        const relevance = isRelevantMessage(msg, AGENT_ID);

        if (relevance) {
          console.log(`[CLAB] ${msg.author}: ${msg.message.substring(0, 100)}${msg.message.length > 100 ? '...' : ''}`);

          // Add to inbox
          const unreadCount = addToInbox({
            id: msg.id,
            author: msg.author,
            message: msg.message,
            timestamp: msg.timestamp,
            relevance: relevance
          });

          // Notify based on mode
          if (NOTIFY_MODE === 'desktop' || relevance.priority === 'high') {
            await showDesktopNotification(
              `CLAB: ${msg.author}`,
              msg.message.substring(0, 200)
            );
          }

          if (NOTIFY_MODE === 'console') {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`📬 NEW MESSAGE (${unreadCount} unread)`);
            console.log(`From: ${msg.author}`);
            console.log(`${msg.message}`);
            console.log(`${'='.repeat(60)}\n`);
          }
        }
      }

      // Handle agent updates
      if (event.type === 'agent-update') {
        console.log(`[CLAB] Agent update: ${event.payload.agentId} - ${event.payload.status}`);
      }

      // Handle pong (keepalive)
      if (event.type === 'pong') {
        // Silent acknowledgment
      }

    } catch (e) {
      console.error('[CLAB Listener] Parse error:', e.message);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[CLAB Listener] Disconnected (${code}). Reconnecting in ${RECONNECT_DELAY/1000}s...`);
    setTimeout(connect, RECONNECT_DELAY);
  });

  ws.on('error', (error) => {
    console.error('[CLAB Listener] WebSocket error:', error.message);
  });

  return ws;
}

// Command to clear inbox
function clearInbox() {
  saveInbox({ messages: [], lastChecked: new Date().toISOString() });
  console.log('[CLAB Listener] Inbox cleared');
}

// Start
console.log(`
╔════════════════════════════════════════════════════════════╗
║                    CLAB WebSocket Listener                 ║
╠════════════════════════════════════════════════════════════╣
║  Agent: ${AGENT_ID.padEnd(50)}║
║  Mode:  ${NOTIFY_MODE.padEnd(50)}║
║  Inbox: ${INBOX_PATH.substring(0, 50).padEnd(50)}║
╚════════════════════════════════════════════════════════════╝
`);

connect();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[CLAB Listener] Shutting down...');
  process.exit(0);
});

// Export for potential programmatic use
module.exports = { connect, clearInbox, loadInbox, INBOX_PATH };
