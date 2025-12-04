import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SHADOWS_KEY = 'agent-coord:shadow-agents';
const AGENTS_KEY = 'agent-coord:agents';
const CHECKPOINTS_KEY = 'agent-coord:checkpoints';

// API base for internal calls
const API_BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

/**
 * Shadow Agent - A VM-based agent that monitors and can take over for a local agent
 */
interface ShadowAgent {
  id: string;                    // Shadow agent ID (e.g., "phil-shadow")
  primaryAgentId: string;        // ID of local agent to shadow (e.g., "phil")
  vmId?: string;                 // VM instance ID if spawned
  status: 'standby' | 'monitoring' | 'taking-over' | 'active';
  lastPrimaryHeartbeat?: string; // Last time primary agent was seen
  staleThresholdMs: number;      // How long before considering primary stale (default: 5min)
  autoTakeover: boolean;         // Whether to auto-takeover on stale
  createdAt: string;
  updatedAt: string;
  tookOverAt?: string;           // When shadow took over
  tookOverReason?: string;       // Why shadow took over
}

/**
 * Shadow Agent API
 *
 * POST /api/shadow-agents?action=register - Register a shadow for a local agent
 * POST /api/shadow-agents?action=heartbeat - Update primary agent heartbeat
 * POST /api/shadow-agents?action=check-stale - Check for stale agents and trigger takeover
 * POST /api/shadow-agents?action=takeover - Manually trigger shadow takeover
 * POST /api/shadow-agents?action=release - Release shadow back to standby
 * GET /api/shadow-agents - List all shadows
 * GET /api/shadow-agents?agentId=X - Get shadow for specific agent
 */

/**
 * Spawn a cloud VM to take over for a stale primary agent
 */
async function spawnShadowVM(
  primaryAgentId: string,
  checkpoint: any,
  reason: string
): Promise<{ success: boolean; vmId?: string; error?: string }> {
  try {
    // Build task description from checkpoint
    let task = `Shadow takeover for ${primaryAgentId}. Reason: ${reason}`;
    if (checkpoint?.state?.currentTask) {
      task += `\n\nResume task: ${checkpoint.state.currentTask}`;
    }
    if (checkpoint?.state?.context) {
      task += `\n\nContext: ${checkpoint.state.context}`;
    }

    // Call cloud-spawn to create the shadow VM
    const response = await fetch(`${API_BASE}/api/cloud-spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task,
        shadowMode: true,
        shadowFor: primaryAgentId,
        stallThresholdMs: 5 * 60 * 1000, // 5 minutes
        spawnedBy: 'shadow-agent-system',
        priority: 'high',
      }),
    });

    const data = await response.json();

    if (data.agent?.agentId) {
      return { success: true, vmId: data.agent.agentId };
    } else {
      return { success: false, error: data.error || 'Failed to spawn VM' };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, agentId } = req.query;

  try {
    // GET - List shadows, get specific shadow, or run check-stale (for Vercel cron)
    if (req.method === 'GET') {
      // Handle check-stale via GET for Vercel cron compatibility
      if (action === 'check-stale') {
        const shadows = await redis.hgetall(SHADOWS_KEY) || {};
        const now = Date.now();
        const results: { agentId: string; status: string; action: string; vmId?: string }[] = [];

        for (const [id, shadowRaw] of Object.entries(shadows)) {
          const shadow: ShadowAgent = typeof shadowRaw === 'string' ? JSON.parse(shadowRaw) : shadowRaw;

          // Skip if already active or not monitoring
          if (shadow.status === 'active') {
            results.push({ agentId: shadow.primaryAgentId, status: 'active', action: 'none' });
            continue;
          }

          // Check if primary is stale
          const lastHeartbeat = shadow.lastPrimaryHeartbeat
            ? new Date(shadow.lastPrimaryHeartbeat).getTime()
            : 0;
          const staleMs = now - lastHeartbeat;

          if (staleMs > shadow.staleThresholdMs && shadow.autoTakeover) {
            // Trigger takeover
            shadow.status = 'taking-over';
            shadow.updatedAt = new Date().toISOString();
            shadow.tookOverAt = new Date().toISOString();
            shadow.tookOverReason = `Primary agent stale for ${(staleMs / 60000).toFixed(1)} minutes`;

            // Get checkpoint to resume
            const checkpointRaw = await redis.hget(CHECKPOINTS_KEY, shadow.primaryAgentId);
            const checkpoint = checkpointRaw
              ? (typeof checkpointRaw === 'string' ? JSON.parse(checkpointRaw) : checkpointRaw)
              : null;

            // Spawn shadow VM to take over
            const spawnResult = await spawnShadowVM(
              shadow.primaryAgentId,
              checkpoint,
              shadow.tookOverReason
            );

            if (spawnResult.success) {
              shadow.status = 'active';
              shadow.vmId = spawnResult.vmId;

              // Post to chat with VM info
              await postToChat(
                `**Shadow VM ACTIVE** for ${shadow.primaryAgentId}\n` +
                `Reason: ${shadow.tookOverReason}\n` +
                `VM: ${spawnResult.vmId}\n` +
                `Checkpoint: ${checkpoint ? 'Injected' : 'None'}`
              );

              results.push({
                agentId: shadow.primaryAgentId,
                status: 'stale',
                action: 'vm-spawned',
                vmId: spawnResult.vmId,
              });
            } else {
              // VM spawn failed - stay in taking-over state for retry
              await postToChat(
                `**Shadow takeover FAILED** for ${shadow.primaryAgentId}\n` +
                `Reason: ${shadow.tookOverReason}\n` +
                `Error: ${spawnResult.error}\n` +
                `Will retry on next cron run.`
              );

              results.push({
                agentId: shadow.primaryAgentId,
                status: 'stale',
                action: 'spawn-failed',
              });
            }

            await redis.hset(SHADOWS_KEY, { [id]: JSON.stringify(shadow) });
          } else if (staleMs > shadow.staleThresholdMs) {
            results.push({
              agentId: shadow.primaryAgentId,
              status: 'stale',
              action: 'auto-takeover-disabled',
            });
          } else {
            results.push({
              agentId: shadow.primaryAgentId,
              status: 'healthy',
              action: 'none',
            });
          }
        }

        return res.json({ checked: results.length, results, triggeredBy: 'cron' });
      }

      if (agentId) {
        const shadow = await redis.hget(SHADOWS_KEY, `${agentId}-shadow`);
        if (!shadow) {
          return res.json({ shadow: null, message: `No shadow registered for ${agentId}` });
        }
        const parsed = typeof shadow === 'string' ? JSON.parse(shadow) : shadow;
        return res.json({ shadow: parsed });
      }

      // List all shadows
      const shadows = await redis.hgetall(SHADOWS_KEY) || {};
      const shadowList = Object.values(shadows).map((s: any) =>
        typeof s === 'string' ? JSON.parse(s) : s
      );
      return res.json({ shadows: shadowList, count: shadowList.length });
    }

    // POST actions
    if (req.method === 'POST') {
      // Register a new shadow
      if (action === 'register') {
        const { primaryAgentId, staleThresholdMs, autoTakeover } = req.body;

        if (!primaryAgentId) {
          return res.status(400).json({ error: 'primaryAgentId required' });
        }

        const shadowId = `${primaryAgentId}-shadow`;
        const now = new Date().toISOString();

        // Get current primary agent heartbeat
        const primaryAgent = await redis.hget(AGENTS_KEY, primaryAgentId);
        const lastPrimaryHeartbeat = primaryAgent
          ? (typeof primaryAgent === 'string' ? JSON.parse(primaryAgent) : primaryAgent).lastSeen
          : now;

        const shadow: ShadowAgent = {
          id: shadowId,
          primaryAgentId,
          status: 'standby',
          lastPrimaryHeartbeat,
          staleThresholdMs: staleThresholdMs || 5 * 60 * 1000, // Default 5 minutes
          autoTakeover: autoTakeover !== false, // Default true
          createdAt: now,
          updatedAt: now,
        };

        await redis.hset(SHADOWS_KEY, { [shadowId]: JSON.stringify(shadow) });

        // Post to chat
        await postToChat(`Shadow registered for **${primaryAgentId}**. Failover enabled after ${(shadow.staleThresholdMs / 60000).toFixed(1)} min stale.`);

        return res.json({ registered: true, shadow });
      }

      // Update heartbeat for primary agent
      if (action === 'heartbeat') {
        const { primaryAgentId: hbAgentId } = req.body;

        if (!hbAgentId) {
          return res.status(400).json({ error: 'primaryAgentId required' });
        }

        const shadowId = `${hbAgentId}-shadow`;
        const shadowRaw = await redis.hget(SHADOWS_KEY, shadowId);

        if (!shadowRaw) {
          return res.json({ updated: false, message: 'No shadow registered for this agent' });
        }

        const shadow: ShadowAgent = typeof shadowRaw === 'string' ? JSON.parse(shadowRaw) : shadowRaw;
        const now = new Date().toISOString();

        shadow.lastPrimaryHeartbeat = now;
        shadow.updatedAt = now;

        // If shadow was active, return to standby (primary is back)
        if (shadow.status === 'active' || shadow.status === 'taking-over') {
          shadow.status = 'standby';
          await postToChat(`Primary agent **${hbAgentId}** is back online. Shadow returning to standby.`);
        }

        await redis.hset(SHADOWS_KEY, { [shadowId]: JSON.stringify(shadow) });

        return res.json({ updated: true, shadow });
      }

      // Check for stale agents and trigger takeover (POST version)
      if (action === 'check-stale') {
        const shadows = await redis.hgetall(SHADOWS_KEY) || {};
        const now = Date.now();
        const results: { agentId: string; status: string; action: string; vmId?: string }[] = [];

        for (const [id, shadowRaw] of Object.entries(shadows)) {
          const shadow: ShadowAgent = typeof shadowRaw === 'string' ? JSON.parse(shadowRaw) : shadowRaw;

          // Skip if already active or not monitoring
          if (shadow.status === 'active') {
            results.push({ agentId: shadow.primaryAgentId, status: 'active', action: 'none' });
            continue;
          }

          // Check if primary is stale
          const lastHeartbeat = shadow.lastPrimaryHeartbeat
            ? new Date(shadow.lastPrimaryHeartbeat).getTime()
            : 0;
          const staleMs = now - lastHeartbeat;

          if (staleMs > shadow.staleThresholdMs && shadow.autoTakeover) {
            // Trigger takeover
            shadow.status = 'taking-over';
            shadow.updatedAt = new Date().toISOString();
            shadow.tookOverAt = new Date().toISOString();
            shadow.tookOverReason = `Primary agent stale for ${(staleMs / 60000).toFixed(1)} minutes`;

            // Get checkpoint to resume
            const checkpointRaw = await redis.hget(CHECKPOINTS_KEY, shadow.primaryAgentId);
            const checkpoint = checkpointRaw
              ? (typeof checkpointRaw === 'string' ? JSON.parse(checkpointRaw) : checkpointRaw)
              : null;

            // Spawn shadow VM to take over
            const spawnResult = await spawnShadowVM(
              shadow.primaryAgentId,
              checkpoint,
              shadow.tookOverReason
            );

            if (spawnResult.success) {
              shadow.status = 'active';
              shadow.vmId = spawnResult.vmId;

              await postToChat(
                `**Shadow VM ACTIVE** for ${shadow.primaryAgentId}\n` +
                `Reason: ${shadow.tookOverReason}\n` +
                `VM: ${spawnResult.vmId}\n` +
                `Checkpoint: ${checkpoint ? 'Injected' : 'None'}`
              );

              results.push({
                agentId: shadow.primaryAgentId,
                status: 'stale',
                action: 'vm-spawned',
                vmId: spawnResult.vmId,
              });
            } else {
              await postToChat(
                `**Shadow takeover FAILED** for ${shadow.primaryAgentId}\n` +
                `Reason: ${shadow.tookOverReason}\n` +
                `Error: ${spawnResult.error}`
              );

              results.push({
                agentId: shadow.primaryAgentId,
                status: 'stale',
                action: 'spawn-failed',
              });
            }

            await redis.hset(SHADOWS_KEY, { [id]: JSON.stringify(shadow) });
          } else if (staleMs > shadow.staleThresholdMs) {
            results.push({
              agentId: shadow.primaryAgentId,
              status: 'stale',
              action: 'auto-takeover-disabled',
            });
          } else {
            results.push({
              agentId: shadow.primaryAgentId,
              status: 'healthy',
              action: 'none',
            });
          }
        }

        return res.json({ checked: results.length, results });
      }

      // Manual takeover
      if (action === 'takeover') {
        const { primaryAgentId: toAgentId, reason } = req.body;

        if (!toAgentId) {
          return res.status(400).json({ error: 'primaryAgentId required' });
        }

        const shadowId = `${toAgentId}-shadow`;
        const shadowRaw = await redis.hget(SHADOWS_KEY, shadowId);

        if (!shadowRaw) {
          return res.status(404).json({ error: 'No shadow registered for this agent' });
        }

        const shadow: ShadowAgent = typeof shadowRaw === 'string' ? JSON.parse(shadowRaw) : shadowRaw;
        const now = new Date().toISOString();

        shadow.status = 'active';
        shadow.updatedAt = now;
        shadow.tookOverAt = now;
        shadow.tookOverReason = reason || 'Manual takeover';

        await redis.hset(SHADOWS_KEY, { [shadowId]: JSON.stringify(shadow) });

        // Get checkpoint
        const checkpoint = await redis.hget(CHECKPOINTS_KEY, toAgentId);

        await postToChat(
          `**Shadow ACTIVE** for ${toAgentId}\n` +
          `Reason: ${shadow.tookOverReason}\n` +
          `Shadow ID: ${shadowId}`
        );

        return res.json({
          takeover: true,
          shadow,
          checkpoint: checkpoint ? (typeof checkpoint === 'string' ? JSON.parse(checkpoint) : checkpoint) : null,
        });
      }

      // Release shadow back to standby
      if (action === 'release') {
        const { primaryAgentId: relAgentId } = req.body;

        if (!relAgentId) {
          return res.status(400).json({ error: 'primaryAgentId required' });
        }

        const shadowId = `${relAgentId}-shadow`;
        const shadowRaw = await redis.hget(SHADOWS_KEY, shadowId);

        if (!shadowRaw) {
          return res.status(404).json({ error: 'No shadow registered for this agent' });
        }

        const shadow: ShadowAgent = typeof shadowRaw === 'string' ? JSON.parse(shadowRaw) : shadowRaw;
        const now = new Date().toISOString();

        shadow.status = 'standby';
        shadow.updatedAt = now;
        shadow.lastPrimaryHeartbeat = now;

        await redis.hset(SHADOWS_KEY, { [shadowId]: JSON.stringify(shadow) });

        await postToChat(`Shadow for **${relAgentId}** released back to standby.`);

        return res.json({ released: true, shadow });
      }
    }

    // DELETE - Remove shadow registration
    if (req.method === 'DELETE') {
      const { agentId: delAgentId } = req.query;

      if (!delAgentId) {
        return res.status(400).json({ error: 'agentId required' });
      }

      const shadowId = `${delAgentId}-shadow`;
      await redis.hdel(SHADOWS_KEY, shadowId);

      return res.json({ deleted: true, shadowId });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (error) {
    console.error('Shadow agents API error:', error);
    return res.status(500).json({ error: String(error) });
  }
}

// Helper to post to chat
async function postToChat(message: string) {
  const chatMessage = {
    id: `shadow-${Date.now().toString(36)}`,
    author: 'system',
    authorType: 'system',
    message: `[shadow-system] ${message}`,
    timestamp: new Date().toISOString(),
    reactions: [],
  };
  await redis.lpush('agent-coord:group-chat', JSON.stringify(chatMessage));
}
