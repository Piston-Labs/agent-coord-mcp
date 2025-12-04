import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import {
  EC2Client,
  TerminateInstancesCommand,
} from '@aws-sdk/client-ec2';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * System Cleanup API - Remove stale data and maintain system health
 *
 * GET /api/cleanup - Preview what would be cleaned (dry run)
 * POST /api/cleanup - Execute cleanup operations
 * POST /api/cleanup?force=true - Force cleanup without age checks
 *
 * Cleanup operations:
 * - Remove stale agent statuses (inactive > 7 days)
 * - Expire old claims (> 4 hours)
 * - Release stale locks (> 4 hours)
 * - Trim chat history (keep last 500 messages)
 * - Archive completed tasks (> 30 days)
 * - Clean old handoffs (completed > 7 days)
 * - Terminate zombie cloud agents:
 *   - Stuck in "booting"/"provisioning" > 30 minutes
 *   - Errored VMs > 24 hours old
 *   - Terminated records > 24 hours old
 */

interface CleanupResult {
  staleAgents: { removed: string[]; count: number };
  expiredClaims: { removed: string[]; count: number };
  staleLocks: { removed: string[]; count: number };
  trimmedChat: { removed: number; kept: number };
  archivedTasks: { archived: string[]; count: number };
  oldHandoffs: { removed: number };
  zombieCloudAgents: { terminated: string[]; cleaned: string[]; count: number };
  totalCleaned: number;
  duration: string;
}

interface CloudAgent {
  agentId: string;
  instanceId: string;
  status: string;
  spawnedAt: string;
  lastSeen: string | null;
  errorMessage: string | null;
}

// Time thresholds (in milliseconds)
const THRESHOLDS = {
  AGENT_STALE: 7 * 24 * 60 * 60 * 1000,      // 7 days
  CLAIM_EXPIRE: 4 * 60 * 60 * 1000,           // 4 hours
  LOCK_EXPIRE: 4 * 60 * 60 * 1000,            // 4 hours
  TASK_ARCHIVE: 30 * 24 * 60 * 60 * 1000,     // 30 days
  HANDOFF_EXPIRE: 7 * 24 * 60 * 60 * 1000,    // 7 days
  CHAT_MAX_MESSAGES: 500,
  // Cloud agent zombie detection
  VM_BOOT_TIMEOUT: 30 * 60 * 1000,            // 30 minutes - if still "booting" after this, it's a zombie
  VM_ERROR_CLEANUP: 24 * 60 * 60 * 1000,      // 24 hours - clean up errored VMs after this
};

function getEC2Client(region: string = 'us-west-1') {
  return new EC2Client({
    region,
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const isDryRun = req.method === 'GET';
  const force = req.query.force === 'true';

  try {
    const startTime = Date.now();
    const now = Date.now();
    const result: CleanupResult = {
      staleAgents: { removed: [], count: 0 },
      expiredClaims: { removed: [], count: 0 },
      staleLocks: { removed: [], count: 0 },
      trimmedChat: { removed: 0, kept: 0 },
      archivedTasks: { archived: [], count: 0 },
      oldHandoffs: { removed: 0 },
      zombieCloudAgents: { terminated: [], cleaned: [], count: 0 },
      totalCleaned: 0,
      duration: '0ms',
    };

    // 1. Clean stale agents
    const agents = await redis.hgetall('agent-coord:agents') || {};
    const activeAgents = await redis.hgetall('agent-coord:active-agents') || {};

    for (const [agentId, data] of Object.entries({ ...agents, ...activeAgents })) {
      try {
        const agent = typeof data === 'string' ? JSON.parse(data) : data;
        const lastSeen = agent.lastSeen ? new Date(agent.lastSeen).getTime() : 0;
        const isStale = (now - lastSeen) > THRESHOLDS.AGENT_STALE;

        if (isStale || force) {
          result.staleAgents.removed.push(agentId);
          if (!isDryRun) {
            await redis.hdel('agent-coord:agents', agentId);
            await redis.hdel('agent-coord:active-agents', agentId);
          }
        }
      } catch (e) { /* skip invalid entries */ }
    }
    result.staleAgents.count = result.staleAgents.removed.length;

    // 2. Expire old claims
    const claims = await redis.hgetall('agent-coord:claims') || {};

    for (const [claimKey, data] of Object.entries(claims)) {
      try {
        const claim = typeof data === 'string' ? JSON.parse(data) : data;
        const claimedAt = claim.claimedAt ? new Date(claim.claimedAt).getTime() : 0;
        const isExpired = (now - claimedAt) > THRESHOLDS.CLAIM_EXPIRE;

        if (isExpired || force) {
          result.expiredClaims.removed.push(claimKey);
          if (!isDryRun) {
            await redis.hdel('agent-coord:claims', claimKey);
          }
        }
      } catch (e) { /* skip invalid entries */ }
    }
    result.expiredClaims.count = result.expiredClaims.removed.length;

    // 3. Release stale locks
    const locks = await redis.hgetall('agent-coord:locks') || {};

    for (const [lockPath, data] of Object.entries(locks)) {
      try {
        const lock = typeof data === 'string' ? JSON.parse(data) : data;
        const lockedAt = lock.lockedAt ? new Date(lock.lockedAt).getTime() : 0;
        const isStale = (now - lockedAt) > THRESHOLDS.LOCK_EXPIRE;

        if (isStale || force) {
          result.staleLocks.removed.push(lockPath);
          if (!isDryRun) {
            await redis.hdel('agent-coord:locks', lockPath);
          }
        }
      } catch (e) { /* skip invalid entries */ }
    }
    result.staleLocks.count = result.staleLocks.removed.length;

    // 4. Trim chat history
    const chatLength = await redis.llen('agent-coord:group-chat');
    if (chatLength > THRESHOLDS.CHAT_MAX_MESSAGES || force) {
      const toRemove = chatLength - THRESHOLDS.CHAT_MAX_MESSAGES;
      if (toRemove > 0) {
        result.trimmedChat.removed = toRemove;
        result.trimmedChat.kept = THRESHOLDS.CHAT_MAX_MESSAGES;
        if (!isDryRun) {
          // Remove oldest messages (from the end of the list)
          await redis.ltrim('agent-coord:group-chat', 0, THRESHOLDS.CHAT_MAX_MESSAGES - 1);
        }
      }
    } else {
      result.trimmedChat.kept = chatLength;
    }

    // 5. Archive completed tasks
    const tasks = await redis.hgetall('agent-coord:tasks') || {};

    for (const [taskId, data] of Object.entries(tasks)) {
      try {
        const task = typeof data === 'string' ? JSON.parse(data) : data;
        if (task.status === 'done' || task.status === 'completed') {
          const completedAt = task.completedAt || task.updatedAt;
          const completedTime = completedAt ? new Date(completedAt).getTime() : 0;
          const isOld = (now - completedTime) > THRESHOLDS.TASK_ARCHIVE;

          if (isOld || force) {
            result.archivedTasks.archived.push(taskId);
            if (!isDryRun) {
              // Move to archived tasks
              await redis.hset('agent-coord:tasks-archived', { [taskId]: JSON.stringify(task) });
              await redis.hdel('agent-coord:tasks', taskId);
            }
          }
        }
      } catch (e) { /* skip invalid entries */ }
    }
    result.archivedTasks.count = result.archivedTasks.archived.length;

    // 6. Clean old handoffs
    const handoffs = await redis.lrange('agent-coord:handoffs', 0, -1) || [];
    let handoffsToKeep: string[] = [];

    for (const data of handoffs) {
      try {
        const handoff = typeof data === 'string' ? JSON.parse(data) : data;
        const createdAt = handoff.createdAt ? new Date(handoff.createdAt).getTime() : 0;
        const isCompleted = handoff.status === 'completed' || handoff.status === 'accepted';
        const isOld = (now - createdAt) > THRESHOLDS.HANDOFF_EXPIRE;

        if ((isCompleted && isOld) || force) {
          result.oldHandoffs.removed++;
        } else {
          handoffsToKeep.push(typeof data === 'string' ? data : JSON.stringify(data));
        }
      } catch (e) {
        // Keep entries we can't parse
        handoffsToKeep.push(typeof data === 'string' ? data : JSON.stringify(data));
      }
    }

    if (result.oldHandoffs.removed > 0 && !isDryRun) {
      // Replace list with filtered handoffs
      await redis.del('agent-coord:handoffs');
      if (handoffsToKeep.length > 0) {
        await redis.rpush('agent-coord:handoffs', ...handoffsToKeep);
      }
    }

    // 7. Clean zombie cloud agents (stuck in booting or errored)
    const cloudAgents = await redis.hgetall('agent-coord:cloud-agents') || {};

    for (const [agentId, data] of Object.entries(cloudAgents)) {
      try {
        const agent: CloudAgent = typeof data === 'string' ? JSON.parse(data) : data;
        const spawnedAt = agent.spawnedAt ? new Date(agent.spawnedAt).getTime() : 0;
        const age = now - spawnedAt;

        let isZombie = false;
        let reason = '';

        // Zombie condition 1: Stuck in "booting" or "provisioning" for > 30 minutes
        if (['booting', 'provisioning'].includes(agent.status) && age > THRESHOLDS.VM_BOOT_TIMEOUT) {
          isZombie = true;
          reason = `stuck in "${agent.status}" for ${Math.floor(age / 60000)} minutes`;
        }

        // Zombie condition 2: Errored VMs older than 24 hours
        if (agent.status === 'error' && age > THRESHOLDS.VM_ERROR_CLEANUP) {
          isZombie = true;
          reason = `errored ${Math.floor(age / 3600000)} hours ago`;
        }

        // Zombie condition 3: Already terminated but still in Redis (stale record)
        if (agent.status === 'terminated' && age > THRESHOLDS.VM_ERROR_CLEANUP) {
          isZombie = true;
          reason = 'terminated record older than 24h';
        }

        if (isZombie || force) {
          // Try to terminate AWS instance if it has one
          if (agent.instanceId && !['error', 'terminated'].includes(agent.status)) {
            if (!isDryRun) {
              try {
                const ec2 = getEC2Client();
                await ec2.send(new TerminateInstancesCommand({ InstanceIds: [agent.instanceId] }));
                result.zombieCloudAgents.terminated.push(`${agentId} (${agent.instanceId})`);
              } catch (awsErr: any) {
                // Instance may already be gone - that's fine
                if (!awsErr.message?.includes('does not exist')) {
                  console.error(`Failed to terminate ${agentId}:`, awsErr.message);
                }
              }
            } else {
              result.zombieCloudAgents.terminated.push(`${agentId} (${agent.instanceId}) [would terminate]`);
            }
          }

          // Remove from Redis
          result.zombieCloudAgents.cleaned.push(`${agentId}: ${reason}`);
          if (!isDryRun) {
            await redis.hdel('agent-coord:cloud-agents', agentId);
          }
        }
      } catch (e) { /* skip invalid entries */ }
    }
    result.zombieCloudAgents.count = result.zombieCloudAgents.cleaned.length;

    // Calculate totals
    result.totalCleaned =
      result.staleAgents.count +
      result.expiredClaims.count +
      result.staleLocks.count +
      result.trimmedChat.removed +
      result.archivedTasks.count +
      result.oldHandoffs.removed +
      result.zombieCloudAgents.count;

    result.duration = `${Date.now() - startTime}ms`;

    return res.json({
      success: true,
      mode: isDryRun ? 'dry-run' : 'executed',
      forced: force,
      timestamp: new Date().toISOString(),
      thresholds: {
        agentStale: '7 days',
        claimExpire: '4 hours',
        lockExpire: '4 hours',
        taskArchive: '30 days',
        handoffExpire: '7 days',
        chatMaxMessages: THRESHOLDS.CHAT_MAX_MESSAGES,
        vmBootTimeout: '30 minutes',
        vmErrorCleanup: '24 hours',
      },
      result,
    });
  } catch (error) {
    console.error('Cleanup API error:', error);
    return res.status(500).json({
      error: 'Cleanup failed',
      details: String(error)
    });
  }
}
