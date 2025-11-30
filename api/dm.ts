import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Redis keys
const DM_MESSAGES_KEY = 'agent-coord:dm:messages';      // Hash: conversationId -> messages JSON array
const DM_CONVERSATIONS_KEY = 'agent-coord:dm:convos';   // Hash: odconversationId -> conversation metadata
const DM_USER_CONVOS_KEY = 'agent-coord:dm:user-convos'; // Hash: oduserId -> array of conversationIds

interface Attachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  mimeType: string;
  size: number;
  data: string;  // Base64 encoded
  thumbnail?: string;
}

interface DirectMessage {
  id: string;
  conversationId: string;
  from: string;
  fromType: 'human' | 'agent';
  to: string;
  toType: 'human' | 'agent';
  message: string;
  attachments?: Attachment[];
  timestamp: string;
  read: boolean;
  readAt?: string;
}

interface Conversation {
  id: string;
  participants: string[];
  participantTypes: { [id: string]: 'human' | 'agent' };
  lastMessage?: {
    preview: string;
    timestamp: string;
    from: string;
  };
  unreadCount: { [participantId: string]: number };
  createdAt: string;
  updatedAt: string;
}

/**
 * Generate a consistent conversation ID from two participant IDs
 */
function getConversationId(user1: string, user2: string): string {
  const sorted = [user1, user2].sort();
  return `dm-${sorted[0]}-${sorted[1]}`;
}

/**
 * Get or create a conversation between two users
 */
async function getOrCreateConversation(
  from: string,
  fromType: 'human' | 'agent',
  to: string,
  toType: 'human' | 'agent'
): Promise<Conversation> {
  const conversationId = getConversationId(from, to);

  // Check if conversation exists
  const existing = await redis.hget(DM_CONVERSATIONS_KEY, conversationId);
  if (existing) {
    return typeof existing === 'string' ? JSON.parse(existing) : existing;
  }

  // Create new conversation
  const conversation: Conversation = {
    id: conversationId,
    participants: [from, to].sort(),
    participantTypes: { [from]: fromType, [to]: toType },
    unreadCount: { [from]: 0, [to]: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await redis.hset(DM_CONVERSATIONS_KEY, { [conversationId]: JSON.stringify(conversation) });

  // Add to both users' conversation lists
  for (const userId of [from, to]) {
    const userConvos = await redis.hget(DM_USER_CONVOS_KEY, userId);
    const convoIds: string[] = userConvos
      ? (typeof userConvos === 'string' ? JSON.parse(userConvos) : userConvos)
      : [];
    if (!convoIds.includes(conversationId)) {
      convoIds.push(conversationId);
      await redis.hset(DM_USER_CONVOS_KEY, { [userId]: JSON.stringify(convoIds) });
    }
  }

  return conversation;
}

/**
 * Direct Messaging API
 *
 * GET /api/dm?userId=X - List all conversations for user
 * GET /api/dm?conversationId=X&userId=Y - Get messages in conversation
 * GET /api/dm?userId=X&checkUnread=true - Just get unread count
 * POST /api/dm - Send a message
 * PATCH /api/dm - Mark messages as read
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List conversations or get messages
    if (req.method === 'GET') {
      const { userId, conversationId, checkUnread } = req.query;

      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      const userIdStr = String(userId);

      // Just check unread count
      if (checkUnread === 'true') {
        const userConvos = await redis.hget(DM_USER_CONVOS_KEY, userIdStr);
        const convoIds: string[] = userConvos
          ? (typeof userConvos === 'string' ? JSON.parse(userConvos) : userConvos)
          : [];

        let totalUnread = 0;
        for (const cId of convoIds) {
          const convo = await redis.hget(DM_CONVERSATIONS_KEY, cId);
          if (convo) {
            const c = typeof convo === 'string' ? JSON.parse(convo) : convo;
            totalUnread += c.unreadCount?.[userIdStr] || 0;
          }
        }

        return res.json({ userId: userIdStr, totalUnread });
      }

      // Get specific conversation messages
      if (conversationId) {
        const convoIdStr = String(conversationId);

        // Verify user is participant
        const convo = await redis.hget(DM_CONVERSATIONS_KEY, convoIdStr);
        if (!convo) {
          return res.status(404).json({ error: 'Conversation not found' });
        }

        const conversation: Conversation = typeof convo === 'string' ? JSON.parse(convo) : convo;
        if (!conversation.participants.includes(userIdStr)) {
          return res.status(403).json({ error: 'Not a participant in this conversation' });
        }

        // Get messages
        const messagesRaw = await redis.hget(DM_MESSAGES_KEY, convoIdStr);
        let messages: DirectMessage[] = [];
        if (messagesRaw) {
          if (typeof messagesRaw === 'string') {
            messages = JSON.parse(messagesRaw);
          } else if (Array.isArray(messagesRaw)) {
            messages = messagesRaw;
          }
        }

        // Mark messages as read for this user
        let updated = false;
        const now = new Date().toISOString();
        for (const msg of messages) {
          if (msg.to === userIdStr && !msg.read) {
            msg.read = true;
            msg.readAt = now;
            updated = true;
          }
        }

        if (updated) {
          await redis.hset(DM_MESSAGES_KEY, { [convoIdStr]: JSON.stringify(messages) });
          // Reset unread count
          conversation.unreadCount[userIdStr] = 0;
          await redis.hset(DM_CONVERSATIONS_KEY, { [convoIdStr]: JSON.stringify(conversation) });
        }

        return res.json({
          conversation,
          messages,
          count: messages.length
        });
      }

      // List all conversations for user
      const userConvos = await redis.hget(DM_USER_CONVOS_KEY, userIdStr);
      const convoIds: string[] = userConvos
        ? (typeof userConvos === 'string' ? JSON.parse(userConvos) : userConvos)
        : [];

      const conversations: Conversation[] = [];
      for (const cId of convoIds) {
        const convo = await redis.hget(DM_CONVERSATIONS_KEY, cId);
        if (convo) {
          conversations.push(typeof convo === 'string' ? JSON.parse(convo) : convo);
        }
      }

      // Sort by last message timestamp
      conversations.sort((a, b) => {
        const aTime = a.lastMessage?.timestamp || a.updatedAt;
        const bTime = b.lastMessage?.timestamp || b.updatedAt;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });

      // Calculate total unread
      const totalUnread = conversations.reduce(
        (sum, c) => sum + (c.unreadCount?.[userIdStr] || 0),
        0
      );

      return res.json({
        userId: userIdStr,
        conversations,
        count: conversations.length,
        totalUnread
      });
    }

    // POST: Send a message
    if (req.method === 'POST') {
      const { from, fromType, to, toType, message, attachments } = req.body;

      if (!from || !to) {
        return res.status(400).json({ error: 'from and to are required' });
      }

      if (!message && (!attachments || attachments.length === 0)) {
        return res.status(400).json({ error: 'message or attachments required' });
      }

      // Get or create conversation
      const conversation = await getOrCreateConversation(
        from,
        fromType || 'human',
        to,
        toType || 'agent'
      );

      // Create message
      const dm: DirectMessage = {
        id: `dm-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`,
        conversationId: conversation.id,
        from,
        fromType: fromType || 'human',
        to,
        toType: toType || 'agent',
        message: message || '',
        attachments,
        timestamp: new Date().toISOString(),
        read: false
      };

      // Get existing messages and append
      const messagesRaw = await redis.hget(DM_MESSAGES_KEY, conversation.id);
      let messages: DirectMessage[] = [];
      if (messagesRaw) {
        if (typeof messagesRaw === 'string') {
          messages = JSON.parse(messagesRaw);
        } else if (Array.isArray(messagesRaw)) {
          messages = messagesRaw;
        } else {
          // Handle edge case where it might be a single object
          messages = [];
        }
      }

      messages.push(dm);

      // Keep last 500 messages per conversation
      if (messages.length > 500) {
        messages.splice(0, messages.length - 500);
      }

      await redis.hset(DM_MESSAGES_KEY, { [conversation.id]: JSON.stringify(messages) });

      // Update conversation metadata
      conversation.lastMessage = {
        preview: message ? message.substring(0, 100) : (attachments?.[0]?.name || 'Attachment'),
        timestamp: dm.timestamp,
        from
      };
      conversation.unreadCount[to] = (conversation.unreadCount[to] || 0) + 1;
      conversation.updatedAt = dm.timestamp;

      await redis.hset(DM_CONVERSATIONS_KEY, { [conversation.id]: JSON.stringify(conversation) });

      return res.json({
        success: true,
        message: dm,
        conversationId: conversation.id
      });
    }

    // PATCH: Mark messages as read
    if (req.method === 'PATCH') {
      const { conversationId, userId, action } = req.body;

      if (action !== 'mark-read') {
        return res.status(400).json({ error: 'action must be "mark-read"' });
      }

      if (!conversationId || !userId) {
        return res.status(400).json({ error: 'conversationId and userId required' });
      }

      // Get conversation
      const convo = await redis.hget(DM_CONVERSATIONS_KEY, conversationId);
      if (!convo) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const conversation: Conversation = typeof convo === 'string' ? JSON.parse(convo) : convo;
      if (!conversation.participants.includes(userId)) {
        return res.status(403).json({ error: 'Not a participant' });
      }

      // Mark all messages as read
      const messagesRaw = await redis.hget(DM_MESSAGES_KEY, conversationId);
      let messages: DirectMessage[] = [];
      if (messagesRaw) {
        if (typeof messagesRaw === 'string') {
          messages = JSON.parse(messagesRaw);
        } else if (Array.isArray(messagesRaw)) {
          messages = messagesRaw;
        }
      }

      const now = new Date().toISOString();
      let markedCount = 0;
      for (const msg of messages) {
        if (msg.to === userId && !msg.read) {
          msg.read = true;
          msg.readAt = now;
          markedCount++;
        }
      }

      await redis.hset(DM_MESSAGES_KEY, { [conversationId]: JSON.stringify(messages) });

      // Reset unread count
      conversation.unreadCount[userId] = 0;
      await redis.hset(DM_CONVERSATIONS_KEY, { [conversationId]: JSON.stringify(conversation) });

      return res.json({
        success: true,
        markedAsRead: markedCount
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('DM API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
