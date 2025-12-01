import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ZONES_KEY = 'agent-coord:zones';

interface Zone {
  zoneId: string;
  owner: string;
  path: string;
  description?: string;
  createdAt: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { owner, zoneId } = req.query;
      const zonesRaw = await redis.hgetall(ZONES_KEY) || {};
      let zones: Zone[] = Object.values(zonesRaw).map(v =>
        typeof v === 'string' ? JSON.parse(v) : v
      );

      // Filter by owner if provided
      if (owner && typeof owner === 'string') {
        zones = zones.filter(z => z.owner === owner);
      }

      // Filter by zoneId if provided
      if (zoneId && typeof zoneId === 'string') {
        zones = zones.filter(z => z.zoneId === zoneId);
      }

      return res.json({ zones, count: zones.length });
    }

    if (req.method === 'POST') {
      const { zoneId, owner, path, description } = req.body;
      if (!zoneId || !owner || !path) {
        return res.status(400).json({ error: 'zoneId, owner, and path required' });
      }
      const zone: Zone = { zoneId, owner, path, description, createdAt: new Date().toISOString() };
      await redis.hset(ZONES_KEY, { [zoneId]: JSON.stringify(zone) });
      return res.json({ success: true, zone });
    }

    if (req.method === 'DELETE') {
      const { zoneId } = req.query;
      if (!zoneId) return res.status(400).json({ error: 'zoneId required' });
      await redis.hdel(ZONES_KEY, zoneId as string);
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
