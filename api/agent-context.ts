import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CONTEXT_KEY = 'agent-coord:agent-context';
const MAX_CONTEXT_ITEMS = 50;

interface ContextItem {
  id: string;
  type: 'decision' | 'learning' | 'insight' | 'blocker' | 'accomplishment' | 'reference';
  content: string;
  source?: string;
  importance: 'low' | 'medium' | 'high' | 'critical';
  createdAt: string;
  expiresAt?: string;
}

interface AgentContext {
  agentId: string;
  name: string;
  lastUpdated: string;
  currentFocus?: string;
  currentGoals: string[];
  blockers: string[];
  contextItems: ContextItem[];
  frequentlyUsedFiles: string[];
  knownPatterns: string[];
  recentDecisions: string[];
  totalItemsStored: number;
  oldestItem?: string;
  newestItem?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { agentId, type, importance, limit = '20' } = req.query;
      if (!agentId || typeof agentId !== 'string') {
        return res.status(400).json({ error: 'agentId required' });
      }

      const contextRaw = await redis.hget(CONTEXT_KEY, agentId);
      if (!contextRaw) {
        return res.json({ agentId, found: false, context: null });
      }

      const context: AgentContext = typeof contextRaw === 'string' ? JSON.parse(contextRaw) : contextRaw;
      let items = context.contextItems;

      if (type && typeof type === 'string') items = items.filter(i => i.type === type);
      if (importance && typeof importance === 'string') items = items.filter(i => i.importance === importance);
      items = items.slice(0, parseInt(limit as string, 10));

      return res.json({ agentId, found: true, context: { ...context, contextItems: items } });
    }

    if (req.method === 'POST') {
      const { agentId, name, currentFocus, currentGoals, blockers, addItem, addDecision, addLearning, addInsight, frequentlyUsedFiles, knownPatterns } = req.body;
      if (!agentId) return res.status(400).json({ error: 'agentId required' });

      const existing = await redis.hget(CONTEXT_KEY, agentId);
      let context: AgentContext = existing
        ? (typeof existing === 'string' ? JSON.parse(existing) : existing)
        : { agentId, name: name || agentId, lastUpdated: '', currentGoals: [], blockers: [], contextItems: [], frequentlyUsedFiles: [], knownPatterns: [], recentDecisions: [], totalItemsStored: 0 };

      if (name) context.name = name;
      if (currentFocus !== undefined) context.currentFocus = currentFocus;
      if (currentGoals) context.currentGoals = currentGoals;
      if (blockers) context.blockers = blockers;
      if (frequentlyUsedFiles) context.frequentlyUsedFiles = frequentlyUsedFiles;
      if (knownPatterns) context.knownPatterns = knownPatterns;

      if (addItem) {
        context.contextItems.unshift({
          id: `ctx-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          type: addItem.type || 'insight',
          content: addItem.content,
          source: addItem.source,
          importance: addItem.importance || 'medium',
          createdAt: new Date().toISOString(),
          expiresAt: addItem.expiresAt
        });
        context.totalItemsStored++;
      }

      if (addDecision) {
        context.contextItems.unshift({ id: `dec-${Date.now().toString(36)}`, type: 'decision', content: addDecision, importance: 'high', createdAt: new Date().toISOString() });
        context.recentDecisions.unshift(addDecision);
        if (context.recentDecisions.length > 10) context.recentDecisions.pop();
        context.totalItemsStored++;
      }

      if (addLearning) {
        context.contextItems.unshift({ id: `learn-${Date.now().toString(36)}`, type: 'learning', content: addLearning, importance: 'medium', createdAt: new Date().toISOString() });
        context.totalItemsStored++;
      }

      if (addInsight) {
        context.contextItems.unshift({ id: `ins-${Date.now().toString(36)}`, type: 'insight', content: addInsight, importance: 'medium', createdAt: new Date().toISOString() });
        context.totalItemsStored++;
      }

      if (context.contextItems.length > MAX_CONTEXT_ITEMS) {
        const critical = context.contextItems.filter(i => i.importance === 'critical').slice(0, 10);
        const high = context.contextItems.filter(i => i.importance === 'high').slice(0, 15);
        const medium = context.contextItems.filter(i => i.importance === 'medium').slice(0, 15);
        const low = context.contextItems.filter(i => i.importance === 'low').slice(0, 10);
        context.contextItems = [...critical, ...high, ...medium, ...low].slice(0, MAX_CONTEXT_ITEMS);
      }

      const now = new Date().getTime();
      context.contextItems = context.contextItems.filter(item => !item.expiresAt || new Date(item.expiresAt).getTime() > now);
      context.lastUpdated = new Date().toISOString();
      if (context.contextItems.length > 0) {
        context.newestItem = context.contextItems[0].createdAt;
        context.oldestItem = context.contextItems[context.contextItems.length - 1].createdAt;
      }

      await redis.hset(CONTEXT_KEY, { [agentId]: JSON.stringify(context) });
      return res.json({ success: true, agentId, itemCount: context.contextItems.length });
    }

    if (req.method === 'DELETE') {
      const { agentId, itemId, clearAll } = req.query;
      if (!agentId || typeof agentId !== 'string') return res.status(400).json({ error: 'agentId required' });

      if (clearAll === 'true') {
        await redis.hdel(CONTEXT_KEY, agentId);
        return res.json({ success: true, cleared: true, agentId });
      }

      if (!itemId || typeof itemId !== 'string') return res.status(400).json({ error: 'itemId required' });

      const existing = await redis.hget(CONTEXT_KEY, agentId);
      if (!existing) return res.status(404).json({ error: 'Agent context not found' });

      const context: AgentContext = typeof existing === 'string' ? JSON.parse(existing) : existing;
      const before = context.contextItems.length;
      context.contextItems = context.contextItems.filter(i => i.id !== itemId);

      if (before !== context.contextItems.length) {
        context.lastUpdated = new Date().toISOString();
        await redis.hset(CONTEXT_KEY, { [agentId]: JSON.stringify(context) });
      }

      return res.json({ success: true, removed: before - context.contextItems.length });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Agent context error:', error);
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
