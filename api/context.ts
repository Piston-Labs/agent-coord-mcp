import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CONTEXT_KEY = 'agent-coord:context-clusters';
const CONTEXT_HISTORY_KEY = 'agent-coord:context-history';

interface ClusterState {
  cluster: string;
  version: number;
  state: 'stable' | 'in-progress' | 'error' | 'rollback';
  lastUpdated: string;
  updatedBy: string;
  summary: string;
  files: string[];
  dependencies: string[];
  metadata: Record<string, any>;
}

interface ClusterHistory {
  version: number;
  timestamp: string;
  updatedBy: string;
  summary: string;
  snapshot: ClusterState;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET /api/context - List all cluster states
    if (req.method === 'GET' && !req.query.cluster) {
      const clusters = await redis.hgetall(CONTEXT_KEY) || {};
      const clusterList: ClusterState[] = [];
      
      for (const [key, value] of Object.entries(clusters)) {
        try {
          const state = typeof value === 'string' ? JSON.parse(value) : value;
          clusterList.push(state);
        } catch (e) {
          console.error(`Failed to parse cluster ${key}:`, e);
        }
      }
      
      return res.json({
        clusters: clusterList,
        count: clusterList.length,
        timestamp: new Date().toISOString()
      });
    }

    // GET /api/context?cluster=auth - Get specific cluster state
    if (req.method === 'GET' && req.query.cluster) {
      const cluster = req.query.cluster as string;
      const stateData = await redis.hget(CONTEXT_KEY, cluster);
      
      if (!stateData) {
        return res.status(404).json({ error: `Cluster '${cluster}' not found` });
      }
      
      const state = typeof stateData === 'string' ? JSON.parse(stateData) : stateData;
      
      // Get history
      const historyData = await redis.lrange(`${CONTEXT_HISTORY_KEY}:${cluster}`, 0, 9);
      const history = historyData.map(h => typeof h === 'string' ? JSON.parse(h) : h);
      
      return res.json({ cluster: state, history });
    }

    // POST /api/context - Update cluster state
    if (req.method === 'POST') {
      const { cluster, state, summary, files, dependencies, metadata, updatedBy } = req.body;
      
      if (!cluster || !updatedBy) {
        return res.status(400).json({ error: 'cluster and updatedBy are required' });
      }
      
      // Get existing state for versioning
      let version = 1;
      const existingData = await redis.hget(CONTEXT_KEY, cluster);
      if (existingData) {
        const existing = typeof existingData === 'string' ? JSON.parse(existingData) : existingData;
        version = (existing.version || 0) + 1;
        
        // Save to history before updating
        const historyEntry: ClusterHistory = {
          version: existing.version,
          timestamp: existing.lastUpdated,
          updatedBy: existing.updatedBy,
          summary: existing.summary,
          snapshot: existing
        };
        await redis.lpush(`${CONTEXT_HISTORY_KEY}:${cluster}`, JSON.stringify(historyEntry));
        await redis.ltrim(`${CONTEXT_HISTORY_KEY}:${cluster}`, 0, 19); // Keep last 20 versions
      }
      
      const clusterState: ClusterState = {
        cluster,
        version,
        state: state || 'in-progress',
        lastUpdated: new Date().toISOString(),
        updatedBy,
        summary: summary || '',
        files: files || [],
        dependencies: dependencies || [],
        metadata: metadata || {}
      };
      
      await redis.hset(CONTEXT_KEY, { [cluster]: JSON.stringify(clusterState) });
      
      return res.json({
        success: true,
        cluster: clusterState,
        message: `Cluster '${cluster}' updated to v${version}`
      });
    }

    // PUT /api/context?cluster=auth&action=rollback&version=3 - Rollback to version
    if (req.method === 'PUT' && req.query.action === 'rollback') {
      const cluster = req.query.cluster as string;
      const targetVersion = parseInt(req.query.version as string);
      
      if (!cluster || isNaN(targetVersion)) {
        return res.status(400).json({ error: 'cluster and version are required for rollback' });
      }
      
      // Find version in history
      const historyData = await redis.lrange(`${CONTEXT_HISTORY_KEY}:${cluster}`, 0, -1);
      const targetEntry = historyData.find(h => {
        const entry = typeof h === 'string' ? JSON.parse(h) : h;
        return entry.version === targetVersion;
      });
      
      if (!targetEntry) {
        return res.status(404).json({ error: `Version ${targetVersion} not found in history` });
      }
      
      const entry = typeof targetEntry === 'string' ? JSON.parse(targetEntry) : targetEntry;
      const restoredState = {
        ...entry.snapshot,
        state: 'rollback',
        lastUpdated: new Date().toISOString(),
        metadata: { ...entry.snapshot.metadata, rolledBackFrom: entry.version }
      };
      
      await redis.hset(CONTEXT_KEY, { [cluster]: JSON.stringify(restoredState) });
      
      return res.json({
        success: true,
        message: `Rolled back '${cluster}' to v${targetVersion}`,
        cluster: restoredState
      });
    }

    // DELETE /api/context?cluster=auth - Delete cluster state
    if (req.method === 'DELETE' && req.query.cluster) {
      const cluster = req.query.cluster as string;
      await redis.hdel(CONTEXT_KEY, cluster);
      await redis.del(`${CONTEXT_HISTORY_KEY}:${cluster}`);
      
      return res.json({ success: true, deleted: cluster });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Context API error:', error);
    return res.status(500).json({ error: 'Context operation failed', details: String(error) });
  }
}
