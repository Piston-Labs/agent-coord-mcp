import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const TASKS_KEY = 'agent-coord:tasks';
const MESSAGES_KEY = 'agent-coord:messages';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in-progress' | 'review' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  pickedUpAt?: string;
  completedAt?: string;
  blockedReason?: string;
  tags?: string[];
}

// Helper to post task updates to chat
async function postTaskUpdate(action: string, task: Task, agentId?: string) {
  const emoji: Record<string, string> = {
    'created': '📋',
    'picked-up': '🎯',
    'started': '🔄',
    'completed': '✅',
    'blocked': '🚫',
    'released': '📤'
  };

  const message = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
    author: 'system',
    authorType: 'system',
    message: `${emoji[action] || '📋'} **Task ${action}:** "${task.title}" ${agentId ? `by @${agentId}` : ''}`,
    timestamp: new Date().toISOString(),
    reactions: []
  };
  await redis.lpush(MESSAGES_KEY, JSON.stringify(message));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET: List tasks with optional filters
    if (req.method === 'GET') {
      const { status, assignee, available, agentId } = req.query;
      const tasksRaw = await redis.hgetall(TASKS_KEY) || {};
      let tasks: Task[] = Object.values(tasksRaw).map(v =>
        typeof v === 'string' ? JSON.parse(v) : v
      );

      // Filter by status
      if (status && typeof status === 'string') {
        tasks = tasks.filter(t => t.status === status);
      }

      // Filter by assignee
      if (assignee && typeof assignee === 'string') {
        tasks = tasks.filter(t => t.assignee === assignee);
      }

      // Get available tasks (unassigned + todo status) for agents to pick up
      if (available === 'true') {
        tasks = tasks.filter(t =>
          t.status === 'todo' && (!t.assignee || t.assignee === '')
        );
      }

      // Get tasks for specific agent (assigned to them)
      if (agentId && typeof agentId === 'string') {
        tasks = tasks.filter(t => t.assignee === agentId);
      }

      // Sort by priority then by date
      const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      tasks.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3));

      return res.json({
        tasks,
        count: tasks.length,
        summary: {
          todo: tasks.filter(t => t.status === 'todo').length,
          inProgress: tasks.filter(t => t.status === 'in-progress').length,
          review: tasks.filter(t => t.status === 'review').length,
          done: tasks.filter(t => t.status === 'done').length,
          blocked: tasks.filter(t => t.status === 'blocked').length
        }
      });
    }

    // POST: Create task OR special actions (pickup, complete, block, release)
    if (req.method === 'POST') {
      const { action, taskId, agentId, title, description, priority, assignee, createdBy, blockedReason, tags } = req.body;

      // Special action: Agent picks up a task
      if (action === 'pickup') {
        if (!taskId || !agentId) {
          return res.status(400).json({ error: 'taskId and agentId required for pickup' });
        }

        const existing = await redis.hget(TASKS_KEY, taskId);
        if (!existing) return res.status(404).json({ error: 'Task not found' });

        const task: Task = typeof existing === 'string' ? JSON.parse(existing) : existing;

        // Check if task is available
        if (task.assignee && task.assignee !== '' && task.assignee !== agentId) {
          return res.status(409).json({
            error: 'Task already assigned',
            assignedTo: task.assignee,
            message: `CONFLICT: Task is already assigned to ${task.assignee}`
          });
        }

        if (task.status !== 'todo') {
          return res.status(409).json({
            error: 'Task not available',
            status: task.status,
            message: `Task is already ${task.status}`
          });
        }

        task.assignee = agentId;
        task.status = 'in-progress';
        task.pickedUpAt = new Date().toISOString();
        task.updatedAt = new Date().toISOString();

        await redis.hset(TASKS_KEY, { [taskId]: JSON.stringify(task) });
        await postTaskUpdate('picked-up', task, agentId);

        return res.json({ success: true, task, message: `Task assigned to ${agentId}` });
      }

      // Special action: Agent completes a task
      if (action === 'complete') {
        if (!taskId || !agentId) {
          return res.status(400).json({ error: 'taskId and agentId required for complete' });
        }

        const existing = await redis.hget(TASKS_KEY, taskId);
        if (!existing) return res.status(404).json({ error: 'Task not found' });

        const task: Task = typeof existing === 'string' ? JSON.parse(existing) : existing;

        if (task.assignee !== agentId) {
          return res.status(403).json({
            error: 'Not your task',
            assignedTo: task.assignee,
            message: `Task is assigned to ${task.assignee}, not ${agentId}`
          });
        }

        task.status = 'done';
        task.completedAt = new Date().toISOString();
        task.updatedAt = new Date().toISOString();

        await redis.hset(TASKS_KEY, { [taskId]: JSON.stringify(task) });
        await postTaskUpdate('completed', task, agentId);

        return res.json({ success: true, task, message: 'Task completed!' });
      }

      // Special action: Agent blocks a task
      if (action === 'block') {
        if (!taskId || !agentId) {
          return res.status(400).json({ error: 'taskId and agentId required for block' });
        }

        const existing = await redis.hget(TASKS_KEY, taskId);
        if (!existing) return res.status(404).json({ error: 'Task not found' });

        const task: Task = typeof existing === 'string' ? JSON.parse(existing) : existing;

        task.status = 'blocked';
        task.blockedReason = blockedReason || 'Blocked by agent';
        task.updatedAt = new Date().toISOString();

        await redis.hset(TASKS_KEY, { [taskId]: JSON.stringify(task) });
        await postTaskUpdate('blocked', task, agentId);

        return res.json({ success: true, task, message: 'Task blocked' });
      }

      // Special action: Agent releases a task
      if (action === 'release') {
        if (!taskId || !agentId) {
          return res.status(400).json({ error: 'taskId and agentId required for release' });
        }

        const existing = await redis.hget(TASKS_KEY, taskId);
        if (!existing) return res.status(404).json({ error: 'Task not found' });

        const task: Task = typeof existing === 'string' ? JSON.parse(existing) : existing;

        if (task.assignee !== agentId) {
          return res.status(403).json({
            error: 'Not your task',
            assignedTo: task.assignee,
            message: `Task is assigned to ${task.assignee}, not ${agentId}`
          });
        }

        task.assignee = '';
        task.status = 'todo';
        task.pickedUpAt = undefined;
        task.updatedAt = new Date().toISOString();

        await redis.hset(TASKS_KEY, { [taskId]: JSON.stringify(task) });
        await postTaskUpdate('released', task, agentId);

        return res.json({ success: true, task, message: 'Task released back to pool' });
      }

      // Default: Create new task
      if (!title || !createdBy) {
        return res.status(400).json({ error: 'title and createdBy required' });
      }

      const task: Task = {
        id: `task-${Date.now().toString(36)}`,
        title,
        description,
        status: 'todo',
        priority: priority || 'medium',
        assignee: assignee || '',
        createdBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: tags || []
      };
      await redis.hset(TASKS_KEY, { [task.id]: JSON.stringify(task) });
      await postTaskUpdate('created', task, createdBy);

      return res.json({ success: true, task });
    }

    // PATCH: Update task
    if (req.method === 'PATCH') {
      const { id, status, assignee, priority, description, blockedReason, tags } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });

      const existing = await redis.hget(TASKS_KEY, id);
      if (!existing) return res.status(404).json({ error: 'Task not found' });

      const task: Task = typeof existing === 'string' ? JSON.parse(existing) : existing;
      if (status) {
        task.status = status;
        if (status === 'done') task.completedAt = new Date().toISOString();
      }
      if (assignee !== undefined) task.assignee = assignee;
      if (priority) task.priority = priority;
      if (description !== undefined) task.description = description;
      if (blockedReason !== undefined) task.blockedReason = blockedReason;
      if (tags) task.tags = tags;
      task.updatedAt = new Date().toISOString();

      await redis.hset(TASKS_KEY, { [id]: JSON.stringify(task) });
      return res.json({ success: true, task });
    }

    // DELETE: Remove task
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      await redis.hdel(TASKS_KEY, id as string);
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
