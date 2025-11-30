import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ROADMAP_KEY = 'agent-coord:roadmap';

interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  status: 'backlog' | 'planned' | 'in-progress' | 'review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;
  assigneeType: 'human' | 'bot';
  project: string;
  phase?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  dueDate?: string;
  progress?: number;
}

interface BulkImportItem {
  title: string;
  description?: string;
  status?: 'backlog' | 'planned' | 'in-progress' | 'review' | 'done';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;
  assigneeType?: 'human' | 'bot';
  project: string;
  phase?: string;
  tags?: string[];
  dueDate?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { items, clearProject } = req.body as { items: BulkImportItem[], clearProject?: string };

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'items array required' });
    }

    // Optionally clear existing items for a project before import
    if (clearProject) {
      const existing = await redis.hgetall(ROADMAP_KEY);
      for (const [key, value] of Object.entries(existing || {})) {
        const item = typeof value === 'string' ? JSON.parse(value) : value;
        if (item.project === clearProject) {
          await redis.hdel(ROADMAP_KEY, key);
        }
      }
    }

    const imported: RoadmapItem[] = [];
    const now = new Date().toISOString();

    for (const item of items) {
      if (!item.title || !item.project) {
        continue; // Skip invalid items
      }

      const roadmapItem: RoadmapItem = {
        id: `roadmap-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        title: item.title,
        description: item.description || '',
        status: item.status || 'backlog',
        priority: item.priority || 'medium',
        assignee: item.assignee,
        assigneeType: item.assigneeType || 'human',
        project: item.project,
        phase: item.phase,
        tags: item.tags || [],
        createdAt: now,
        updatedAt: now,
        dueDate: item.dueDate,
        progress: 0
      };

      await redis.hset(ROADMAP_KEY, { [roadmapItem.id]: JSON.stringify(roadmapItem) });
      imported.push(roadmapItem);

      // Small delay to ensure unique IDs
      await new Promise(r => setTimeout(r, 5));
    }

    // Post summary to chat
    const chatMessage = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
      author: 'system',
      authorType: 'system',
      message: `📋 Bulk import: Added ${imported.length} items to roadmap${clearProject ? ` (cleared ${clearProject} first)` : ''}`,
      timestamp: now,
      reactions: []
    };
    await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));

    return res.json({
      success: true,
      imported: imported.length,
      items: imported
    });

  } catch (error) {
    console.error('Bulk import error:', error);
    return res.status(500).json({ error: 'Import failed', details: String(error) });
  }
}
