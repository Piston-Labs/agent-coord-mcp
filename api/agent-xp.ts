import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const XP_KEY = 'agent-coord:agent-xp';
const ACHIEVEMENTS_KEY = 'agent-coord:achievements';

// XP required for each level
const LEVEL_THRESHOLDS = [
  0,      // Level 1: Novice
  100,    // Level 2: Capable
  300,    // Level 3: Proficient
  600,    // Level 4: Expert
  1000,   // Level 5: Master
];

const LEVEL_NAMES = ['Novice', 'Capable', 'Proficient', 'Expert', 'Master'];

interface AgentXP {
  agentId: string;
  xp: number;
  level: number;
  levelName: string;
  xpToNextLevel: number;
  xpProgress: number;  // percentage to next level
  totalTasks: number;
  tasksCompleted: number;
  achievements: string[];
  lastActive: string;
  streak: number;  // consecutive days active
}

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  xpReward: number;
}

const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-steps', name: 'First Steps', description: 'Complete your first task', icon: '👶', xpReward: 10 },
  { id: 'team-player', name: 'Team Player', description: 'Give kudos to 5 teammates', icon: '🤝', xpReward: 25 },
  { id: 'bug-squasher', name: 'Bug Squasher', description: 'Fix 10 bugs', icon: '🐛', xpReward: 50 },
  { id: 'knowledge-keeper', name: 'Knowledge Keeper', description: 'Add 10 memories to shared knowledge', icon: '📚', xpReward: 50 },
  { id: 'night-owl', name: 'Night Owl', description: 'Work during off-hours', icon: '🦉', xpReward: 15 },
  { id: 'early-bird', name: 'Early Bird', description: 'First agent online 5 days in a row', icon: '🐦', xpReward: 30 },
  { id: 'mentor', name: 'Mentor', description: 'Help onboard a new agent', icon: '🎓', xpReward: 75 },
  { id: 'perfectionist', name: 'Perfectionist', description: 'Complete 5 tasks with zero revisions', icon: '✨', xpReward: 40 },
  { id: 'marathon', name: 'Marathon Runner', description: 'Active for 4+ hours in a single session', icon: '🏃', xpReward: 35 },
  { id: 'explorer', name: 'Explorer', description: 'Use 20+ different MCP tools', icon: '🧭', xpReward: 45 },
  { id: 'architect', name: 'Architect', description: 'Ship a major feature', icon: '🏗️', xpReward: 100 },
  { id: 'guardian', name: 'Guardian', description: 'Catch a security issue before production', icon: '🛡️', xpReward: 75 },
];

function calculateLevel(xp: number): { level: number; levelName: string; xpToNextLevel: number; xpProgress: number } {
  let level = 1;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) {
      level = i + 1;
      break;
    }
  }

  const currentThreshold = LEVEL_THRESHOLDS[level - 1] || 0;
  const nextThreshold = LEVEL_THRESHOLDS[level] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
  const xpInLevel = xp - currentThreshold;
  const xpNeeded = nextThreshold - currentThreshold;
  const xpToNextLevel = level >= LEVEL_NAMES.length ? 0 : nextThreshold - xp;
  const xpProgress = level >= LEVEL_NAMES.length ? 100 : Math.round((xpInLevel / xpNeeded) * 100);

  return {
    level,
    levelName: LEVEL_NAMES[level - 1] || 'Master',
    xpToNextLevel,
    xpProgress
  };
}

/**
 * Agent XP API - Track agent progression and achievements
 *
 * GET /api/agent-xp - Get XP for an agent or leaderboard
 *   query: agentId (optional - if omitted, returns leaderboard)
 *   query: leaderboard=true&limit=10 - Get top agents
 *
 * POST /api/agent-xp - Add XP to an agent
 *   body: { agentId, xp, reason }
 *
 * POST /api/agent-xp?action=achievement - Unlock an achievement
 *   body: { agentId, achievementId }
 *
 * GET /api/agent-xp?achievements=true - List all possible achievements
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET achievements list
    if (req.method === 'GET' && req.query.achievements === 'true') {
      return res.status(200).json({ achievements: ACHIEVEMENTS });
    }

    // GET leaderboard or single agent
    if (req.method === 'GET') {
      const { agentId, leaderboard, limit = '10' } = req.query;

      if (leaderboard === 'true' || !agentId) {
        // Get all agent XP data
        const keys = await redis.keys(`${XP_KEY}:*`);
        const agents: AgentXP[] = [];

        for (const key of keys) {
          const data = await redis.hgetall(key);
          if (data && data.agentId) {
            const xp = parseInt(data.xp as string) || 0;
            const levelInfo = calculateLevel(xp);
            agents.push({
              agentId: data.agentId as string,
              xp,
              ...levelInfo,
              totalTasks: parseInt(data.totalTasks as string) || 0,
              tasksCompleted: parseInt(data.tasksCompleted as string) || 0,
              achievements: JSON.parse(data.achievements as string || '[]'),
              lastActive: data.lastActive as string || '',
              streak: parseInt(data.streak as string) || 0
            });
          }
        }

        // Sort by XP descending
        agents.sort((a, b) => b.xp - a.xp);

        return res.status(200).json({
          leaderboard: agents.slice(0, parseInt(limit as string)),
          totalAgents: agents.length
        });
      }

      // Get single agent
      const key = `${XP_KEY}:${agentId}`;
      const data = await redis.hgetall(key);

      if (!data || !data.agentId) {
        // Return default for new agent
        return res.status(200).json({
          agentId,
          xp: 0,
          level: 1,
          levelName: 'Novice',
          xpToNextLevel: 100,
          xpProgress: 0,
          totalTasks: 0,
          tasksCompleted: 0,
          achievements: [],
          lastActive: null,
          streak: 0
        });
      }

      const xp = parseInt(data.xp as string) || 0;
      const levelInfo = calculateLevel(xp);

      return res.status(200).json({
        agentId: data.agentId,
        xp,
        ...levelInfo,
        totalTasks: parseInt(data.totalTasks as string) || 0,
        tasksCompleted: parseInt(data.tasksCompleted as string) || 0,
        achievements: JSON.parse(data.achievements as string || '[]'),
        lastActive: data.lastActive,
        streak: parseInt(data.streak as string) || 0
      });
    }

    // POST - Add XP or unlock achievement
    if (req.method === 'POST') {
      const { action } = req.query;

      // Unlock achievement
      if (action === 'achievement') {
        const { agentId, achievementId } = req.body;

        if (!agentId || !achievementId) {
          return res.status(400).json({ error: 'agentId and achievementId required' });
        }

        const achievement = ACHIEVEMENTS.find(a => a.id === achievementId);
        if (!achievement) {
          return res.status(404).json({ error: 'Achievement not found' });
        }

        const key = `${XP_KEY}:${agentId}`;
        const data = await redis.hgetall(key) || {};
        const achievements: string[] = JSON.parse(data.achievements as string || '[]');

        if (achievements.includes(achievementId)) {
          return res.status(400).json({ error: 'Achievement already unlocked' });
        }

        achievements.push(achievementId);
        const currentXp = parseInt(data.xp as string) || 0;
        const newXp = currentXp + achievement.xpReward;

        await redis.hset(key, {
          agentId,
          achievements: JSON.stringify(achievements),
          xp: newXp,
          lastActive: new Date().toISOString()
        });

        const levelInfo = calculateLevel(newXp);

        return res.status(200).json({
          success: true,
          achievement,
          xpAwarded: achievement.xpReward,
          newXp,
          ...levelInfo
        });
      }

      // Add XP
      const { agentId, xp, reason } = req.body;

      if (!agentId || xp === undefined) {
        return res.status(400).json({ error: 'agentId and xp required' });
      }

      const key = `${XP_KEY}:${agentId}`;
      const data = await redis.hgetall(key) || {};
      const currentXp = parseInt(data.xp as string) || 0;
      const newXp = currentXp + parseInt(xp);

      await redis.hset(key, {
        agentId,
        xp: newXp,
        lastActive: new Date().toISOString(),
        totalTasks: parseInt(data.totalTasks as string) || 0,
        tasksCompleted: parseInt(data.tasksCompleted as string) || 0,
        achievements: data.achievements || '[]',
        streak: parseInt(data.streak as string) || 0
      });

      const levelInfo = calculateLevel(newXp);

      return res.status(200).json({
        success: true,
        agentId,
        xpAdded: xp,
        reason,
        newXp,
        ...levelInfo
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Agent XP error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
