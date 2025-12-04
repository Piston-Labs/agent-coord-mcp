/**
 * Worker Init - Helper module for Claude CLI Docker workers
 *
 * This module provides utilities for Docker workers to:
 * - Load soul data and inject into Claude CLI
 * - Report status to coordination hub
 * - Save checkpoints before exit
 * - Handle graceful shutdown
 *
 * Used by: docker/worker-entrypoint.sh
 * Build: npm run build (outputs to dist/worker-init.js)
 */

interface Soul {
  id: string;
  name: string;
  personality: string;
  systemPrompt: string;
  capabilities: string[];
  memory: string[];
}

interface Checkpoint {
  conversationSummary?: string;
  accomplishments: string[];
  pendingWork: string[];
  recentContext?: string;
  filesEdited: string[];
}

interface WorkerConfig {
  agentId: string;
  soulId: string;
  targetRepo: string;
  task: string;
  coordApi: string;
}

// Load config from environment
function getConfig(): WorkerConfig {
  return {
    agentId: process.env.AGENT_ID || 'worker',
    soulId: process.env.SOUL_ID || 'default',
    targetRepo: process.env.TARGET_REPO || '',
    task: process.env.TASK || '',
    coordApi: process.env.COORD_API || 'https://agent-coord-mcp.vercel.app',
  };
}

// Fetch soul from coordination hub
async function loadSoul(config: WorkerConfig): Promise<Soul | null> {
  try {
    const res = await fetch(`${config.coordApi}/api/souls/${config.soulId}`);
    if (!res.ok) {
      console.error(`[worker-init] Failed to load soul: ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('[worker-init] Error loading soul:', err);
    return null;
  }
}

// Post message to group chat
async function postToChat(config: WorkerConfig, message: string): Promise<void> {
  try {
    await fetch(`${config.coordApi}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: config.agentId,
        authorType: 'agent',
        message,
      }),
    });
  } catch (err) {
    console.error('[worker-init] Failed to post to chat:', err);
  }
}

// Update agent status
async function updateStatus(config: WorkerConfig, status: string, task: string): Promise<void> {
  try {
    await fetch(`${config.coordApi}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: config.agentId,
        name: config.soulId,
        status,
        currentTask: task,
        role: 'worker',
      }),
    });
  } catch (err) {
    console.error('[worker-init] Failed to update status:', err);
  }
}

// Save checkpoint before exit
async function saveCheckpoint(config: WorkerConfig, checkpoint: Checkpoint): Promise<void> {
  try {
    await fetch(`${config.coordApi}/api/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: config.agentId,
        state: checkpoint,
      }),
    });
    console.log('[worker-init] Checkpoint saved');
  } catch (err) {
    console.error('[worker-init] Failed to save checkpoint:', err);
  }
}

// Load previous checkpoint
async function loadCheckpoint(config: WorkerConfig): Promise<Checkpoint | null> {
  try {
    const res = await fetch(`${config.coordApi}/api/checkpoint?agentId=${config.agentId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.state || null;
  } catch (err) {
    console.error('[worker-init] Failed to load checkpoint:', err);
    return null;
  }
}

// Create handoff for next worker
async function createHandoff(
  config: WorkerConfig,
  title: string,
  context: string,
  nextSteps: string[],
  filePath?: string,
  code?: string
): Promise<string | null> {
  try {
    const res = await fetch(`${config.coordApi}/api/handoffs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        fromAgent: config.agentId,
        title,
        context,
        nextSteps,
        filePath,
        code,
        priority: 'medium',
      }),
    });
    const data = await res.json();
    return data.handoffId || null;
  } catch (err) {
    console.error('[worker-init] Failed to create handoff:', err);
    return null;
  }
}

// Main initialization
async function init(): Promise<void> {
  const config = getConfig();

  console.log('[worker-init] Starting worker initialization...');
  console.log(`[worker-init] Agent ID: ${config.agentId}`);
  console.log(`[worker-init] Soul ID: ${config.soulId}`);
  console.log(`[worker-init] Target Repo: ${config.targetRepo}`);
  console.log(`[worker-init] Task: ${config.task}`);

  // Load soul
  const soul = await loadSoul(config);
  if (soul) {
    console.log(`[worker-init] Loaded soul: ${soul.name}`);
    // Output soul prompt for entrypoint to capture
    console.log('---SOUL_PROMPT_START---');
    console.log(soul.systemPrompt);
    console.log('---SOUL_PROMPT_END---');
  }

  // Load previous checkpoint if exists
  const checkpoint = await loadCheckpoint(config);
  if (checkpoint) {
    console.log('[worker-init] Found previous checkpoint');
    console.log('---CHECKPOINT_START---');
    console.log(JSON.stringify(checkpoint, null, 2));
    console.log('---CHECKPOINT_END---');
  }

  // Update status to active
  await updateStatus(config, 'active', config.task);

  // Announce presence
  await postToChat(config, `**Worker Online: ${config.agentId}**

| Property | Value |
|----------|-------|
| Soul | ${config.soulId} |
| Repo | ${config.targetRepo || 'none'} |
| Task | ${config.task || 'awaiting instructions'} |

Ready to work!`);

  console.log('[worker-init] Initialization complete');
}

// Graceful shutdown handler
async function shutdown(signal: string): Promise<void> {
  const config = getConfig();
  console.log(`[worker-init] Received ${signal}, shutting down...`);

  await updateStatus(config, 'idle', 'Shutting down');
  await postToChat(config, `**Worker Offline: ${config.agentId}**\n\nShutdown signal: ${signal}`);

  process.exit(0);
}

// Export for use as module
export {
  getConfig,
  loadSoul,
  postToChat,
  updateStatus,
  saveCheckpoint,
  loadCheckpoint,
  createHandoff,
  init,
  shutdown,
  WorkerConfig,
  Soul,
  Checkpoint,
};

// Run init if called directly
if (require.main === module || process.argv[1]?.endsWith('worker-init.js')) {
  // Handle signals
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  init().catch(err => {
    console.error('[worker-init] Fatal error:', err);
    process.exit(1);
  });
}
