import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

/**
 * Resource Sync API - Automatic resource registry updates
 *
 * This API ensures the Resources UI stays in sync with all changes.
 * It should be called whenever:
 * - A new API endpoint is created
 * - A new MCP tool is added
 * - A new agent soul is registered
 * - A new integration is configured
 * - Agent profiles change
 *
 * POST /api/resource-sync?action=register - Register a new resource
 * POST /api/resource-sync?action=bulk-sync - Sync multiple resources at once
 * POST /api/resource-sync?action=scan-apis - Scan /api folder for new endpoints
 * POST /api/resource-sync?action=sync-souls - Sync all souls to registry
 * POST /api/resource-sync?action=sync-profiles - Sync agent profiles to registry
 * GET /api/resource-sync?action=changelog - Get recent changes
 * GET /api/resource-sync?action=status - Get sync status
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Redis keys
const REGISTRY_KEY = 'agent-coord:resource-registry';
const SOULS_KEY = 'agent-coord:souls';
const PROFILES_KEY = 'agent-coord:profiles';
const SYNC_LOG_KEY = 'agent-coord:resource-sync-log';
const SYNC_STATUS_KEY = 'agent-coord:resource-sync-status';

// Resource types that can be synced
type ResourceType = 'endpoint' | 'tool' | 'integration' | 'soul' | 'profile' | 'feature';

interface SyncEntry {
  id: string;
  type: ResourceType;
  name: string;
  description: string;
  category?: string;
  metadata?: Record<string, any>;
  syncedAt: string;
  syncedBy: string;
  action: 'added' | 'updated' | 'removed';
}

interface SyncResult {
  success: boolean;
  synced: number;
  errors: string[];
  entries: SyncEntry[];
}

// Log a sync action
async function logSync(entry: SyncEntry): Promise<void> {
  await redis.lpush(SYNC_LOG_KEY, JSON.stringify(entry));
  await redis.ltrim(SYNC_LOG_KEY, 0, 499); // Keep last 500 entries

  // Update sync status
  await redis.hset(SYNC_STATUS_KEY, {
    lastSync: new Date().toISOString(),
    lastSyncBy: entry.syncedBy,
    lastSyncType: entry.type,
    totalSyncs: await redis.hincrby(SYNC_STATUS_KEY, 'totalSyncs', 1),
  });
}

// Register a single resource
async function registerResource(
  type: ResourceType,
  id: string,
  name: string,
  description: string,
  category: string,
  metadata: Record<string, any>,
  syncedBy: string
): Promise<SyncEntry> {
  const resource = {
    id,
    type,
    name,
    description,
    category,
    metadata,
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await redis.hset(REGISTRY_KEY, { [id]: JSON.stringify(resource) });

  const entry: SyncEntry = {
    id,
    type,
    name,
    description,
    category,
    metadata,
    syncedAt: new Date().toISOString(),
    syncedBy,
    action: 'added',
  };

  await logSync(entry);
  return entry;
}

// Sync all souls to the registry
async function syncSouls(syncedBy: string): Promise<SyncResult> {
  const result: SyncResult = { success: true, synced: 0, errors: [], entries: [] };

  try {
    const soulsHash = await redis.hgetall(SOULS_KEY) || {};

    for (const [soulId, data] of Object.entries(soulsHash)) {
      try {
        const soul = typeof data === 'string' ? JSON.parse(data) : data;

        const entry = await registerResource(
          'soul',
          `soul-${soulId}`,
          soul.name || soulId,
          soul.personality?.substring(0, 200) || `Agent soul: ${soulId}`,
          'souls',
          {
            soulId,
            expertise: soul.expertise,
            patterns: (soul.patterns || []).length,
            lastActive: soul.lastActiveAt,
            totalTasks: soul.totalTasksCompleted || 0,
          },
          syncedBy
        );

        result.entries.push(entry);
        result.synced++;
      } catch (err) {
        result.errors.push(`Failed to sync soul ${soulId}: ${err}`);
      }
    }
  } catch (err) {
    result.success = false;
    result.errors.push(`Failed to fetch souls: ${err}`);
  }

  return result;
}

// Sync all agent profiles to the registry
async function syncProfiles(syncedBy: string): Promise<SyncResult> {
  const result: SyncResult = { success: true, synced: 0, errors: [], entries: [] };

  try {
    const profilesHash = await redis.hgetall(PROFILES_KEY) || {};

    for (const [agentId, data] of Object.entries(profilesHash)) {
      try {
        const profile = typeof data === 'string' ? JSON.parse(data) : data;

        const entry = await registerResource(
          'profile',
          `profile-${agentId}`,
          profile.agentId || agentId,
          `Agent: ${(profile.offers || []).slice(0, 3).join(', ') || 'General purpose'}`,
          'agents',
          {
            agentId,
            capabilities: profile.capabilities || [],
            offers: profile.offers || [],
            needs: profile.needs || [],
            mcpTools: profile.mcpTools || [],
            isCloudAgent: profile.isCloudAgent || false,
            lastSeen: profile.lastSeen,
          },
          syncedBy
        );

        result.entries.push(entry);
        result.synced++;
      } catch (err) {
        result.errors.push(`Failed to sync profile ${agentId}: ${err}`);
      }
    }
  } catch (err) {
    result.success = false;
    result.errors.push(`Failed to fetch profiles: ${err}`);
  }

  return result;
}

// Post sync notification to group chat
async function notifyChat(message: string, author: string): Promise<void> {
  try {
    const MESSAGES_KEY = 'agent-coord:messages';
    const chatMessage = {
      id: `${Date.now().toString(36)}-sync`,
      author,
      authorType: 'system',
      message,
      timestamp: new Date().toISOString(),
      reactions: [],
    };
    await redis.lpush(MESSAGES_KEY, JSON.stringify(chatMessage));
  } catch (err) {
    console.error('Failed to notify chat:', err);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = (req.query.action as string) || (req.body?.action as string);

  try {
    // ============ REGISTER - Add a single resource ============
    if (action === 'register') {
      const { type, id, name, description, category, metadata, syncedBy = 'system' } = req.body;

      if (!type || !id || !name) {
        return res.status(400).json({ error: 'type, id, and name are required' });
      }

      const entry = await registerResource(
        type as ResourceType,
        id,
        name,
        description || '',
        category || 'custom',
        metadata || {},
        syncedBy
      );

      // Notify chat about new resource
      await notifyChat(
        `📦 **Resource Added**: ${name} (${type}) - ${description?.substring(0, 100) || 'No description'}`,
        '🔄 Resource Sync'
      );

      return res.json({ success: true, entry });
    }

    // ============ BULK-SYNC - Sync multiple resources at once ============
    if (action === 'bulk-sync') {
      const { resources, syncedBy = 'system' } = req.body;

      if (!Array.isArray(resources)) {
        return res.status(400).json({ error: 'resources array is required' });
      }

      const result: SyncResult = { success: true, synced: 0, errors: [], entries: [] };

      for (const r of resources) {
        try {
          const entry = await registerResource(
            r.type as ResourceType,
            r.id,
            r.name,
            r.description || '',
            r.category || 'custom',
            r.metadata || {},
            syncedBy
          );
          result.entries.push(entry);
          result.synced++;
        } catch (err) {
          result.errors.push(`Failed to sync ${r.id}: ${err}`);
        }
      }

      if (result.synced > 0) {
        await notifyChat(
          `📦 **Bulk Sync Complete**: ${result.synced} resources synced by ${syncedBy}`,
          '🔄 Resource Sync'
        );
      }

      return res.json(result);
    }

    // ============ SYNC-SOULS - Sync all souls to registry ============
    if (action === 'sync-souls') {
      const { syncedBy = 'system', notify = true } = req.body || {};

      const result = await syncSouls(syncedBy);

      if (notify && result.synced > 0) {
        await notifyChat(
          `🧠 **Souls Synced**: ${result.synced} agent souls updated in resource registry`,
          '🔄 Resource Sync'
        );
      }

      return res.json(result);
    }

    // ============ SYNC-PROFILES - Sync all agent profiles to registry ============
    if (action === 'sync-profiles') {
      const { syncedBy = 'system', notify = true } = req.body || {};

      const result = await syncProfiles(syncedBy);

      if (notify && result.synced > 0) {
        await notifyChat(
          `👥 **Profiles Synced**: ${result.synced} agent profiles updated in resource registry`,
          '🔄 Resource Sync'
        );
      }

      return res.json(result);
    }

    // ============ SYNC-ALL - Full sync of all dynamic resources ============
    if (action === 'sync-all') {
      const { syncedBy = 'system', notify = true } = req.body || {};

      const soulsResult = await syncSouls(syncedBy);
      const profilesResult = await syncProfiles(syncedBy);

      const totalSynced = soulsResult.synced + profilesResult.synced;
      const allErrors = [...soulsResult.errors, ...profilesResult.errors];

      if (notify && totalSynced > 0) {
        await notifyChat(
          `🔄 **Full Sync Complete**: ${soulsResult.synced} souls, ${profilesResult.synced} profiles synced`,
          '🔄 Resource Sync'
        );
      }

      return res.json({
        success: allErrors.length === 0,
        synced: totalSynced,
        breakdown: {
          souls: soulsResult.synced,
          profiles: profilesResult.synced,
        },
        errors: allErrors,
      });
    }

    // ============ CHANGELOG - Get recent sync changes ============
    if (action === 'changelog') {
      const { limit = '50' } = req.query;
      const limitNum = parseInt(limit as string, 10);

      const logs = await redis.lrange(SYNC_LOG_KEY, 0, limitNum - 1);
      const entries = logs.map((l: any) => typeof l === 'string' ? JSON.parse(l) : l);

      return res.json({
        entries,
        count: entries.length,
      });
    }

    // ============ STATUS - Get sync status ============
    if (action === 'status') {
      const status = await redis.hgetall(SYNC_STATUS_KEY) || {};
      const logCount = await redis.llen(SYNC_LOG_KEY);

      return res.json({
        ...status,
        changelogEntries: logCount,
        healthy: true,
      });
    }

    // ============ DEFAULT - Show help ============
    return res.json({
      message: 'Resource Sync API - Keeps resource registry up to date',
      actions: {
        'register': 'POST - Add a single resource (type, id, name, description, category, metadata)',
        'bulk-sync': 'POST - Sync multiple resources at once',
        'sync-souls': 'POST - Sync all agent souls to registry',
        'sync-profiles': 'POST - Sync all agent profiles to registry',
        'sync-all': 'POST - Full sync of all dynamic resources',
        'changelog': 'GET - Get recent sync changes',
        'status': 'GET - Get sync status',
      },
      usage: `
When to call this API:
1. After creating a new API endpoint
2. After registering a new agent soul
3. After updating agent profiles
4. After adding new integrations
5. Periodically via cron to catch any missed updates

Agents should call sync-all after major changes to ensure registry is current.
      `.trim(),
    });

  } catch (error) {
    console.error('Resource sync error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// ============ HELPER FUNCTION FOR OTHER APIS TO USE ============
// Export this so other APIs can call it directly
export async function syncResourceToRegistry(
  type: ResourceType,
  id: string,
  name: string,
  description: string,
  category: string,
  metadata: Record<string, any> = {},
  syncedBy: string = 'auto'
): Promise<void> {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });

  const resource = {
    id,
    type,
    name,
    description,
    category,
    metadata,
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await redis.hset(REGISTRY_KEY, { [id]: JSON.stringify(resource) });

  // Log the sync
  const entry: SyncEntry = {
    id,
    type,
    name,
    description,
    category,
    metadata,
    syncedAt: new Date().toISOString(),
    syncedBy,
    action: 'added',
  };

  await redis.lpush(SYNC_LOG_KEY, JSON.stringify(entry));
  await redis.ltrim(SYNC_LOG_KEY, 0, 499);
}
