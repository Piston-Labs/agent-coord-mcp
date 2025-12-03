/**
 * Message Bridge Bot
 *
 * Simple file-based bridge for Claude Code to respond to group chat.
 * Writes pending messages to PENDING_MESSAGES.txt
 * Reads responses from RESPONSE.txt
 *
 * This allows Claude Code to respond without needing a separate API key.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const AGENT_ID = process.env.AGENT_ID || 'claude-code';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '2000'); // 2 seconds
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');

const PENDING_FILE = join(DATA_DIR, 'PENDING_MESSAGES.txt');
const RESPONSE_FILE = join(DATA_DIR, 'RESPONSE.txt');

interface ChatMessage {
  id: string;
  author: string;
  authorType: 'agent' | 'human';
  message: string;
  timestamp: string;
}

interface ChatResponse {
  messages: ChatMessage[];
  count: number;
}

let lastProcessedTimestamp: string | null = null;

async function updateAgentStatus(task: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: AGENT_ID,
        status: 'active',
        currentTask: task,
        workingOn: 'group-chat-bridge',
        role: 'message-bridge'
      })
    });
  } catch (err) {
    console.error('[bridge] Failed to update status:', err);
  }
}

async function getNewMessages(): Promise<ChatMessage[]> {
  try {
    const url = lastProcessedTimestamp
      ? `${API_BASE}/api/chat?since=${encodeURIComponent(lastProcessedTimestamp)}`
      : `${API_BASE}/api/chat?limit=10`;

    const res = await fetch(url);
    const data: ChatResponse = await res.json();

    // Filter out our own messages
    return data.messages.filter(m => m.author !== AGENT_ID);
  } catch (err) {
    console.error('[bridge] Failed to fetch messages:', err);
    return [];
  }
}

async function postMessage(message: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: AGENT_ID,
        authorType: 'agent',
        message
      })
    });
    console.log(`[bridge] Posted response to chat`);
  } catch (err) {
    console.error('[bridge] Failed to post message:', err);
  }
}

function writePendingMessages(messages: ChatMessage[]): void {
  const content = messages.map(m =>
    `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.author}: ${m.message}`
  ).join('\n');

  const header = `=== PENDING MESSAGES (${new Date().toLocaleTimeString()}) ===\n`;
  const footer = `\n\n=== WAITING FOR RESPONSE ===\nWrite your response to: ${RESPONSE_FILE}\n`;

  writeFileSync(PENDING_FILE, header + content + footer);
  console.log(`[bridge] Wrote ${messages.length} pending message(s) to file`);
}

function checkForResponse(): string | null {
  if (!existsSync(RESPONSE_FILE)) return null;

  try {
    const response = readFileSync(RESPONSE_FILE, 'utf-8').trim();
    if (response) {
      // Delete the response file after reading
      unlinkSync(RESPONSE_FILE);
      return response;
    }
  } catch (err) {
    console.error('[bridge] Error reading response file:', err);
  }
  return null;
}

function clearPendingMessages(): void {
  if (existsSync(PENDING_FILE)) {
    unlinkSync(PENDING_FILE);
  }
}

async function pollLoop(): Promise<void> {
  console.log(`[bridge] Starting message bridge for ${AGENT_ID}`);
  console.log(`[bridge] Polling ${API_BASE} every ${POLL_INTERVAL}ms`);
  console.log(`[bridge] Pending file: ${PENDING_FILE}`);
  console.log(`[bridge] Response file: ${RESPONSE_FILE}`);

  await updateAgentStatus('Starting message bridge...');
  await postMessage(`${AGENT_ID} message bridge is now online!`);

  let pendingMessages: ChatMessage[] = [];

  while (true) {
    try {
      await updateAgentStatus(pendingMessages.length > 0
        ? `Waiting for response to ${pendingMessages.length} message(s)`
        : 'Monitoring group chat');

      // Check for response to post
      const response = checkForResponse();
      if (response) {
        await postMessage(response);
        clearPendingMessages();
        pendingMessages = [];
      }

      // Get new messages
      const newMessages = await getNewMessages();

      if (newMessages.length > 0) {
        console.log(`[bridge] Found ${newMessages.length} new message(s)`);

        // Update timestamp to latest message
        lastProcessedTimestamp = newMessages[newMessages.length - 1].timestamp;

        // Add to pending and write to file
        pendingMessages.push(...newMessages);
        writePendingMessages(pendingMessages);
      }
    } catch (err) {
      console.error('[bridge] Poll error:', err);
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('[bridge] Shutting down...');
  await postMessage(`${AGENT_ID} bridge going offline.`);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[bridge] Shutting down...');
  await postMessage(`${AGENT_ID} bridge going offline.`);
  process.exit(0);
});

// Start the bridge
pollLoop().catch(err => {
  console.error('[bridge] Fatal error:', err);
  process.exit(1);
});
