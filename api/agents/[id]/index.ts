import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const AGENTS_KEY = 'agent-coord:agents';

interface AgentMetrics {
  tasksCompleted: number;
  tasksSucceeded: number;
  tasksFailed: number;
  successRate: number;
  avgResponseTime: number;
  totalResponseTime: number;
  lastOptimized: string | null;
}

interface AgentMemory {
  patterns: string[];
  failures: string[];
  preferences: Record<string, string>;
}

interface Agent {
  id: string;
  name: string;
  version: number;
  role: string;
  specialty: string[];
  status: string;
  currentTask: string | null;
  createdAt: string;
  lastSeen: string;
  metrics: AgentMetrics;
  memory: AgentMemory;
  clusterProficiency: Record<string, number>;
  previousNames: string[];
}

function createDefaultAgent(id: string): Agent {
  return {
    id,
    name: id,
    version: 1,
    role: 'general',
    specialty: [],
    status: 'inactive',
    currentTask: null,
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    metrics: {
      tasksCompleted: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      successRate: 0,
      avgResponseTime: 0,
      totalResponseTime: 0,
      lastOptimized: null,
    },
    memory: {
      patterns: [],
      failures: [],
      preferences: {},
    },
    clusterProficiency: {},
    previousNames: [],
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Agent ID required' });
  }

  try {
    // GET: Get single agent
    if (req.method === 'GET') {
      const agentData = await redis.hget(AGENTS_KEY, id);
      if (!agentData) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      const agent = typeof agentData === 'string' ? JSON.parse(agentData) : agentData;
      return res.json({ agent });
    }

    // PATCH: Update agent (rename, update metrics, add learnings)
    if (req.method === 'PATCH') {
      let agent: Agent;
      const existingData = await redis.hget(AGENTS_KEY, id);
      
      if (existingData) {
        agent = typeof existingData === 'string' ? JSON.parse(existingData) : existingData;
      } else {
        agent = createDefaultAgent(id);
      }

      const { 
        name, 
        role, 
        specialty, 
        status,
        currentTask,
        // Metrics updates
        taskCompleted,
        taskSucceeded,
        responseTime,
        // Memory updates  
        addPattern,
        addFailure,
        setPreference,
        // Cluster proficiency
        updateProficiency,
        // Optimization
        optimize
      } = req.body;

      // Handle rename (track history)
      if (name && name !== agent.name) {
        agent.previousNames.push(agent.name);
        agent.name = name;
        agent.version += 1;
      }

      // Basic updates
      if (role) agent.role = role;
      if (specialty) agent.specialty = specialty;
      if (status) agent.status = status;
      if (currentTask !== undefined) agent.currentTask = currentTask;
      agent.lastSeen = new Date().toISOString();

      // Metrics updates
      if (taskCompleted) {
        agent.metrics.tasksCompleted += 1;
        if (taskSucceeded) {
          agent.metrics.tasksSucceeded += 1;
        } else {
          agent.metrics.tasksFailed += 1;
        }
        agent.metrics.successRate = agent.metrics.tasksCompleted > 0 
          ? agent.metrics.tasksSucceeded / agent.metrics.tasksCompleted 
          : 0;
      }

      if (responseTime) {
        agent.metrics.totalResponseTime += responseTime;
        agent.metrics.avgResponseTime = agent.metrics.tasksCompleted > 0
          ? agent.metrics.totalResponseTime / agent.metrics.tasksCompleted
          : 0;
      }

      // Memory updates
      if (addPattern && !agent.memory.patterns.includes(addPattern)) {
        agent.memory.patterns.push(addPattern);
        // Keep last 50 patterns
        if (agent.memory.patterns.length > 50) {
          agent.memory.patterns = agent.memory.patterns.slice(-50);
        }
      }

      if (addFailure && !agent.memory.failures.includes(addFailure)) {
        agent.memory.failures.push(addFailure);
        // Keep last 20 failures
        if (agent.memory.failures.length > 20) {
          agent.memory.failures = agent.memory.failures.slice(-20);
        }
      }

      if (setPreference) {
        const { key, value } = setPreference;
        agent.memory.preferences[key] = value;
      }

      // Cluster proficiency updates
      if (updateProficiency) {
        const { cluster, delta } = updateProficiency;
        const current = agent.clusterProficiency[cluster] || 0.5;
        agent.clusterProficiency[cluster] = Math.max(0, Math.min(1, current + delta));
      }

      // Self-optimization trigger
      if (optimize) {
        agent.metrics.lastOptimized = new Date().toISOString();
        agent.version += 1;
        
        // Post optimization event to chat
        await redis.lpush('agent-coord:messages', JSON.stringify({
          id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
          author: 'system',
          authorType: 'system',
          message: `🔄 Agent **${agent.name}** optimized → v${agent.version} (Success rate: ${(agent.metrics.successRate * 100).toFixed(1)}%)`,
          timestamp: new Date().toISOString(),
          reactions: []
        }));
      }

      await redis.hset(AGENTS_KEY, id, JSON.stringify(agent));
      return res.json({ agent, updated: true });
    }

    // DELETE: Remove agent
    if (req.method === 'DELETE') {
      await redis.hdel(AGENTS_KEY, id);
      return res.json({ deleted: true, id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Agent error:', error);
    return res.status(500).json({ error: 'Agent operation failed', details: String(error) });
  }
}
