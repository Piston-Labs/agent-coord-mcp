import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const TASKS_KEY = 'agent-coord:tasks';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in-progress' | 'review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const tasksRaw = await redis.hgetall(TASKS_KEY) || {};
      const tasks: Task[] = Object.values(tasksRaw).map(v => 
        typeof v === 'string' ? JSON.parse(v) : v
      );
      // Sort by priority then by date
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      tasks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
      return res.json({ tasks, count: tasks.length });
    }

    if (req.method === 'POST') {
      const { title, description, priority, assignee, createdBy } = req.body;
      if (!title || !createdBy) {
        return res.status(400).json({ error: 'title and createdBy required' });
      }
      
      const task: Task = {
        id: `task-${Date.now().toString(36)}`,
        title,
        description,
        status: 'todo',
        priority: priority || 'medium',
        assignee,
        createdBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await redis.hset(TASKS_KEY, { [task.id]: JSON.stringify(task) });
      return res.json({ success: true, task });
    }

    if (req.method === 'PATCH') {
      const { id, status, assignee, priority } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });
      
      const existing = await redis.hget(TASKS_KEY, id);
      if (!existing) return res.status(404).json({ error: 'Task not found' });
      
      const task = typeof existing === 'string' ? JSON.parse(existing) : existing;
      if (status) task.status = status;
      if (assignee !== undefined) task.assignee = assignee;
      if (priority) task.priority = priority;
      task.updatedAt = new Date().toISOString();
      
      await redis.hset(TASKS_KEY, { [id]: JSON.stringify(task) });
      return res.json({ success: true, task });
    }

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
