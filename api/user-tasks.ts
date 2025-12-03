import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SESSIONS_KEY = 'agent-coord:sessions';
const PRIVATE_TASKS_KEY = 'agent-coord:private-tasks';

interface PrivateTask {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in-progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category?: string;
  dueDate?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  notes?: string;
}

/**
 * Extract session ID from cookie
 */
function getSessionFromCookie(req: VercelRequest): string | null {
  const cookies = req.headers.cookie;
  if (!cookies) return null;
  const sessionMatch = cookies.match(/session=([^;]+)/);
  return sessionMatch ? sessionMatch[1] : null;
}

/**
 * Get current user from session - returns username if authenticated
 */
async function getCurrentUser(req: VercelRequest): Promise<string | null> {
  // First check for explicit user query param (for MCP tool usage)
  const { user } = req.query;
  if (user && typeof user === 'string') {
    return user;
  }

  // Fall back to session cookie
  const sessionId = getSessionFromCookie(req);
  if (!sessionId) return null;

  const raw = await redis.hget(SESSIONS_KEY, sessionId);
  if (!raw) return null;

  const session = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // Check expiry
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
    return null;
  }

  return session.username;
}

/**
 * User Private Tasks API - Personal task management scoped to individual users
 *
 * GET /api/user-tasks - List user's private tasks
 * GET /api/user-tasks?status=todo - Filter by status
 * GET /api/user-tasks?taskId=X - Get single task
 * POST /api/user-tasks - Create new task
 * PATCH /api/user-tasks - Update task
 * DELETE /api/user-tasks?taskId=X - Delete task
 *
 * Authentication: Requires session cookie OR ?user=username param
 * Privacy: Users can only see/modify their own tasks
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Get current user from session or query param
    const currentUser = await getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({
        error: 'Not authenticated',
        hint: 'Log in via the dashboard or pass ?user=username'
      });
    }

    // =========================================================================
    // GET: List user's private tasks
    // =========================================================================
    if (req.method === 'GET') {
      const { taskId, status, priority, category } = req.query;

      // Get single task
      if (taskId && typeof taskId === 'string') {
        const key = `${currentUser}:${taskId}`;
        const task = await redis.hget(PRIVATE_TASKS_KEY, key);

        if (!task) {
          return res.status(404).json({ error: 'Task not found' });
        }

        const parsed = typeof task === 'string' ? JSON.parse(task) : task;

        // Verify ownership
        if (parsed.createdBy !== currentUser) {
          return res.status(403).json({ error: 'Unauthorized' });
        }

        return res.json({ task: parsed });
      }

      // Get all tasks for user
      const allTasks = await redis.hgetall(PRIVATE_TASKS_KEY) || {};

      // Filter to only tasks created by current user
      let tasks: PrivateTask[] = Object.entries(allTasks)
        .filter(([key]) => key.startsWith(`${currentUser}:`))
        .map(([_, v]) => typeof v === 'string' ? JSON.parse(v) : v);

      // Apply filters
      if (status && typeof status === 'string') {
        tasks = tasks.filter(t => t.status === status);
      }
      if (priority && typeof priority === 'string') {
        tasks = tasks.filter(t => t.priority === priority);
      }
      if (category && typeof category === 'string') {
        tasks = tasks.filter(t => t.category === category);
      }

      // Sort by priority (urgent first) then by createdAt
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      tasks.sort((a, b) => {
        const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (pDiff !== 0) return pDiff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      // Get summary stats
      const stats = {
        total: tasks.length,
        todo: tasks.filter(t => t.status === 'todo').length,
        inProgress: tasks.filter(t => t.status === 'in-progress').length,
        done: tasks.filter(t => t.status === 'done').length,
        blocked: tasks.filter(t => t.status === 'blocked').length
      };

      return res.json({
        user: currentUser,
        tasks,
        count: tasks.length,
        stats
      });
    }

    // =========================================================================
    // POST: Create new task
    // =========================================================================
    if (req.method === 'POST') {
      const { title, description, priority = 'medium', category, dueDate, notes } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'title required' });
      }

      const taskId = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
      const task: PrivateTask = {
        id: taskId,
        title,
        description,
        status: 'todo',
        priority,
        category,
        dueDate,
        notes,
        createdBy: currentUser,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Store with username prefix in key for easy filtering
      const key = `${currentUser}:${taskId}`;
      await redis.hset(PRIVATE_TASKS_KEY, { [key]: JSON.stringify(task) });

      return res.json({
        success: true,
        task,
        message: `Task "${title}" created`
      });
    }

    // =========================================================================
    // PATCH: Update task
    // =========================================================================
    if (req.method === 'PATCH') {
      const { taskId, title, description, status, priority, category, dueDate, notes } = req.body;

      if (!taskId) {
        return res.status(400).json({ error: 'taskId required' });
      }

      const key = `${currentUser}:${taskId}`;
      const existing = await redis.hget(PRIVATE_TASKS_KEY, key);

      if (!existing) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const task: PrivateTask = typeof existing === 'string' ? JSON.parse(existing) : existing;

      // Verify ownership
      if (task.createdBy !== currentUser) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      // Apply updates
      if (title !== undefined) task.title = title;
      if (description !== undefined) task.description = description;
      if (status !== undefined) {
        task.status = status;
        if (status === 'done' && !task.completedAt) {
          task.completedAt = new Date().toISOString();
        }
      }
      if (priority !== undefined) task.priority = priority;
      if (category !== undefined) task.category = category;
      if (dueDate !== undefined) task.dueDate = dueDate;
      if (notes !== undefined) task.notes = notes;
      task.updatedAt = new Date().toISOString();

      await redis.hset(PRIVATE_TASKS_KEY, { [key]: JSON.stringify(task) });

      return res.json({
        success: true,
        task,
        message: `Task "${task.title}" updated`
      });
    }

    // =========================================================================
    // DELETE: Remove task
    // =========================================================================
    if (req.method === 'DELETE') {
      const { taskId } = req.query;

      if (!taskId || typeof taskId !== 'string') {
        return res.status(400).json({ error: 'taskId required' });
      }

      const key = `${currentUser}:${taskId}`;
      const existing = await redis.hget(PRIVATE_TASKS_KEY, key);

      if (!existing) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const task = typeof existing === 'string' ? JSON.parse(existing) : existing;

      // Verify ownership
      if (task.createdBy !== currentUser) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      await redis.hdel(PRIVATE_TASKS_KEY, key);

      return res.json({
        success: true,
        deleted: taskId,
        message: `Task "${task.title}" deleted`
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('User tasks error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
