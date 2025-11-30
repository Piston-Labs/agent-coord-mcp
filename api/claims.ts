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
 * POST /api/claims - Create a claim (will fail if already claimed by another agent)
 * DELETE /api/claims?what=filepath&by=agentId - Release a claim
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List all claims
    if (req.method === 'GET') {
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

    // DELETE: Release a claim
    if (req.method === 'DELETE') {
      const { what, by } = req.query;

      if (!what || !by) {
        return res.status(400).json({ error: 'what and by query params required' });
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
