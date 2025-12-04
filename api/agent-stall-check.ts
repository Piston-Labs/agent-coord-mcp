import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const AGENTS_KEY = 'agent-coord:agents';
const CHECKPOINTS_KEY = 'agent-coord:checkpoints';
const SHADOWS_KEY = 'agent-coord:shadows';

// Default stall threshold in milliseconds (5 minutes)
const DEFAULT_STALL_THRESHOLD_MS = 5 * 60 * 1000;

interface AgentStatus {
  id: string;
  status: string;
  lastSeen: string;
  currentTask?: string;
  workingOn?: string;
}

interface StallCheckResult {
  agentId: string;
  isStalled: boolean;
  lastSeen: string;
  stalledForMs: number;
  stalledForMinutes: number;
  hasCheckpoint: boolean;
  hasShadow: boolean;
  shadowId?: string;
  recommendation: 'ok' | 'spawn-shadow' | 'takeover' | 'already-has-shadow';
}

/**
 * Agent Stall Check API
 *
 * GET /api/agent-stall-check - Check all agents for stalls
 * GET /api/agent-stall-check?agentId=X - Check specific agent
 * GET /api/agent-stall-check?threshold=300000 - Custom threshold (ms)
 * POST /api/agent-stall-check - Register a shadow agent
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // POST: Register a shadow agent
    if (req.method === 'POST') {
      const { primaryAgentId, shadowAgentId, vmId } = req.body;

      if (!primaryAgentId || !shadowAgentId) {
        return res.status(400).json({ error: 'primaryAgentId and shadowAgentId required' });
      }

      const shadow = {
        id: shadowAgentId,
        primaryAgent: primaryAgentId,
        vmId: vmId || 'unknown',
        status: 'monitoring',
        registeredAt: new Date().toISOString(),
        lastCheck: new Date().toISOString(),
      };

      await redis.hset(SHADOWS_KEY, { [primaryAgentId]: JSON.stringify(shadow) });

      return res.json({
        success: true,
        message: `Shadow ${shadowAgentId} registered for ${primaryAgentId}`,
        shadow
      });
    }

    // GET: Check for stalls
    const { agentId, threshold } = req.query;
    const stallThreshold = threshold ? parseInt(threshold as string) : DEFAULT_STALL_THRESHOLD_MS;

    // Get all agents
    const agentsRaw = await redis.hgetall(AGENTS_KEY);
    const agents = agentsRaw || {};

    // Get all checkpoints
    const checkpointsRaw = await redis.hgetall(CHECKPOINTS_KEY);
    const checkpoints = checkpointsRaw || {};

    // Get all shadows
    const shadowsRaw = await redis.hgetall(SHADOWS_KEY);
    const shadows = shadowsRaw || {};

    const now = Date.now();
    const results: StallCheckResult[] = [];
    const stalledAgents: StallCheckResult[] = [];

    for (const [id, agentData] of Object.entries(agents)) {
      // Filter by agentId if specified
      if (agentId && id !== agentId) continue;

      const agent: AgentStatus = typeof agentData === 'string' ? JSON.parse(agentData) : agentData;
      const lastSeenTime = new Date(agent.lastSeen).getTime();
      const stalledForMs = now - lastSeenTime;
      const isStalled = stalledForMs > stallThreshold;

      // Check for checkpoint
      const checkpointData = checkpoints[id];
      const hasCheckpoint = !!checkpointData;

      // Check for existing shadow
      const shadowData = shadows[id];
      const hasShadow = !!shadowData;
      const shadow = shadowData ? (typeof shadowData === 'string' ? JSON.parse(shadowData) : shadowData) : null;

      // Determine recommendation
      let recommendation: StallCheckResult['recommendation'] = 'ok';
      if (isStalled) {
        if (hasShadow) {
          recommendation = 'takeover';
        } else if (hasCheckpoint) {
          recommendation = 'spawn-shadow';
        } else {
          recommendation = 'spawn-shadow'; // Even without checkpoint, spawn for monitoring
        }
      } else if (hasShadow) {
        recommendation = 'already-has-shadow';
      }

      const result: StallCheckResult = {
        agentId: id,
        isStalled,
        lastSeen: agent.lastSeen,
        stalledForMs,
        stalledForMinutes: Math.round(stalledForMs / 60000 * 10) / 10,
        hasCheckpoint,
        hasShadow,
        shadowId: shadow?.id,
        recommendation,
      };

      results.push(result);
      if (isStalled) {
        stalledAgents.push(result);
      }
    }

    // Post to chat if there are newly stalled agents needing action
    const needsAction = stalledAgents.filter(a => a.recommendation === 'spawn-shadow' || a.recommendation === 'takeover');
    if (needsAction.length > 0 && !agentId) {
      await redis.lpush('agent-coord:chat', JSON.stringify({
        id: `stall-alert-${Date.now()}`,
        author: 'stall-monitor',
        authorType: 'system',
        message: `⚠️ **Agent Stall Alert**\n\n${needsAction.map(a =>
          `- **${a.agentId}**: stalled ${a.stalledForMinutes}min → ${a.recommendation}`
        ).join('\n')}`,
        timestamp: new Date().toISOString()
      }));
    }

    return res.json({
      timestamp: new Date().toISOString(),
      thresholdMs: stallThreshold,
      thresholdMinutes: stallThreshold / 60000,
      totalAgents: results.length,
      stalledCount: stalledAgents.length,
      needsAction: needsAction.length,
      results: agentId ? results[0] : results,
      stalledAgents: agentId ? undefined : stalledAgents,
    });

  } catch (error) {
    console.error('Stall check error:', error);
    return res.status(500).json({ error: String(error) });
  }
}
