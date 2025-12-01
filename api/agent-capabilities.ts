import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CAPABILITIES_KEY = 'agent-coord:capabilities';

interface AgentCapabilities {
  agentId: string;
  name: string;
  description: string;
  capabilities: string[];           // e.g., ['code-review', 'testing', 'documentation']
  specializations: string[];        // e.g., ['typescript', 'react', 'aws']
  strengths: string[];              // e.g., ['frontend', 'backend', 'devops']
  preferredTasks: string[];         // e.g., ['bug-fix', 'feature', 'refactor']
  availability: 'high' | 'medium' | 'low' | 'offline';
  performance: {
    tasksCompleted: number;
    avgResponseTime: number;        // in seconds
    successRate: number;            // 0-100
    lastActive: string;
  };
  contextLoaded: string[];          // Which context clusters agent has loaded
  updatedAt: string;
}

/**
 * Agent Capabilities API
 * 
 * Stores and retrieves agent capability profiles for intelligent task matching.
 * 
 * GET /api/agent-capabilities - List all agent capabilities
 * GET /api/agent-capabilities?agentId=xxx - Get specific agent capabilities
 * GET /api/agent-capabilities?match=code-review - Find agents matching capability
 * POST /api/agent-capabilities - Create/update agent capabilities
 * DELETE /api/agent-capabilities?agentId=xxx - Remove agent capabilities
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const { agentId, match, specialization, strength, taskType } = req.query;

      // Get all capabilities
      const capsRaw = await redis.hgetall(CAPABILITIES_KEY) || {};
      let capabilities: AgentCapabilities[] = Object.values(capsRaw).map(v =>
        typeof v === 'string' ? JSON.parse(v) : v
      );

      // Filter by agentId
      if (agentId && typeof agentId === 'string') {
        capabilities = capabilities.filter(c => c.agentId === agentId);
        if (capabilities.length === 0) {
          return res.status(404).json({ error: 'Agent capabilities not found' });
        }
        return res.json({ agent: capabilities[0] });
      }

      // Match by capability
      if (match && typeof match === 'string') {
        capabilities = capabilities.filter(c => 
          c.capabilities.some(cap => cap.toLowerCase().includes(match.toLowerCase()))
        );
      }

      // Filter by specialization
      if (specialization && typeof specialization === 'string') {
        capabilities = capabilities.filter(c =>
          c.specializations.some(spec => spec.toLowerCase().includes(specialization.toLowerCase()))
        );
      }

      // Filter by strength
      if (strength && typeof strength === 'string') {
        capabilities = capabilities.filter(c =>
          c.strengths.some(s => s.toLowerCase().includes(strength.toLowerCase()))
        );
      }

      // Filter by preferred task type
      if (taskType && typeof taskType === 'string') {
        capabilities = capabilities.filter(c =>
          c.preferredTasks.some(t => t.toLowerCase().includes(taskType.toLowerCase()))
        );
      }

      // Sort by availability and performance
      capabilities.sort((a, b) => {
        const availOrder: Record<string, number> = { high: 0, medium: 1, low: 2, offline: 3 };
        const availDiff = availOrder[a.availability] - availOrder[b.availability];
        if (availDiff !== 0) return availDiff;
        return b.performance.successRate - a.performance.successRate;
      });

      return res.json({ 
        agents: capabilities, 
        count: capabilities.length,
        filters: { match, specialization, strength, taskType }
      });
    }

    if (req.method === 'POST') {
      const data = req.body;

      if (!data.agentId) {
        return res.status(400).json({ error: 'agentId required' });
      }

      // Get existing or create new
      const existing = await redis.hget(CAPABILITIES_KEY, data.agentId);
      let caps: AgentCapabilities;

      if (existing) {
        caps = typeof existing === 'string' ? JSON.parse(existing) : existing;
        // Update fields
        caps = {
          ...caps,
          ...data,
          performance: {
            ...caps.performance,
            ...(data.performance || {})
          },
          updatedAt: new Date().toISOString()
        };
      } else {
        // Create new
        caps = {
          agentId: data.agentId,
          name: data.name || data.agentId,
          description: data.description || '',
          capabilities: data.capabilities || [],
          specializations: data.specializations || [],
          strengths: data.strengths || [],
          preferredTasks: data.preferredTasks || [],
          availability: data.availability || 'medium',
          performance: {
            tasksCompleted: 0,
            avgResponseTime: 0,
            successRate: 100,
            lastActive: new Date().toISOString(),
            ...(data.performance || {})
          },
          contextLoaded: data.contextLoaded || [],
          updatedAt: new Date().toISOString()
        };
      }

      await redis.hset(CAPABILITIES_KEY, { [data.agentId]: JSON.stringify(caps) });
      return res.json({ success: true, agent: caps });
    }

    if (req.method === 'DELETE') {
      const { agentId } = req.query;
      if (!agentId || typeof agentId !== 'string') {
        return res.status(400).json({ error: 'agentId required' });
      }
      await redis.hdel(CAPABILITIES_KEY, agentId);
      return res.json({ success: true, deleted: agentId });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Agent capabilities error:', error);
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
