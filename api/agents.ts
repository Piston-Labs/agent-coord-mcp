import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const AGENTS_KEY = 'agent-coord:active-agents';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List active agents
    if (req.method === 'GET') {
      const agents = await redis.hgetall(AGENTS_KEY);
      const staleThreshold = Date.now() - 30 * 60 * 1000; // 30 minutes

      const agentList: any[] = [];
      for (const [key, value] of Object.entries(agents || {})) {
        try {
          const agent = typeof value === 'string' ? JSON.parse(value) : value;
          const lastSeen = new Date(agent.lastSeen).getTime();
          if (lastSeen > staleThreshold) {
            agentList.push(agent);
          }
        } catch (parseError) {
          // Skip invalid entries and optionally clean them up
          console.error(`Invalid agent entry for ${key}:`, parseError);
          await redis.hdel(AGENTS_KEY, key);
        }
      }

      return res.json({ agents: agentList, count: agentList.length });
    }

    // POST: Register/update agent status
    if (req.method === 'POST') {
      const { id, name, status, currentTask, workingOn, role } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      const agent = {
        id,
        name: name || id,
        status: status || 'active',
        currentTask: currentTask || '',
        workingOn: workingOn || '',
        role: role || 'agent',
        lastSeen: new Date().toISOString()
      };

      await redis.hset(AGENTS_KEY, id, JSON.stringify(agent));

      return res.json({ success: true, agent });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Agents error:', error);
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
