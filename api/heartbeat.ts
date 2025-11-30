import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const HEARTBEAT_KEY = 'agent-coord:heartbeats';
const HEARTBEAT_HISTORY_KEY = 'agent-coord:heartbeat-history';
const HEARTBEAT_TTL = 60 * 5; // 5 minutes - agent considered offline after this

interface Heartbeat {
  agentId: string;
  status: 'active' | 'idle' | 'busy' | 'error';
  timestamp: string;
  sessionHealth?: 'healthy' | 'degraded' | 'truncated';
  lastResponseTime?: number; // ms
  errorCount?: number;
  metadata?: Record<string, any>;
}

interface HeartbeatHistory {
  agentId: string;
  events: Array<{
    type: 'online' | 'offline' | 'error' | 'recovery';
    timestamp: string;
    details?: string;
  }>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET - Get heartbeat status for all agents or specific agent
    if (req.method === 'GET') {
      const { agentId, includeHistory } = req.query;

      if (agentId && typeof agentId === 'string') {
        // Get specific agent's heartbeat
        const raw = await redis.hget(HEARTBEAT_KEY, agentId);
        if (!raw) {
          return res.json({ agentId, status: 'offline', lastSeen: null });
        }
        const heartbeat: Heartbeat = typeof raw === 'string' ? JSON.parse(raw) : raw;

        // Check if stale (offline)
        const lastSeen = new Date(heartbeat.timestamp);
        const isStale = Date.now() - lastSeen.getTime() > HEARTBEAT_TTL * 1000;

        const response: any = {
          ...heartbeat,
          online: !isStale,
          staleAfterSeconds: HEARTBEAT_TTL,
        };

        // Include history if requested
        if (includeHistory === 'true') {
          const historyRaw = await redis.hget(HEARTBEAT_HISTORY_KEY, agentId);
          if (historyRaw) {
            response.history = typeof historyRaw === 'string' ? JSON.parse(historyRaw) : historyRaw;
          }
        }

        return res.json(response);
      }

      // Get all heartbeats
      const allHeartbeats = await redis.hgetall(HEARTBEAT_KEY) || {};
      const now = Date.now();

      const agents = Object.entries(allHeartbeats).map(([id, data]) => {
        const heartbeat: Heartbeat = typeof data === 'string' ? JSON.parse(data) : data;
        const lastSeen = new Date(heartbeat.timestamp);
        const isStale = now - lastSeen.getTime() > HEARTBEAT_TTL * 1000;

        return {
          ...heartbeat,
          online: !isStale,
          secondsSinceHeartbeat: Math.floor((now - lastSeen.getTime()) / 1000),
        };
      });

      // Sort by most recent
      agents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const online = agents.filter(a => a.online);
      const offline = agents.filter(a => !a.online);

      return res.json({
        agents,
        summary: {
          total: agents.length,
          online: online.length,
          offline: offline.length,
          staleThresholdSeconds: HEARTBEAT_TTL,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // POST - Send heartbeat
    if (req.method === 'POST') {
      const { agentId, status = 'active', sessionHealth, lastResponseTime, errorCount, metadata } = req.body;

      if (!agentId) {
        return res.status(400).json({ error: 'agentId is required' });
      }

      // Check if agent was previously offline (for history tracking)
      const previousRaw = await redis.hget(HEARTBEAT_KEY, agentId);
      let wasOffline = true;
      if (previousRaw) {
        const previous: Heartbeat = typeof previousRaw === 'string' ? JSON.parse(previousRaw) : previousRaw;
        const lastSeen = new Date(previous.timestamp);
        wasOffline = Date.now() - lastSeen.getTime() > HEARTBEAT_TTL * 1000;
      }

      const heartbeat: Heartbeat = {
        agentId,
        status,
        timestamp: new Date().toISOString(),
        sessionHealth,
        lastResponseTime,
        errorCount,
        metadata,
      };

      await redis.hset(HEARTBEAT_KEY, { [agentId]: JSON.stringify(heartbeat) });

      // Track online/recovery events in history
      if (wasOffline || !previousRaw) {
        const historyRaw = await redis.hget(HEARTBEAT_HISTORY_KEY, agentId);
        const history: HeartbeatHistory = historyRaw
          ? (typeof historyRaw === 'string' ? JSON.parse(historyRaw) : historyRaw)
          : { agentId, events: [] };

        history.events.push({
          type: previousRaw ? 'recovery' : 'online',
          timestamp: heartbeat.timestamp,
          details: previousRaw ? 'Agent recovered from offline state' : 'Agent came online',
        });

        // Keep last 50 events
        if (history.events.length > 50) {
          history.events = history.events.slice(-50);
        }

        await redis.hset(HEARTBEAT_HISTORY_KEY, { [agentId]: JSON.stringify(history) });
      }

      return res.json({
        success: true,
        heartbeat,
        wasOffline,
      });
    }

    // DELETE - Remove agent from heartbeat tracking
    if (req.method === 'DELETE') {
      const { agentId } = req.query;

      if (!agentId || typeof agentId !== 'string') {
        return res.status(400).json({ error: 'agentId query parameter required' });
      }

      // Record offline event in history
      const historyRaw = await redis.hget(HEARTBEAT_HISTORY_KEY, agentId);
      const history: HeartbeatHistory = historyRaw
        ? (typeof historyRaw === 'string' ? JSON.parse(historyRaw) : historyRaw)
        : { agentId, events: [] };

      history.events.push({
        type: 'offline',
        timestamp: new Date().toISOString(),
        details: 'Agent explicitly went offline',
      });

      await redis.hset(HEARTBEAT_HISTORY_KEY, { [agentId]: JSON.stringify(history) });
      await redis.hdel(HEARTBEAT_KEY, agentId);

      return res.json({ success: true, removed: agentId });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Heartbeat error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
