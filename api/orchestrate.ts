import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ORCHESTRATIONS_KEY = 'agent-coord:orchestrations';
const TASKS_KEY = 'agent-coord:tasks';

/**
 * Orchestration API - Hierarchical Multi-Agent Coordination
 *
 * Enables a coordinator agent to:
 * 1. Break down complex tasks into subtasks
 * 2. Spawn/assign subtasks to specialist agents
 * 3. Track progress across all subtasks
 * 4. Synthesize results when all complete
 *
 * This is ADDITIVE - uses existing task/agent infrastructure
 * Does NOT modify core store or types
 */

interface Subtask {
  id: string;
  title: string;
  description?: string;
  assignee?: string;         // Specialist agent ID
  status: 'pending' | 'assigned' | 'in-progress' | 'completed' | 'failed';
  result?: string;           // Output from specialist
  createdAt: string;
  updatedAt: string;
}

interface Orchestration {
  id: string;
  title: string;
  description: string;
  coordinator: string;       // Agent ID of the coordinator
  status: 'planning' | 'executing' | 'synthesizing' | 'completed' | 'failed';
  subtasks: Subtask[];
  synthesis?: string;        // Final combined result
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET - List orchestrations or get specific one
    if (req.method === 'GET') {
      const { id, coordinator, status } = req.query;

      if (id && typeof id === 'string') {
        const orch = await redis.hget(ORCHESTRATIONS_KEY, id);
        if (!orch) return res.status(404).json({ error: 'Orchestration not found' });
        const parsed = typeof orch === 'string' ? JSON.parse(orch) : orch;
        return res.json({ orchestration: parsed });
      }

      // List all
      const all = await redis.hgetall(ORCHESTRATIONS_KEY) || {};
      let orchestrations: Orchestration[] = Object.values(all).map((v: any) =>
        typeof v === 'string' ? JSON.parse(v) : v
      );

      // Filter
      if (coordinator && typeof coordinator === 'string') {
        orchestrations = orchestrations.filter(o => o.coordinator === coordinator);
      }
      if (status && typeof status === 'string') {
        orchestrations = orchestrations.filter(o => o.status === status);
      }

      // Sort by most recent
      orchestrations.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      return res.json({
        count: orchestrations.length,
        orchestrations: orchestrations.slice(0, 20)
      });
    }

    // POST - Create new orchestration
    if (req.method === 'POST') {
      const { title, description, coordinator, subtasks } = req.body;

      if (!title || !coordinator) {
        return res.status(400).json({ error: 'title and coordinator required' });
      }

      const now = new Date().toISOString();
      const id = `orch-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

      // Create subtasks from array of titles/descriptions
      const createdSubtasks: Subtask[] = (subtasks || []).map((st: any, idx: number) => ({
        id: `${id}-sub-${idx}`,
        title: typeof st === 'string' ? st : st.title,
        description: typeof st === 'string' ? undefined : st.description,
        assignee: typeof st === 'string' ? undefined : st.assignee,
        status: 'pending' as const,
        createdAt: now,
        updatedAt: now
      }));

      const orchestration: Orchestration = {
        id,
        title,
        description: description || '',
        coordinator,
        status: createdSubtasks.length > 0 ? 'executing' : 'planning',
        subtasks: createdSubtasks,
        createdAt: now,
        updatedAt: now
      };

      await redis.hset(ORCHESTRATIONS_KEY, { [id]: JSON.stringify(orchestration) });

      // Also create actual tasks for each subtask (integrates with existing task system)
      for (const st of createdSubtasks) {
        const task = {
          id: st.id,
          title: st.title,
          description: st.description || `Subtask of orchestration: ${title}`,
          status: 'todo',
          priority: 'high',
          createdBy: coordinator,
          assignee: st.assignee,
          tags: ['orchestration', id],
          parentOrchestration: id,
          createdAt: now,
          updatedAt: now
        };
        await redis.hset(TASKS_KEY, { [st.id]: JSON.stringify(task) });
      }

      return res.json({
        created: true,
        orchestration,
        subtaskCount: createdSubtasks.length
      });
    }

    // PATCH - Update orchestration or subtask
    if (req.method === 'PATCH') {
      const { id, subtaskId, status, result, assignee, synthesis } = req.body;

      if (!id) return res.status(400).json({ error: 'id required' });

      const existing = await redis.hget(ORCHESTRATIONS_KEY, id);
      if (!existing) return res.status(404).json({ error: 'Orchestration not found' });

      const orchestration: Orchestration = typeof existing === 'string'
        ? JSON.parse(existing) : existing;
      const now = new Date().toISOString();

      // Update specific subtask
      if (subtaskId) {
        const subtask = orchestration.subtasks.find(st => st.id === subtaskId);
        if (!subtask) return res.status(404).json({ error: 'Subtask not found' });

        if (status) subtask.status = status;
        if (result) subtask.result = result;
        if (assignee) subtask.assignee = assignee;
        subtask.updatedAt = now;

        // Check if all subtasks complete
        const allComplete = orchestration.subtasks.every(
          st => st.status === 'completed' || st.status === 'failed'
        );
        if (allComplete && orchestration.status === 'executing') {
          orchestration.status = 'synthesizing';
        }
      }

      // Update orchestration-level fields
      if (synthesis) {
        orchestration.synthesis = synthesis;
        orchestration.status = 'completed';
        orchestration.completedAt = now;
      }
      if (status && !subtaskId) {
        orchestration.status = status;
      }

      orchestration.updatedAt = now;
      await redis.hset(ORCHESTRATIONS_KEY, { [id]: JSON.stringify(orchestration) });

      return res.json({ updated: true, orchestration });
    }

    // DELETE - Remove orchestration
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'id required' });
      }

      await redis.hdel(ORCHESTRATIONS_KEY, id);
      return res.json({ deleted: true, id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Orchestration error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
