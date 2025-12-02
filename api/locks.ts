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

      // RACE CONDITION PROTECTION: Check existing lock first
      const existingRaw = await redis.hget(LOCKS_KEY, resourcePath);
      if (existingRaw) {
        const existing = typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw;
        const now = Date.now();

        // Check if existing lock is still valid (not expired)
        if (new Date(existing.expiresAt).getTime() > now) {
          // Lock exists and is valid
          if (existing.lockedBy === lockedBy) {
            // Same agent - extend/refresh the lock
            const refreshedLock: Lock = {
              resourcePath,
              lockedBy,
              reason: reason || existing.reason,
              lockedAt: existing.lockedAt,
              expiresAt: new Date(now + LOCK_EXPIRY_MS).toISOString()
            };
            await redis.hset(LOCKS_KEY, { [resourcePath]: JSON.stringify(refreshedLock) });
            return res.json({ success: true, lock: refreshedLock, refreshed: true });
          } else {
            // Different agent - BLOCKED
            return res.status(409).json({
              success: false,
              error: 'Resource already locked',
              lockedBy: existing.lockedBy,
              expiresAt: existing.expiresAt,
              message: `Resource "${resourcePath}" is locked by ${existing.lockedBy}. Wait for release or expiry.`
            });
          }
        }
        // Lock expired - clean it up and proceed
        await redis.hdel(LOCKS_KEY, resourcePath);
      }

      // ATOMIC LOCK ACQUISITION: Use hsetnx to prevent race conditions
      const now = new Date();
      const lock: Lock = {
        resourcePath,
        lockedBy,
        reason,
        lockedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + LOCK_EXPIRY_MS).toISOString()
      };

      // hsetnx returns 1 if field was set (didn't exist), 0 if it existed
      const wasSet = await redis.hsetnx(LOCKS_KEY, resourcePath, JSON.stringify(lock));

      if (wasSet === 0) {
        // Another agent grabbed it between our check and set - race condition caught!
        const racedLock = await redis.hget(LOCKS_KEY, resourcePath);
        const raced = typeof racedLock === 'string' ? JSON.parse(racedLock) : racedLock;
        return res.status(409).json({
          success: false,
          error: 'Race condition - resource was locked by another agent',
          lockedBy: raced?.lockedBy || 'unknown',
          message: 'Another agent acquired the lock simultaneously. Retry shortly.'
        });
      }

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
