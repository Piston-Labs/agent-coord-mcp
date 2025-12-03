import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const MESSAGES_KEY = 'agent-coord:messages';
const AGENTS_KEY = 'agent-coord:agents';
const TASKS_KEY = 'agent-coord:tasks';
const CLAIMS_KEY = 'agent-coord:claims';

/**
 * Team Digest API - Intelligent activity summarization
 * Inspired by contextOS team digests
 *
 * GET /api/digest - Get current team digest
 * GET /api/digest?since=ISO_TIMESTAMP - Activity since timestamp
 * GET /api/digest?agentId=X - Personalized digest for agent
 */
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
    const { since, agentId, format = 'json' } = req.query;
    const sinceTime = since ? new Date(since as string).getTime() : Date.now() - 60 * 60 * 1000; // Default: last hour

    // Fetch all data in parallel
    const [messagesRaw, agentsRaw, tasksRaw, claimsRaw] = await Promise.all([
      redis.lrange(MESSAGES_KEY, 0, 200),
      redis.hgetall(AGENTS_KEY),
      redis.hgetall(TASKS_KEY),
      redis.hgetall(CLAIMS_KEY)
    ]);

    // Parse messages
    const allMessages = (messagesRaw || []).map((m: any) =>
      typeof m === 'string' ? JSON.parse(m) : m
    );
    const recentMessages = allMessages.filter((m: any) =>
      new Date(m.timestamp).getTime() > sinceTime
    );

    // Parse agents
    const agents = Object.values(agentsRaw || {}).map((a: any) =>
      typeof a === 'string' ? JSON.parse(a) : a
    );

    // Online agents - use same threshold as api/agents.ts (5 minutes = offline)
    // Agents active within last 30 minutes are shown in listing, but only last 5 min are truly "online"
    const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;  // Must match api/agents.ts
    const onlineThreshold = Date.now() - OFFLINE_THRESHOLD_MS;
    const onlineAgents = agents.filter((a: any) =>
      new Date(a.lastSeen).getTime() > onlineThreshold
    );

    // Parse tasks
    const tasks = Object.values(tasksRaw || {}).map((t: any) =>
      typeof t === 'string' ? JSON.parse(t) : t
    );

    // Parse claims
    const claims = Object.values(claimsRaw || {}).map((c: any) =>
      typeof c === 'string' ? JSON.parse(c) : c
    );

    // Build activity summary
    const activityByAgent: Record<string, { messages: number; lastMessage?: string }> = {};
    for (const msg of recentMessages) {
      if (!activityByAgent[msg.author]) {
        activityByAgent[msg.author] = { messages: 0 };
      }
      activityByAgent[msg.author].messages++;
      activityByAgent[msg.author].lastMessage = msg.message?.substring(0, 100);
    }

    // Find items needing attention
    const needsAttention: Array<{ type: string; message: string; agent?: string }> = [];

    // Blocked tasks
    const blockedTasks = tasks.filter((t: any) => t.status === 'blocked');
    for (const task of blockedTasks) {
      needsAttention.push({
        type: 'blocked-task',
        message: `Task "${task.title}" is blocked${task.blockedReason ? `: ${task.blockedReason}` : ''}`,
        agent: task.assignee
      });
    }

    // Unassigned high-priority tasks
    const unassignedHigh = tasks.filter((t: any) =>
      t.status === 'todo' && !t.assignee && (t.priority === 'high' || t.priority === 'urgent')
    );
    for (const task of unassignedHigh) {
      needsAttention.push({
        type: 'unassigned-urgent',
        message: `${task.priority.toUpperCase()}: "${task.title}" needs assignment`
      });
    }

    // Mentions for specific agent
    if (agentId) {
      const mentions = recentMessages.filter((m: any) =>
        m.message?.includes(`@${agentId}`)
      );
      for (const mention of mentions) {
        needsAttention.push({
          type: 'mention',
          message: `@${agentId} mentioned by ${mention.author}: "${mention.message?.substring(0, 80)}..."`,
          agent: agentId as string
        });
      }
    }

    // Active claims
    const activeClaims = claims.filter((c: any) => {
      const age = Date.now() - new Date(c.since).getTime();
      return age < 30 * 60 * 1000; // Less than 30 min old
    });

    // Build in-progress work
    const inProgress = tasks
      .filter((t: any) => t.status === 'in-progress')
      .map((t: any) => ({
        task: t.title,
        assignee: t.assignee,
        since: t.updatedAt
      }));

    // Build digest
    const digest = {
      timestamp: new Date().toISOString(),
      period: {
        since: new Date(sinceTime).toISOString(),
        durationMinutes: Math.round((Date.now() - sinceTime) / 60000)
      },
      online: onlineAgents.map((a: any) => ({
        agentId: a.id,
        status: a.status,
        currentTask: a.currentTask
      })),
      onlineCount: onlineAgents.length,
      needsAttention,
      recentActivity: Object.entries(activityByAgent)
        .sort((a, b) => b[1].messages - a[1].messages)
        .slice(0, 10)
        .map(([agent, data]) => ({
          agent,
          messageCount: data.messages,
          lastMessage: data.lastMessage
        })),
      inProgress,
      activeClaims: activeClaims.map((c: any) => ({
        what: c.what,
        by: c.by,
        since: c.since
      })),
      stats: {
        totalMessages: recentMessages.length,
        totalAgents: agents.length,
        onlineAgents: onlineAgents.length,
        todoTasks: tasks.filter((t: any) => t.status === 'todo').length,
        inProgressTasks: inProgress.length,
        blockedTasks: blockedTasks.length
      }
    };

    // Format as markdown if requested
    if (format === 'markdown' || format === 'md') {
      let md = `# Team Digest\n\n`;
      md += `*Generated: ${digest.timestamp}*\n\n`;

      if (digest.needsAttention.length > 0) {
        md += `## ⚠️ Needs Attention\n`;
        for (const item of digest.needsAttention) {
          md += `- **${item.type}**: ${item.message}\n`;
        }
        md += '\n';
      }

      md += `## 👥 Online (${digest.onlineCount})\n`;
      for (const agent of digest.online) {
        md += `- **${agent.agentId}**: ${agent.currentTask || agent.status}\n`;
      }
      md += '\n';

      if (digest.inProgress.length > 0) {
        md += `## 🎯 In Progress\n`;
        for (const work of digest.inProgress) {
          md += `- ${work.task} (${work.assignee})\n`;
        }
        md += '\n';
      }

      if (digest.recentActivity.length > 0) {
        md += `## 📊 Recent Activity\n`;
        for (const activity of digest.recentActivity) {
          md += `- **${activity.agent}**: ${activity.messageCount} messages\n`;
        }
      }

      return res.setHeader('Content-Type', 'text/markdown').send(md);
    }

    return res.json(digest);

  } catch (error) {
    console.error('Digest API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
