import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const KUDOS_KEY = 'agent-coord:kudos';
const KUDOS_LOG_KEY = 'agent-coord:kudos-log';

interface KudosEntry {
  id: string;
  from: string;
  to: string;
  reason: string;
  timestamp: string;
  emoji?: string;
}

interface AgentKudos {
  agentId: string;
  received: number;
  given: number;
  recentKudos: KudosEntry[];
}

/**
 * Kudos API - Peer recognition system for agents and humans
 *
 * POST /api/kudos - Give kudos to someone
 *   body: { from: string, to: string, reason: string, emoji?: string }
 *
 * GET /api/kudos - Get kudos for an agent
 *   query: agentId (required)
 *
 * GET /api/kudos?leaderboard=true - Get top agents by kudos received
 *   query: limit (optional, default 10)
 *
 * GET /api/kudos?recent=true - Get recent kudos activity
 *   query: limit (optional, default 20)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // POST - Give kudos
    if (req.method === 'POST') {
      const { from, to, reason, emoji } = req.body;

      if (!from || !to) {
        return res.status(400).json({ error: 'from and to are required' });
      }

      if (from === to) {
        return res.status(400).json({ error: 'Cannot give kudos to yourself' });
      }

      const kudosEntry: KudosEntry = {
        id: `kudos-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        from,
        to,
        reason: reason || 'Great work!',
        timestamp: new Date().toISOString(),
        emoji: emoji || '⭐'
      };

      // Increment kudos count for recipient
      const recipientKey = `${KUDOS_KEY}:${to}`;
      const senderKey = `${KUDOS_KEY}:${from}`;

      // Get current counts
      const recipientData = await redis.hgetall(recipientKey) || {};
      const senderData = await redis.hgetall(senderKey) || {};

      const recipientReceived = parseInt(String(recipientData.received || '0')) + 1;
      const senderGiven = parseInt(String(senderData.given || '0')) + 1;

      // Update recipient
      await redis.hset(recipientKey, {
        agentId: to,
        received: recipientReceived,
        given: recipientData.given || 0
      });

      // Update sender's given count
      await redis.hset(senderKey, {
        agentId: from,
        received: senderData.received || 0,
        given: senderGiven
      });

      // Log the kudos entry (keep last 500)
      await redis.lpush(KUDOS_LOG_KEY, JSON.stringify(kudosEntry));
      await redis.ltrim(KUDOS_LOG_KEY, 0, 499);

      // Also store recent kudos for the recipient
      const recipientLogKey = `${KUDOS_KEY}:${to}:log`;
      await redis.lpush(recipientLogKey, JSON.stringify(kudosEntry));
      await redis.ltrim(recipientLogKey, 0, 19); // Keep last 20 for each agent

      return res.json({
        success: true,
        kudos: kudosEntry,
        recipientTotal: recipientReceived,
        message: `${from} gave kudos to ${to}: ${reason || 'Great work!'}`
      });
    }

    // GET - Query kudos
    if (req.method === 'GET') {
      const { agentId, leaderboard, recent, limit } = req.query;
      const limitNum = parseInt(String(limit || '10'));

      // Leaderboard mode
      if (leaderboard === 'true') {
        // Get all agent kudos
        const keys = await redis.keys(`${KUDOS_KEY}:*`);
        const agentKeys = keys.filter(k => !k.includes(':log'));

        const leaderboardData: { agentId: string; received: number; given: number }[] = [];

        for (const key of agentKeys) {
          const data = await redis.hgetall(key);
          if (data && data.agentId) {
            leaderboardData.push({
              agentId: String(data.agentId),
              received: parseInt(String(data.received || '0')),
              given: parseInt(String(data.given || '0'))
            });
          }
        }

        // Sort by received kudos descending
        leaderboardData.sort((a, b) => b.received - a.received);

        return res.json({
          leaderboard: leaderboardData.slice(0, limitNum),
          total: leaderboardData.length
        });
      }

      // Recent kudos mode
      if (recent === 'true') {
        const recentKudos = await redis.lrange(KUDOS_LOG_KEY, 0, limitNum - 1);
        const parsed = recentKudos.map(k => typeof k === 'string' ? JSON.parse(k) : k);

        return res.json({
          recent: parsed,
          count: parsed.length
        });
      }

      // Get kudos for specific agent
      if (agentId) {
        const agentKey = `${KUDOS_KEY}:${agentId}`;
        const data = await redis.hgetall(agentKey) || {};

        // Get recent kudos for this agent
        const logKey = `${KUDOS_KEY}:${agentId}:log`;
        const recentKudos = await redis.lrange(logKey, 0, 9);
        const parsed = recentKudos.map(k => typeof k === 'string' ? JSON.parse(k) : k);

        return res.json({
          agentId,
          received: parseInt(String(data.received || '0')),
          given: parseInt(String(data.given || '0')),
          recentKudos: parsed
        });
      }

      return res.status(400).json({ error: 'agentId, leaderboard=true, or recent=true required' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Kudos API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
