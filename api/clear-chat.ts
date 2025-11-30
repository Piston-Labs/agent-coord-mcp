import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const MESSAGES_KEY = 'agent-coord:messages';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    try {
      await redis.del(MESSAGES_KEY);
      return res.json({ cleared: true, message: 'All messages deleted' });
    } catch (error) {
      console.error('Redis error:', error);
      return res.status(500).json({ error: 'Database error', details: String(error) });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
