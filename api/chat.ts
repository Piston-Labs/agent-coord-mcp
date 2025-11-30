import type { VercelRequest, VercelResponse } from '@vercel/node';

// In-memory store (will need Redis for production persistence)
let messages: any[] = [];

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const { limit = '50', since } = req.query;
    let result = messages;

    if (since && typeof since === 'string') {
      const sinceTime = new Date(since).getTime();
      result = messages.filter(m => new Date(m.timestamp).getTime() > sinceTime);
    } else {
      result = messages.slice(-parseInt(limit as string));
    }

    return res.json({ messages: result, count: result.length });
  }

  if (req.method === 'POST') {
    const { author, authorType = 'agent', message } = req.body;

    if (!author || !message) {
      return res.status(400).json({ error: 'author and message required' });
    }

    const newMessage = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
      author,
      authorType,
      message,
      timestamp: new Date().toISOString(),
      reactions: []
    };

    messages.push(newMessage);

    // Keep last 1000 messages
    if (messages.length > 1000) {
      messages = messages.slice(-1000);
    }

    return res.json({ id: newMessage.id, sent: true, timestamp: newMessage.timestamp });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
