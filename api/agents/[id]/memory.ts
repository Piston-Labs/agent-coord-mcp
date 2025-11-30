import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const AGENT_MEMORY_KEY = 'agent-coord:agent-memory';
const TRAINING_LOG_KEY = 'agent-coord:training-log';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  const agentId = id as string;

  try {
    // GET: Retrieve agent memory
    if (req.method === 'GET') {
      const data = await redis.hget(AGENT_MEMORY_KEY, agentId);
      if (!data) {
        return res.json({ 
          agentId, 
          patterns: [], 
          antiPatterns: [], 
          clusterProficiency: {},
          mentors: [],
          trainingComplete: false,
          version: 1
        });
      }
      const memory = typeof data === 'string' ? JSON.parse(data) : data;
      return res.json(memory);
    }

    // POST: Learn a new pattern or anti-pattern
    if (req.method === 'POST') {
      const { action, pattern, context, reason, cluster, success } = req.body;

      let memoryData = await redis.hget(AGENT_MEMORY_KEY, agentId);
      let memory = memoryData 
        ? (typeof memoryData === 'string' ? JSON.parse(memoryData) : memoryData)
        : { agentId, patterns: [], antiPatterns: [], clusterProficiency: {}, mentors: [], version: 1 };

      if (action === 'learn-pattern' && pattern) {
        const existing = memory.patterns.find((p: any) => p.pattern === pattern);
        if (existing) {
          existing.successCount++;
          existing.lastUsed = new Date().toISOString();
        } else {
          memory.patterns.push({ pattern, context: context || '', successCount: 1, lastUsed: new Date().toISOString() });
        }
      }

      if (action === 'learn-anti-pattern' && pattern) {
        const existing = memory.antiPatterns.find((p: any) => p.pattern === pattern);
        if (existing) {
          existing.occurrences++;
        } else {
          memory.antiPatterns.push({ pattern, reason: reason || '', occurrences: 1 });
        }
      }

      if (action === 'update-proficiency' && cluster !== undefined) {
        if (!memory.clusterProficiency[cluster]) {
          memory.clusterProficiency[cluster] = { level: 0.5, tasksCompleted: 0, lastUpdated: new Date().toISOString() };
        }
        const prof = memory.clusterProficiency[cluster];
        prof.tasksCompleted++;
        prof.lastUpdated = new Date().toISOString();
        const delta = success ? 0.05 : -0.03;
        prof.level = Math.max(0.1, Math.min(1.0, prof.level + delta));
      }

      await redis.hset(AGENT_MEMORY_KEY, { [agentId]: JSON.stringify(memory) });
      return res.json({ success: true, memory });
    }

    // PATCH: Transfer knowledge from mentor
    if (req.method === 'PATCH') {
      const { mentorId, clusters } = req.body;

      if (!mentorId) {
        return res.status(400).json({ error: 'mentorId required for knowledge transfer' });
      }

      // Get mentor memory
      const mentorData = await redis.hget(AGENT_MEMORY_KEY, mentorId);
      if (!mentorData) {
        return res.status(404).json({ error: 'Mentor not found or has no memory' });
      }
      const mentorMemory = typeof mentorData === 'string' ? JSON.parse(mentorData) : mentorData;

      // Get or create protege memory
      let protegeData = await redis.hget(AGENT_MEMORY_KEY, agentId);
      let protegeMemory = protegeData 
        ? (typeof protegeData === 'string' ? JSON.parse(protegeData) : protegeData)
        : { agentId, patterns: [], antiPatterns: [], clusterProficiency: {}, mentors: [], version: 1 };

      // Transfer patterns
      const topPatterns = (mentorMemory.patterns || []).slice(0, 20);
      for (const p of topPatterns) {
        if (!protegeMemory.patterns.find((pp: any) => pp.pattern === p.pattern)) {
          protegeMemory.patterns.push({
            ...p,
            successCount: Math.floor(p.successCount / 2),
            lastUsed: new Date().toISOString()
          });
        }
      }

      // Transfer cluster proficiency
      const clustersToTransfer = clusters || Object.keys(mentorMemory.clusterProficiency || {});
      for (const cluster of clustersToTransfer) {
        if (mentorMemory.clusterProficiency?.[cluster]) {
          protegeMemory.clusterProficiency[cluster] = {
            level: mentorMemory.clusterProficiency[cluster].level * 0.7,
            tasksCompleted: 0,
            lastUpdated: new Date().toISOString()
          };
        }
      }

      // Record mentorship
      if (!protegeMemory.mentors) protegeMemory.mentors = [];
      if (!protegeMemory.mentors.includes(mentorId)) {
        protegeMemory.mentors.push(mentorId);
      }
      protegeMemory.version = (protegeMemory.version || 1) + 1;

      await redis.hset(AGENT_MEMORY_KEY, { [agentId]: JSON.stringify(protegeMemory) });

      // Log training
      await redis.lpush(TRAINING_LOG_KEY, JSON.stringify({
        timestamp: new Date().toISOString(),
        mentor: mentorId,
        protege: agentId,
        patternsTransferred: topPatterns.length,
        clustersTransferred: clustersToTransfer
      }));

      return res.json({
        success: true,
        patternsTransferred: topPatterns.length,
        clustersTransferred: clustersToTransfer,
        protegeMemory
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Memory error:', error);
    return res.status(500).json({ error: 'Memory operation failed', details: String(error) });
  }
}
