import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import crypto from 'crypto';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const USERS_KEY = 'agent-coord:users';

// Simple password hashing (for production, use bcrypt)
function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

interface User {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  role: 'admin' | 'user' | 'agent';
  createdAt: string;
  createdBy?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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
    const { username, password, role = 'user', inviteCode } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'Username must be 3-30 characters' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores, and hyphens' });
    }

    // Check invite code (simple protection for now)
    const INVITE_CODE = process.env.INVITE_CODE || 'piston-team-2025';
    if (inviteCode !== INVITE_CODE) {
      return res.status(403).json({ error: 'Valid invite code required' });
    }

    // Check if username already exists
    const existingUsers = await redis.hgetall(USERS_KEY) || {};
    const userExists = Object.values(existingUsers).some((userData: any) => {
      const user = typeof userData === 'string' ? JSON.parse(userData) : userData;
      return user.username?.toLowerCase() === username.toLowerCase();
    });

    if (userExists) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Create user
    const salt = generateSalt();
    const passwordHash = hashPassword(password, salt);
    const userId = crypto.randomUUID();

    const user: User = {
      id: userId,
      username,
      passwordHash,
      salt,
      role: role === 'admin' ? 'user' : role, // Don't allow self-registration as admin
      createdAt: new Date().toISOString(),
    };

    // Store user
    await redis.hset(USERS_KEY, { [userId]: JSON.stringify(user) });

    return res.status(201).json({
      success: true,
      user: {
        id: userId,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
