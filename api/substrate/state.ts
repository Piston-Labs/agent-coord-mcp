import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Redis keys
const RULES_KEY = 'agent-coord:rules';
const SESSIONS_KEY = 'agent-coord:sessions';
const LOCKS_KEY = 'agent-coord:resource-locks';
const ZONES_KEY = 'agent-coord:zones';
const CLAIMS_KEY = 'agent-coord:claims';
const VIOLATIONS_KEY = 'agent-coord:violations';

/**
 * Substrate State API - Full system state view
 *
 * GET /api/substrate/state
 *   - Returns all active sessions, locks, zones, claims, and recent violations
 *   - Useful for understanding current coordination state
 *
 * GET /api/substrate/state?agentId=X
 *   - Returns state filtered to what's relevant to this agent
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
    const { agentId } = req.query;

    // Load all state in parallel
    const [rulesData, sessionsData, locksData, zonesData, claimsData, violationsData] = await Promise.all([
      redis.get(RULES_KEY),
      redis.hgetall(SESSIONS_KEY),
      redis.hgetall(LOCKS_KEY),
      redis.hgetall(ZONES_KEY),
      redis.hgetall(CLAIMS_KEY),
      redis.lrange(VIOLATIONS_KEY, 0, 49), // Last 50 violations
    ]);

    // Parse rules
    const rules = rulesData
      ? (typeof rulesData === 'string' ? JSON.parse(rulesData) : rulesData)
      : null;

    // Parse sessions
    const sessions = sessionsData
      ? Object.entries(sessionsData).map(([id, data]) => ({
          agentId: id,
          ...(typeof data === 'string' ? JSON.parse(data) : data)
        }))
      : [];

    // Parse locks
    const locks = locksData
      ? Object.entries(locksData).map(([path, data]) => ({
          path,
          ...(typeof data === 'string' ? JSON.parse(data) : data)
        }))
      : [];

    // Parse zones
    const zones = zonesData
      ? Object.entries(zonesData).map(([zoneId, data]) => ({
          zoneId,
          ...(typeof data === 'string' ? JSON.parse(data) : data)
        }))
      : [];

    // Parse claims
    const claims = claimsData
      ? Object.entries(claimsData).map(([claimId, data]) => ({
          claimId,
          ...(typeof data === 'string' ? JSON.parse(data) : data)
        }))
      : [];

    // Parse violations
    const violations = violationsData
      ? violationsData.map(v => typeof v === 'string' ? JSON.parse(v) : v)
      : [];

    // If agentId provided, filter to relevant data
    if (agentId) {
      const agentIdStr = agentId as string;

      return res.json({
        agentId: agentIdStr,
        timestamp: new Date().toISOString(),

        mySession: sessions.find(s => s.agentId === agentIdStr) || null,

        myLocks: locks.filter(l => l.lockedBy === agentIdStr),
        myZones: zones.filter(z => z.owner === agentIdStr),
        myClaims: claims.filter(c => c.agentId === agentIdStr),
        myViolations: violations.filter(v => v.agentId === agentIdStr),

        // Other agents' resources (for awareness)
        otherLocks: locks.filter(l => l.lockedBy !== agentIdStr),
        otherZones: zones.filter(z => z.owner && z.owner !== agentIdStr),

        // Active agents
        activeAgents: sessions.map(s => ({
          agentId: s.agentId,
          role: s.role,
          rulesAcknowledged: s.rulesAcknowledged,
          lastActivity: s.lastActivity
        })),

        rulesVersion: rules?.version || 'unknown'
      });
    }

    // Full state view
    return res.json({
      timestamp: new Date().toISOString(),

      rules: {
        version: rules?.version || 'unknown',
        coordination: rules?.coordination || {},
        conflicts: rules?.conflicts || {}
      },

      sessions: {
        count: sessions.length,
        active: sessions.filter(s => s.rulesAcknowledged),
        pending: sessions.filter(s => !s.rulesAcknowledged)
      },

      locks: {
        count: locks.length,
        items: locks
      },

      zones: {
        count: zones.length,
        items: zones
      },

      claims: {
        count: claims.length,
        items: claims
      },

      violations: {
        recentCount: violations.length,
        recent: violations.slice(0, 10)
      },

      summary: {
        activeAgents: sessions.filter(s => s.rulesAcknowledged).length,
        pendingAgents: sessions.filter(s => !s.rulesAcknowledged).length,
        totalLocks: locks.length,
        totalZones: zones.filter(z => z.owner).length,
        totalClaims: claims.length,
        recentViolations: violations.length
      }
    });

  } catch (error) {
    console.error('State error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
