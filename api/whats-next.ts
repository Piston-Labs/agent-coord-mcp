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

// Priority order for sorting
const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER: Record<string, number> = { 'in-progress': 0, planned: 1, backlog: 2, review: 3, done: 4 };

// Extract phase number from title like "[P1]" or "[P2]"
function getPhaseNumber(title: string): number {
  const match = title.match(/\[P(\d+)\]/);
  return match ? parseInt(match[1], 10) : 999;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { assignee, format } = req.query;

    if (!assignee || typeof assignee !== 'string') {
      return res.status(400).json({
        error: 'assignee required',
        usage: '/api/whats-next?assignee=tom or /api/whats-next?assignee=ryan',
        example: 'curl https://agent-coord-mcp.vercel.app/api/whats-next?assignee=tom'
      });
    }

    // Get all roadmap items
    const items = await redis.hgetall(ROADMAP_KEY);
    let roadmapList: RoadmapItem[] = [];

    for (const [key, value] of Object.entries(items || {})) {
      try {
        const item = typeof value === 'string' ? JSON.parse(value) : value;
        if (item && item.id && item.title && item.assignee === assignee.toLowerCase()) {
          roadmapList.push(item);
        }
      } catch (e) {
        // Skip corrupted entries
        console.error(`Skipping corrupted entry: ${key}`);
      }
    }

    // Filter out completed tasks
    roadmapList = roadmapList.filter(item => item.status !== 'done');

    if (roadmapList.length === 0) {
      return res.json({
        assignee,
        message: `🎉 All tasks completed! No pending tasks for ${assignee}.`,
        nextTask: null,
        totalPending: 0
      });
    }

    // Sort by: status (in-progress first) → priority → phase number
    roadmapList.sort((a, b) => {
      // First: in-progress items come first
      const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (statusDiff !== 0) return statusDiff;

      // Then: by priority (critical > high > medium > low)
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Finally: by phase number (P1 before P2 before P3...)
      return getPhaseNumber(a.title) - getPhaseNumber(b.title);
    });

    const nextTask = roadmapList[0];
    const upcomingTasks = roadmapList.slice(1, 4); // Next 3 tasks after the current one

    // Count tasks by status
    const statusCounts = roadmapList.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Format response based on format parameter
    if (format === 'chat' || format === 'simple') {
      // Human-readable format for chat
      let response = `📋 **What's Next for ${assignee.charAt(0).toUpperCase() + assignee.slice(1)}**\n\n`;
      response += `**Current Task:** ${nextTask.title}\n`;
      response += `**Priority:** ${nextTask.priority.toUpperCase()}\n`;
      response += `**Status:** ${nextTask.status}\n`;
      response += `**Project:** ${nextTask.project}\n\n`;

      if (nextTask.description) {
        response += `**Instructions:**\n${nextTask.description}\n\n`;
      }

      if (upcomingTasks.length > 0) {
        response += `**Up Next:**\n`;
        upcomingTasks.forEach((task, i) => {
          response += `${i + 1}. ${task.title} (${task.priority})\n`;
        });
      }

      response += `\n**Progress:** ${statusCounts['done'] || 0} done, ${roadmapList.length} remaining`;

      return res.json({
        assignee,
        message: response,
        nextTask,
        totalPending: roadmapList.length
      });
    }

    // Full JSON response
    return res.json({
      assignee,
      summary: {
        totalPending: roadmapList.length,
        inProgress: statusCounts['in-progress'] || 0,
        planned: statusCounts['planned'] || 0,
        backlog: statusCounts['backlog'] || 0
      },
      nextTask: {
        id: nextTask.id,
        title: nextTask.title,
        description: nextTask.description,
        priority: nextTask.priority,
        status: nextTask.status,
        project: nextTask.project,
        phase: getPhaseNumber(nextTask.title),
        tags: nextTask.tags,
        instructions: nextTask.description || 'No detailed instructions provided. Check with the team for clarification.'
      },
      upcomingTasks: upcomingTasks.map(task => ({
        id: task.id,
        title: task.title,
        priority: task.priority,
        status: task.status,
        phase: getPhaseNumber(task.title)
      })),
      tip: `To mark task complete: PUT /api/roadmap with { "id": "${nextTask.id}", "status": "done" }`
    });

  } catch (error) {
    console.error('Whats-next error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
