/**
 * Agent Spawner - Railway Substrate Service
 *
 * A lightweight orchestrator that runs 24/7 on Railway and manages
 * ephemeral Claude CLI worker containers. This service:
 *
 * 1. Monitors group chat for spawn requests
 * 2. Manages soul persistence in Redis
 * 3. Spawns Docker containers with injected credentials
 * 4. Tracks worker lifecycle and cleanup
 *
 * The key insight is separating orchestration (this service) from
 * actual AI work (Claude CLI containers). This service has NO
 * Anthropic API key - it only coordinates.
 *
 * Deploy to Railway with Docker support enabled.
 */

import { Redis } from '@upstash/redis';

// Configuration
const CONFIG = {
  COORD_API: process.env.COORD_API || 'https://agent-coord-mcp.vercel.app',
  AGENT_ID: 'spawner',
  POLL_INTERVAL: parseInt(process.env.POLL_INTERVAL || '5000'),

  // Redis for soul storage
  REDIS_URL: process.env.UPSTASH_REDIS_REST_URL || '',
  REDIS_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || '',

  // Docker/Railway settings
  WORKER_IMAGE: process.env.WORKER_IMAGE || 'ghcr.io/piston-labs/claude-worker:latest',
  MAX_WORKERS: parseInt(process.env.MAX_WORKERS || '5'),

  // Credentials to inject into workers (stored in Railway secrets)
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  GITHUB_ORG: process.env.GITHUB_ORG || 'Piston-Labs',
};

// Initialize Redis for soul storage
let redis: Redis | null = null;
if (CONFIG.REDIS_URL && CONFIG.REDIS_TOKEN) {
  redis = new Redis({
    url: CONFIG.REDIS_URL,
    token: CONFIG.REDIS_TOKEN,
  });
}

// Track active workers
interface Worker {
  id: string;
  soulId: string;
  repo: string;
  task: string;
  startedAt: string;
  containerId?: string;
  status: 'starting' | 'running' | 'completed' | 'failed';
}

const activeWorkers = new Map<string, Worker>();

// Soul system
interface Soul {
  id: string;
  name: string;
  personality: string;
  systemPrompt: string;
  capabilities: string[];
  memory: string[];
  createdAt: string;
  updatedAt: string;
}

const SOULS_KEY = 'agent-coord:souls';

// Default souls that come pre-loaded
const DEFAULT_SOULS: Soul[] = [
  {
    id: 'phoenix',
    name: 'Phoenix',
    personality: 'Frontend specialist with a passion for clean UI/UX',
    systemPrompt: `You are Phoenix, a frontend development specialist.

## Your Expertise
- React, Next.js, TypeScript
- CSS, Tailwind, styled-components
- Accessibility and responsive design
- Performance optimization

## Your Style
- You write clean, readable code
- You care deeply about user experience
- You test your work thoroughly
- You explain your design decisions

## Guidelines
- Always consider mobile-first design
- Use semantic HTML
- Follow React best practices
- Write meaningful commit messages`,
    capabilities: ['react', 'nextjs', 'typescript', 'css', 'accessibility'],
    memory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'echo',
    name: 'Echo',
    personality: 'Backend architect focused on scalability and reliability',
    systemPrompt: `You are Echo, a backend systems architect.

## Your Expertise
- Node.js, TypeScript, Python
- AWS, serverless, microservices
- Databases (PostgreSQL, Redis, DynamoDB)
- API design and security

## Your Style
- You think about edge cases
- You prioritize reliability over speed
- You document your architecture decisions
- You write comprehensive tests

## Guidelines
- Always validate inputs
- Handle errors gracefully
- Consider rate limiting and caching
- Use TypeScript for type safety`,
    capabilities: ['nodejs', 'aws', 'databases', 'api-design', 'security'],
    memory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'spark',
    name: 'Spark',
    personality: 'DevOps engineer who loves automation',
    systemPrompt: `You are Spark, a DevOps and infrastructure specialist.

## Your Expertise
- Docker, Kubernetes, Railway
- CI/CD pipelines (GitHub Actions)
- Monitoring and observability
- Infrastructure as Code

## Your Style
- You automate everything
- You think about failure modes
- You document runbooks
- You optimize for developer experience

## Guidelines
- Never store secrets in code
- Always have rollback plans
- Monitor before you need to
- Keep deployments reproducible`,
    capabilities: ['docker', 'kubernetes', 'cicd', 'monitoring', 'iac'],
    memory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// Initialize default souls in Redis
async function initializeSouls(): Promise<void> {
  if (!redis) {
    console.log('[spawner] Redis not configured, souls will be in-memory only');
    return;
  }

  for (const soul of DEFAULT_SOULS) {
    const existing = await redis.hget(SOULS_KEY, soul.id);
    if (!existing) {
      await redis.hset(SOULS_KEY, { [soul.id]: JSON.stringify(soul) });
      console.log(`[spawner] Initialized soul: ${soul.id}`);
    }
  }
}

// Get a soul by ID
async function getSoul(soulId: string): Promise<Soul | null> {
  if (!redis) {
    return DEFAULT_SOULS.find(s => s.id === soulId) || null;
  }

  const data = await redis.hget(SOULS_KEY, soulId);
  if (!data) return null;
  return typeof data === 'string' ? JSON.parse(data) : data as Soul;
}

// Save soul memory
async function updateSoulMemory(soulId: string, memory: string): Promise<void> {
  if (!redis) return;

  const soul = await getSoul(soulId);
  if (!soul) return;

  soul.memory.push(memory);
  // Keep last 50 memories
  if (soul.memory.length > 50) {
    soul.memory = soul.memory.slice(-50);
  }
  soul.updatedAt = new Date().toISOString();

  await redis.hset(SOULS_KEY, { [soulId]: JSON.stringify(soul) });
}

// Spawn a new worker
async function spawnWorker(
  soulId: string,
  repo: string,
  task: string,
  requestedBy: string
): Promise<string> {
  // Check limits
  if (activeWorkers.size >= CONFIG.MAX_WORKERS) {
    throw new Error(`Max workers (${CONFIG.MAX_WORKERS}) reached. Wait for a worker to complete.`);
  }

  // Validate soul exists
  const soul = await getSoul(soulId);
  if (!soul) {
    throw new Error(`Soul not found: ${soulId}. Available: phoenix, echo, spark`);
  }

  // Generate worker ID
  const workerId = `${soulId}-${Date.now().toString(36)}`;

  // Create worker record
  const worker: Worker = {
    id: workerId,
    soulId,
    repo,
    task,
    startedAt: new Date().toISOString(),
    status: 'starting',
  };
  activeWorkers.set(workerId, worker);

  console.log(`[spawner] Spawning worker: ${workerId}`);
  console.log(`[spawner] Soul: ${soulId}, Repo: ${repo}`);
  console.log(`[spawner] Task: ${task}`);

  // In production, this would use Railway API or Docker SDK to spawn container
  // For now, we'll simulate and document the approach
  try {
    // Build environment variables for the worker
    const workerEnv = {
      ANTHROPIC_API_KEY: CONFIG.ANTHROPIC_API_KEY,
      GITHUB_TOKEN: CONFIG.GITHUB_TOKEN,
      SOUL_ID: soulId,
      AGENT_ID: workerId,
      TARGET_REPO: repo.includes('/') ? repo : `${CONFIG.GITHUB_ORG}/${repo}`,
      TASK: task,
      COORD_API: CONFIG.COORD_API,
    };

    // TODO: Replace with actual Docker/Railway spawn
    // Option 1: Docker SDK
    // const container = await docker.createContainer({
    //   Image: CONFIG.WORKER_IMAGE,
    //   Env: Object.entries(workerEnv).map(([k, v]) => `${k}=${v}`),
    //   HostConfig: { AutoRemove: true }
    // });
    // await container.start();

    // Option 2: Railway CLI
    // await exec(`railway run --service ${workerId} --image ${CONFIG.WORKER_IMAGE}`);

    // Option 3: Railway API
    // await railwayApi.deployService({ ... });

    // For now, announce intention and provide manual instructions
    worker.status = 'running';

    // Post to chat
    await postMessage(`**Worker Spawned: ${workerId}**

| Property | Value |
|----------|-------|
| Soul | ${soul.name} (${soulId}) |
| Repo | ${repo} |
| Task | ${task} |
| Requested By | @${requestedBy} |

**To run locally (while Railway integration is being built):**
\`\`\`bash
docker build -f Dockerfile.claude-worker -t claude-worker .
docker run -it \\
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \\
  -e GITHUB_TOKEN="$GITHUB_TOKEN" \\
  -e SOUL_ID="${soulId}" \\
  -e AGENT_ID="${workerId}" \\
  -e TARGET_REPO="${workerEnv.TARGET_REPO}" \\
  -e TASK="${task}" \\
  -e COORD_API="${CONFIG.COORD_API}" \\
  claude-worker
\`\`\`

_Full Railway integration coming soon!_`);

    return workerId;
  } catch (err) {
    worker.status = 'failed';
    throw err;
  }
}

// Parse spawn commands from chat
interface SpawnCommand {
  soulId: string;
  repo: string;
  task: string;
  requestedBy: string;
}

function parseSpawnCommand(message: string, author: string): SpawnCommand | null {
  // Match: /spawn <soul> <repo> "<task>"
  // Or: @spawner spawn <soul> <repo> "<task>"
  const patterns = [
    /^\/spawn\s+(\w+)\s+([\w\-\/]+)\s+["'](.+?)["']$/i,
    /^@spawner\s+spawn\s+(\w+)\s+([\w\-\/]+)\s+["'](.+?)["']$/i,
    /^spawn\s+(\w+)\s+(?:on\s+)?([\w\-\/]+)\s+(?:to\s+)?["'](.+?)["']$/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return {
        soulId: match[1].toLowerCase(),
        repo: match[2],
        task: match[3],
        requestedBy: author,
      };
    }
  }

  return null;
}

// Chat integration
interface ChatMessage {
  id: string;
  author: string;
  authorType: 'agent' | 'human';
  message: string;
  timestamp: string;
}

let lastProcessedTimestamp: string | null = null;
const processedMessageIds = new Set<string>();

async function getNewMessages(): Promise<ChatMessage[]> {
  try {
    const url = lastProcessedTimestamp
      ? `${CONFIG.COORD_API}/api/chat?since=${encodeURIComponent(lastProcessedTimestamp)}`
      : `${CONFIG.COORD_API}/api/chat?limit=10`;

    const res = await fetch(url);
    const data = await res.json();
    return (data.messages || []).filter((m: ChatMessage) => m.author !== CONFIG.AGENT_ID);
  } catch (err) {
    console.error('[spawner] Failed to fetch messages:', err);
    return [];
  }
}

async function postMessage(message: string): Promise<void> {
  try {
    await fetch(`${CONFIG.COORD_API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: CONFIG.AGENT_ID, authorType: 'agent', message }),
    });
  } catch (err) {
    console.error('[spawner] Failed to post message:', err);
  }
}

async function updateStatus(task: string): Promise<void> {
  try {
    await fetch(`${CONFIG.COORD_API}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: CONFIG.AGENT_ID,
        name: 'Spawner',
        status: 'active',
        currentTask: task,
        role: 'orchestrator',
      }),
    });
  } catch (err) {
    console.error('[spawner] Failed to update status:', err);
  }
}

// Main loop
async function main(): Promise<void> {
  console.log('[spawner] Agent Spawner starting...');
  console.log(`[spawner] Coordination API: ${CONFIG.COORD_API}`);
  console.log(`[spawner] Max workers: ${CONFIG.MAX_WORKERS}`);
  console.log(`[spawner] Redis: ${redis ? 'connected' : 'not configured'}`);

  // Initialize souls
  await initializeSouls();

  // Announce presence
  await updateStatus('Online - ready to spawn workers');
  await postMessage(`**Spawner Online**

Ready to spawn Claude CLI workers with persistent souls.

**Commands:**
- \`/spawn <soul> <repo> "<task>"\` - Spawn a worker
- \`/souls\` - List available souls
- \`/workers\` - Show active workers

**Available Souls:** phoenix (frontend), echo (backend), spark (devops)

Example: \`/spawn phoenix agent-coord-mcp "fix the TypeScript errors"\``);

  // Main loop
  while (true) {
    try {
      await updateStatus(`Monitoring (${activeWorkers.size}/${CONFIG.MAX_WORKERS} workers)`);

      const messages = await getNewMessages();

      for (const msg of messages) {
        if (processedMessageIds.has(msg.id)) continue;
        processedMessageIds.add(msg.id);
        lastProcessedTimestamp = msg.timestamp;

        // Handle spawn command
        const spawnCmd = parseSpawnCommand(msg.message, msg.author);
        if (spawnCmd) {
          console.log(`[spawner] Spawn request from ${msg.author}: ${JSON.stringify(spawnCmd)}`);
          try {
            await spawnWorker(spawnCmd.soulId, spawnCmd.repo, spawnCmd.task, spawnCmd.requestedBy);
          } catch (err) {
            await postMessage(`**Spawn Failed**\n\n${err}`);
          }
          continue;
        }

        // Handle /souls command
        if (msg.message.toLowerCase().trim() === '/souls') {
          const souls = DEFAULT_SOULS.map(s => `- **${s.name}** (\`${s.id}\`) - ${s.personality}`).join('\n');
          await postMessage(`**Available Souls**\n\n${souls}`);
          continue;
        }

        // Handle /workers command
        if (msg.message.toLowerCase().trim() === '/workers') {
          if (activeWorkers.size === 0) {
            await postMessage('No active workers.');
          } else {
            const workers = Array.from(activeWorkers.values())
              .map(w => `- **${w.id}** (${w.status}) - ${w.task.slice(0, 50)}...`)
              .join('\n');
            await postMessage(`**Active Workers (${activeWorkers.size}/${CONFIG.MAX_WORKERS})**\n\n${workers}`);
          }
          continue;
        }
      }

      // Cleanup old message IDs
      if (processedMessageIds.size > 200) {
        const toDelete = Array.from(processedMessageIds).slice(0, 100);
        toDelete.forEach(id => processedMessageIds.delete(id));
      }
    } catch (err) {
      console.error('[spawner] Loop error:', err);
    }

    await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL));
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[spawner] Shutting down...');
  await postMessage('**Spawner going offline.** Active workers may continue running.');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[spawner] Shutting down...');
  await postMessage('**Spawner going offline.** Active workers may continue running.');
  process.exit(0);
});

// Start
main().catch(err => {
  console.error('[spawner] Fatal error:', err);
  process.exit(1);
});
