import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * System Metrics API - Analytics and usage statistics
 *
 * GET /api/metrics - Get comprehensive system metrics
 * GET /api/metrics?period=24h - Get metrics for specific time period
 * POST /api/metrics - Record a metric event
 *
 * Tracks:
 * - Agent activity (messages sent, tasks completed, time active)
 * - System usage (API calls, peak times, popular endpoints)
 * - Coordination stats (locks, claims, handoffs)
 * - Fleet telemetry aggregates
 */

interface AgentMetrics {
  agentId: string;
  messagesSent: number;
  tasksCompleted: number;
  claimsMade: number;
  locksAcquired: number;
  lastActive: string;
  totalActiveMinutes: number;
}

interface SystemMetrics {
  timestamp: string;
  period: string;
  agents: {
    total: number;
    activeNow: number;
    active24h: number;
    topContributors: AgentMetrics[];
  };
  messages: {
    total: number;
    last24h: number;
    avgPerDay: number;
  };
  tasks: {
    total: number;
    completed: number;
    inProgress: number;
    completionRate: string;
  };
  coordination: {
    activeLocks: number;
    activeClaims: number;
    pendingHandoffs: number;
    totalHandoffs: number;
  };
  workflows: {
    totalRuns: number;
    activeRuns: number;
    completedRuns: number;
  };
  memory: {
    totalItems: number;
    categories: Record<string, number>;
  };
  telemetry: {
    totalDevices: number;
    activeDevices: number;
    avgBatteryVoltage: number;
  };
  uptime: {
    lastDeployment: string;
    version: string;
    tools: number;
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const startTime = Date.now();
    const period = (req.query.period as string) || '24h';
    const now = Date.now();

    // Calculate period in milliseconds
    const periodMs = period === '7d' ? 7 * 24 * 60 * 60 * 1000 :
                     period === '30d' ? 30 * 24 * 60 * 60 * 1000 :
                     24 * 60 * 60 * 1000; // default 24h

    // POST: Record a metric event
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { agentId, event, value } = body;

      if (!agentId || !event) {
        return res.status(400).json({ error: 'agentId and event are required' });
      }

      const metricsKey = `agent-coord:metrics:${agentId}`;
      const existing = await redis.hget(metricsKey, event);
      const currentValue = existing ? Number(existing) : 0;

      await redis.hset(metricsKey, { [event]: currentValue + (value || 1) });
      await redis.hset(metricsKey, { lastActive: new Date().toISOString() });

      return res.json({ success: true, event, newValue: currentValue + (value || 1) });
    }

    // GET: Retrieve metrics
    // Parallel fetch all data
    const [
      agentsRaw,
      activeAgentsRaw,
      chatMessages,
      tasksRaw,
      locksRaw,
      claimsRaw,
      handoffsRaw,
      workflowRunsRaw,
      memoryRaw,
      telemetryRaw,
    ] = await Promise.all([
      redis.hgetall('agent-coord:agents'),
      redis.hgetall('agent-coord:active-agents'),
      redis.lrange('agent-coord:group-chat', 0, -1),
      redis.hgetall('agent-coord:tasks'),
      redis.hgetall('agent-coord:locks'),
      redis.hgetall('agent-coord:claims'),
      redis.lrange('agent-coord:handoffs', 0, -1),
      redis.lrange('agent-coord:workflow-runs', 0, -1),
      redis.hgetall('agent-coord:shared-memory'),
      redis.hgetall('piston:telemetry'),
    ]);

    // Process agents
    const allAgents = { ...(agentsRaw || {}), ...(activeAgentsRaw || {}) };
    const agentList = Object.entries(allAgents).map(([id, data]) => {
      const agent = typeof data === 'string' ? JSON.parse(data) : data;
      return { id, ...agent };
    });

    const activeThreshold = now - 30 * 60 * 1000; // 30 minutes
    const active24hThreshold = now - 24 * 60 * 60 * 1000;

    const activeNow = agentList.filter(a =>
      a.lastSeen && new Date(a.lastSeen).getTime() > activeThreshold
    ).length;

    const active24h = agentList.filter(a =>
      a.lastSeen && new Date(a.lastSeen).getTime() > active24hThreshold
    ).length;

    // Process messages
    const messages = (chatMessages || []).map(m =>
      typeof m === 'string' ? JSON.parse(m) : m
    );

    const messagesLast24h = messages.filter(m =>
      m.timestamp && new Date(m.timestamp).getTime() > active24hThreshold
    ).length;

    // Count messages per agent for top contributors
    const messageCountByAgent: Record<string, number> = {};
    messages.forEach(m => {
      if (m.author) {
        messageCountByAgent[m.author] = (messageCountByAgent[m.author] || 0) + 1;
      }
    });

    const topContributors: AgentMetrics[] = Object.entries(messageCountByAgent)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([agentId, count]) => ({
        agentId,
        messagesSent: count,
        tasksCompleted: 0,
        claimsMade: 0,
        locksAcquired: 0,
        lastActive: agentList.find(a => a.id === agentId)?.lastSeen || 'unknown',
        totalActiveMinutes: 0,
      }));

    // Process tasks
    const tasks = Object.values(tasksRaw || {}).map(t =>
      typeof t === 'string' ? JSON.parse(t) : t
    );

    const completedTasks = tasks.filter(t => t.status === 'done' || t.status === 'completed').length;
    const inProgressTasks = tasks.filter(t => t.status === 'in-progress').length;

    // Process coordination data
    const locks = Object.keys(locksRaw || {}).length;
    const claims = Object.keys(claimsRaw || {}).length;
    const handoffs = (handoffsRaw || []).map(h => typeof h === 'string' ? JSON.parse(h) : h);
    const pendingHandoffs = handoffs.filter(h => h.status === 'pending').length;

    // Process workflows
    const workflowRuns = (workflowRunsRaw || []).map(r => typeof r === 'string' ? JSON.parse(r) : r);
    const activeWorkflows = workflowRuns.filter(r => r.status === 'running').length;
    const completedWorkflows = workflowRuns.filter(r => r.status === 'completed').length;

    // Process memory
    const memoryItems = Object.values(memoryRaw || {});
    const memoryCategories: Record<string, number> = {};
    memoryItems.forEach(item => {
      const mem = typeof item === 'string' ? JSON.parse(item) : item;
      const category = mem.category || 'uncategorized';
      memoryCategories[category] = (memoryCategories[category] || 0) + 1;
    });

    // Process telemetry
    const telemetryDevices = Object.values(telemetryRaw || {}).map(t =>
      typeof t === 'string' ? JSON.parse(t) : t
    );
    const activeDevices = telemetryDevices.filter(d => d.status?.ignition).length;
    const avgBattery = telemetryDevices.length > 0
      ? telemetryDevices.reduce((sum, d) => sum + (d.metrics?.batteryVoltage || 0), 0) / telemetryDevices.length
      : 0;

    const metrics: SystemMetrics = {
      timestamp: new Date().toISOString(),
      period,
      agents: {
        total: agentList.length,
        activeNow,
        active24h,
        topContributors,
      },
      messages: {
        total: messages.length,
        last24h: messagesLast24h,
        avgPerDay: Math.round(messages.length / 7), // Rough estimate
      },
      tasks: {
        total: tasks.length,
        completed: completedTasks,
        inProgress: inProgressTasks,
        completionRate: tasks.length > 0
          ? `${Math.round((completedTasks / tasks.length) * 100)}%`
          : '0%',
      },
      coordination: {
        activeLocks: locks,
        activeClaims: claims,
        pendingHandoffs,
        totalHandoffs: handoffs.length,
      },
      workflows: {
        totalRuns: workflowRuns.length,
        activeRuns: activeWorkflows,
        completedRuns: completedWorkflows,
      },
      memory: {
        totalItems: memoryItems.length,
        categories: memoryCategories,
      },
      telemetry: {
        totalDevices: telemetryDevices.length,
        activeDevices,
        avgBatteryVoltage: Math.round(avgBattery * 10) / 10,
      },
      uptime: {
        lastDeployment: new Date().toISOString(),
        version: '0.1.0',
        tools: 21,
      },
    };

    const loadTime = Date.now() - startTime;

    return res.json({
      ...metrics,
      _meta: {
        loadTime: `${loadTime}ms`,
        cached: false,
      },
    });
  } catch (error) {
    console.error('Metrics API error:', error);
    return res.status(500).json({
      error: 'Failed to fetch metrics',
      details: String(error),
    });
  }
}
