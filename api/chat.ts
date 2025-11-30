import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const MESSAGES_KEY = 'agent-coord:messages';
const MAX_MESSAGES = 1000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const { limit = '50', since } = req.query;
      const limitNum = parseInt(limit as string, 10);
      
      // Get messages from Redis (stored as JSON strings)
      const messages = await redis.lrange(MESSAGES_KEY, 0, MAX_MESSAGES - 1);
      let result = messages.map((m: any) => typeof m === 'string' ? JSON.parse(m) : m);
      
      if (since && typeof since === 'string') {
        const sinceTime = new Date(since).getTime();
        result = result.filter((m: any) => new Date(m.timestamp).getTime() > sinceTime);
      }
      
      // Return most recent messages (list is newest-first)
      result = result.slice(0, limitNum);
      
      return res.json({ messages: result, count: result.length });
    }

    if (req.method === 'POST') {
      const { author, authorType = 'agent', message } = req.body;

      if (!author || !message) {
        return res.status(400).json({ error: 'author and message required' });
      }

      const newMessage = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
        author,
        authorType,
        message,
        timestamp: new Date().toISOString(),
        reactions: []
      };

      // Push to front of list (newest first)
      await redis.lpush(MESSAGES_KEY, JSON.stringify(newMessage));
      
      // Trim to max messages
      await redis.ltrim(MESSAGES_KEY, 0, MAX_MESSAGES - 1);

      return res.json({ id: newMessage.id, sent: true, timestamp: newMessage.timestamp });
    }

    // DELETE: Clear all messages
    if (req.method === 'DELETE') {
      await redis.del(MESSAGES_KEY);
      return res.json({ cleared: true, message: 'All messages deleted' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Redis error:', error);
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
