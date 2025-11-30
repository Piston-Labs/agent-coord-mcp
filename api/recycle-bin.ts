import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const RECYCLE_BIN_KEY = 'agent-coord:recycled-agents';
const AGENTS_KEY = 'agent-coord:active-agents';

interface RecycledAgent {
  id: string;
  originalAgent: any;
  recycledAt: string;
  recycledBy: string;
  reason: string;
  expiresAt: string;  // Auto-delete after 7 days
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List recycled agents
    if (req.method === 'GET') {
      const recycled = await redis.hgetall(RECYCLE_BIN_KEY) || {};
      const agentList: RecycledAgent[] = [];
      const now = new Date();
      
      for (const [key, value] of Object.entries(recycled)) {
        try {
          const agent = typeof value === 'string' ? JSON.parse(value) : value;
          // Check if expired
          if (new Date(agent.expiresAt) > now) {
            agentList.push(agent);
          } else {
            // Clean up expired entries
            await redis.hdel(RECYCLE_BIN_KEY, key);
          }
        } catch (e) {
          console.error('Invalid recycled agent:', e);
        }
      }
      
      return res.json({ recycledAgents: agentList, count: agentList.length });
    }

    // POST: Recycle an agent (move from active to recycle bin)
    if (req.method === 'POST') {
      const { agentId, reason, recycledBy } = req.body;

      if (!agentId) {
        return res.status(400).json({ error: 'agentId is required' });
      }

      // Get the agent from active agents
      const agentData = await redis.hget(AGENTS_KEY, agentId);
      if (!agentData) {
        return res.status(404).json({ error: 'Agent not found in active agents' });
      }

      const originalAgent = typeof agentData === 'string' ? JSON.parse(agentData) : agentData;

      // Create recycled entry
      const recycled: RecycledAgent = {
        id: `recycled-${Date.now().toString(36)}`,
        originalAgent,
        recycledAt: new Date().toISOString(),
        recycledBy: recycledBy || 'system',
        reason: reason || 'No reason provided',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
      };

      // Store in recycle bin
      await redis.hset(RECYCLE_BIN_KEY, { [agentId]: JSON.stringify(recycled) });
      
      // Remove from active agents
      await redis.hdel(AGENTS_KEY, agentId);

      return res.json({ success: true, recycled });
    }

    // DELETE with restore=true: Restore an agent from recycle bin
    // DELETE with restore=false: Permanently delete
    if (req.method === 'DELETE') {
      const { agentId, restore } = req.body;
      
      if (!agentId) {
        return res.status(400).json({ error: 'agentId is required' });
      }

      const recycledData = await redis.hget(RECYCLE_BIN_KEY, agentId);
      if (!recycledData) {
        return res.status(404).json({ error: 'Agent not found in recycle bin' });
      }

      const recycled = typeof recycledData === 'string' ? JSON.parse(recycledData) : recycledData;

      if (restore) {
        // Restore to active agents
        const agent = recycled.originalAgent;
        agent.status = 'restored';
        agent.lastSeen = new Date().toISOString();
        agent.restoredAt = new Date().toISOString();
        
        await redis.hset(AGENTS_KEY, { [agentId]: JSON.stringify(agent) });
        await redis.hdel(RECYCLE_BIN_KEY, agentId);

        return res.json({ success: true, restored: agent });
      } else {
        // Permanent delete
        await redis.hdel(RECYCLE_BIN_KEY, agentId);
        return res.json({ success: true, permanentlyDeleted: agentId });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Recycle bin error:', error);
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
