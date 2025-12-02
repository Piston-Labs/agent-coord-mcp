import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ROADMAP_KEY = 'agent-coord:roadmap';
const TEAM_KEY = 'agent-coord:team';
const CYCLES_KEY = 'agent-coord:cycles';

interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  status: 'backlog' | 'planned' | 'in-progress' | 'review' | 'done' | 'archived';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;        // Can be bot ID or human name (e.g., "ryan", "tom", "autonomous-agent")
  assigneeType: 'human' | 'bot';
  project: string;          // e.g., "teltonika", "gran-autismo", "agent-coord"
  tags: string[];
  createdAt: string;
  updatedAt: string;
  dueDate?: string;
  progress?: number;        // 0-100

  // Dependencies (Linear/Jira-style)
  blockedBy?: string[];     // IDs of items that block this one
  blocks?: string[];        // IDs of items this one blocks

  // Subtasks (hierarchy)
  parentId?: string;        // If this is a subtask, the parent item ID
  subtaskIds?: string[];    // IDs of child tasks

  // Time tracking
  estimate?: number;        // Estimated hours
  timeSpent?: number;       // Actual hours spent

  // Milestones/Sprints
  milestone?: string;       // e.g., "v1.0", "Sprint 23", "Q1 2024"
  cycleId?: string;         // Links to a cycle/sprint

  // Workflow metadata
  completedAt?: string;     // When status changed to 'done'
  archivedAt?: string;      // When status changed to 'archived'
  lastActivityBy?: string;  // Who last modified this item
}

interface TeamMember {
  id: string;
  name: string;
  type: 'human' | 'bot';
  role: string;
  avatar?: string;
  color?: string;
}

// Cycles/Sprints (Linear-inspired)
interface Cycle {
  id: string;
  name: string;               // e.g., "Sprint 23", "Week 49"
  project: string;
  startDate: string;
  endDate: string;
  status: 'upcoming' | 'active' | 'completed';
  goals?: string[];           // Sprint goals
  velocity?: number;          // Points/items completed
  plannedItems?: number;      // Items at start
  completedItems?: number;    // Items done
  createdAt: string;
  updatedAt: string;
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List roadmap items or team members
    if (req.method === 'GET') {
      const { type, project, assignee, status, priority } = req.query;

      // Get cycles/sprints
      if (type === 'cycles') {
        const cycles = await redis.hgetall(CYCLES_KEY);
        let cycleList: Cycle[] = [];
        for (const [, value] of Object.entries(cycles || {})) {
          const cycle = typeof value === 'string' ? JSON.parse(value) : value;
          if (cycle && cycle.id) cycleList.push(cycle);
        }
        // Filter by project if specified
        if (project && typeof project === 'string') {
          cycleList = cycleList.filter(c => c.project === project);
        }
        // Sort by startDate descending
        cycleList.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
        return res.json({ cycles: cycleList, count: cycleList.length });
      }

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

      // Create cycle/sprint
      if (type === 'cycle') {
        const { name, project: proj, startDate, endDate, goals } = req.body;
        if (!name || !proj || !startDate || !endDate) {
          return res.status(400).json({ error: 'name, project, startDate, endDate required' });
        }

        const now = new Date();
        const start = new Date(startDate);
        const end = new Date(endDate);
        let status: 'upcoming' | 'active' | 'completed' = 'upcoming';
        if (now >= start && now <= end) status = 'active';
        if (now > end) status = 'completed';

        const cycle: Cycle = {
          id: `cycle-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          name,
          project: proj,
          startDate,
          endDate,
          status,
          goals: goals || [],
          velocity: 0,
          plannedItems: 0,
          completedItems: 0,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        };

        await redis.hset(CYCLES_KEY, { [cycle.id]: JSON.stringify(cycle) });

        // Notify in chat
        const chatMessage = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
          author: 'system',
          authorType: 'system',
          message: `🔄 New cycle created: **${name}** (${proj})\n${startDate} → ${endDate}`,
          timestamp: now.toISOString(),
          reactions: []
        };
        await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));

        return res.json({ success: true, cycle });
      }

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

    // PATCH: Batch operations
    if (req.method === 'PATCH') {
      const { action } = req.body;

      // BATCH STATUS UPDATE
      if (action === 'batch-status') {
        const { ids, status, updatedBy } = req.body;
        if (!ids || !Array.isArray(ids) || !status) {
          return res.status(400).json({ error: 'ids (array) and status required' });
        }

        const updated: RoadmapItem[] = [];
        const now = new Date().toISOString();

        for (const id of ids) {
          const existing = await redis.hget(ROADMAP_KEY, id);
          if (existing) {
            const item = typeof existing === 'string' ? JSON.parse(existing) : existing;
            item.status = status;
            item.updatedAt = now;
            item.lastActivityBy = updatedBy || 'system';
            if (status === 'done') item.completedAt = now;
            if (status === 'archived') item.archivedAt = now;
            await redis.hset(ROADMAP_KEY, { [id]: JSON.stringify(item) });
            updated.push(item);
          }
        }

        return res.json({ success: true, updated, count: updated.length });
      }

      // BATCH ASSIGN
      if (action === 'batch-assign') {
        const { ids, assignee, assigneeType = 'human' } = req.body;
        if (!ids || !Array.isArray(ids) || !assignee) {
          return res.status(400).json({ error: 'ids (array) and assignee required' });
        }

        const updated: RoadmapItem[] = [];
        const now = new Date().toISOString();

        for (const id of ids) {
          const existing = await redis.hget(ROADMAP_KEY, id);
          if (existing) {
            const item = typeof existing === 'string' ? JSON.parse(existing) : existing;
            item.assignee = assignee;
            item.assigneeType = assigneeType;
            item.updatedAt = now;
            await redis.hset(ROADMAP_KEY, { [id]: JSON.stringify(item) });
            updated.push(item);
          }
        }

        return res.json({ success: true, updated, count: updated.length });
      }

      // ADD DEPENDENCY
      if (action === 'add-dependency') {
        const { itemId, blockedById } = req.body;
        if (!itemId || !blockedById) {
          return res.status(400).json({ error: 'itemId and blockedById required' });
        }

        // Update the item being blocked
        const itemRaw = await redis.hget(ROADMAP_KEY, itemId);
        if (!itemRaw) return res.status(404).json({ error: 'Item not found' });
        const item = typeof itemRaw === 'string' ? JSON.parse(itemRaw) : itemRaw;
        item.blockedBy = [...(item.blockedBy || []), blockedById].filter((v, i, a) => a.indexOf(v) === i);
        item.updatedAt = new Date().toISOString();
        await redis.hset(ROADMAP_KEY, { [itemId]: JSON.stringify(item) });

        // Update the blocking item
        const blockerRaw = await redis.hget(ROADMAP_KEY, blockedById);
        if (blockerRaw) {
          const blocker = typeof blockerRaw === 'string' ? JSON.parse(blockerRaw) : blockerRaw;
          blocker.blocks = [...(blocker.blocks || []), itemId].filter((v, i, a) => a.indexOf(v) === i);
          blocker.updatedAt = new Date().toISOString();
          await redis.hset(ROADMAP_KEY, { [blockedById]: JSON.stringify(blocker) });
        }

        return res.json({ success: true, item, message: `${itemId} is now blocked by ${blockedById}` });
      }

      // REMOVE DEPENDENCY
      if (action === 'remove-dependency') {
        const { itemId, blockedById } = req.body;
        if (!itemId || !blockedById) {
          return res.status(400).json({ error: 'itemId and blockedById required' });
        }

        const itemRaw = await redis.hget(ROADMAP_KEY, itemId);
        if (!itemRaw) return res.status(404).json({ error: 'Item not found' });
        const item = typeof itemRaw === 'string' ? JSON.parse(itemRaw) : itemRaw;
        item.blockedBy = (item.blockedBy || []).filter((id: string) => id !== blockedById);
        item.updatedAt = new Date().toISOString();
        await redis.hset(ROADMAP_KEY, { [itemId]: JSON.stringify(item) });

        const blockerRaw = await redis.hget(ROADMAP_KEY, blockedById);
        if (blockerRaw) {
          const blocker = typeof blockerRaw === 'string' ? JSON.parse(blockerRaw) : blockerRaw;
          blocker.blocks = (blocker.blocks || []).filter((id: string) => id !== itemId);
          blocker.updatedAt = new Date().toISOString();
          await redis.hset(ROADMAP_KEY, { [blockedById]: JSON.stringify(blocker) });
        }

        return res.json({ success: true, message: `Dependency removed` });
      }

      // ADD SUBTASK
      if (action === 'add-subtask') {
        const { parentId, title, description, priority = 'medium', assignee } = req.body;
        if (!parentId || !title) {
          return res.status(400).json({ error: 'parentId and title required' });
        }

        const parentRaw = await redis.hget(ROADMAP_KEY, parentId);
        if (!parentRaw) return res.status(404).json({ error: 'Parent item not found' });
        const parent = typeof parentRaw === 'string' ? JSON.parse(parentRaw) : parentRaw;

        // Create subtask
        const subtask: RoadmapItem = {
          id: `roadmap-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          title,
          description: description || '',
          status: 'backlog',
          priority,
          assignee: assignee || parent.assignee,
          assigneeType: parent.assigneeType || 'human',
          project: parent.project,
          tags: parent.tags || [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          parentId,
          progress: 0
        };

        await redis.hset(ROADMAP_KEY, { [subtask.id]: JSON.stringify(subtask) });

        // Update parent's subtaskIds
        parent.subtaskIds = [...(parent.subtaskIds || []), subtask.id];
        parent.updatedAt = new Date().toISOString();
        await redis.hset(ROADMAP_KEY, { [parentId]: JSON.stringify(parent) });

        return res.json({ success: true, subtask, parent });
      }

      // ARCHIVE DONE ITEMS
      if (action === 'archive-done') {
        const { project } = req.body;
        const items = await redis.hgetall(ROADMAP_KEY);
        const archived: string[] = [];
        const now = new Date().toISOString();

        for (const [key, value] of Object.entries(items || {})) {
          const item = typeof value === 'string' ? JSON.parse(value) : value;
          if (item.status === 'done' && (!project || item.project === project)) {
            item.status = 'archived';
            item.archivedAt = now;
            item.updatedAt = now;
            await redis.hset(ROADMAP_KEY, { [key]: JSON.stringify(item) });
            archived.push(key);
          }
        }

        return res.json({ success: true, archived, count: archived.length });
      }

      // GET BLOCKED ITEMS (items that can't proceed)
      if (action === 'get-blocked') {
        const items = await redis.hgetall(ROADMAP_KEY);
        const blocked: RoadmapItem[] = [];

        for (const [, value] of Object.entries(items || {})) {
          const item = typeof value === 'string' ? JSON.parse(value) : value;
          if (item.blockedBy && item.blockedBy.length > 0 && item.status !== 'done' && item.status !== 'archived') {
            // Check if any blocker is still not done
            let stillBlocked = false;
            for (const blockerId of item.blockedBy) {
              const blockerRaw = await redis.hget(ROADMAP_KEY, blockerId);
              if (blockerRaw) {
                const blocker = typeof blockerRaw === 'string' ? JSON.parse(blockerRaw) : blockerRaw;
                if (blocker.status !== 'done' && blocker.status !== 'archived') {
                  stillBlocked = true;
                  break;
                }
              }
            }
            if (stillBlocked) blocked.push(item);
          }
        }

        return res.json({ blocked, count: blocked.length });
      }

      // GET WORKLOAD (items per assignee)
      if (action === 'get-workload') {
        const items = await redis.hgetall(ROADMAP_KEY);
        const workload: Record<string, { total: number; byStatus: Record<string, number>; byPriority: Record<string, number> }> = {};

        for (const [, value] of Object.entries(items || {})) {
          const item = typeof value === 'string' ? JSON.parse(value) : value;
          if (item.status === 'done' || item.status === 'archived') continue;

          const assignee = item.assignee || 'unassigned';
          if (!workload[assignee]) {
            workload[assignee] = { total: 0, byStatus: {}, byPriority: {} };
          }

          workload[assignee].total++;
          workload[assignee].byStatus[item.status] = (workload[assignee].byStatus[item.status] || 0) + 1;
          workload[assignee].byPriority[item.priority] = (workload[assignee].byPriority[item.priority] || 0) + 1;
        }

        return res.json({ workload });
      }

      // ASSIGN TO CYCLE
      if (action === 'assign-to-cycle') {
        const { itemIds, cycleId } = req.body;
        if (!itemIds || !Array.isArray(itemIds) || !cycleId) {
          return res.status(400).json({ error: 'itemIds (array) and cycleId required' });
        }

        const cycleRaw = await redis.hget(CYCLES_KEY, cycleId);
        if (!cycleRaw) return res.status(404).json({ error: 'Cycle not found' });
        const cycle = typeof cycleRaw === 'string' ? JSON.parse(cycleRaw) : cycleRaw;

        const updated: RoadmapItem[] = [];
        const now = new Date().toISOString();

        for (const id of itemIds) {
          const existing = await redis.hget(ROADMAP_KEY, id);
          if (existing) {
            const item = typeof existing === 'string' ? JSON.parse(existing) : existing;
            item.cycleId = cycleId;
            item.updatedAt = now;
            await redis.hset(ROADMAP_KEY, { [id]: JSON.stringify(item) });
            updated.push(item);
          }
        }

        // Update cycle's plannedItems count
        cycle.plannedItems = (cycle.plannedItems || 0) + updated.length;
        cycle.updatedAt = now;
        await redis.hset(CYCLES_KEY, { [cycleId]: JSON.stringify(cycle) });

        return res.json({ success: true, updated, cycle });
      }

      // GET CYCLE VELOCITY (completed items/points in a cycle)
      if (action === 'cycle-velocity') {
        const { cycleId } = req.body;
        if (!cycleId) {
          return res.status(400).json({ error: 'cycleId required' });
        }

        const cycleRaw = await redis.hget(CYCLES_KEY, cycleId);
        if (!cycleRaw) return res.status(404).json({ error: 'Cycle not found' });
        const cycle = typeof cycleRaw === 'string' ? JSON.parse(cycleRaw) : cycleRaw;

        const items = await redis.hgetall(ROADMAP_KEY);
        let totalItems = 0;
        let completedItems = 0;
        let totalEstimate = 0;
        let completedEstimate = 0;
        const itemsByStatus: Record<string, number> = {};

        for (const [, value] of Object.entries(items || {})) {
          const item = typeof value === 'string' ? JSON.parse(value) : value;
          if (item.cycleId === cycleId) {
            totalItems++;
            itemsByStatus[item.status] = (itemsByStatus[item.status] || 0) + 1;
            if (item.estimate) totalEstimate += item.estimate;
            if (item.status === 'done' || item.status === 'archived') {
              completedItems++;
              if (item.estimate) completedEstimate += item.estimate;
            }
          }
        }

        // Update cycle with calculated values
        cycle.completedItems = completedItems;
        cycle.velocity = completedEstimate;
        cycle.updatedAt = new Date().toISOString();
        await redis.hset(CYCLES_KEY, { [cycleId]: JSON.stringify(cycle) });

        return res.json({
          cycle,
          metrics: {
            totalItems,
            completedItems,
            completionRate: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
            totalEstimate,
            completedEstimate,
            velocityPoints: completedEstimate,
            itemsByStatus
          }
        });
      }

      // ROLLOVER INCOMPLETE (move incomplete items to next cycle)
      if (action === 'cycle-rollover') {
        const { fromCycleId, toCycleId } = req.body;
        if (!fromCycleId || !toCycleId) {
          return res.status(400).json({ error: 'fromCycleId and toCycleId required' });
        }

        const items = await redis.hgetall(ROADMAP_KEY);
        const rolledOver: string[] = [];
        const now = new Date().toISOString();

        for (const [id, value] of Object.entries(items || {})) {
          const item = typeof value === 'string' ? JSON.parse(value) : value;
          if (item.cycleId === fromCycleId && item.status !== 'done' && item.status !== 'archived') {
            item.cycleId = toCycleId;
            item.updatedAt = now;
            await redis.hset(ROADMAP_KEY, { [id]: JSON.stringify(item) });
            rolledOver.push(id);
          }
        }

        // Update cycle statuses
        const fromCycleRaw = await redis.hget(CYCLES_KEY, fromCycleId);
        if (fromCycleRaw) {
          const fromCycle = typeof fromCycleRaw === 'string' ? JSON.parse(fromCycleRaw) : fromCycleRaw;
          fromCycle.status = 'completed';
          fromCycle.updatedAt = now;
          await redis.hset(CYCLES_KEY, { [fromCycleId]: JSON.stringify(fromCycle) });
        }

        const toCycleRaw = await redis.hget(CYCLES_KEY, toCycleId);
        if (toCycleRaw) {
          const toCycle = typeof toCycleRaw === 'string' ? JSON.parse(toCycleRaw) : toCycleRaw;
          toCycle.plannedItems = (toCycle.plannedItems || 0) + rolledOver.length;
          toCycle.updatedAt = now;
          await redis.hset(CYCLES_KEY, { [toCycleId]: JSON.stringify(toCycle) });
        }

        // Notify in chat
        if (rolledOver.length > 0) {
          const chatMessage = {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
            author: 'system',
            authorType: 'system',
            message: `🔄 Cycle rollover: ${rolledOver.length} incomplete items moved to next cycle`,
            timestamp: now,
            reactions: []
          };
          await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));
        }

        return res.json({ success: true, rolledOver, count: rolledOver.length });
      }

      return res.status(400).json({ error: 'Unknown action. Use: batch-status, batch-assign, add-dependency, remove-dependency, add-subtask, archive-done, get-blocked, get-workload, assign-to-cycle, cycle-velocity, cycle-rollover' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Roadmap error:', error);
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
