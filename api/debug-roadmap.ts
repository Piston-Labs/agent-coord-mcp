import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ROADMAP_KEY = 'agent-coord:roadmap';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // DELETE: Clear all roadmap items
    if (req.method === 'DELETE') {
      const items = await redis.hgetall(ROADMAP_KEY);
      const keys = Object.keys(items || {});

      for (const key of keys) {
        await redis.hdel(ROADMAP_KEY, key);
      }

      return res.json({
        success: true,
        deleted: keys.length,
        keys: keys
      });
    }

    // GET: Get raw data from Redis to debug
    const items = await redis.hgetall(ROADMAP_KEY);

    const debug = {
      rawItems: items,
      rawType: typeof items,
      entries: Object.entries(items || {}).map(([key, value]) => ({
        key,
        valueType: typeof value,
        value: value,
        isString: typeof value === 'string',
        canParse: (() => {
          if (typeof value === 'string') {
            try {
              JSON.parse(value);
              return true;
            } catch {
              return false;
            }
          }
          return typeof value === 'object';
        })()
      })),
      count: Object.keys(items || {}).length,
      now: new Date().toISOString()
    };

    return res.json(debug);
  } catch (error) {
    console.error('Debug roadmap error:', error);
    return res.status(500).json({ error: 'Debug error', details: String(error) });
  }
}
