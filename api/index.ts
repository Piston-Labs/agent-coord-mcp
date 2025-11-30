import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.json({
    name: 'Agent Coordination API',
    version: '0.1.0',
    endpoints: [
      'GET /api - This endpoint',
      'GET /api/chat - Get messages',
      'POST /api/chat - Send message',
      'GET /api/agents - List agents',
      'GET/POST /api/agents/:id/status - Agent status',
      'GET /api/roadmap - List roadmap items',
      'GET /api/whats-next?assignee=tom|ryan - Get next task for team member'
    ],
    status: 'ok',
    timestamp: new Date().toISOString()
  });
}
