import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const HANDOFFS_KEY = 'agent-coord:handoffs'; // Code handoff queue storage

interface Handoff {
  id: string;
  taskId?: string;
  fromAgent: string;
  toAgent: string;
  type: 'code' | 'patch' | 'test' | 'review' | 'other';
  status: 'submitted' | 'claimed' | 'in_review' | 'integrated' | 'rejected';
  title: string;
  description?: string;
  code?: string;
  filePath?: string;
  tests?: string;
  context?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: string;
  updatedAt: string;
  claimedBy?: string;
  claimedAt?: string;
  completedAt?: string;
  feedback?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List handoffs (optionally filtered)
    if (req.method === 'GET') {
      const { status, toAgent, fromAgent, type } = req.query;

      const handoffsRaw = await redis.hgetall(HANDOFFS_KEY) || {};
      let handoffs: Handoff[] = Object.values(handoffsRaw).map((h: unknown) =>
        typeof h === 'string' ? JSON.parse(h) : h
      ) as Handoff[];

      // Apply filters
      if (status && typeof status === 'string') {
        handoffs = handoffs.filter(h => h.status === status);
      }
      if (toAgent && typeof toAgent === 'string') {
        handoffs = handoffs.filter(h => h.toAgent === toAgent || h.toAgent === 'any');
      }
      if (fromAgent && typeof fromAgent === 'string') {
        handoffs = handoffs.filter(h => h.fromAgent === fromAgent);
      }
      if (type && typeof type === 'string') {
        handoffs = handoffs.filter(h => h.type === type);
      }

      // Sort by priority and creation time
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      handoffs.sort((a, b) => {
        const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (pDiff !== 0) return pDiff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      return res.json({
        handoffs,
        count: handoffs.length,
        pending: handoffs.filter(h => h.status === 'submitted').length
      });
    }

    // POST: Create new handoff
    if (req.method === 'POST') {
      const {
        taskId,
        fromAgent,
        toAgent = 'claude-code', // Default recipient
        type = 'code',
        title,
        description,
        code,
        filePath,
        tests,
        context,
        priority = 'medium'
      } = req.body;

      if (!fromAgent || !title) {
        return res.status(400).json({ error: 'fromAgent and title are required' });
      }

      const handoff: Handoff = {
        id: `ho-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
        taskId,
        fromAgent,
        toAgent,
        type,
        status: 'submitted',
        title,
        description,
        code,
        filePath,
        tests,
        context,
        priority,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await redis.hset(HANDOFFS_KEY, { [handoff.id]: JSON.stringify(handoff) });

      return res.json({
        success: true,
        handoff,
        message: `Handoff submitted to ${toAgent}`
      });
    }

    // PATCH: Update handoff status (claim, review, integrate, reject)
    if (req.method === 'PATCH') {
      const { id, status, claimedBy, feedback } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'id required' });
      }

      const raw = await redis.hget(HANDOFFS_KEY, id);
      if (!raw) {
        return res.status(404).json({ error: 'Handoff not found' });
      }

      const handoff: Handoff = typeof raw === 'string' ? JSON.parse(raw) : raw;

      // Update fields
      if (status) {
        handoff.status = status;

        if (status === 'claimed' && claimedBy) {
          handoff.claimedBy = claimedBy;
          handoff.claimedAt = new Date().toISOString();
        }

        if (status === 'integrated' || status === 'rejected') {
          handoff.completedAt = new Date().toISOString();
        }
      }

      if (feedback) {
        handoff.feedback = feedback;
      }

      handoff.updatedAt = new Date().toISOString();

      await redis.hset(HANDOFFS_KEY, { [id]: JSON.stringify(handoff) });

      return res.json({ success: true, handoff });
    }

    // DELETE: Remove a handoff
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'id required' });
      }

      await redis.hdel(HANDOFFS_KEY, id);
      return res.json({ success: true, message: 'Handoff deleted' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Handoffs error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
