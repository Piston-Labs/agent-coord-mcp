import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CLAIMS_KEY = 'agent-coord:claims';
const CLAIM_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

interface FileClaim {
  what: string;        // file path or resource name
  by: string;          // agent ID
  description: string; // what they're doing
  since: string;       // when claimed
  stale: boolean;
}

/**
 * File/Resource Claims Endpoint
 *
 * Prevents agents from editing the same files simultaneously.
 *
 * GET /api/claims - List all active claims
 * GET /api/claims?action=cleanup - Remove all stale claims
 * POST /api/claims - Create a claim (will fail if already claimed by another agent)
 * DELETE /api/claims?what=filepath&by=agentId - Release a claim
 * DELETE /api/claims?action=cleanup-stale - Remove all stale claims
 * DELETE /api/claims?action=release-all&by=agentId - Release all claims by an agent
 */

async function cleanupStaleClaims(): Promise<{ removed: string[]; remaining: number }> {
  const claimsRaw = await redis.hgetall(CLAIMS_KEY) || {};
  const now = Date.now();
  const removed: string[] = [];

  for (const [key, value] of Object.entries(claimsRaw)) {
    try {
      const claim = typeof value === 'string' ? JSON.parse(value) : value;
      const claimTime = new Date(claim.since).getTime();
      if ((now - claimTime) > CLAIM_EXPIRY_MS) {
        await redis.hdel(CLAIMS_KEY, key);
        removed.push(`${claim.what} (was claimed by ${claim.by})`);
      }
    } catch (e) {
      // Remove corrupt entries
      await redis.hdel(CLAIMS_KEY, key);
      removed.push(key + ' (corrupt)');
    }
  }

  // Get remaining count
  const remaining = await redis.hlen(CLAIMS_KEY);

  // Post cleanup summary to chat if any were removed
  if (removed.length > 0) {
    const chatMessage = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
      author: 'system',
      authorType: 'system',
      message: `🧹 Auto-cleanup: Released ${removed.length} stale claim(s)`,
      timestamp: new Date().toISOString(),
      reactions: []
    };
    await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));
  }

  return { removed, remaining };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List all claims or cleanup
    if (req.method === 'GET') {
      const { action } = req.query;

      // Cleanup action
      if (action === 'cleanup') {
        const result = await cleanupStaleClaims();
        return res.json({
          success: true,
          ...result,
          message: result.removed.length > 0
            ? `Cleaned up ${result.removed.length} stale claims`
            : 'No stale claims to clean up'
        });
      }

      // Auto-cleanup stale claims on every GET (keeps claims fresh)
      await cleanupStaleClaims();

      const claimsRaw = await redis.hgetall(CLAIMS_KEY) || {};
      const now = Date.now();
      const claims: FileClaim[] = [];

      for (const [key, value] of Object.entries(claimsRaw)) {
        try {
          const claim = typeof value === 'string' ? JSON.parse(value) : value;
          const claimTime = new Date(claim.since).getTime();
          claim.stale = (now - claimTime) > CLAIM_EXPIRY_MS;
          claims.push(claim);
        } catch (e) {
          // Clean up corrupt entries
          await redis.hdel(CLAIMS_KEY, key);
        }
      }

      return res.json({ claims, count: claims.length });
    }

    // POST: Create a claim
    if (req.method === 'POST') {
      const { what, by, description } = req.body;

      if (!what || !by) {
        return res.status(400).json({ error: 'what (filepath) and by (agentId) required' });
      }

      const claimKey = `${by}:${what}`;
      const now = Date.now();

      // Check if already claimed by another agent
      const existingClaims = await redis.hgetall(CLAIMS_KEY) || {};
      for (const [key, value] of Object.entries(existingClaims)) {
        try {
          const claim = typeof value === 'string' ? JSON.parse(value) : value;
          if (claim.what === what && claim.by !== by) {
            const claimTime = new Date(claim.since).getTime();
            // Only block if claim is not stale
            if ((now - claimTime) < CLAIM_EXPIRY_MS) {
              return res.status(409).json({
                error: 'File already claimed',
                claimedBy: claim.by,
                description: claim.description,
                since: claim.since,
                message: `CONFLICT: ${claim.by} is already working on ${what}. Wait or coordinate with them.`
              });
            }
          }
        } catch (e) {}
      }

      const claim: FileClaim = {
        what,
        by,
        description: description || 'Editing file',
        since: new Date().toISOString(),
        stale: false
      };

      await redis.hset(CLAIMS_KEY, { [claimKey]: JSON.stringify(claim) });

      // Post to chat about the claim
      const chatMessage = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
        author: 'system',
        authorType: 'system',
        message: `🔒 **${by}** claimed \`${what}\` - ${description || 'Editing'}`,
        timestamp: new Date().toISOString(),
        reactions: []
      };
      await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));

      return res.json({ success: true, claim });
    }

    // DELETE: Release a claim or batch operations
    if (req.method === 'DELETE') {
      const { what, by, action } = req.query;

      // Cleanup stale claims
      if (action === 'cleanup-stale') {
        const result = await cleanupStaleClaims();
        return res.json({
          success: true,
          ...result
        });
      }

      // Release all claims by a specific agent
      if (action === 'release-all' && by) {
        const claimsRaw = await redis.hgetall(CLAIMS_KEY) || {};
        const released: string[] = [];

        for (const [key, value] of Object.entries(claimsRaw)) {
          try {
            const claim = typeof value === 'string' ? JSON.parse(value) : value;
            if (claim.by === by) {
              await redis.hdel(CLAIMS_KEY, key);
              released.push(claim.what);
            }
          } catch (e) {
            await redis.hdel(CLAIMS_KEY, key);
          }
        }

        if (released.length > 0) {
          const chatMessage = {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
            author: 'system',
            authorType: 'system',
            message: `🔓 **${by}** released all claims (${released.length}): ${released.join(', ')}`,
            timestamp: new Date().toISOString(),
            reactions: []
          };
          await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));
        }

        return res.json({ success: true, released, count: released.length });
      }

      // Standard single claim release
      if (!what || !by) {
        return res.status(400).json({ error: 'what and by query params required (or use action=release-all&by=agentId)' });
      }

      const claimKey = `${by}:${what}`;
      await redis.hdel(CLAIMS_KEY, claimKey);

      // Post to chat about the release
      const chatMessage = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
        author: 'system',
        authorType: 'system',
        message: `🔓 **${by}** released \`${what}\``,
        timestamp: new Date().toISOString(),
        reactions: []
      };
      await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));

      return res.json({ success: true, released: what });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Claims error:', error);
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
