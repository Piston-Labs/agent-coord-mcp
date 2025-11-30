import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Fast Sync Endpoint for Agent Onboarding
 *
 * Returns a compressed summary of current system state:
 * - Recent chat messages (last 10)
 * - Active agents and their current tasks
 * - Priority roadmap items (in-progress and high priority)
 * - File claims (to avoid conflicts)
 * - Quick context summary
 *
 * Usage: GET /api/sync?agentId=claude-code
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { agentId } = req.query;

  try {
    // Fetch all data in parallel for speed
    const [messagesRaw, agentsRaw, roadmapRaw, claimsRaw] = await Promise.all([
      redis.lrange('agent-coord:messages', 0, 9), // Last 10 messages
      redis.hgetall('agent-coord:active-agents'),
      redis.hgetall('agent-coord:roadmap'),
      redis.hgetall('agent-coord:claims')
    ]);

    // Parse messages
    const recentMessages = (messagesRaw || []).map((m: any) => {
      const msg = typeof m === 'string' ? JSON.parse(m) : m;
      return {
        author: msg.author,
        type: msg.authorType,
        message: msg.message?.substring(0, 200) + (msg.message?.length > 200 ? '...' : ''),
        time: msg.timestamp
      };
    });

    // Parse active agents
    const activeAgents: any[] = [];
    const staleThreshold = Date.now() - 30 * 60 * 1000;
    for (const [key, value] of Object.entries(agentsRaw || {})) {
      try {
        const agent = typeof value === 'string' ? JSON.parse(value) : value;
        if (agent && agent.lastSeen && new Date(agent.lastSeen).getTime() > staleThreshold) {
          activeAgents.push({
            id: agent.id,
            name: agent.name || agent.id,
            task: agent.currentTask || 'idle',
            role: agent.role || 'agent'
          });
        }
      } catch (e) {}
    }

    // Parse priority roadmap items (in-progress or high/critical priority)
    const priorityItems: any[] = [];
    for (const [key, value] of Object.entries(roadmapRaw || {})) {
      try {
        const item = typeof value === 'string' ? JSON.parse(value) : value;
        if (item && (item.status === 'in-progress' || item.priority === 'high' || item.priority === 'critical')) {
          priorityItems.push({
            id: item.id,
            title: item.title,
            status: item.status,
            priority: item.priority,
            assignee: item.assignee
          });
        }
      } catch (e) {}
    }

    // Parse file claims
    const fileClaims: any[] = [];
    for (const [key, value] of Object.entries(claimsRaw || {})) {
      try {
        const claim = typeof value === 'string' ? JSON.parse(value) : value;
        if (claim && claim.what) {
          fileClaims.push({
            file: claim.what,
            by: claim.by,
            task: claim.description
          });
        }
      } catch (e) {}
    }

    // Generate quick context summary
    const humanMessages = recentMessages.filter((m: any) => m.type === 'human');
    const lastHumanMessage = humanMessages[0]?.message || 'No recent human messages';

    const contextSummary = {
      lastHumanRequest: lastHumanMessage,
      activeAgentCount: activeAgents.length,
      inProgressTasks: priorityItems.filter(i => i.status === 'in-progress').length,
      claimedFiles: fileClaims.length
    };

    // Update agent's last seen if agentId provided
    if (agentId && typeof agentId === 'string') {
      const existingAgent = await redis.hget('agent-coord:active-agents', agentId);
      const agentData = existingAgent
        ? (typeof existingAgent === 'string' ? JSON.parse(existingAgent) : existingAgent)
        : { id: agentId, name: agentId };

      agentData.lastSeen = new Date().toISOString();
      agentData.status = 'active';
      await redis.hset('agent-coord:active-agents', { [agentId]: JSON.stringify(agentData) });
    }

    return res.json({
      syncTime: new Date().toISOString(),
      context: contextSummary,
      recentChat: recentMessages,
      activeAgents,
      priorityWork: priorityItems,
      fileClaims,
      tips: [
        'Claim files before editing: POST /api/claims',
        'Check agent tasks to avoid duplicate work',
        'Post updates to /api/chat to coordinate',
        'Use /api/whats-next?assignee=name for task assignments'
      ]
    });

  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: 'Sync failed', details: String(error) });
  }
}
