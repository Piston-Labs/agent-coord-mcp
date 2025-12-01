import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const AGENTS_KEY = 'agent-coord:active-agents';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // DELETE: Clear all agents (useful for corrupt data)
    if (req.method === 'DELETE') {
      await redis.del(AGENTS_KEY);
      return res.json({ success: true, message: 'All agents cleared' });
    }

    // GET: List agents (both active and offline)
    if (req.method === 'GET') {
      // Short cache for agent list (5 seconds)
      res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=3');
      const includeOffline = req.query.includeOffline === 'true';
      
      let agents: Record<string, unknown> = {};
      try {
        agents = await redis.hgetall(AGENTS_KEY) || {};
      } catch (hgetError) {
        // If hgetall fails due to corrupt data, clear and return empty
        console.error('hgetall failed, clearing corrupt data:', hgetError);
        await redis.del(AGENTS_KEY);
        return res.json({ agents: [], offlineAgents: [], count: 0, note: 'Cleared corrupt data' });
      }

      const activeThreshold = Date.now() - 30 * 60 * 1000; // 30 minutes = active
      const activeAgents: any[] = [];
      const offlineAgents: any[] = [];

      for (const [key, value] of Object.entries(agents)) {
        try {
          const agent = typeof value === 'string' ? JSON.parse(value) : value;
          if (agent && agent.lastSeen) {
            const lastSeen = new Date(agent.lastSeen).getTime();
            // Determine status based on lastSeen
            agent.status = lastSeen > activeThreshold ? 'active' : 'offline';
            
            if (lastSeen > activeThreshold) {
              activeAgents.push(agent);
            } else {
              offlineAgents.push(agent);
            }
          }
        } catch (parseError) {
          // Skip invalid entries and clean them up
          console.error(`Invalid agent entry for ${key}:`, parseError);
          await redis.hdel(AGENTS_KEY, key);
        }
      }

      // Sort by lastSeen (most recent first)
      activeAgents.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
      offlineAgents.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

      if (includeOffline) {
        return res.json({ 
          agents: activeAgents, 
          offlineAgents: offlineAgents,
          count: activeAgents.length,
          offlineCount: offlineAgents.length
        });
      }
      
      return res.json({ agents: activeAgents, count: activeAgents.length });
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

      // Use object form for Upstash: hset(key, { field: value })
      await redis.hset(AGENTS_KEY, { [id]: JSON.stringify(agent) });

      return res.json({ success: true, agent });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Agents error:', error);
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
