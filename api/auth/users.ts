import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const USERS_KEY = 'agent-coord:users';
const SESSIONS_KEY = 'agent-coord:sessions';

function getSessionFromCookie(req: VercelRequest): string | null {
  const cookies = req.headers.cookie;
  if (!cookies) return null;
  const sessionMatch = cookies.match(/session=([^;]+)/);
  return sessionMatch ? sessionMatch[1] : null;
}

interface User {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  role: 'admin' | 'user' | 'agent';
  createdAt: string;
}

interface Session {
  id: string;
  userId: string;
  username: string;
  role: string;
  createdAt: string;
  expiresAt: string;
}

async function requireAdmin(req: VercelRequest): Promise<Session | null> {
  const sessionId = getSessionFromCookie(req);
  if (!sessionId) return null;

  const raw = await redis.hget(SESSIONS_KEY, sessionId);
  if (!raw) return null;

  const session: Session = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // Check expiry
  if (new Date(session.expiresAt) < new Date()) return null;

  // Check admin role (also allow env var admin)
  if (session.role !== 'admin' && session.userId !== 'admin') return null;

  return session;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Must use specific origin when credentials are included (not *)
  const origin = req.headers.origin || 'https://agent-coord-mcp.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Require admin for all operations
  const session = await requireAdmin(req);
  if (!session) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    if (req.method === 'GET') {
      // List all users (without sensitive data)
      const users = await redis.hgetall(USERS_KEY) || {};
      const userList = Object.entries(users).map(([id, userData]) => {
        const user: User = typeof userData === 'string' ? JSON.parse(userData) : userData;
        return {
          id: user.id,
          username: user.username,
          role: user.role,
          createdAt: user.createdAt,
        };
      });

      return res.json({ users: userList, count: userList.length });
    }

    if (req.method === 'DELETE') {
      const { userId } = req.query;
      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'userId query parameter required' });
      }

      // Don't allow deleting yourself
      if (userId === session.userId) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
      }

      await redis.hdel(USERS_KEY, userId);
      return res.json({ success: true, deleted: userId });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Users endpoint error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
