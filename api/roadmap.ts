import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ROADMAP_KEY = 'agent-coord:roadmap';
const TEAM_KEY = 'agent-coord:team';

interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  status: 'backlog' | 'planned' | 'in-progress' | 'review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;        // Can be bot ID or human name (e.g., "ryan", "tom", "autonomous-agent")
  assigneeType: 'human' | 'bot';
  project: string;          // e.g., "teltonika", "gran-autismo", "agent-coord"
  tags: string[];
  createdAt: string;
  updatedAt: string;
  dueDate?: string;
  progress?: number;        // 0-100
}

interface TeamMember {
  id: string;
  name: string;
  type: 'human' | 'bot';
  role: string;
  avatar?: string;
  color?: string;
}

// Default team members for Piston Labs
const DEFAULT_TEAM: TeamMember[] = [
  { id: 'tyler', name: 'Tyler Porras', type: 'human', role: 'CEO', color: '#a371f7' },
  { id: 'ryan', name: 'Ryan Morris', type: 'human', role: 'Technical Co-Founder, Dashboard', color: '#58a6ff' },
  { id: 'tom', name: 'Tom', type: 'human', role: 'Hardware & IoT', color: '#3fb950' },
  { id: 'eli', name: 'Eli', type: 'human', role: 'Sales Engineering', color: '#d29922' },
  { id: 'autonomous-agent', name: 'Autonomous Agent', type: 'bot', role: 'Orchestrator', color: '#f85149' },
  { id: 'claude-code', name: 'Claude Code', type: 'bot', role: 'Developer', color: '#8b949e' },
  { id: 'claude-desktop', name: 'Claude Desktop', type: 'bot', role: 'Coordinator', color: '#8b949e' },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List roadmap items or team members
    if (req.method === 'GET') {
      const { type, project, assignee, status, priority } = req.query;

      // Get team members
      if (type === 'team') {
        let team = await redis.hgetall(TEAM_KEY);
        if (!team || Object.keys(team).length === 0) {
          // Initialize with default team
          for (const member of DEFAULT_TEAM) {
            await redis.hset(TEAM_KEY, { [member.id]: JSON.stringify(member) });
          }
          team = DEFAULT_TEAM.reduce((acc, m) => ({ ...acc, [m.id]: m }), {});
        }
        const teamList = Object.values(team).map((t: any) =>
          typeof t === 'string' ? JSON.parse(t) : t
        );
        return res.json({ team: teamList, count: teamList.length });
      }

      // Get roadmap items
      const items = await redis.hgetall(ROADMAP_KEY);
      let roadmapList: RoadmapItem[] = [];
      for (const [key, value] of Object.entries(items || {})) {
        try {
          const item = typeof value === 'string' ? JSON.parse(value) : value;
          if (item && item.id && item.title) {
            roadmapList.push(item);
          }
        } catch (e) {
          // Skip corrupted entries, optionally delete them
          console.error(`Skipping corrupted roadmap entry: ${key}`);
          await redis.hdel(ROADMAP_KEY, key);
        }
      }

      // Filter by project
      if (project && typeof project === 'string') {
        roadmapList = roadmapList.filter((item: RoadmapItem) => item.project === project);
      }

      // Filter by assignee
      if (assignee && typeof assignee === 'string') {
        roadmapList = roadmapList.filter((item: RoadmapItem) => item.assignee === assignee);
      }

      // Filter by status
      if (status && typeof status === 'string') {
        roadmapList = roadmapList.filter((item: RoadmapItem) => item.status === status);
      }

      // Filter by priority
      if (priority && typeof priority === 'string') {
        roadmapList = roadmapList.filter((item: RoadmapItem) => item.priority === priority);
      }

      // Sort by priority then by updatedAt
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      roadmapList.sort((a: RoadmapItem, b: RoadmapItem) => {
        const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (pDiff !== 0) return pDiff;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

      return res.json({ items: roadmapList, count: roadmapList.length });
    }

    // POST: Create new roadmap item or team member
    if (req.method === 'POST') {
      const { type } = req.query;

      // Add team member
      if (type === 'team') {
        const { id, name, role, memberType, color } = req.body;
        if (!id || !name) {
          return res.status(400).json({ error: 'id and name required' });
        }
        const member: TeamMember = {
          id,
          name,
          type: memberType || 'human',
          role: role || '',
          color: color || '#8b949e'
        };
        await redis.hset(TEAM_KEY, { [id]: JSON.stringify(member) });
        return res.json({ success: true, member });
      }

      // Add roadmap item
      const { title, description, status, priority, assignee, assigneeType, project, tags, dueDate } = req.body;

      if (!title || !project) {
        return res.status(400).json({ error: 'title and project required' });
      }

      const item: RoadmapItem = {
        id: `roadmap-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        title,
        description: description || '',
        status: status || 'backlog',
        priority: priority || 'medium',
        assignee: assignee || undefined,
        assigneeType: assigneeType || 'human',
        project,
        tags: tags || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        dueDate: dueDate || undefined,
        progress: 0
      };

      await redis.hset(ROADMAP_KEY, { [item.id]: JSON.stringify(item) });

      // Post to group chat
      const chatMessage = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
        author: 'system',
        authorType: 'system',
        message: `📋 New roadmap item: **${title}** (${project})\nPriority: ${priority || 'medium'}${assignee ? `\nAssigned to: ${assignee}` : ''}`,
        timestamp: new Date().toISOString(),
        reactions: []
      };
      await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));

      return res.json({ success: true, item });
    }

    // PUT: Update roadmap item
    if (req.method === 'PUT') {
      const { id, ...updates } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'id required' });
      }

      const existing = await redis.hget(ROADMAP_KEY, id);
      if (!existing) {
        return res.status(404).json({ error: 'Item not found' });
      }

      const item = typeof existing === 'string' ? JSON.parse(existing) : existing;
      const updated = {
        ...item,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      await redis.hset(ROADMAP_KEY, { [id]: JSON.stringify(updated) });

      // If status changed, post to chat
      if (updates.status && updates.status !== item.status) {
        const statusEmoji: Record<string, string> = {
          'backlog': '📝',
          'planned': '📅',
          'in-progress': '🔄',
          'review': '👀',
          'done': '✅'
        };
        const chatMessage = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
          author: 'system',
          authorType: 'system',
          message: `${statusEmoji[updates.status] || '📋'} Roadmap update: **${item.title}** → ${updates.status}${updates.assignee ? ` (${updates.assignee})` : ''}`,
          timestamp: new Date().toISOString(),
          reactions: []
        };
        await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));
      }

      return res.json({ success: true, item: updated });
    }

    // DELETE: Remove roadmap item
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'id required' });
      }

      await redis.hdel(ROADMAP_KEY, id);
      return res.json({ success: true, deleted: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Roadmap error:', error);
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
