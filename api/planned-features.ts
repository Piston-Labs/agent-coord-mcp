import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const FEATURES_KEY = 'agent-coord:planned-features';

interface PlannedFeature {
  id: string;
  title: string;
  description: string;
  status: 'planned' | 'in-progress' | 'testing' | 'done';
  assignedTo: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  createdAt: string;
  updatedAt: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List all planned features
    if (req.method === 'GET') {
      const features = await redis.hgetall(FEATURES_KEY) || {};
      const featureList: PlannedFeature[] = [];
      
      for (const [, value] of Object.entries(features)) {
        try {
          const feature = typeof value === 'string' ? JSON.parse(value) : value;
          if (feature.status !== 'done') {
            featureList.push(feature);
          }
        } catch (e) {
          console.error('Invalid feature entry:', e);
        }
      }
      
      // Sort by priority
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      featureList.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
      
      return res.json({ features: featureList, count: featureList.length });
    }

    // POST: Add a new planned feature
    if (req.method === 'POST') {
      const { title, description, assignedTo, priority = 'medium' } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'title is required' });
      }

      const feature: PlannedFeature = {
        id: `feat-${Date.now().toString(36)}`,
        title,
        description: description || '',
        status: 'planned',
        assignedTo: assignedTo || 'unassigned',
        priority,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await redis.hset(FEATURES_KEY, { [feature.id]: JSON.stringify(feature) });

      return res.json({ success: true, feature });
    }

    // PATCH: Update a feature
    if (req.method === 'PATCH') {
      const { id, ...updates } = req.body;
      
      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      const existing = await redis.hget(FEATURES_KEY, id);
      if (!existing) {
        return res.status(404).json({ error: 'Feature not found' });
      }

      const feature = typeof existing === 'string' ? JSON.parse(existing) : existing;
      const updated = { ...feature, ...updates, updatedAt: new Date().toISOString() };
      
      await redis.hset(FEATURES_KEY, { [id]: JSON.stringify(updated) });

      return res.json({ success: true, feature: updated });
    }

    // DELETE: Remove a feature
    if (req.method === 'DELETE') {
      const { id } = req.body;
      
      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      await redis.hdel(FEATURES_KEY, id);
      return res.json({ success: true, deleted: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Planned features error:', error);
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
