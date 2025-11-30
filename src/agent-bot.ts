/**
 * Autonomous Agent Bot
 *
 * Polls the group chat and responds to messages using Claude API.
 * This runs as a standalone service that enables true autonomous agent behavior.
 */

import Anthropic from '@anthropic-ai/sdk';

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const AGENT_ID = process.env.AGENT_ID || 'claude-code';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '3000'); // 3 seconds

// Initialize Anthropic client
const anthropic = new Anthropic();

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
let conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];

async function updateAgentStatus(task: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/agents/${AGENT_ID}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'active',
        currentTask: task,
        workingOn: 'group-chat',
        roles: ['coder', 'autonomous-bot']
      })
    });
  } catch (err) {
    console.error('[agent-bot] Failed to update status:', err);
  }
}

async function getNewMessages(): Promise<ChatMessage[]> {
  try {
    const url = lastProcessedTimestamp
      ? `${API_BASE}/api/chat?since=${encodeURIComponent(lastProcessedTimestamp)}`
      : `${API_BASE}/api/chat?limit=5`;

    const res = await fetch(url);
    const data: ChatResponse = await res.json();

    // Filter out our own messages
    return data.messages.filter(m => m.author !== AGENT_ID);
  } catch (err) {
    console.error('[agent-bot] Failed to fetch messages:', err);
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
    console.log(`[agent-bot] Posted: ${message.substring(0, 50)}...`);
  } catch (err) {
    console.error('[agent-bot] Failed to post message:', err);
  }
}

async function generateResponse(newMessages: ChatMessage[]): Promise<string | null> {
  // Build context from new messages
  const context = newMessages.map(m => `${m.author}: ${m.message}`).join('\n');

  // Add to conversation history
  conversationHistory.push({
    role: 'user',
    content: context
  });

  // Keep history manageable (last 20 exchanges)
  if (conversationHistory.length > 40) {
    conversationHistory = conversationHistory.slice(-40);
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: `You are ${AGENT_ID}, an AI agent participating in a multi-agent collaboration system.
You are in a group chat with other agents and humans (Tyler).
Keep responses concise and helpful. You can:
- Answer questions about the codebase
- Coordinate with other agents
- Acknowledge tasks and provide status updates
- Ask clarifying questions when needed

Current project: agent-coord-mcp (multi-agent coordination system)
Your role: Coder, working on TypeScript/Node.js

Important: Keep responses SHORT (1-3 sentences). Be direct and actionable.
If someone asks you to do a coding task, acknowledge it and say you'll work on it.`,
      messages: conversationHistory
    });

    const assistantMessage = response.content[0].type === 'text'
      ? response.content[0].text
      : null;

    if (assistantMessage) {
      conversationHistory.push({
        role: 'assistant',
        content: assistantMessage
      });
    }

    return assistantMessage;
  } catch (err) {
    console.error('[agent-bot] Failed to generate response:', err);
    return null;
  }
}

async function shouldRespond(messages: ChatMessage[]): Promise<boolean> {
  // Respond if:
  // 1. A human sent a message
  // 2. We were @mentioned
  // 3. It's a direct question or task assignment

  for (const msg of messages) {
    if (msg.authorType === 'human') return true;
    if (msg.message.toLowerCase().includes(`@${AGENT_ID.toLowerCase()}`)) return true;
    if (msg.message.includes('@claude-code')) return true;
  }

  return false;
}

async function pollLoop(): Promise<void> {
  console.log(`[agent-bot] Starting autonomous bot for ${AGENT_ID}`);
  console.log(`[agent-bot] Polling ${API_BASE} every ${POLL_INTERVAL}ms`);

  await updateAgentStatus('Starting up...');
  await postMessage(`${AGENT_ID} autonomous bot is now online and listening!`);

  while (true) {
    try {
      await updateAgentStatus('Monitoring group chat');

      const newMessages = await getNewMessages();

      if (newMessages.length > 0) {
        console.log(`[agent-bot] Found ${newMessages.length} new message(s)`);

        // Update timestamp to latest message
        lastProcessedTimestamp = newMessages[newMessages.length - 1].timestamp;

        // Check if we should respond
        if (await shouldRespond(newMessages)) {
          await updateAgentStatus('Generating response...');

          const response = await generateResponse(newMessages);

          if (response) {
            await postMessage(response);
          }
        }
      }
    } catch (err) {
      console.error('[agent-bot] Poll error:', err);
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('[agent-bot] Shutting down...');
  await postMessage(`${AGENT_ID} bot going offline.`);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[agent-bot] Shutting down...');
  await postMessage(`${AGENT_ID} bot going offline.`);
  process.exit(0);
});

// Start the bot
pollLoop().catch(err => {
  console.error('[agent-bot] Fatal error:', err);
  process.exit(1);
});
