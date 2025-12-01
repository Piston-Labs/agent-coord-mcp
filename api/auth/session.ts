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

interface Session {
  id: string;
  userId?: string;
  username: string;
  role?: string;
  createdAt: string;
  expiresAt: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sessionId = getSessionFromCookie(req);

    // AUTH BYPASS: If no session cookie, return authenticated as guest
    // This allows the hub to work without login during development
    if (!sessionId) {
      return res.json({
        authenticated: true,
        session: {
          username: 'guest',
          role: 'user',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
        bypass: true
      });
    }

    const raw = await redis.hget(SESSIONS_KEY, sessionId);
    if (!raw) {
      return res.status(401).json({ authenticated: false, error: 'Session not found' });
    }

    const session: Session = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // Check if expired
    if (new Date(session.expiresAt) < new Date()) {
      await redis.hdel(SESSIONS_KEY, sessionId);
      return res.status(401).json({ authenticated: false, error: 'Session expired' });
    }

    return res.json({
      authenticated: true,
      session: {
        username: session.username,
        role: session.role || 'admin',
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    console.error('Session check error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
