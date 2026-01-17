#!/usr/bin/env node
/**
 * CLAB Autonomous Agent Daemon
 *
 * A stateful, self-directed agent that:
 * - Maintains a persistent goal queue (stored in Durable Objects)
 * - Works through goals autonomously without human prompting
 * - Learns from outcomes (memory API)
 * - Earns XP for completed tasks (soul progression)
 * - Responds to chat commands for goal assignment
 * - Checkpoints state every 15 minutes
 *
 * Usage:
 *   node autonomous-daemon.js --agent=phil
 *   node autonomous-daemon.js --agent=phil --auto-work
 */

const WebSocket = require('ws');
const { spawn } = require('child_process');
const readline = require('readline');

// Configuration
// Cloudflare DO endpoints
const CLAB_BASE = 'https://agent-coord-do.elidecloud.workers.dev';
const CLAB_WS = 'wss://agent-coord-do.elidecloud.workers.dev';
const CHECKPOINT_INTERVAL = 15 * 60 * 1000; // 15 minutes
const WORK_CHECK_INTERVAL = 30 * 1000; // 30 seconds

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  acc[key] = value || true;
  return acc;
}, {});

const AGENT_ID = args.agent || process.env.CLAB_AGENT_ID || 'autonomous';
const AUTO_WORK = args['auto-work'] || false;

console.log(`
╔══════════════════════════════════════════════════════════════╗
║              CLAB Autonomous Agent Daemon                     ║
╠══════════════════════════════════════════════════════════════╣
║  Agent ID:  ${AGENT_ID.padEnd(48)}║
║  Auto-work: ${String(AUTO_WORK).padEnd(48)}║
║  API:       ${CLAB_BASE.padEnd(48)}║
╚══════════════════════════════════════════════════════════════╝
`);

// State
let ws = null;
let currentGoal = null;
let claudeProcess = null;
let isWorking = false;
let soul = null;
let goalStats = null;

// ========== API Helpers ==========

async function api(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${CLAB_BASE}${endpoint}`, options);
  return res.json();
}

async function agentApi(endpoint, method = 'GET', body = null) {
  return api(`/agent/${AGENT_ID}${endpoint}`, method, body);
}

// ========== Goals Management ==========

async function loadGoals() {
  const result = await agentApi('/goals?action=list');
  return result.goals || [];
}

async function getNextGoal() {
  const result = await agentApi('/goals?action=next');
  return result.goal;
}

async function getActiveGoal() {
  const result = await agentApi('/goals?action=active');
  return result.goal;
}

async function getGoalStats() {
  const result = await agentApi('/goals?action=stats');
  return result.stats;
}

async function createGoal(title, description = null, priority = 5, xpReward = 10, assignedBy = null) {
  const result = await agentApi('/goals?action=create', 'POST', {
    title,
    description,
    priority,
    xpReward,
    assignedBy,
    source: assignedBy ? 'assigned' : 'self'
  });
  return result.goal;
}

async function startGoal(goalId) {
  const result = await agentApi('/goals?action=start', 'POST', { id: goalId });
  return result.goal;
}

async function completeGoal(goalId, outcome = 'completed') {
  const result = await agentApi('/goals?action=complete', 'POST', { id: goalId, outcome });
  return result;
}

async function failGoal(goalId, outcome = 'failed') {
  const result = await agentApi('/goals?action=fail', 'POST', { id: goalId, outcome });
  return result.goal;
}

// ========== Soul & Memory ==========

async function loadSoul() {
  const result = await agentApi('/soul');
  return result.soul;
}

async function checkpoint(summary, pendingWork = []) {
  const result = await agentApi('/checkpoint', 'POST', {
    conversationSummary: summary,
    pendingWork,
    recentContext: `Autonomous daemon running. Current goal: ${currentGoal?.title || 'none'}`
  });
  console.log(`[Checkpoint] Saved at ${new Date().toISOString()}`);
  return result;
}

async function storeMemory(category, content, tags = []) {
  const result = await agentApi('/memory', 'POST', { category, content, tags });
  return result;
}

// ========== Chat Integration ==========

async function postToChat(message) {
  const result = await api('/coordinator/chat', 'POST', {
    author: AGENT_ID,
    message
  });
  return result;
}

function connectWebSocket() {
  const wsUrl = `${CLAB_WS}/coordinator?agentId=${AGENT_ID}`;
  console.log(`[WS] Connecting to ${wsUrl}...`);

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('[WS] Connected!');
    postToChat(`**${AGENT_ID} autonomous daemon online** - Ready for goals. Commands: \`@${AGENT_ID} goal: <task>\`, \`@${AGENT_ID} status\`, \`@${AGENT_ID} work\``);
  });

  ws.on('message', async (data) => {
    try {
      const event = JSON.parse(data.toString());

      if (event.type === 'chat') {
        const msg = event.payload;
        if (msg.author !== AGENT_ID) {
          await handleChatMessage(msg);
        }
      }
    } catch (e) {
      console.error('[WS] Parse error:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Disconnected. Reconnecting in 5s...');
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (error) => {
    console.error('[WS] Error:', error.message);
  });

  // Keepalive ping
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);
}

// ========== Chat Command Parser ==========

async function handleChatMessage(msg) {
  const content = msg.message || '';
  const author = msg.author || '';

  // Check for @mention
  if (!content.includes(`@${AGENT_ID}`) && !content.includes('@all')) {
    return; // Not for us
  }

  console.log(`[Chat] ${author}: ${content.substring(0, 100)}...`);

  // Parse commands
  const lowerContent = content.toLowerCase();

  // Goal assignment: "@agent goal: do something"
  const goalMatch = content.match(/@\w+\s+goal:\s*(.+)/i);
  if (goalMatch) {
    const goalTitle = goalMatch[1].trim();
    const goal = await createGoal(goalTitle, null, 5, 15, author);
    await postToChat(`**Goal queued!** "${goal.title}" (priority ${goal.priority}, ${goal.xpReward} XP) - ID: \`${goal.id}\``);
    return;
  }

  // High priority goal: "@agent urgent: do something"
  const urgentMatch = content.match(/@\w+\s+urgent:\s*(.+)/i);
  if (urgentMatch) {
    const goalTitle = urgentMatch[1].trim();
    const goal = await createGoal(goalTitle, null, 10, 25, author);
    await postToChat(`**URGENT goal queued!** "${goal.title}" (priority 10, 25 XP) - ID: \`${goal.id}\``);
    return;
  }

  // Status check: "@agent status"
  if (lowerContent.includes('status')) {
    const stats = await getGoalStats();
    const active = await getActiveGoal();
    const soulData = await loadSoul();

    let statusMsg = `**${AGENT_ID} Status**\n\n`;
    statusMsg += `| Metric | Value |\n|--------|-------|\n`;
    statusMsg += `| Level | ${soulData?.level || 'unknown'} |\n`;
    statusMsg += `| XP | ${soulData?.totalXp || 0} |\n`;
    statusMsg += `| Goals pending | ${stats?.pending || 0} |\n`;
    statusMsg += `| Goals completed | ${stats?.completed || 0} |\n`;
    statusMsg += `| Working on | ${active?.title || 'nothing'} |\n`;

    await postToChat(statusMsg);
    return;
  }

  // Start working: "@agent work"
  if (lowerContent.includes('work') || lowerContent.includes('start')) {
    if (isWorking) {
      await postToChat(`Already working on: "${currentGoal?.title}"`);
    } else {
      await startWorkLoop();
    }
    return;
  }

  // List goals: "@agent goals"
  if (lowerContent.includes('goals') || lowerContent.includes('queue')) {
    const goals = await loadGoals();
    const pending = goals.filter(g => g.status === 'pending').slice(0, 5);

    if (pending.length === 0) {
      await postToChat('**Goal queue is empty.** Assign me work with `@' + AGENT_ID + ' goal: <task>`');
    } else {
      let msg = `**Goal Queue** (${pending.length} pending)\n\n`;
      pending.forEach((g, i) => {
        msg += `${i + 1}. [P${g.priority}] ${g.title} (${g.xpReward} XP)\n`;
      });
      await postToChat(msg);
    }
    return;
  }

  // Stop working: "@agent stop"
  if (lowerContent.includes('stop') || lowerContent.includes('pause')) {
    isWorking = false;
    await postToChat(`Stopping work loop. Current goal "${currentGoal?.title}" will be paused.`);
    return;
  }

  // Help: "@agent help"
  if (lowerContent.includes('help')) {
    const helpMsg = `**${AGENT_ID} Commands**

| Command | Description |
|---------|-------------|
| \`@${AGENT_ID} goal: <task>\` | Add task to goal queue |
| \`@${AGENT_ID} urgent: <task>\` | Add high-priority goal |
| \`@${AGENT_ID} status\` | Show agent status |
| \`@${AGENT_ID} goals\` | List pending goals |
| \`@${AGENT_ID} work\` | Start working on goals |
| \`@${AGENT_ID} stop\` | Pause work loop |
`;
    await postToChat(helpMsg);
    return;
  }

  // Generic response
  await postToChat(`I heard you, ${author}! Use \`@${AGENT_ID} help\` for commands.`);
}

// ========== Autonomous Work Loop ==========

async function startWorkLoop() {
  if (isWorking) {
    console.log('[Work] Already in work loop');
    return;
  }

  console.log('[Work] Starting autonomous work loop...');
  isWorking = true;

  while (isWorking) {
    try {
      // Check for active goal first
      currentGoal = await getActiveGoal();

      // If no active goal, get next from queue
      if (!currentGoal) {
        currentGoal = await getNextGoal();
        if (currentGoal) {
          await startGoal(currentGoal.id);
          await postToChat(`**Starting goal:** "${currentGoal.title}" (${currentGoal.xpReward} XP)`);
          console.log(`[Work] Starting: ${currentGoal.title}`);
        }
      }

      if (!currentGoal) {
        console.log('[Work] No goals in queue. Waiting...');
        await sleep(WORK_CHECK_INTERVAL);
        continue;
      }

      // Execute the goal (this is where Claude Code would be invoked)
      const success = await executeGoal(currentGoal);

      if (success) {
        const result = await completeGoal(currentGoal.id, 'Completed successfully');
        await postToChat(`**Goal completed!** "${currentGoal.title}" - Earned ${result.xpAwarded} XP`);
        console.log(`[Work] Completed: ${currentGoal.title} (+${result.xpAwarded} XP)`);

        // Store learning
        await storeMemory('learning', `Completed goal: ${currentGoal.title}`, ['goal', 'success']);
      } else {
        await failGoal(currentGoal.id, 'Failed to complete');
        await postToChat(`**Goal failed:** "${currentGoal.title}" - Will retry or escalate`);
        console.log(`[Work] Failed: ${currentGoal.title}`);
      }

      currentGoal = null;

    } catch (error) {
      console.error('[Work] Error in work loop:', error);
      await sleep(5000);
    }
  }

  console.log('[Work] Work loop stopped');
}

async function executeGoal(goal) {
  // This is where the magic happens - invoke Claude Code to work on the goal
  // For now, simulate work with a delay

  console.log(`[Execute] Working on: ${goal.title}`);
  console.log(`[Execute] Description: ${goal.description || 'none'}`);
  console.log(`[Execute] Context: ${goal.context || 'none'}`);

  // In a full implementation, this would:
  // 1. Spawn Claude Code with the goal as a prompt
  // 2. Monitor progress
  // 3. Capture output
  // 4. Determine success/failure

  // For demo, simulate work
  await sleep(5000);

  // Simulate 80% success rate
  return Math.random() > 0.2;
}

// ========== Lifecycle ==========

async function initialize() {
  console.log('[Init] Loading agent state...');

  // Load soul
  soul = await loadSoul();
  if (soul) {
    console.log(`[Init] Soul loaded: ${soul.name} (Level ${soul.level}, ${soul.totalXp} XP)`);
  } else {
    console.log('[Init] No soul found - creating one...');
    // Soul will be created on first XP award
  }

  // Load goal stats
  goalStats = await getGoalStats();
  console.log(`[Init] Goals: ${goalStats.pending} pending, ${goalStats.completed} completed`);

  // Check for active goal (resume from checkpoint)
  currentGoal = await getActiveGoal();
  if (currentGoal) {
    console.log(`[Init] Resuming goal: ${currentGoal.title}`);
  }

  // Connect WebSocket
  connectWebSocket();

  // Start checkpoint timer
  setInterval(async () => {
    const stats = await getGoalStats();
    await checkpoint(
      `Autonomous daemon running. Stats: ${stats.completed} completed, ${stats.pending} pending.`,
      currentGoal ? [currentGoal.title] : []
    );
  }, CHECKPOINT_INTERVAL);

  // Auto-start work if requested
  if (AUTO_WORK) {
    console.log('[Init] Auto-work enabled - starting work loop');
    setTimeout(startWorkLoop, 3000); // Wait for WS connection
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== Main ==========

initialize().catch(err => {
  console.error('[Fatal] Initialization failed:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Shutdown] Saving checkpoint...');
  isWorking = false;
  await checkpoint('Daemon shutdown', currentGoal ? [currentGoal.title] : []);
  await postToChat(`**${AGENT_ID} daemon shutting down** - ${currentGoal ? `Paused on: "${currentGoal.title}"` : 'No active goal'}`);
  process.exit(0);
});

// Export for testing
module.exports = {
  createGoal,
  completeGoal,
  loadGoals,
  startWorkLoop
};
