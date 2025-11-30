import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CORE_CONTEXT_KEY = 'agent-coord:core-agent-context';

interface CoreAgentContext {
  id: string;
  agentId: string;
  name: string;
  role: string;
  expertise: string[];
  patterns: string[];       // Successful approaches
  antiPatterns: string[];   // Things to avoid
  knowledge: string[];      // Key learnings
  preferences: Record<string, string>;
  lastUpdated: string;
  version: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List all core agent contexts or get specific one
    if (req.method === 'GET') {
      const { agentId } = req.query;
      
      if (agentId) {
        const context = await redis.hget(CORE_CONTEXT_KEY, agentId as string);
        if (!context) {
          return res.status(404).json({ error: 'Context not found' });
        }
        const parsed = typeof context === 'string' ? JSON.parse(context) : context;
        return res.json({ context: parsed });
      }
      
      const allContexts = await redis.hgetall(CORE_CONTEXT_KEY) || {};
      const contextList: CoreAgentContext[] = [];
      
      for (const [, value] of Object.entries(allContexts)) {
        try {
          const ctx = typeof value === 'string' ? JSON.parse(value) : value;
          contextList.push(ctx);
        } catch (e) {
          console.error('Invalid context entry:', e);
        }
      }
      
      return res.json({ contexts: contextList, count: contextList.length });
    }

    // POST: Save/create core agent context
    if (req.method === 'POST') {
      const { agentId, name, role, expertise, patterns, antiPatterns, knowledge, preferences } = req.body;

      if (!agentId) {
        return res.status(400).json({ error: 'agentId is required' });
      }

      // Check for existing context
      const existing = await redis.hget(CORE_CONTEXT_KEY, agentId);
      let version = 1;
      if (existing) {
        const parsed = typeof existing === 'string' ? JSON.parse(existing) : existing;
        version = (parsed.version || 0) + 1;
      }

      const context: CoreAgentContext = {
        id: `ctx-${Date.now().toString(36)}`,
        agentId,
        name: name || agentId,
        role: role || 'agent',
        expertise: expertise || [],
        patterns: patterns || [],
        antiPatterns: antiPatterns || [],
        knowledge: knowledge || [],
        preferences: preferences || {},
        lastUpdated: new Date().toISOString(),
        version
      };

      await redis.hset(CORE_CONTEXT_KEY, { [agentId]: JSON.stringify(context) });

      return res.json({ success: true, context });
    }

    // PATCH: Update existing context (add patterns, knowledge, etc.)
    if (req.method === 'PATCH') {
      const { agentId, addPattern, addAntiPattern, addKnowledge, addExpertise, setPreference } = req.body;
      
      if (!agentId) {
        return res.status(400).json({ error: 'agentId is required' });
      }

      const existing = await redis.hget(CORE_CONTEXT_KEY, agentId);
      if (!existing) {
        return res.status(404).json({ error: 'Context not found. Use POST to create.' });
      }

      const context = typeof existing === 'string' ? JSON.parse(existing) : existing;

      if (addPattern) {
        context.patterns = [...new Set([...context.patterns, addPattern])].slice(-50);
      }
      if (addAntiPattern) {
        context.antiPatterns = [...new Set([...context.antiPatterns, addAntiPattern])].slice(-30);
      }
      if (addKnowledge) {
        context.knowledge = [...new Set([...context.knowledge, addKnowledge])].slice(-100);
      }
      if (addExpertise) {
        context.expertise = [...new Set([...context.expertise, addExpertise])].slice(-20);
      }
      if (setPreference) {
        context.preferences = { ...context.preferences, [setPreference.key]: setPreference.value };
      }

      context.lastUpdated = new Date().toISOString();
      context.version = (context.version || 0) + 1;

      await redis.hset(CORE_CONTEXT_KEY, { [agentId]: JSON.stringify(context) });

      return res.json({ success: true, context });
    }

    // DELETE: Remove core context
    if (req.method === 'DELETE') {
      const { agentId } = req.body;
      
      if (!agentId) {
        return res.status(400).json({ error: 'agentId is required' });
      }

      await redis.hdel(CORE_CONTEXT_KEY, agentId);
      return res.json({ success: true, deleted: agentId });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Core context error:', error);
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
