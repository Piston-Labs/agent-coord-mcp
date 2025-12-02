import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Redis keys
const SESSIONS_KEY = 'agent-coord:sessions';
const RULES_KEY = 'agent-coord:rules';
const LOCKS_KEY = 'agent-coord:resource-locks';
const ZONES_KEY = 'agent-coord:zones';
const CLAIMS_KEY = 'agent-coord:claims';

interface AgentSession {
  agentId: string;
  role: string;
  startedAt: string;
  lastActivity: string;
  rulesVersion: string;
  rulesAcknowledged: boolean;
  currentClaims: string[];
  currentLocks: string[];
  currentZones: string[];
  violationCount: number;
}

/**
 * Substrate Session API - Agent session management
 *
 * POST /api/substrate/session { action: "init", agentId, role }
 *   - Initialize a new session, load rules, return acknowledgment requirement
 *
 * POST /api/substrate/session { action: "acknowledge", agentId }
 *   - Acknowledge rules (required before working)
 *
 * GET /api/substrate/session?agentId=X
 *   - Get current session state
 *
 * POST /api/substrate/session { action: "heartbeat", agentId }
 *   - Update last activity timestamp
 *
 * POST /api/substrate/session { action: "end", agentId }
 *   - End session, prompt for checkpoint if needed
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: Retrieve session
    if (req.method === 'GET') {
      const { agentId } = req.query;

      if (!agentId) {
        return res.status(400).json({ error: 'agentId required' });
      }

      const session = await redis.hget(SESSIONS_KEY, agentId as string);

      if (!session) {
        return res.status(404).json({ error: 'No active session', agentId });
      }

      const sessionData = typeof session === 'string' ? JSON.parse(session) : session;

      // Get current state
      const [locksData, zonesData, claimsData] = await Promise.all([
        redis.hgetall(LOCKS_KEY),
        redis.hgetall(ZONES_KEY),
        redis.hgetall(CLAIMS_KEY),
      ]);

      // Find this agent's active resources
      const myLocks = Object.entries(locksData || {})
        .filter(([_, lock]) => {
          const l = typeof lock === 'string' ? JSON.parse(lock) : lock;
          return l.lockedBy === agentId;
        })
        .map(([path]) => path);

      const myZones = Object.entries(zonesData || {})
        .filter(([_, zone]) => {
          const z = typeof zone === 'string' ? JSON.parse(zone) : zone;
          return z.owner === agentId;
        })
        .map(([zoneId]) => zoneId);

      const myClaims = Object.entries(claimsData || {})
        .filter(([_, claim]) => {
          const c = typeof claim === 'string' ? JSON.parse(claim) : claim;
          return c.agentId === agentId;
        })
        .map(([_, claim]) => {
          const c = typeof claim === 'string' ? JSON.parse(claim) : claim;
          return c.what;
        });

      return res.json({
        session: {
          ...sessionData,
          currentLocks: myLocks,
          currentZones: myZones,
          currentClaims: myClaims,
        }
      });
    }

    // POST: Session actions
    if (req.method === 'POST') {
      const { action, agentId, role } = req.body;

      if (!action || !agentId) {
        return res.status(400).json({ error: 'action and agentId required' });
      }

      // INIT: Start new session
      if (action === 'init') {
        const rules = await redis.get(RULES_KEY);
        const rulesData = rules
          ? (typeof rules === 'string' ? JSON.parse(rules) : rules)
          : null;

        const session: AgentSession = {
          agentId,
          role: role || 'developer',
          startedAt: new Date().toISOString(),
          lastActivity: new Date().toISOString(),
          rulesVersion: rulesData?.version || '1.0.0',
          rulesAcknowledged: false,
          currentClaims: [],
          currentLocks: [],
          currentZones: [],
          violationCount: 0,
        };

        await redis.hset(SESSIONS_KEY, { [agentId]: JSON.stringify(session) });

        // Return rules summary for agent to acknowledge
        const rulesSummary = [
          { id: 'lock-before-edit', summary: 'Lock files before editing to prevent conflicts' },
          { id: 'zone-respect', summary: 'Do not edit files in zones owned by other agents' },
          { id: 'claim-before-work', summary: 'Claim tasks before starting work' },
          { id: 'max-claims', summary: `Maximum ${rulesData?.coordination?.maxConcurrentClaimsPerAgent || 3} concurrent claims` },
          { id: 'handoff-protocol', summary: 'Use formal handoff tool when transferring work' },
          { id: 'checkpoint-on-exit', summary: 'Save checkpoint before ending session' },
        ];

        return res.json({
          success: true,
          session,
          rules: rulesSummary,
          message: 'Session initialized. Please acknowledge rules before working.',
          requiresAcknowledgment: true
        });
      }

      // ACKNOWLEDGE: Confirm rules acceptance
      if (action === 'acknowledge') {
        const existing = await redis.hget(SESSIONS_KEY, agentId);

        if (!existing) {
          return res.status(404).json({ error: 'No session found. Call init first.' });
        }

        const session = typeof existing === 'string' ? JSON.parse(existing) : existing;
        session.rulesAcknowledged = true;
        session.lastActivity = new Date().toISOString();

        await redis.hset(SESSIONS_KEY, { [agentId]: JSON.stringify(session) });

        return res.json({
          success: true,
          message: 'Rules acknowledged. You may now proceed with work.',
          session
        });
      }

      // HEARTBEAT: Update activity
      if (action === 'heartbeat') {
        const existing = await redis.hget(SESSIONS_KEY, agentId);

        if (!existing) {
          return res.status(404).json({ error: 'No session found' });
        }

        const session = typeof existing === 'string' ? JSON.parse(existing) : existing;
        session.lastActivity = new Date().toISOString();

        await redis.hset(SESSIONS_KEY, { [agentId]: JSON.stringify(session) });

        return res.json({ success: true, lastActivity: session.lastActivity });
      }

      // END: End session
      if (action === 'end') {
        const existing = await redis.hget(SESSIONS_KEY, agentId);

        if (!existing) {
          return res.status(404).json({ error: 'No session found' });
        }

        const session = typeof existing === 'string' ? JSON.parse(existing) : existing;

        // Check for unreleased resources
        const [locksData, zonesData, claimsData] = await Promise.all([
          redis.hgetall(LOCKS_KEY),
          redis.hgetall(ZONES_KEY),
          redis.hgetall(CLAIMS_KEY),
        ]);

        const myLocks = Object.entries(locksData || {})
          .filter(([_, lock]) => {
            const l = typeof lock === 'string' ? JSON.parse(lock) : lock;
            return l.lockedBy === agentId;
          });

        const myZones = Object.entries(zonesData || {})
          .filter(([_, zone]) => {
            const z = typeof zone === 'string' ? JSON.parse(zone) : zone;
            return z.owner === agentId;
          });

        const myClaims = Object.entries(claimsData || {})
          .filter(([_, claim]) => {
            const c = typeof claim === 'string' ? JSON.parse(claim) : claim;
            return c.agentId === agentId;
          });

        const warnings: string[] = [];

        if (myLocks.length > 0) {
          warnings.push(`You have ${myLocks.length} active locks. Consider releasing them.`);
        }
        if (myZones.length > 0) {
          warnings.push(`You own ${myZones.length} zones. Consider releasing them.`);
        }
        if (myClaims.length > 0) {
          warnings.push(`You have ${myClaims.length} active claims. Consider handoff or release.`);
        }

        // Remove session
        await redis.hdel(SESSIONS_KEY, agentId);

        return res.json({
          success: true,
          message: 'Session ended',
          warnings,
          recommendation: warnings.length > 0
            ? 'Consider saving a checkpoint and releasing resources before fully ending.'
            : 'Clean exit - no unreleased resources.'
        });
      }

      return res.status(400).json({ error: 'Unknown action. Use: init, acknowledge, heartbeat, end' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Session error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
