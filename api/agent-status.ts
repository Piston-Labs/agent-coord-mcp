import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CHECKPOINTS_KEY = 'agent-coord:checkpoints';
const AGENTS_KEY = 'agent-coord:active-agents';

interface Checkpoint {
  agentId: string;
  conversationSummary?: string;
  currentTask?: string;
  pendingWork?: string[];
  recentContext?: string;
  checkpointAt: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action, agentId } = req.body || {};
    const queryAgentId = req.query.agentId as string;

    // GET: Retrieve checkpoint
    if (req.method === 'GET') {
      const id = queryAgentId;
      if (!id) {
        return res.status(400).json({ error: 'agentId required' });
      }
      
      const checkpoint = await redis.hget(CHECKPOINTS_KEY, id);
      if (!checkpoint) {
        return res.json({ found: false });
      }
      
      const parsed = typeof checkpoint === 'string' ? JSON.parse(checkpoint) : checkpoint;
      return res.json({ found: true, checkpoint: parsed });
    }

    // POST: Save checkpoint or update status
    if (req.method === 'POST') {
      switch (action) {
        case 'save-checkpoint': {
          if (!agentId) {
            return res.status(400).json({ error: 'agentId required' });
          }
          
          const checkpoint: Checkpoint = {
            agentId,
            conversationSummary: req.body.conversationSummary,
            currentTask: req.body.currentTask,
            pendingWork: req.body.pendingWork,
            recentContext: req.body.recentContext,
            checkpointAt: new Date().toISOString()
          };
          
          await redis.hset(CHECKPOINTS_KEY, { [agentId]: JSON.stringify(checkpoint) });
          console.log(`Checkpoint saved for ${agentId}`);
          
          return res.json({ saved: true, checkpointAt: checkpoint.checkpointAt });
        }
        
        case 'get-checkpoint': {
          if (!agentId) {
            return res.status(400).json({ error: 'agentId required' });
          }
          
          const checkpoint = await redis.hget(CHECKPOINTS_KEY, agentId);
          if (!checkpoint) {
            return res.json({ found: false });
          }
          
          const parsed = typeof checkpoint === 'string' ? JSON.parse(checkpoint) : checkpoint;
          return res.json({ found: true, checkpoint: parsed });
        }
        
        case 'clear-checkpoint': {
          if (!agentId) {
            return res.status(400).json({ error: 'agentId required' });
          }
          
          await redis.hdel(CHECKPOINTS_KEY, agentId);
          return res.json({ cleared: true });
        }
        
        case 'update': {
          if (!agentId) {
            return res.status(400).json({ error: 'agentId required' });
          }
          
          // Get existing agent or create new
          let agent: any = {};
          const existing = await redis.hget(AGENTS_KEY, agentId);
          if (existing) {
            agent = typeof existing === 'string' ? JSON.parse(existing) : existing;
          }
          
          // Update fields
          agent = {
            ...agent,
            id: agentId,
            status: req.body.status || agent.status || 'active',
            currentTask: req.body.currentTask !== undefined ? req.body.currentTask : agent.currentTask,
            workingOn: req.body.workingOn !== undefined ? req.body.workingOn : agent.workingOn,
            lastSeen: new Date().toISOString()
          };
          
          await redis.hset(AGENTS_KEY, { [agentId]: JSON.stringify(agent) });
          return res.json({ agentId, updated: true });
        }
        
        default:
          return res.status(400).json({ error: 'Unknown action', validActions: ['save-checkpoint', 'get-checkpoint', 'clear-checkpoint', 'update'] });
      }
    }

    // DELETE: Clear checkpoint
    if (req.method === 'DELETE') {
      const id = queryAgentId;
      if (!id) {
        return res.status(400).json({ error: 'agentId required' });
      }
      
      await redis.hdel(CHECKPOINTS_KEY, id);
      return res.json({ cleared: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Agent status error:', error);
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
