import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const MESSAGES_KEY = 'agent-coord:messages';
const POLL_TRACKING_KEY = 'agent-coord:poll-tracking';
const USERS_KEY = 'agent-coord:users';
const MAX_MESSAGES = 1000;

// Topic keywords for message filtering (token optimization)
const TOPIC_KEYWORDS: Record<string, string[]> = {
  'infrastructure': ['docker', 'railway', 'aws', 'ec2', 'kubernetes', 'k8s', 'vm', 'container', 'deploy', 'cloudflare', 'durable object', 'spawn', 'worker'],
  'training': ['training', 'lesson', 'quiz', 'module', 'learning', 'simulation', 'roleplay', 'eli', 'spaced repetition'],
  'sales': ['sales', 'pitch', 'prospect', 'demo', 'objection', 'closing', 'crm', 'pipeline', 'shop owner'],
  'coordination': ['handoff', 'checkpoint', 'claim', 'task', 'blocker', 'status', 'heartbeat', 'online', 'offline'],
  'architecture': ['architecture', 'design', 'pattern', 'memory', 'state', 'hybrid', 'tier', 'soul'],
  'bug': ['bug', 'fix', 'error', 'issue', 'broken', 'failed', 'crash'],
};

// Check if message matches any of the given topics
function messageMatchesTopics(message: string, topics: string[]): boolean {
  const lowerMessage = message.toLowerCase();
  return topics.some(topic => {
    const keywords = TOPIC_KEYWORDS[topic];
    if (!keywords) return false;
    return keywords.some(keyword => lowerMessage.includes(keyword));
  });
}

interface User {
  id: string;
  username: string;
  role: 'admin' | 'user' | 'agent';
}

// Check if a username belongs to a registered human user
async function isRegisteredHumanUser(username: string): Promise<boolean> {
  const users = await redis.hgetall(USERS_KEY) || {};
  for (const userData of Object.values(users)) {
    const user: User = typeof userData === 'string' ? JSON.parse(userData) : userData;
    if (user.username.toLowerCase() === username.toLowerCase() && user.role !== 'agent') {
      return true;
    }
  }
  return false;
}

// Polling advisory configuration (inspired by contextOS)
const MIN_POLL_INTERVAL_MS = 30000;  // 30 seconds minimum
const SUGGESTED_POLL_INTERVAL_MS = 60000;  // 60 seconds suggested
const FAST_POLL_THRESHOLD_MS = 15000;  // Warn if polling faster than 15s

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const { limit = '50', since, agentId, topics, mentionsMe, excludeSystem } = req.query;
      const limitNum = parseInt(limit as string, 10);

      // Get messages from Redis (stored as JSON strings)
      const messages = await redis.lrange(MESSAGES_KEY, 0, MAX_MESSAGES - 1);
      let result = messages.map((m: any) => typeof m === 'string' ? JSON.parse(m) : m);

      if (since && typeof since === 'string') {
        const sinceTime = new Date(since).getTime();
        result = result.filter((m: any) => new Date(m.timestamp).getTime() > sinceTime);
      }

      // Topic-based filtering for token optimization (researcher insight: 60-80% reduction)
      // Usage: ?topics=infrastructure,training
      if (topics && typeof topics === 'string') {
        const topicList = topics.split(',').map(t => t.trim().toLowerCase());
        const beforeCount = result.length;
        result = result.filter((m: any) => {
          // Always include messages from humans (important context)
          if (m.authorType === 'human') return true;
          // Always include system messages about agent status
          if (m.authorType === 'system') return true;
          // Filter agent messages by topic
          return messageMatchesTopics(m.message || '', topicList);
        });
        // Add filter stats to help agents understand reduction
        const filteredCount = beforeCount - result.length;
        if (filteredCount > 0) {
          console.log(`[chat] Topic filter reduced ${beforeCount} → ${result.length} messages (${Math.round(filteredCount/beforeCount*100)}% reduction)`);
        }
      }

      // Filter to only messages that mention this agent
      // Usage: ?agentId=phil&mentionsMe=true
      if (mentionsMe === 'true' && agentId && typeof agentId === 'string') {
        result = result.filter((m: any) => {
          const msg = (m.message || '').toLowerCase();
          return msg.includes(`@${agentId.toLowerCase()}`) ||
                 msg.includes(`@team`) ||
                 m.authorType === 'human'; // Always include human messages
        });
      }

      // Optionally exclude system messages (heartbeats, online/offline)
      // Usage: ?excludeSystem=true
      if (excludeSystem === 'true') {
        result = result.filter((m: any) => m.authorType !== 'system');
      }

      // Return most recent messages (list is newest-first)
      result = result.slice(0, limitNum);

      // Polling advisory - track agent poll times and suggest intervals
      let pollingAdvisory: any = null;
      if (agentId && typeof agentId === 'string') {
        const now = Date.now();
        const lastPollKey = `${POLL_TRACKING_KEY}:${agentId}`;
        const lastPollTime = await redis.get(lastPollKey);

        if (lastPollTime) {
          const timeSinceLastPoll = now - parseInt(lastPollTime as string, 10);

          if (timeSinceLastPoll < FAST_POLL_THRESHOLD_MS) {
            pollingAdvisory = {
              warning: `⚠️ Polling too fast (${Math.round(timeSinceLastPoll / 1000)}s since last). Slow down to avoid context explosion.`,
              suggestedIntervalMs: SUGGESTED_POLL_INTERVAL_MS,
              suggestion: 'Use 30-60s intervals for healthier context management.',
              yourInterval: timeSinceLastPoll
            };
          } else if (timeSinceLastPoll < MIN_POLL_INTERVAL_MS) {
            pollingAdvisory = {
              tip: `Consider slowing to ${SUGGESTED_POLL_INTERVAL_MS / 1000}s intervals for healthier context management.`,
              suggestedIntervalMs: SUGGESTED_POLL_INTERVAL_MS,
              yourInterval: timeSinceLastPoll
            };
          }
        }

        // Update last poll time
        await redis.set(lastPollKey, now.toString(), { ex: 3600 }); // Expire after 1 hour
      }

      const response: any = { messages: result, count: result.length };
      if (pollingAdvisory) {
        response.pollingAdvisory = pollingAdvisory;
      }
      response.suggestedPollIntervalMs = SUGGESTED_POLL_INTERVAL_MS;

      // Include available topics for filtering (helps agents discover the feature)
      if (topics) {
        response.appliedFilters = { topics: topics.split(',').map((t: string) => t.trim()) };
      }
      response.availableTopics = Object.keys(TOPIC_KEYWORDS);

      return res.json(response);
    }

    if (req.method === 'POST') {
      const { author, authorType = 'agent', message, imageData, imageName } = req.body;

      if (!author || (!message && !imageData)) {
        return res.status(400).json({ error: 'author and (message or imageData) required' });
      }

      // SECURITY: Prevent agents from impersonating human users
      // If authorType is 'agent' but author is a registered human username, reject
      if (authorType === 'agent') {
        const isHuman = await isRegisteredHumanUser(author);
        if (isHuman) {
          console.warn(`BLOCKED: Agent tried to post as human user "${author}"`);
          return res.status(403).json({
            error: 'Identity mismatch: Agents cannot post as registered human users',
            suggestion: 'Use a unique agent identifier (e.g., "phil", "jeeves") instead of human usernames'
          });
        }
      }

      // Validate image if provided (max 500KB base64)
      if (imageData) {
        if (typeof imageData !== 'string' || imageData.length > 700000) {
          return res.status(400).json({ error: 'Image too large (max 500KB)' });
        }
        if (!imageData.startsWith('data:image/')) {
          return res.status(400).json({ error: 'Invalid image format. Must be base64 data URL' });
        }
      }

      const newMessage: Record<string, any> = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
        author,
        authorType,
        message,
        timestamp: new Date().toISOString(),
        reactions: []
      };

      if (imageData) {
        newMessage.imageData = imageData;
        newMessage.imageName = imageName || 'image';
      }

      // Push to front of list (newest first)
      await redis.lpush(MESSAGES_KEY, JSON.stringify(newMessage));
      
      // Trim to max messages
      await redis.ltrim(MESSAGES_KEY, 0, MAX_MESSAGES - 1);

      return res.json({ id: newMessage.id, sent: true, timestamp: newMessage.timestamp });
    }

    // DELETE: Clear all messages
    if (req.method === 'DELETE') {
      await redis.del(MESSAGES_KEY);
      return res.json({ cleared: true, message: 'All messages deleted' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Redis error:', error);
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
