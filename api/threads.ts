import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const THREADS_KEY = 'agent-coord:threads';
const THREAD_MESSAGES_KEY = 'agent-coord:thread-messages';

/**
 * Threads API - Long-running strategic discussions
 * Inspired by contextOS thread pattern for persistent conversations
 * separate from ephemeral group chat
 *
 * GET /api/threads - List all threads
 * GET /api/threads?id=X - Get thread details with messages
 * POST /api/threads - Create new thread or post message
 * PATCH /api/threads - Update thread status
 */

interface Thread {
  id: string;
  topic: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'resolved' | 'archived';
  messageCount: number;
  participants: string[];
}

interface ThreadMessage {
  id: string;
  threadId: string;
  author: string;
  content: string;
  timestamp: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET - List threads or get single thread with messages
    if (req.method === 'GET') {
      const { id, status, limit = '20' } = req.query;

      // Get single thread with messages
      if (id && typeof id === 'string') {
        const thread = await redis.hget(THREADS_KEY, id);
        if (!thread) {
          return res.status(404).json({ error: 'Thread not found' });
        }

        const threadData = typeof thread === 'string' ? JSON.parse(thread) : thread;

        // Get messages for this thread
        const messagesKey = `${THREAD_MESSAGES_KEY}:${id}`;
        const messages = await redis.lrange(messagesKey, 0, parseInt(limit as string, 10) - 1);
        const parsedMessages = messages.map((m: any) =>
          typeof m === 'string' ? JSON.parse(m) : m
        );

        return res.json({
          thread: threadData,
          messages: parsedMessages,
          messageCount: parsedMessages.length
        });
      }

      // List all threads
      const threadsData = await redis.hgetall(THREADS_KEY) || {};
      let threads: Thread[] = Object.values(threadsData).map((t: any) =>
        typeof t === 'string' ? JSON.parse(t) : t
      );

      // Filter by status if provided
      if (status && typeof status === 'string') {
        threads = threads.filter(t => t.status === status);
      }

      // Sort by updatedAt (most recent first)
      threads.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      return res.json({
        threads,
        count: threads.length,
        activeCount: threads.filter(t => t.status === 'active').length
      });
    }

    // POST - Create thread or post message
    if (req.method === 'POST') {
      const { action, threadId, topic, createdBy, author, content } = req.body;

      // Create new thread
      if (action === 'create' || (!action && topic)) {
        if (!topic || !createdBy) {
          return res.status(400).json({ error: 'topic and createdBy required' });
        }

        const id = `thread-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
        const now = new Date().toISOString();

        const thread: Thread = {
          id,
          topic,
          createdBy,
          createdAt: now,
          updatedAt: now,
          status: 'active',
          messageCount: 0,
          participants: [createdBy]
        };

        await redis.hset(THREADS_KEY, { [id]: JSON.stringify(thread) });

        return res.json({ success: true, thread });
      }

      // Post message to thread
      if (action === 'post' || (!action && threadId)) {
        if (!threadId || !author || !content) {
          return res.status(400).json({ error: 'threadId, author, and content required' });
        }

        // Verify thread exists
        const thread = await redis.hget(THREADS_KEY, threadId);
        if (!thread) {
          return res.status(404).json({ error: 'Thread not found' });
        }

        const threadData: Thread = typeof thread === 'string' ? JSON.parse(thread) : thread;

        // Create message
        const message: ThreadMessage = {
          id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          threadId,
          author,
          content,
          timestamp: new Date().toISOString()
        };

        // Add message to thread's message list
        const messagesKey = `${THREAD_MESSAGES_KEY}:${threadId}`;
        await redis.lpush(messagesKey, JSON.stringify(message));

        // Update thread metadata
        threadData.messageCount++;
        threadData.updatedAt = message.timestamp;
        if (!threadData.participants.includes(author)) {
          threadData.participants.push(author);
        }

        await redis.hset(THREADS_KEY, { [threadId]: JSON.stringify(threadData) });

        return res.json({
          success: true,
          message,
          thread: threadData
        });
      }

      return res.status(400).json({ error: 'Invalid action. Use action=create or action=post' });
    }

    // PATCH - Update thread status
    if (req.method === 'PATCH') {
      const { id, status } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'Thread id required' });
      }

      const thread = await redis.hget(THREADS_KEY, id);
      if (!thread) {
        return res.status(404).json({ error: 'Thread not found' });
      }

      const threadData: Thread = typeof thread === 'string' ? JSON.parse(thread) : thread;

      if (status && ['active', 'resolved', 'archived'].includes(status)) {
        threadData.status = status;
      }
      threadData.updatedAt = new Date().toISOString();

      await redis.hset(THREADS_KEY, { [id]: JSON.stringify(threadData) });

      return res.json({ success: true, thread: threadData });
    }

    // DELETE - Archive thread (soft delete)
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Thread id required' });
      }

      const thread = await redis.hget(THREADS_KEY, id);
      if (!thread) {
        return res.status(404).json({ error: 'Thread not found' });
      }

      const threadData: Thread = typeof thread === 'string' ? JSON.parse(thread) : thread;
      threadData.status = 'archived';
      threadData.updatedAt = new Date().toISOString();

      await redis.hset(THREADS_KEY, { [id]: JSON.stringify(threadData) });

      return res.json({ success: true, archived: true, thread: threadData });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Threads API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
