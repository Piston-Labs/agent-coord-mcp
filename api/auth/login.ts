import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import crypto from 'crypto';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SESSIONS_KEY = 'agent-coord:sessions';
const USERS_KEY = 'agent-coord:users';
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days in seconds

// Fallback admin credentials from env vars
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'piston2025';

function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

interface User {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  role: 'admin' | 'user' | 'agent';
  createdAt: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Must use specific origin when credentials are included (not *)
  const origin = req.headers.origin || 'https://agent-coord-mcp.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    let authenticatedUser: { id: string; username: string; role: string } | null = null;

    // First, check registered users in Redis
    const users = await redis.hgetall(USERS_KEY) || {};
    for (const [userId, userData] of Object.entries(users)) {
      const user: User = typeof userData === 'string' ? JSON.parse(userData) : userData;
      if (user.username.toLowerCase() === username.toLowerCase()) {
        // Verify password
        const inputHash = hashPassword(password, user.salt);
        if (inputHash === user.passwordHash) {
          authenticatedUser = { id: user.id, username: user.username, role: user.role };
        }
        break;
      }
    }

    // Fallback to env var admin (for backwards compatibility)
    if (!authenticatedUser && username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      authenticatedUser = { id: 'admin', username: ADMIN_USERNAME, role: 'admin' };
    }

    if (!authenticatedUser) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate session
    const sessionId = generateSessionId();
    const session = {
      id: sessionId,
      userId: authenticatedUser.id,
      username: authenticatedUser.username,
      role: authenticatedUser.role,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_TTL * 1000).toISOString(),
    };

    // Store in Redis with TTL
    await redis.hset(SESSIONS_KEY, { [sessionId]: JSON.stringify(session) });
    await redis.expire(SESSIONS_KEY, SESSION_TTL);

    // Set cookie - use Secure in production for HTTPS
    const isProduction = process.env.VERCEL_ENV === 'production' || req.headers.host?.includes('vercel.app');
    const securePart = isProduction ? '; Secure' : '';
    res.setHeader('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly; SameSite=Lax${securePart}; Max-Age=${SESSION_TTL}`);

    return res.json({
      success: true,
      session: {
        username: session.username,
        role: session.role,
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
