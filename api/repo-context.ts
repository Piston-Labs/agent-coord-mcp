import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Redis key pattern: agent-coord:repo-context:{repoId}:{cluster}
const REPO_CONTEXT_PREFIX = 'agent-coord:repo-context';

interface ContextEntry {
  key: string;
  value: any;
  updatedBy: string;
  updatedAt: string;
  version: number;
}

interface ClusterData {
  cluster: string;
  repoId: string;
  entries: Record<string, ContextEntry>;
  lastUpdated: string;
}

/**
 * Repo Context API - Persistent codebase knowledge storage
 *
 * Clusters:
 * - architecture: File structure, module organization, layers
 * - patterns: Code patterns, conventions, idioms used
 * - apis: API endpoints, schemas, request/response formats
 * - components: UI components, their props, usage patterns
 * - dependencies: External deps, internal deps, version info
 * - conventions: Naming conventions, file organization rules
 * - decisions: Architectural decisions and their rationale
 *
 * GET /api/repo-context?repoId=X - List all clusters for repo
 * GET /api/repo-context?repoId=X&cluster=Y - Get cluster data
 * GET /api/repo-context?repoId=X&cluster=Y&key=Z - Get specific key
 * GET /api/repo-context?repoId=X&action=search&q=query - Search across clusters
 * POST /api/repo-context - Set a key in a cluster
 * PATCH /api/repo-context - Update/append to a key
 * DELETE /api/repo-context?repoId=X&cluster=Y&key=Z - Delete a key
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const repoId = (req.query.repoId as string) || 'default';

    // GET: List clusters, get cluster data, or search
    if (req.method === 'GET') {
      const { cluster, key, action, q } = req.query;

      // Search across all clusters
      if (action === 'search' && q) {
        const query = (q as string).toLowerCase();
        const results: Array<{ cluster: string; key: string; entry: ContextEntry; score: number }> = [];

        // Get all clusters for this repo
        const clusterKeys = await redis.keys(`${REPO_CONTEXT_PREFIX}:${repoId}:*`);

        for (const clusterKey of clusterKeys) {
          const clusterName = clusterKey.split(':').pop() || '';
          const data = await redis.hgetall(clusterKey);

          if (data) {
            for (const [entryKey, entryValue] of Object.entries(data)) {
              const entry = typeof entryValue === 'string' ? JSON.parse(entryValue) : entryValue;
              const valueStr = JSON.stringify(entry.value).toLowerCase();
              const keyStr = entryKey.toLowerCase();

              if (keyStr.includes(query) || valueStr.includes(query)) {
                // Simple scoring: key match = 2, value match = 1
                const score = (keyStr.includes(query) ? 2 : 0) + (valueStr.includes(query) ? 1 : 0);
                results.push({ cluster: clusterName, key: entryKey, entry, score });
              }
            }
          }
        }

        // Sort by score descending
        results.sort((a, b) => b.score - a.score);

        return res.json({
          repoId,
          query: q,
          results: results.slice(0, 20),
          count: results.length
        });
      }

      // List all clusters
      if (action === 'list' && !cluster) {
        const clusterKeys = await redis.keys(`${REPO_CONTEXT_PREFIX}:${repoId}:*`);
        const clusters: Array<{ name: string; keyCount: number; lastUpdated: string }> = [];

        for (const clusterKey of clusterKeys) {
          const clusterName = clusterKey.split(':').pop() || '';
          const data = await redis.hgetall(clusterKey);
          const entries = Object.values(data || {});

          let lastUpdated = '';
          for (const entry of entries) {
            const parsed = typeof entry === 'string' ? JSON.parse(entry) : entry;
            if (!lastUpdated || parsed.updatedAt > lastUpdated) {
              lastUpdated = parsed.updatedAt;
            }
          }

          clusters.push({
            name: clusterName,
            keyCount: entries.length,
            lastUpdated
          });
        }

        return res.json({ repoId, clusters, count: clusters.length });
      }

      // Get specific cluster
      if (cluster) {
        const clusterKey = `${REPO_CONTEXT_PREFIX}:${repoId}:${cluster}`;

        // Get specific key
        if (key) {
          const entry = await redis.hget(clusterKey, key as string);
          if (!entry) {
            return res.status(404).json({ error: `Key '${key}' not found in cluster '${cluster}'` });
          }
          const parsed = typeof entry === 'string' ? JSON.parse(entry) : entry;
          return res.json({ repoId, cluster, key, entry: parsed });
        }

        // Get all keys in cluster
        const data = await redis.hgetall(clusterKey);
        const entries: Record<string, ContextEntry> = {};

        if (data) {
          for (const [k, v] of Object.entries(data)) {
            entries[k] = typeof v === 'string' ? JSON.parse(v) : v;
          }
        }

        return res.json({
          repoId,
          cluster,
          entries,
          count: Object.keys(entries).length
        });
      }

      // Default: list clusters
      const clusterKeys = await redis.keys(`${REPO_CONTEXT_PREFIX}:${repoId}:*`);
      const clusterNames = clusterKeys.map(k => k.split(':').pop());

      return res.json({ repoId, clusters: clusterNames, count: clusterNames.length });
    }

    // POST: Set a key in a cluster
    if (req.method === 'POST') {
      let body: any;
      try {
        body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const { cluster, key, value, updatedBy } = body;

      if (!cluster || !key || value === undefined) {
        return res.status(400).json({ error: 'cluster, key, and value are required' });
      }

      const clusterKey = `${REPO_CONTEXT_PREFIX}:${repoId}:${cluster}`;

      // Check for existing entry
      const existing = await redis.hget(clusterKey, key);
      let version = 1;
      if (existing) {
        const parsed = typeof existing === 'string' ? JSON.parse(existing) : existing;
        version = (parsed.version || 0) + 1;
      }

      const entry: ContextEntry = {
        key,
        value,
        updatedBy: updatedBy || 'unknown',
        updatedAt: new Date().toISOString(),
        version
      };

      await redis.hset(clusterKey, { [key]: JSON.stringify(entry) });

      return res.json({
        success: true,
        repoId,
        cluster,
        key,
        version,
        message: existing ? 'Updated existing key' : 'Created new key'
      });
    }

    // PATCH: Update/append to existing key
    if (req.method === 'PATCH') {
      let body: any;
      try {
        body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const { cluster, key, value, updatedBy, append } = body;

      if (!cluster || !key) {
        return res.status(400).json({ error: 'cluster and key are required' });
      }

      const clusterKey = `${REPO_CONTEXT_PREFIX}:${repoId}:${cluster}`;
      const existing = await redis.hget(clusterKey, key);

      if (!existing) {
        return res.status(404).json({ error: `Key '${key}' not found. Use POST to create.` });
      }

      const entry = typeof existing === 'string' ? JSON.parse(existing) : existing;

      // If append mode and value is array, append to existing array
      if (append && Array.isArray(entry.value) && Array.isArray(value)) {
        entry.value = [...entry.value, ...value];
      } else if (append && typeof entry.value === 'object' && typeof value === 'object') {
        entry.value = { ...entry.value, ...value };
      } else if (value !== undefined) {
        entry.value = value;
      }

      entry.updatedBy = updatedBy || entry.updatedBy;
      entry.updatedAt = new Date().toISOString();
      entry.version = (entry.version || 0) + 1;

      await redis.hset(clusterKey, { [key]: JSON.stringify(entry) });

      return res.json({
        success: true,
        repoId,
        cluster,
        key,
        version: entry.version,
        entry
      });
    }

    // DELETE: Remove a key
    if (req.method === 'DELETE') {
      const { cluster, key } = req.query;

      if (!cluster || !key) {
        return res.status(400).json({ error: 'cluster and key query params required' });
      }

      const clusterKey = `${REPO_CONTEXT_PREFIX}:${repoId}:${cluster}`;
      await redis.hdel(clusterKey, key as string);

      return res.json({ success: true, deleted: { repoId, cluster, key } });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Repo context error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
