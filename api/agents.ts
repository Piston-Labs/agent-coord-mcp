import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const AGENTS_KEY = 'agent-coord:active-agents';
const MESSAGES_KEY = 'agent-coord:messages';
const AGENT_STATUS_KEY = 'agent-coord:agent-presence';  // Track online/offline status
const OFFLINE_NOTIFIED_KEY = 'agent-coord:offline-notified';  // Track offline notifications to prevent duplicates

// Heartbeat configuration (inspired by contextOS)
// IMPORTANT: These are the authoritative thresholds. api/digest.ts should use the same values.
const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;  // 5 minutes = considered offline (triggers notification)
const ACTIVE_THRESHOLD_MS = 30 * 60 * 1000;  // 30 minutes = stale (removed from active listing)

// Post system message to chat
async function postSystemMessage(message: string) {
  const newMessage = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
    author: '🤖 system',
    authorType: 'system',
    message,
    timestamp: new Date().toISOString(),
    reactions: []
  };
  await redis.lpush(MESSAGES_KEY, JSON.stringify(newMessage));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // DELETE: Clear all agents (useful for corrupt data)
    if (req.method === 'DELETE') {
      await redis.del(AGENTS_KEY);
      return res.json({ success: true, message: 'All agents cleared' });
    }

    // GET: List agents (both active and offline)
    // Also runs heartbeat detection to post offline notifications
    if (req.method === 'GET') {
      // Short cache for agent list (5 seconds)
      res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=3');
      const includeOffline = req.query.includeOffline === 'true';

      let agents: Record<string, unknown> = {};
      try {
        agents = await redis.hgetall(AGENTS_KEY) || {};
      } catch (hgetError) {
        // If hgetall fails due to corrupt data, clear and return empty
        console.error('hgetall failed, clearing corrupt data:', hgetError);
        await redis.del(AGENTS_KEY);
        return res.json({ agents: [], offlineAgents: [], count: 0, note: 'Cleared corrupt data' });
      }

      const now = Date.now();
      const offlineThreshold = now - OFFLINE_THRESHOLD_MS;  // 5 min for offline detection
      const activeThreshold = now - ACTIVE_THRESHOLD_MS;    // 30 min for listing
      const activeAgents: any[] = [];
      const offlineAgents: any[] = [];

      // Get presence tracking data and offline notification timestamps
      let presenceData: Record<string, unknown> = {};
      let offlineNotifiedData: Record<string, unknown> = {};
      try {
        [presenceData, offlineNotifiedData] = await Promise.all([
          redis.hgetall(AGENT_STATUS_KEY) || {},
          redis.hgetall(OFFLINE_NOTIFIED_KEY) || {}
        ]);
        presenceData = presenceData || {};
        offlineNotifiedData = offlineNotifiedData || {};
      } catch {
        // Ignore errors for presence tracking
      }

      for (const [key, value] of Object.entries(agents)) {
        try {
          const agent = typeof value === 'string' ? JSON.parse(value) : value;
          if (agent && agent.lastSeen) {
            const lastSeen = new Date(agent.lastSeen).getTime();
            const wasOnline = presenceData[agent.id] === 'online';
            const lastNotified = offlineNotifiedData[agent.id] ? parseInt(offlineNotifiedData[agent.id] as string) : 0;

            // Check if agent just went offline (was online, now past threshold)
            // Also prevent duplicate notifications by checking if we already notified within the threshold
            if (wasOnline && lastSeen < offlineThreshold && now - lastNotified > OFFLINE_THRESHOLD_MS) {
              // Post offline notification and record the timestamp to prevent duplicates
              await postSystemMessage(`[agent-offline] 👋 **${agent.id}** went offline (last seen: ${agent.lastSeen})`);
              await redis.hset(AGENT_STATUS_KEY, { [agent.id]: 'offline' });
              await redis.hset(OFFLINE_NOTIFIED_KEY, { [agent.id]: now.toString() });
            } else if (wasOnline && lastSeen < offlineThreshold) {
              // Just update presence without notification (already notified recently)
              await redis.hset(AGENT_STATUS_KEY, { [agent.id]: 'offline' });
            }

            // Determine status based on lastSeen
            agent.status = lastSeen > activeThreshold ? 'active' : 'offline';

            if (lastSeen > activeThreshold) {
              activeAgents.push(agent);
            } else {
              offlineAgents.push(agent);
            }
          }
        } catch (parseError) {
          // Skip invalid entries and clean them up
          console.error(`Invalid agent entry for ${key}:`, parseError);
          await redis.hdel(AGENTS_KEY, key);
        }
      }

      // Sort by lastSeen (most recent first)
      activeAgents.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
      offlineAgents.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

      if (includeOffline) {
        return res.json({
          agents: activeAgents,
          offlineAgents: offlineAgents,
          count: activeAgents.length,
          offlineCount: offlineAgents.length
        });
      }

      return res.json({ agents: activeAgents, count: activeAgents.length });
    }

    // POST: Register/update agent status
    // Also tracks presence and posts join/status notifications
    if (req.method === 'POST') {
      const { id, name, status, currentTask, workingOn, role } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      // Check previous presence state
      let previousPresence: string | null = null;
      try {
        previousPresence = await redis.hget(AGENT_STATUS_KEY, id) as string | null;
      } catch {
        // Ignore errors
      }

      const agent = {
        id,
        name: name || id,
        status: status || 'active',
        currentTask: currentTask || '',
        workingOn: workingOn || '',
        role: role || 'agent',
        lastSeen: new Date().toISOString()
      };

      // Use object form for Upstash: hset(key, { field: value })
      await redis.hset(AGENTS_KEY, { [id]: JSON.stringify(agent) });

      // Track presence and post notifications
      const isComingOnline = previousPresence !== 'online';
      if (isComingOnline) {
        // Agent just came online (new or returning from offline)
        await redis.hset(AGENT_STATUS_KEY, { [id]: 'online' });

        if (previousPresence === 'offline') {
          // Returning from offline
          await postSystemMessage(`[agent-online] 🔄 **${id}** is back online${currentTask ? ` - working on: ${currentTask}` : ''}`);
        } else if (!previousPresence) {
          // First time joining
          await postSystemMessage(`[agent-joined] 👋 **${id}** joined the network${currentTask ? ` - working on: ${currentTask}` : ''}`);
        }
      } else {
        // Already online, just update presence timestamp
        await redis.hset(AGENT_STATUS_KEY, { [id]: 'online' });
      }

      return res.json({ success: true, agent, wasOffline: previousPresence === 'offline' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Agents error:', error);
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
