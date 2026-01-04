import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Cloudflare telemetry endpoint for fleet data
const CF_TELEMETRY_URL = 'https://piston-telemetry.tyler-4c4.workers.dev/devices';

// Helper for fetch with timeout (compatible with Node 16+)
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * System Status API - Real-time dashboard data
 *
 * GET /api/status - Lightweight system status for dashboards
 *
 * Returns:
 * - Active agents with their current tasks
 * - Recent chat messages
 * - Active workflow runs
 * - Current locks
 * - Pending handoffs
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Very short cache for real-time dashboard
  res.setHeader('Cache-Control', 's-maxage=3, stale-while-revalidate=2');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const startTime = Date.now();

    // Parallel fetch all needed data (including telemetry from Cloudflare)
    const [
      agentsRaw,
      chatRaw,
      workflowRunsRaw,
      locksRaw,
      handoffsRaw,
      tasksRaw,
      telemetryRes
    ] = await Promise.all([
      redis.hgetall('agent-coord:active-agents').catch(() => ({})),
      redis.lrange('agent-coord:group-chat', 0, 4).catch(() => []),
      redis.lrange('agent-coord:workflow-runs', 0, 4).catch(() => []),
      redis.hgetall('agent-coord:locks').catch(() => ({})),
      redis.lrange('agent-coord:handoffs', 0, 9).catch(() => []),
      redis.hgetall('agent-coord:tasks').catch(() => ({})),
      fetchWithTimeout(CF_TELEMETRY_URL, 3000)
    ]);

    const loadTime = Date.now() - startTime;

    // Process agents
    const activeThreshold = Date.now() - 30 * 60 * 1000;
    const agents: any[] = [];
    for (const [, value] of Object.entries(agentsRaw || {})) {
      try {
        const agent = typeof value === 'string' ? JSON.parse(value) : value;
        if (agent?.lastSeen && new Date(agent.lastSeen).getTime() > activeThreshold) {
          agents.push({
            id: agent.id,
            name: agent.name,
            currentTask: agent.currentTask,
            workingOn: agent.workingOn,
            lastSeen: agent.lastSeen
          });
        }
      } catch (e) { /* skip invalid */ }
    }

    // Process recent chat
    const recentChat = (chatRaw || []).map((msg: any) => {
      const parsed = typeof msg === 'string' ? JSON.parse(msg) : msg;
      return {
        author: parsed.author,
        message: parsed.message?.substring(0, 100) + (parsed.message?.length > 100 ? '...' : ''),
        timestamp: parsed.timestamp
      };
    });

    // Process workflow runs
    const activeWorkflows = (workflowRunsRaw || [])
      .map((run: any) => typeof run === 'string' ? JSON.parse(run) : run)
      .filter((run: any) => run.status === 'running')
      .map((run: any) => ({
        id: run.id,
        workflow: run.workflowName,
        startedBy: run.startedBy,
        participants: run.participants
      }));

    // Process locks
    const activeLocks = Object.entries(locksRaw || {}).map(([path, lock]: [string, any]) => {
      const parsed = typeof lock === 'string' ? JSON.parse(lock) : lock;
      return {
        path,
        lockedBy: parsed.lockedBy,
        reason: parsed.reason
      };
    });

    // Process pending handoffs
    const pendingHandoffs = (handoffsRaw || [])
      .map((h: any) => typeof h === 'string' ? JSON.parse(h) : h)
      .filter((h: any) => h.status === 'pending')
      .slice(0, 5)
      .map((h: any) => ({
        id: h.id,
        title: h.title,
        from: h.fromAgent,
        to: h.toAgent,
        priority: h.priority
      }));

    // Process tasks
    const inProgressTasks = Object.values(tasksRaw || {})
      .map((t: any) => typeof t === 'string' ? JSON.parse(t) : t)
      .filter((t: any) => t.status === 'in-progress')
      .slice(0, 5)
      .map((t: any) => ({
        id: t.id,
        title: t.title,
        assignee: t.assignee,
        priority: t.priority
      }));

    // Process telemetry from Cloudflare
    let telemetry = { totalDevices: 0, activeDevices: 0, avgBatteryVoltage: null as number | null };
    if (telemetryRes && telemetryRes.ok) {
      try {
        const telemetryData = await telemetryRes.json();
        const devices = telemetryData.devices || telemetryData || [];
        if (Array.isArray(devices)) {
          telemetry.totalDevices = devices.length;
          telemetry.activeDevices = devices.filter((d: any) => d.online || d.ignition).length;
          // Calculate average battery voltage from devices that have it
          const voltages = devices
            .map((d: any) => d.externalVoltage || d.batteryVoltage || d.voltage)
            .filter((v: any) => typeof v === 'number' && v > 0);
          if (voltages.length > 0) {
            telemetry.avgBatteryVoltage = Math.round((voltages.reduce((a: number, b: number) => a + b, 0) / voltages.length) * 10) / 10;
          }
        }
      } catch (e) {
        console.error('Telemetry parse error:', e);
      }
    }

    return res.json({
      timestamp: new Date().toISOString(),
      loadTime: `${loadTime}ms`,
      agents: {
        active: agents.length,
        list: agents
      },
      activity: {
        recentChat,
        activeWorkflows,
        activeLocks,
        pendingHandoffs,
        inProgressTasks
      },
      telemetry,
      counts: {
        agents: agents.length,
        locks: activeLocks.length,
        workflows: activeWorkflows.length,
        handoffs: pendingHandoffs.length,
        tasks: inProgressTasks.length
      }
    });
  } catch (error) {
    console.error('Status API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
