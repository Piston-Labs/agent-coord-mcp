import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const AGENTS_KEY = 'agent-coord:agents';
const SPAWN_QUEUE_KEY = 'agent-coord:spawn-queue';

interface SpawnRequest {
  name: string;
  role: string;
  task: string;
  parentAgent?: string;
  tools?: string[];
}

interface Agent {
  id: string;
  name: string;
  role: string;
  task: string;
  parentAgent?: string;
  tools: string[];
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string;
  lastSeen?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List spawn queue or all agents
    if (req.method === 'GET') {
      const { queue } = req.query;

      if (queue === 'true') {
        // Get pending spawn requests
        const pending = await redis.lrange(SPAWN_QUEUE_KEY, 0, -1);
        return res.json({
          queue: pending.map((p: any) => typeof p === 'string' ? JSON.parse(p) : p),
          count: pending.length
        });
      }

      // Get all agents
      const agents = await redis.hgetall(AGENTS_KEY);
      const agentList = Object.values(agents || {}).map((a: any) =>
        typeof a === 'string' ? JSON.parse(a) : a
      );
      return res.json({ agents: agentList, count: agentList.length });
    }

    // POST: Spawn a new agent
    if (req.method === 'POST') {
      const { name, role, task, parentAgent, tools = [] } = req.body as SpawnRequest;

      if (!name || !role || !task) {
        return res.status(400).json({
          error: 'name, role, and task are required'
        });
      }

      const agent: Agent = {
        id: `agent-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        name,
        role,
        task,
        parentAgent,
        tools,
        status: 'queued',
        createdAt: new Date().toISOString()
      };

      // Store agent in registry
      await redis.hset(AGENTS_KEY, agent.id, JSON.stringify(agent));

      // Add to spawn queue for the main agent service to pick up
      await redis.lpush(SPAWN_QUEUE_KEY, JSON.stringify({
        agentId: agent.id,
        ...agent
      }));

      // Post to group chat
      const chatMessage = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
        author: 'system',
        authorType: 'system',
        message: `🤖 Agent spawned: **${name}** (${role})\nTask: ${task}${parentAgent ? `\nParent: ${parentAgent}` : ''}`,
        timestamp: new Date().toISOString(),
        reactions: []
      };
      await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));

      return res.json({
        success: true,
        agent,
        message: `Agent ${name} queued for spawning`
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Spawn error:', error);
    return res.status(500).json({ error: 'Spawn failed', details: String(error) });
  }
}
