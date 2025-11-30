import type { VercelRequest, VercelResponse } from '@vercel/node';

// In-memory store
let agents: Record<string, any> = {};

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { id } = req.query;

  if (req.method === 'GET') {
    const agent = agents[id as string];
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    return res.json(agent);
  }

  if (req.method === 'POST') {
    const { status, currentTask, workingOn, roles } = req.body;

    const agent = {
      id,
      status: status || 'active',
      currentTask,
      workingOn,
      roles: roles || [],
      lastSeen: new Date().toISOString()
    };

    agents[id as string] = agent;
    return res.json(agent);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
