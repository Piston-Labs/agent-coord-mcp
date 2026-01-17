#!/usr/bin/env node
/**
 * CLAB Agent Runner - Full Automation
 *
 * Wraps Claude Code CLI to enable bidirectional chat with CLAB web dashboard.
 * WebSocket messages from web -> Claude Code stdin
 * Claude Code stdout -> posts back to CLAB chat
 *
 * Usage:
 *   node clab-agent-runner.js --agent=bob
 *   node clab-agent-runner.js --agent=bob --mentions-only
 *
 * This replaces running `claude` directly - it spawns Claude Code as a child
 * process and bridges it to CLAB chat.
 */

const { spawn } = require('child_process');
const WebSocket = require('ws');
const readline = require('readline');
const path = require('path');

// Configuration
// Use the direct Cloudflare DO URL for WebSocket (clab.era-auto.co is Vercel, doesn't proxy WS)
const CLAB_WS_URL = 'wss://agent-coord-do.elidecloud.workers.dev/coordinator';
const RECONNECT_DELAY = 5000;
const OUTPUT_DEBOUNCE_MS = 1500; // Wait for output to settle before posting

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  acc[key] = value || true;
  return acc;
}, {});

const AGENT_ID = args.agent || process.env.CLAB_AGENT_ID || 'runner';
const MENTIONS_ONLY = args['mentions-only'] || false;
const CLAUDE_CMD = args.claude || 'claude';

console.log(`
+================================================================+
|                    CLAB Agent Runner                           |
+================================================================+
|  Agent: ${AGENT_ID.padEnd(54)}|
|  Mode:  ${(MENTIONS_ONLY ? '@mentions only' : 'all messages').padEnd(54)}|
|  Claude: ${CLAUDE_CMD.padEnd(53)}|
+================================================================+
`);

// State
let ws = null;
let claudeProcess = null;
let outputBuffer = '';
let outputTimer = null;
let lastPostedMessage = null;

// ============ WebSocket Connection ============

function connectWebSocket() {
  const url = `${CLAB_WS_URL}?agentId=${AGENT_ID}`;
  console.log(`[Runner] Connecting to CLAB: ${url}`);

  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('[Runner] Connected to CLAB WebSocket');
    postToChat(`[runner] ${AGENT_ID} online - ready for commands`);
  });

  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString());
      handleWebSocketMessage(event);
    } catch (e) {
      console.error('[Runner] Failed to parse WS message:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[Runner] WebSocket disconnected, reconnecting...');
    setTimeout(connectWebSocket, RECONNECT_DELAY);
  });

  ws.on('error', (error) => {
    console.error('[Runner] WebSocket error:', error.message);
  });

  // Keepalive ping
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);
}

function handleWebSocketMessage(event) {
  if (event.type !== 'chat') return;

  const msg = event.payload;
  if (!msg) return;

  // Don't process our own messages (loop prevention)
  if (msg.author === AGENT_ID) return;

  // Don't process messages we just posted (double loop prevention)
  if (lastPostedMessage && msg.message === lastPostedMessage) return;

  const content = msg.message || '';
  const isMention = content.toLowerCase().includes(`@${AGENT_ID.toLowerCase()}`);
  const isAllMention = content.includes('@all') || content.includes('@everyone');

  // Filter based on mode
  if (MENTIONS_ONLY && !isMention && !isAllMention) {
    return;
  }

  console.log(`[CLAB] ${msg.author}: ${content.substring(0, 80)}${content.length > 80 ? '...' : ''}`);

  // Send to Claude Code
  sendToClaudeCode(msg.author, content);
}

// ============ Claude Code Process ============

function spawnClaudeCode() {
  console.log(`[Runner] Spawning Claude Code: ${CLAUDE_CMD}`);

  claudeProcess = spawn(CLAUDE_CMD, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    env: {
      ...process.env,
      CLAB_AGENT_ID: AGENT_ID,
      // Disable colors for cleaner parsing
      NO_COLOR: '1',
      FORCE_COLOR: '0'
    }
  });

  // Handle stdout
  claudeProcess.stdout.on('data', (data) => {
    const text = data.toString();
    process.stdout.write(text); // Echo to terminal
    bufferOutput(text);
  });

  // Handle stderr
  claudeProcess.stderr.on('data', (data) => {
    const text = data.toString();
    process.stderr.write(text); // Echo to terminal
  });

  // Handle process exit
  claudeProcess.on('close', (code) => {
    console.log(`[Runner] Claude Code exited with code ${code}`);
    postToChat(`[runner] ${AGENT_ID} process ended (code ${code})`);

    // Respawn after delay
    setTimeout(() => {
      console.log('[Runner] Respawning Claude Code...');
      spawnClaudeCode();
    }, 3000);
  });

  claudeProcess.on('error', (error) => {
    console.error('[Runner] Failed to spawn Claude Code:', error.message);
  });
}

function sendToClaudeCode(author, message) {
  if (!claudeProcess || !claudeProcess.stdin.writable) {
    console.error('[Runner] Claude Code stdin not writable');
    return;
  }

  // Format the message for Claude Code
  // Strip the @mention since we are already routing to this agent
  let cleanMessage = message.replace(new RegExp(`@${AGENT_ID}\\s*`, 'gi'), '').trim();

  // Add context about who sent it
  const input = `[From CLAB chat - ${author}]: ${cleanMessage}\n`;

  console.log(`[Runner] Sending to Claude: ${input.substring(0, 60)}...`);
  claudeProcess.stdin.write(input);
}

// ============ Output Handling ============

function bufferOutput(text) {
  outputBuffer += text;

  // Reset timer on new output
  if (outputTimer) {
    clearTimeout(outputTimer);
  }

  // Wait for output to settle before posting
  outputTimer = setTimeout(() => {
    if (outputBuffer.trim()) {
      processAndPostOutput(outputBuffer);
      outputBuffer = '';
    }
  }, OUTPUT_DEBOUNCE_MS);
}

function processAndPostOutput(rawOutput) {
  // Clean up the output
  let cleaned = rawOutput
    // Remove ANSI escape codes
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    // Remove carriage returns
    .replace(/\r/g, '')
    // Collapse multiple newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!cleaned) return;

  // Don't post if it is just a prompt or very short
  if (cleaned.length < 10) return;

  // Truncate very long outputs
  const MAX_LENGTH = 2000;
  if (cleaned.length > MAX_LENGTH) {
    cleaned = cleaned.substring(0, MAX_LENGTH) + '\n... (truncated)';
  }

  postToChat(cleaned);
}

// Vercel API for web dashboard visibility
const VERCEL_CHAT_URL = 'https://clab.era-auto.co/api/chat';

async function postToChat(message) {
  lastPostedMessage = message;

  // Post to Vercel API (shows in web dashboard)
  try {
    const res = await fetch(VERCEL_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: AGENT_ID,
        authorType: 'agent',
        message: message
      })
    });
    if (!res.ok) {
      console.error('[Runner] Failed to post to Vercel API:', res.status);
    }
  } catch (e) {
    console.error('[Runner] Error posting to Vercel API:', e.message);
  }

  // The Vercel API now bridges to DO, so WebSocket clients will receive it automatically

  console.log(`[Runner] Posted to chat: ${message.substring(0, 60)}...`);
}

// ============ Local Terminal Input ============

function setupLocalInput() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on('line', (line) => {
    // Local terminal input goes directly to Claude Code
    if (claudeProcess && claudeProcess.stdin.writable) {
      claudeProcess.stdin.write(line + '\n');
    }
  });

  rl.on('close', () => {
    console.log('[Runner] Local input closed');
  });
}

// ============ Main ============

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Runner] Shutting down...');
  postToChat(`[runner] ${AGENT_ID} shutting down`);

  if (claudeProcess) {
    claudeProcess.kill();
  }
  if (ws) {
    ws.close();
  }

  setTimeout(() => process.exit(0), 500);
});

process.on('SIGTERM', () => {
  process.emit('SIGINT');
});

// Start everything
connectWebSocket();
spawnClaudeCode();
setupLocalInput();

console.log('[Runner] Started! Web chat messages will be forwarded to Claude Code.');
console.log('[Runner] Local terminal input also works - type directly to interact.\n');
