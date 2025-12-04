import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SESSIONS_KEY = 'agent-coord:sessions';

function getSessionFromCookie(req: VercelRequest): string | null {
  const cookies = req.headers.cookie;
  if (!cookies) return null;

  const sessionMatch = cookies.match(/session=([^;]+)/);
  return sessionMatch ? sessionMatch[1] : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Must use specific origin when credentials are included (not *)
  const origin = req.headers.origin || 'https://agent-coord-mcp.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sessionId = getSessionFromCookie(req);

    if (sessionId) {
      // Delete session from Redis
      await redis.hdel(SESSIONS_KEY, sessionId);
    }

    // Clear cookie - use Secure in production for HTTPS
    const isProduction = process.env.VERCEL_ENV === 'production' || req.headers.host?.includes('vercel.app');
    const securePart = isProduction ? '; Secure' : '';
    res.setHeader('Set-Cookie', `session=; Path=/; HttpOnly; SameSite=Lax${securePart}; Max-Age=0`);

    return res.json({ success: true, message: 'Logged out' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
