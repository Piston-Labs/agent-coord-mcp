import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Health Check API - System status and statistics
 *
 * GET /api/health - Basic health check
 * GET /api/health?detailed=true - Full system stats
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');

  const { detailed } = req.query;

  const basicHealth = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    tools: 18
  };

  if (detailed !== 'true') {
    return res.json(basicHealth);
  }

  // Detailed health check with Redis stats
  try {
    const startTime = Date.now();

    // Check Redis connectivity and get counts
    const [
      agentCount,
      chatLength,
      memoryCount,
      taskCount,
      workflowRunCount,
      handoffCount,
      lockCount
    ] = await Promise.all([
      redis.hlen('agent-coord:agents'),
      redis.llen('agent-coord:group-chat'),
      redis.hlen('agent-coord:shared-memory'),
      redis.hlen('agent-coord:tasks'),
      redis.llen('agent-coord:workflow-runs'),
      redis.llen('agent-coord:handoffs'),
      redis.hlen('agent-coord:locks')
    ]);

    const redisLatency = Date.now() - startTime;

    return res.json({
      ...basicHealth,
      redis: {
        status: 'connected',
        latency: `${redisLatency}ms`
      },
      stats: {
        agents: agentCount,
        chatMessages: chatLength,
        memories: memoryCount,
        tasks: taskCount,
        workflowRuns: workflowRunCount,
        handoffs: handoffCount,
        activeLocks: lockCount
      },
      endpoints: {
        api: 'https://agent-coord-mcp.vercel.app/api',
        dashboard: 'https://agent-coord-mcp.vercel.app',
        docs: 'https://github.com/Piston-Labs/agent-coord-mcp'
      },
      features: [
        'Multi-agent coordination',
        'Group chat messaging',
        'Resource locking',
        'Task management',
        'Shared memory',
        'Context clusters',
        'Hot-start initialization',
        'Fleet bridge (Teltonika/AWS)',
        'Collaboration workflows',
        'Agent handoffs'
      ]
    });
  } catch (error) {
    return res.status(500).json({
      ...basicHealth,
      status: 'degraded',
      redis: {
        status: 'error',
        error: String(error)
      }
    });
  }
}
