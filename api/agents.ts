import type { VercelRequest, VercelResponse } from '@vercel/node';

// In-memory store
let agents: Record<string, any> = {};

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const staleThreshold = Date.now() - 30 * 60 * 1000; // 30 minutes
    const activeAgents = Object.values(agents).filter((a: any) => {
      const lastSeen = new Date(a.lastSeen).getTime();
      return lastSeen > staleThreshold;
    });

    return res.json({ agents: activeAgents, count: activeAgents.length });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
