import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CAPABILITIES_KEY = 'agent-coord:capabilities';
const TASKS_KEY = 'agent-coord:tasks';

interface TaskMatchResult {
  taskId: string;
  taskTitle: string;
  recommendedAgents: Array<{
    agentId: string;
    name: string;
    matchScore: number;
    matchReasons: string[];
    availability: string;
  }>;
}

/**
 * Task Matcher API
 * 
 * Intelligently matches tasks to agents based on capabilities.
 * 
 * POST /api/task-matcher - Find best agents for a task
 * Body: { taskDescription, taskType, requiredCapabilities, preferredSpecializations }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      taskDescription, 
      taskType,
      requiredCapabilities = [],
      preferredSpecializations = [],
      taskId 
    } = req.body;

    if (!taskDescription && !taskId) {
      return res.status(400).json({ error: 'taskDescription or taskId required' });
    }

    // Get all agent capabilities
    const capsRaw = await redis.hgetall(CAPABILITIES_KEY) || {};
    const agents: any[] = Object.values(capsRaw).map(v =>
      typeof v === 'string' ? JSON.parse(v) : v
    );

    if (agents.length === 0) {
      return res.json({ 
        recommendations: [],
        message: 'No agent capabilities registered. Agents should register their capabilities first.' 
      });
    }

    // Keyword extraction from task description
    const keywords = (taskDescription || '').toLowerCase().split(/\s+/);
    
    // Score each agent
    const scoredAgents = agents
      .filter(agent => agent.availability !== 'offline')
      .map(agent => {
        let score = 0;
        const reasons: string[] = [];

        // Match by task type
        if (taskType && agent.preferredTasks.includes(taskType.toLowerCase())) {
          score += 30;
          reasons.push(`Prefers ${taskType} tasks`);
        }

        // Match required capabilities
        for (const cap of requiredCapabilities) {
          if (agent.capabilities.some((c: string) => c.toLowerCase().includes(cap.toLowerCase()))) {
            score += 25;
            reasons.push(`Has ${cap} capability`);
          }
        }

        // Match preferred specializations
        for (const spec of preferredSpecializations) {
          if (agent.specializations.some((s: string) => s.toLowerCase().includes(spec.toLowerCase()))) {
            score += 20;
            reasons.push(`Specializes in ${spec}`);
          }
        }

        // Keyword matching from description
        for (const kw of keywords) {
          if (kw.length < 3) continue; // Skip short words
          
          const matchesCap = agent.capabilities.some((c: string) => 
            c.toLowerCase().includes(kw)
          );
          const matchesSpec = agent.specializations.some((s: string) => 
            s.toLowerCase().includes(kw)
          );
          const matchesStrength = agent.strengths.some((s: string) => 
            s.toLowerCase().includes(kw)
          );
          
          if (matchesCap || matchesSpec || matchesStrength) {
            score += 5;
          }
        }

        // Availability bonus
        if (agent.availability === 'high') {
          score += 15;
          reasons.push('Highly available');
        } else if (agent.availability === 'medium') {
          score += 5;
        }

        // Performance bonus
        if (agent.performance.successRate >= 90) {
          score += 10;
          reasons.push(`${agent.performance.successRate}% success rate`);
        }

        // Recency bonus (active in last hour)
        const lastActive = new Date(agent.performance.lastActive).getTime();
        const hourAgo = Date.now() - 60 * 60 * 1000;
        if (lastActive > hourAgo) {
          score += 10;
          reasons.push('Recently active');
        }

        return {
          agentId: agent.agentId,
          name: agent.name,
          matchScore: score,
          matchReasons: reasons,
          availability: agent.availability
        };
      })
      .filter(agent => agent.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore);

    return res.json({
      taskDescription: taskDescription?.substring(0, 100),
      taskType,
      recommendations: scoredAgents.slice(0, 5),
      totalAgentsEvaluated: agents.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Task matcher error:', error);
    return res.status(500).json({ error: 'Matching failed', details: String(error) });
  }
}
