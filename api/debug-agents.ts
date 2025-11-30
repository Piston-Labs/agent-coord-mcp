import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const AGENTS_KEY = 'agent-coord:active-agents';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // POST: Test with simple SET/GET instead of hash operations
    if (req.method === 'POST') {
      const testKey = 'agent-coord:test-simple';
      const testValue = JSON.stringify({ test: true, timestamp: new Date().toISOString() });

      // Test 1: Simple SET/GET
      const setResult = await redis.set(testKey, testValue);
      const getResult = await redis.get(testKey);

      // Test 2: Hash SET/GET with correct object syntax
      const testAgent = {
        id: 'debug-write-test',
        name: 'Debug Write Test',
        status: 'active',
        currentTask: 'Testing write',
        workingOn: 'debug',
        role: 'debug',
        lastSeen: new Date().toISOString()
      };

      const hsetResult = await redis.hset(AGENTS_KEY, { 'debug-write-test': JSON.stringify(testAgent) });
      const hgetResult = await redis.hget(AGENTS_KEY, 'debug-write-test');
      const hgetallResult = await redis.hgetall(AGENTS_KEY);

      return res.json({
        simpleTest: { setResult, getResult, getResultType: typeof getResult },
        hashTest: { hsetResult, hgetResult, hgetResultType: typeof hgetResult, hgetallResult },
        testAgent
      });
    }

    // GET: Get raw data from Redis to debug
    const agents = await redis.hgetall(AGENTS_KEY);
    const staleThreshold = Date.now() - 30 * 60 * 1000;

    const debug = {
      rawAgents: agents,
      rawType: typeof agents,
      entries: Object.entries(agents || {}).map(([key, value]) => ({
        key,
        valueType: typeof value,
        value: value,
        isString: typeof value === 'string'
      })),
      staleThreshold: new Date(staleThreshold).toISOString(),
      now: new Date().toISOString()
    };

    return res.json(debug);
  } catch (error) {
    console.error('Debug error:', error);
    return res.status(500).json({ error: 'Debug error', details: String(error) });
  }
}
