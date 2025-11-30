import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const LOCKS_KEY = 'agent-coord:locks';
const LOCK_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

interface Lock {
  resourcePath: string;
  lockedBy: string;
  reason?: string;
  lockedAt: string;
  expiresAt: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const locksRaw = await redis.hgetall(LOCKS_KEY) || {};
      const now = Date.now();
      const locks: Lock[] = [];
      
      for (const [key, value] of Object.entries(locksRaw)) {
        const lock = typeof value === 'string' ? JSON.parse(value) : value;
        if (new Date(lock.expiresAt).getTime() > now) {
          locks.push(lock);
        } else {
          await redis.hdel(LOCKS_KEY, key); // Clean expired
        }
      }
      return res.json({ locks, count: locks.length });
    }

    if (req.method === 'POST') {
      const { resourcePath, lockedBy, reason } = req.body;
      if (!resourcePath || !lockedBy) {
        return res.status(400).json({ error: 'resourcePath and lockedBy required' });
      }
      
      const now = new Date();
      const lock: Lock = {
        resourcePath,
        lockedBy,
        reason,
        lockedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + LOCK_EXPIRY_MS).toISOString()
      };
      await redis.hset(LOCKS_KEY, { [resourcePath]: JSON.stringify(lock) });
      return res.json({ success: true, lock });
    }

    if (req.method === 'DELETE') {
      const { resourcePath } = req.query;
      if (!resourcePath) return res.status(400).json({ error: 'resourcePath required' });
      await redis.hdel(LOCKS_KEY, resourcePath as string);
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
