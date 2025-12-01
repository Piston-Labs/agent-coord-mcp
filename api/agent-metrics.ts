import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const METRICS_KEY = 'agent-coord:agent-metrics';
const METRICS_EVENTS_KEY = 'agent-coord:metrics-events';
const SAFETY_EVENTS_KEY = 'agent-coord:safety-events';

interface AgentMetrics {
  agentId: string;
  // Efficiency metrics
  tasksCompleted: number;
  tasksStarted: number;
  avgTaskDuration: number;  // minutes
  totalActiveTime: number;  // minutes
  idleTime: number;         // minutes

  // Coordination metrics
  handoffsCreated: number;
  handoffsReceived: number;
  handoffSuccessRate: number;
  messagesPosted: number;
  mentionsReceived: number;

  // Quality metrics
  rollbacksTriggered: number;
  errorsEncountered: number;
  conflictsAvoided: number;  // Via claims/locks

  // Safety metrics
  dangerousActionsBlocked: number;
  sensitiveFilesAccessed: number;
  safetyWarnings: number;

  // Context efficiency
  checkpointsSaved: number;
  contextLoadsFromMemory: number;
  coldStarts: number;
  hotStarts: number;

  lastUpdated: string;
}

interface MetricEvent {
  id: string;
  agentId: string;
  eventType: 'task_start' | 'task_complete' | 'error' | 'handoff' | 'message' | 'safety_warning' | 'conflict_avoided' | 'checkpoint' | 'context_load';
  metadata?: Record<string, any>;
  timestamp: string;
}

interface SafetyEvent {
  id: string;
  agentId: string;
  severity: 'info' | 'warning' | 'critical';
  category: 'file_access' | 'destructive_action' | 'credential_exposure' | 'rate_limit' | 'resource_conflict' | 'unauthorized';
  description: string;
  actionTaken: 'blocked' | 'warned' | 'logged' | 'allowed';
  context?: string;
  timestamp: string;
}

/**
 * Agent Metrics API - Multi-agent efficiency and safety monitoring
 *
 * Tracks:
 * - Task completion rates and durations
 * - Handoff success rates
 * - Error frequencies
 * - Safety events and interventions
 * - Context efficiency (cold vs hot starts)
 *
 * GET /api/agent-metrics - Get all agent metrics
 * GET /api/agent-metrics?agentId=X - Get specific agent metrics
 * GET /api/agent-metrics?action=leaderboard - Get efficiency leaderboard
 * GET /api/agent-metrics?action=safety-report - Get safety summary
 * GET /api/agent-metrics?action=events&agentId=X - Get event history
 * POST /api/agent-metrics - Record a metric event
 * POST /api/agent-metrics?action=safety - Record a safety event
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: Retrieve metrics
    if (req.method === 'GET') {
      const { agentId, action } = req.query;

      // Get leaderboard
      if (action === 'leaderboard') {
        const allMetrics = await redis.hgetall(METRICS_KEY) || {};
        const metrics = Object.values(allMetrics).map(m =>
          typeof m === 'string' ? JSON.parse(m) : m
        );

        // Calculate efficiency scores
        const leaderboard = metrics.map(m => ({
          agentId: m.agentId,
          tasksCompleted: m.tasksCompleted || 0,
          completionRate: m.tasksStarted ? ((m.tasksCompleted / m.tasksStarted) * 100).toFixed(1) : 0,
          avgTaskDuration: m.avgTaskDuration?.toFixed(1) || 'N/A',
          handoffSuccessRate: (m.handoffSuccessRate * 100).toFixed(1) || 0,
          errorRate: m.tasksCompleted ? ((m.errorsEncountered / m.tasksCompleted) * 100).toFixed(1) : 0,
          hotStartRate: (m.coldStarts + m.hotStarts) ?
            ((m.hotStarts / (m.coldStarts + m.hotStarts)) * 100).toFixed(1) : 0,
          efficiencyScore: calculateEfficiencyScore(m)
        })).sort((a, b) => b.efficiencyScore - a.efficiencyScore);

        return res.json({ leaderboard });
      }

      // Get safety report
      if (action === 'safety-report') {
        const safetyEvents = await redis.lrange(SAFETY_EVENTS_KEY, 0, 199);
        const events = safetyEvents.map(e => typeof e === 'string' ? JSON.parse(e) : e);

        const report = {
          totalEvents: events.length,
          bySeverity: { info: 0, warning: 0, critical: 0 },
          byCategory: {} as Record<string, number>,
          byAgent: {} as Record<string, number>,
          recentCritical: [] as SafetyEvent[],
          trends: { last24h: 0, last7d: 0 }
        };

        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;

        for (const event of events) {
          report.bySeverity[event.severity]++;
          report.byCategory[event.category] = (report.byCategory[event.category] || 0) + 1;
          report.byAgent[event.agentId] = (report.byAgent[event.agentId] || 0) + 1;

          const eventTime = new Date(event.timestamp).getTime();
          if (now - eventTime < day) report.trends.last24h++;
          if (now - eventTime < 7 * day) report.trends.last7d++;

          if (event.severity === 'critical') {
            report.recentCritical.push(event);
          }
        }

        report.recentCritical = report.recentCritical.slice(0, 10);

        return res.json({ report });
      }

      // Get events for agent
      if (action === 'events') {
        if (!agentId) {
          return res.status(400).json({ error: 'agentId required for events' });
        }

        const allEvents = await redis.lrange(METRICS_EVENTS_KEY, 0, 499);
        const events = allEvents
          .map(e => typeof e === 'string' ? JSON.parse(e) : e)
          .filter(e => e.agentId === agentId);

        return res.json({ agentId, events, count: events.length });
      }

      // Get specific agent metrics
      if (agentId) {
        const metrics = await redis.hget(METRICS_KEY, agentId as string);
        if (!metrics) {
          // Return empty metrics for new agent
          return res.json({
            agentId,
            metrics: createEmptyMetrics(agentId as string),
            isNew: true
          });
        }
        const parsed = typeof metrics === 'string' ? JSON.parse(metrics) : metrics;
        return res.json({ agentId, metrics: parsed });
      }

      // Get all agent metrics
      const allMetrics = await redis.hgetall(METRICS_KEY) || {};
      const metrics = Object.values(allMetrics).map(m =>
        typeof m === 'string' ? JSON.parse(m) : m
      );

      // Calculate team-wide stats
      const teamStats = {
        totalAgents: metrics.length,
        totalTasksCompleted: metrics.reduce((sum, m) => sum + (m.tasksCompleted || 0), 0),
        totalErrors: metrics.reduce((sum, m) => sum + (m.errorsEncountered || 0), 0),
        totalHandoffs: metrics.reduce((sum, m) => sum + (m.handoffsCreated || 0), 0),
        avgEfficiency: metrics.length ?
          (metrics.reduce((sum, m) => sum + calculateEfficiencyScore(m), 0) / metrics.length).toFixed(1) : 0,
        safetyScore: calculateTeamSafetyScore(metrics)
      };

      return res.json({ metrics, teamStats });
    }

    // POST: Record metric or safety event
    if (req.method === 'POST') {
      let body: any;
      try {
        body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const { action } = req.query;

      // Record safety event
      if (action === 'safety') {
        const { agentId, severity, category, description, actionTaken, context } = body;

        if (!agentId || !severity || !category || !description) {
          return res.status(400).json({ error: 'agentId, severity, category, and description required' });
        }

        const safetyEvent: SafetyEvent = {
          id: `safety-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`,
          agentId,
          severity,
          category,
          description,
          actionTaken: actionTaken || 'logged',
          context,
          timestamp: new Date().toISOString()
        };

        await redis.lpush(SAFETY_EVENTS_KEY, JSON.stringify(safetyEvent));
        await redis.ltrim(SAFETY_EVENTS_KEY, 0, 999);

        // Update agent metrics
        const existingMetrics = await redis.hget(METRICS_KEY, agentId);
        const metrics = existingMetrics ?
          (typeof existingMetrics === 'string' ? JSON.parse(existingMetrics) : existingMetrics) :
          createEmptyMetrics(agentId);

        metrics.safetyWarnings++;
        if (actionTaken === 'blocked') metrics.dangerousActionsBlocked++;
        if (category === 'file_access') metrics.sensitiveFilesAccessed++;
        metrics.lastUpdated = new Date().toISOString();

        await redis.hset(METRICS_KEY, { [agentId]: JSON.stringify(metrics) });

        return res.json({ success: true, safetyEvent });
      }

      // Record metric event
      const { agentId, eventType, metadata, duration } = body;

      if (!agentId || !eventType) {
        return res.status(400).json({ error: 'agentId and eventType required' });
      }

      const event: MetricEvent = {
        id: `event-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`,
        agentId,
        eventType,
        metadata,
        timestamp: new Date().toISOString()
      };

      await redis.lpush(METRICS_EVENTS_KEY, JSON.stringify(event));
      await redis.ltrim(METRICS_EVENTS_KEY, 0, 999);

      // Update agent metrics based on event type
      const existingMetrics = await redis.hget(METRICS_KEY, agentId);
      const metrics = existingMetrics ?
        (typeof existingMetrics === 'string' ? JSON.parse(existingMetrics) : existingMetrics) :
        createEmptyMetrics(agentId);

      switch (eventType) {
        case 'task_start':
          metrics.tasksStarted++;
          break;
        case 'task_complete':
          metrics.tasksCompleted++;
          if (duration) {
            const totalDuration = metrics.avgTaskDuration * (metrics.tasksCompleted - 1) + duration;
            metrics.avgTaskDuration = totalDuration / metrics.tasksCompleted;
          }
          break;
        case 'error':
          metrics.errorsEncountered++;
          break;
        case 'handoff':
          if (metadata?.type === 'created') metrics.handoffsCreated++;
          if (metadata?.type === 'received') metrics.handoffsReceived++;
          if (metadata?.success !== undefined) {
            const total = metrics.handoffsCreated + metrics.handoffsReceived;
            const successful = metrics.handoffSuccessRate * (total - 1) + (metadata.success ? 1 : 0);
            metrics.handoffSuccessRate = successful / total;
          }
          break;
        case 'message':
          metrics.messagesPosted++;
          break;
        case 'conflict_avoided':
          metrics.conflictsAvoided++;
          break;
        case 'checkpoint':
          metrics.checkpointsSaved++;
          break;
        case 'context_load':
          metrics.contextLoadsFromMemory++;
          if (metadata?.isHotStart) metrics.hotStarts++;
          else metrics.coldStarts++;
          break;
      }

      metrics.lastUpdated = new Date().toISOString();
      await redis.hset(METRICS_KEY, { [agentId]: JSON.stringify(metrics) });

      return res.json({ success: true, event, metrics });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Agent metrics error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}

function createEmptyMetrics(agentId: string): AgentMetrics {
  return {
    agentId,
    tasksCompleted: 0,
    tasksStarted: 0,
    avgTaskDuration: 0,
    totalActiveTime: 0,
    idleTime: 0,
    handoffsCreated: 0,
    handoffsReceived: 0,
    handoffSuccessRate: 0,
    messagesPosted: 0,
    mentionsReceived: 0,
    rollbacksTriggered: 0,
    errorsEncountered: 0,
    conflictsAvoided: 0,
    dangerousActionsBlocked: 0,
    sensitiveFilesAccessed: 0,
    safetyWarnings: 0,
    checkpointsSaved: 0,
    contextLoadsFromMemory: 0,
    coldStarts: 0,
    hotStarts: 0,
    lastUpdated: new Date().toISOString()
  };
}

function calculateEfficiencyScore(metrics: AgentMetrics): number {
  let score = 0;

  // Task completion (40 points max)
  if (metrics.tasksStarted > 0) {
    score += (metrics.tasksCompleted / metrics.tasksStarted) * 40;
  }

  // Low error rate (20 points max)
  if (metrics.tasksCompleted > 0) {
    const errorRate = metrics.errorsEncountered / metrics.tasksCompleted;
    score += Math.max(0, 20 - errorRate * 100);
  }

  // Handoff success (15 points max)
  score += metrics.handoffSuccessRate * 15;

  // Hot start rate (15 points max)
  const totalStarts = metrics.coldStarts + metrics.hotStarts;
  if (totalStarts > 0) {
    score += (metrics.hotStarts / totalStarts) * 15;
  }

  // Collaboration (10 points max)
  const collaboration = Math.min(10, (metrics.messagesPosted + metrics.handoffsCreated) / 2);
  score += collaboration;

  return Math.round(score * 10) / 10;
}

function calculateTeamSafetyScore(metrics: AgentMetrics[]): number {
  if (metrics.length === 0) return 100;

  let deductions = 0;

  for (const m of metrics) {
    deductions += m.safetyWarnings * 2;
    deductions += m.dangerousActionsBlocked * 5;
    deductions += m.sensitiveFilesAccessed * 1;
  }

  // Normalize by team size
  deductions = deductions / metrics.length;

  return Math.max(0, Math.round(100 - deductions));
}
