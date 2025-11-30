import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const AGENTS_KEY = 'agent-coord:agents';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { id } = req.query;
  const agentId = id as string;

  try {
    if (req.method === 'GET') {
      const agentData = await redis.hget(AGENTS_KEY, agentId);
      if (!agentData) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      const agent = typeof agentData === 'string' ? JSON.parse(agentData) : agentData;
      return res.json(agent);
    }

    if (req.method === 'POST') {
      const { status, currentTask, workingOn, roles, spawnedBy } = req.body;

      // Get existing agent or create new
      let agent: any = {};
      const existing = await redis.hget(AGENTS_KEY, agentId);
      if (existing) {
        agent = typeof existing === 'string' ? JSON.parse(existing) : existing;
      }

      // Update agent
      agent = {
        ...agent,
        id: agentId,
        status: status || agent.status || 'active',
        currentTask: currentTask !== undefined ? currentTask : agent.currentTask,
        workingOn: workingOn !== undefined ? workingOn : agent.workingOn,
        roles: roles || agent.roles || [],
        spawnedBy: spawnedBy || agent.spawnedBy,
        lastSeen: new Date().toISOString(),
        createdAt: agent.createdAt || new Date().toISOString()
      };

      await redis.hset(AGENTS_KEY, { [agentId]: JSON.stringify(agent) });
      return res.json(agent);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Agent status error:', error);
    return res.status(500).json({ error: 'Failed to update agent status', details: String(error) });
  }
}
