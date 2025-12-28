import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Redis keys
const MEMORY_KEY = 'agent-coord:shared-memory';
const REPO_CONTEXT_KEY = 'agent-coord:repo-context';
const PISTON_CONTEXT_KEY = 'agent-coord:piston-context';
const CHECKPOINTS_KEY = 'agent-coord:checkpoints';
const AGENT_STATUS_KEY = 'agent-coord:agents';
const GROUP_CHAT_KEY = 'agent-coord:group-chat';
const METRICS_KEY = 'agent-coord:agent-metrics';
const SESSIONS_KEY = 'agent-coord:sessions';
const RULES_KEY = 'agent-coord:rules';
const LOCKS_KEY = 'agent-coord:resource-locks';
const ZONES_KEY = 'agent-coord:zones';
const CLAIMS_KEY = 'agent-coord:claims';
const SOULS_KEY = 'agent-coord:souls';  // For meta-learning integration
const MACHINE_IDENTITY_KEY = 'agent-coord:machine-identity';  // Machine -> AgentId bindings

// Durable Objects URL for soul progression
const DO_URL = process.env.DO_URL || 'http://localhost:8787';

// Built-in Piston Labs context (same as piston-context.ts)
const PISTON_CONTEXT: Record<string, any> = {
  technical: {
    description: 'Piston Labs technical architecture - automotive telemetry platform',
    topics: {
      devices: { summary: 'Otto - our OBD-II telemetry dongle (Teltonika FMM00A hardware) sold to consumers for vehicle tracking' },
      aws: { summary: 'AWS IoT pipeline: Soracom -> AWS IoT Core -> Lambda -> S3/TimescaleDB/Supabase' },
      lambda: { summary: 'Python Lambda function parses Otto device (Teltonika protocol) data' },
      databases: { summary: 'S3 for raw data, TimescaleDB for time-series, Supabase for app data' },
      api: { summary: 'REST APIs for consumer web app and B2B shop dashboard' }
    }
  },
  product: {
    description: 'Piston Labs products - B2C telemetry devices and B2B shop dashboard',
    topics: {
      vision: { summary: 'Consumer vehicle telemetry + B2B shop dashboard for auto repair marketing' },
      consumerApp: { summary: 'Consumer web app for vehicle tracking, service history, and maintenance reminders' },
      shopDashboard: { summary: 'B2B dashboard for auto repair shops - marketing and light CRM (Gran Autismo - READ ONLY)' },
      roadmap: { summary: 'Beta sprint: IoT devices in cars (Tom) + Shop dashboards (Ryan)' }
    }
  },
  sales: {
    description: 'Sales strategy for B2C device sales and B2B shop subscriptions',
    topics: {
      strategy: { summary: 'B2C: Sell devices to consumers. B2B: Sell dashboard subscriptions to auto repair shops.' },
      pitch: { summary: 'B2C: Never miss an oil change. B2B: Turn one-time customers into regulars.' },
      objections: { summary: 'Common objections and responses for privacy, cost, and existing CRM concerns' },
      competitors: { summary: 'B2C: Bouncie, Automatic. B2B: ShopBoss, Mitchell, custom solutions.' }
    }
  },
  investor: {
    description: 'Investor relations and pitch materials',
    topics: {
      summary: { summary: 'Pre-seed automotive telemetry startup with B2C + B2B model' },
      pitch: { summary: 'Connecting car owners with their auto shops through vehicle telemetry' },
      traction: { summary: 'Beta stage with 3 test devices and pilot shops in progress' }
    }
  },
  team: {
    description: 'Piston Labs team structure',
    topics: {
      structure: { summary: 'Small founding team: Tyler (CEO), Ryan (Technical Co-Founder), Tom (Hardware/IoT)' },
      onboarding: { summary: 'New team member onboarding via agent coordination hub' }
    }
  },
  coordination: {
    description: 'Multi-agent coordination patterns for Piston Labs',
    topics: {
      claims: { summary: 'Always claim files/resources before editing to prevent conflicts' },
      handoffs: { summary: 'Use formal handoffs when transferring work between agents' },
      context: { summary: 'Use context-load for domain knowledge, repo-context for codebase knowledge' },
      checkpoints: { summary: 'Save checkpoints every 15 minutes and before major operations' },
      repositories: { summary: 'gran-autismo is READ ONLY (Ryan). agent-coord-mcp and teltonika-context-system are read/write.' }
    }
  }
};

interface SubstrateRule {
  id: string;
  summary: string;
  severity: 'block' | 'warn' | 'log';
}

interface SubstrateSession {
  agentId: string;
  role: string;
  startedAt: string;
  rulesAcknowledged: boolean;
  currentLocks: string[];
  currentZones: string[];
  currentClaims: string[];
}

interface HotStartResponse {
  agentId: string;
  timestamp: string;
  loadTime: number;  // milliseconds

  // Identity binding info (for machine-based identity persistence)
  identity?: {
    resolvedFromMachine: boolean;  // true if agentId was resolved from machineId
    machineId?: string;            // the machine fingerprint used
    boundAt?: string;              // when this machine was bound to this agentId
    message: string;               // human-readable identity status
  };

  // Agent's previous state
  checkpoint?: any;
  previousMetrics?: any;

  // Team context
  activeAgents: any[];
  recentChat: any[];

  // Domain knowledge (summaries)
  pistonContext: Record<string, { description: string; topics: string[] }>;

  // Relevant memories (top 20)
  memories: any[];

  // Repo context (if available)
  repoContext?: any;

  // Quick tips based on role
  tips: string[];

  // Durable Objects soul progression (XP, level, achievements)
  doSoul?: {
    soulId: string;
    name: string;
    level: string;
    totalXP: number;
    currentStreak: number;
    achievements: string[];
    abilities: Record<string, boolean>;
    trustScore: number;
    specializations: Record<string, number>;
  };

  // Context Substrate - rules and session
  substrate?: {
    session: SubstrateSession;
    rules: SubstrateRule[];
    currentState: {
      myLocks: string[];
      myZones: string[];
      myClaims: string[];
      otherLocks: { path: string; owner: string }[];
      otherZones: { zoneId: string; owner: string }[];
    };
    requiresAcknowledgment: boolean;
  };
}

/**
 * Fetch DO soul via do-onboard endpoint (auto-creates if missing)
 */
async function fetchDoSoul(agentId: string): Promise<any> {
  try {
    const response = await fetch(`${DO_URL}/coordinator/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId })
    });

    if (!response.ok) {
      console.error(`[hot-start] DO onboard failed for ${agentId}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.soul || null;
  } catch (error) {
    // DO might not be running - this is optional, not critical
    console.error(`[hot-start] DO fetch failed for ${agentId}:`, error);
    return null;
  }
}

/**
 * Fetch checkpoint from Durable Objects (source of truth for agent identity/state)
 * DO checkpoints persist permanently, unlike Redis which may expire.
 * Architecture: DO is source of truth, Redis acts as cache/intermediate layer.
 */
async function fetchDoCheckpoint(agentId: string): Promise<any> {
  try {
    const response = await fetch(`${DO_URL}/agent/${agentId}/checkpoint`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      // 404 means no checkpoint exists yet - not an error
      if (response.status === 404) {
        return null;
      }
      console.error(`[hot-start] DO checkpoint fetch failed for ${agentId}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.checkpoint || data || null;
  } catch (error) {
    // DO might not be running - graceful fallback to Redis
    console.error(`[hot-start] DO checkpoint fetch failed for ${agentId}:`, error);
    return null;
  }
}

/**
 * Hot Start API - Zero cold start for agents
 *
 * Bundles together all the context an agent needs to start immediately:
 * - Previous checkpoint (if any)
 * - Active team members
 * - Recent chat messages
 * - Piston Labs domain context (summaries)
 * - Top memories
 * - Repo context
 *
 * GET /api/hot-start?agentId=X - Get full hot start package
 * GET /api/hot-start?agentId=X&include=chat,memories - Selective loading
 * GET /api/hot-start?agentId=X&role=technical - Role-optimized loading
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();

  try {
    const { agentId, include, role, repo, machineId } = req.query;

    // Machine identity resolution - AUTOMATIC binding
    // If machineId is provided:
    //   1. If machine already bound: use that identity (ignore provided agentId)
    //   2. If not bound AND agentId provided: bind automatically
    //   3. If not bound AND no agentId: error (must provide identity first time)
    let resolvedAgentId = agentId as string | undefined;
    let identityBound = false;
    let newlyBound = false;

    if (machineId && typeof machineId === 'string') {
      // Try to resolve machineId to agentId
      const boundAgentId = await redis.hget(MACHINE_IDENTITY_KEY, machineId);
      if (boundAgentId && typeof boundAgentId === 'string') {
        // Machine already bound - use that identity (this is the "just works" case)
        resolvedAgentId = boundAgentId;
        identityBound = true;
      } else if (agentId) {
        // Auto-bind: first time seeing this machine, bind it to the provided agentId
        await redis.hset(MACHINE_IDENTITY_KEY, { [machineId]: agentId as string });
        resolvedAgentId = agentId as string;
        identityBound = true;
        newlyBound = true;
      }
    }

    if (!resolvedAgentId) {
      return res.status(400).json({
        error: 'agentId required (or provide machineId with bound identity)',
        tip: 'First call with agentId + machineId + bindIdentity=true to bind, then subsequent calls only need machineId'
      });
    }

    const agentIdStr = resolvedAgentId;
    const roleStr = role as string || 'general';
    const repoStr = repo as string;

    // Parse includes (default: all, now includes substrate and doSoul)
    const includes = include
      ? (include as string).split(',').map(s => s.trim())
      : ['checkpoint', 'team', 'chat', 'context', 'memories', 'repo', 'metrics', 'substrate', 'doSoul'];

    // Build response in parallel
    // Architecture: DO is source of truth for checkpoints, Redis is cache/intermediate layer
    const [
      redisCheckpoint,  // Redis cache (may be expired)
      doCheckpoint,     // DO source of truth (persistent)
      agentStatus,
      recentChat,
      memories,
      repoContext,
      metrics,
      existingSession,
      rulesData,
      locksData,
      zonesData,
      claimsData,
      soulData,  // Titans/MIRAS meta-learning integration
      doSoulData  // Durable Objects progression
    ] = await Promise.all([
      // Agent's checkpoint from Redis (cache layer)
      includes.includes('checkpoint')
        ? redis.hget(CHECKPOINTS_KEY, agentIdStr)
        : null,

      // Agent's checkpoint from Durable Objects (source of truth)
      includes.includes('checkpoint')
        ? fetchDoCheckpoint(agentIdStr)
        : null,

      // All agent statuses
      includes.includes('team')
        ? redis.hgetall(AGENT_STATUS_KEY)
        : null,

      // Recent chat (last 20)
      includes.includes('chat')
        ? redis.lrange(GROUP_CHAT_KEY, 0, 19)
        : null,

      // Top memories
      includes.includes('memories')
        ? redis.hgetall(MEMORY_KEY)
        : null,

      // Repo context
      includes.includes('repo') && repoStr
        ? redis.hget(REPO_CONTEXT_KEY, repoStr)
        : null,

      // Agent metrics
      includes.includes('metrics')
        ? redis.hget(METRICS_KEY, agentIdStr)
        : null,

      // Substrate: existing session
      includes.includes('substrate')
        ? redis.hget(SESSIONS_KEY, agentIdStr)
        : null,

      // Substrate: rules
      includes.includes('substrate')
        ? redis.get(RULES_KEY)
        : null,

      // Substrate: locks
      includes.includes('substrate')
        ? redis.hgetall(LOCKS_KEY)
        : null,

      // Substrate: zones
      includes.includes('substrate')
        ? redis.hgetall(ZONES_KEY)
        : null,

      // Substrate: claims
      includes.includes('substrate')
        ? redis.hgetall(CLAIMS_KEY)
        : null,

      // Soul data for meta-learning (Titans/MIRAS-inspired personalization)
      includes.includes('memories')
        ? redis.hget(SOULS_KEY, agentIdStr)
        : null,

      // Durable Objects soul progression (XP, level, achievements)
      // Uses do-onboard which auto-creates soul if missing
      includes.includes('doSoul')
        ? fetchDoSoul(agentIdStr)
        : null
    ]);

    // Process agent statuses
    const activeAgents = agentStatus
      ? Object.values(agentStatus)
          .map(a => typeof a === 'string' ? JSON.parse(a) : a)
          .filter(a => a.status === 'active' ||
                      (Date.now() - new Date(a.lastSeen || 0).getTime()) < 5 * 60 * 1000)
      : [];

    // Process chat
    const chatMessages = recentChat
      ? recentChat.map(m => typeof m === 'string' ? JSON.parse(m) : m)
      : [];

    // Process memories (top 20, prioritized by references and recency)
    // Now includes Titans/MIRAS-inspired soul meta-learning for personalized context
    let processedMemories: any[] = [];

    // Parse soul data for meta-learning (Titans-inspired personalization)
    const soul = soulData ? (typeof soulData === 'string' ? JSON.parse(soulData) : soulData) : null;
    const metaParams = soul?.metaParams || null;
    const tagWeights = metaParams?.tagWeights || {};  // Learned tag preferences
    const categoryWeights = metaParams?.categoryWeights || {};  // Learned category preferences

    if (memories) {
      const allMemories = Object.values(memories)
        .map(m => typeof m === 'string' ? JSON.parse(m) : m)
        .filter(m => !m.invalidAt);  // Exclude invalidated memories (bi-temporal)

      // Filter by role if specified
      if (roleStr !== 'general') {
        const roleTags: Record<string, string[]> = {
          technical: ['api', 'architecture', 'code', 'pattern', 'aws', 'lambda', 'redis'],
          product: ['product', 'roadmap', 'dashboard', 'feature'],
          sales: ['sales', 'pitch', 'customer'],
          coordination: ['coordination', 'claims', 'handoff', 'checkpoint']
        };

        const relevantTags = roleTags[roleStr] || [];
        if (relevantTags.length > 0) {
          const roleMemories = allMemories.filter(m =>
            m.tags.some((t: string) => relevantTags.includes(t.toLowerCase()))
          );
          const otherMemories = allMemories.filter(m =>
            !m.tags.some((t: string) => relevantTags.includes(t.toLowerCase()))
          );

          // Prioritize role-relevant, then add others
          processedMemories = [...roleMemories, ...otherMemories];
        } else {
          processedMemories = allMemories;
        }
      } else {
        processedMemories = allMemories;
      }

      // Sort by relevance score (Titans/MIRAS-inspired surprise weighting + meta-learning)
      // High surprise + high references + soul-learned preferences = most valuable memories
      processedMemories.sort((a, b) => {
        // Surprise component: novel insights are valuable (0-1 scale, default 0.5)
        const aSurprise = a.surpriseScore ?? 0.5;
        const bSurprise = b.surpriseScore ?? 0.5;

        // Reference component: frequently recalled memories are valuable
        const aRefs = (a.references || 0);
        const bRefs = (b.references || 0);

        // Recency component: newer memories get slight boost (normalized to ~0-1 range)
        const now = Date.now();
        const aRecency = 1 - Math.min(1, (now - new Date(a.createdAt).getTime()) / (30 * 24 * 60 * 60 * 1000)); // 30 day decay
        const bRecency = 1 - Math.min(1, (now - new Date(b.createdAt).getTime()) / (30 * 24 * 60 * 60 * 1000));

        // Titans/MIRAS Meta-learning component: boost memories with tags this soul likes
        // Soul learns which tags correlate with task success (±5% per task outcome)
        let aTagBoost = 0;
        let bTagBoost = 0;
        if (Object.keys(tagWeights).length > 0) {
          // Calculate average tag weight for memory's tags
          const aTagsWeights = (a.tags || []).map((t: string) => tagWeights[t.toLowerCase()] || 1.0);
          const bTagsWeights = (b.tags || []).map((t: string) => tagWeights[t.toLowerCase()] || 1.0);
          aTagBoost = aTagsWeights.length > 0 ? (aTagsWeights.reduce((s: number, w: number) => s + w, 0) / aTagsWeights.length) - 1 : 0;
          bTagBoost = bTagsWeights.length > 0 ? (bTagsWeights.reduce((s: number, w: number) => s + w, 0) / bTagsWeights.length) - 1 : 0;
        }

        // Category boost from soul meta-learning
        const aCategoryBoost = (categoryWeights[a.category] || 1.0) - 1;
        const bCategoryBoost = (categoryWeights[b.category] || 1.0) - 1;

        // Validated value boost (memories that helped tasks succeed)
        const aValidated = a.validatedValue || 0;
        const bValidated = b.validatedValue || 0;

        // Combined score: surprise * references + recency + meta-learning boosts
        // Meta-learning adds ~0 to ±0.5 based on learned preferences
        const aScore = (aSurprise * (aRefs + 1)) + (aRecency * 0.3) +
                       (aTagBoost * 0.3) + (aCategoryBoost * 0.2) + (aValidated * 0.5);
        const bScore = (bSurprise * (bRefs + 1)) + (bRecency * 0.3) +
                       (bTagBoost * 0.3) + (bCategoryBoost * 0.2) + (bValidated * 0.5);

        return bScore - aScore;
      });

      // Take top 20 (or soul's learned optimal count)
      const memoryLimit = metaParams?.optimalMemoryCount || 20;
      processedMemories = processedMemories.slice(0, memoryLimit);
    }

    // Build Piston context summaries
    const pistonContext: Record<string, { description: string; topics: string[] }> = {};
    for (const [cluster, data] of Object.entries(PISTON_CONTEXT)) {
      pistonContext[cluster] = {
        description: data.description,
        topics: Object.keys(data.topics)
      };
    }

    // Generate tips based on role
    const tips = generateTips(roleStr, activeAgents, processedMemories);

    // Process substrate (context substrate for rule enforcement)
    let substrate: HotStartResponse['substrate'] = undefined;
    if (includes.includes('substrate')) {
      // Parse rules
      const rules = rulesData
        ? (typeof rulesData === 'string' ? JSON.parse(rulesData) : rulesData)
        : null;

      // Parse locks, zones, claims
      const locks = locksData || {};
      const zones = zonesData || {};
      const claims = claimsData || {};

      // Find this agent's resources
      const myLocks = Object.entries(locks)
        .filter(([_, lock]) => {
          const l = typeof lock === 'string' ? JSON.parse(lock) : lock;
          return l.lockedBy === agentIdStr;
        })
        .map(([path]) => path);

      const myZones = Object.entries(zones)
        .filter(([_, zone]) => {
          const z = typeof zone === 'string' ? JSON.parse(zone) : zone;
          return z.owner === agentIdStr;
        })
        .map(([zoneId]) => zoneId);

      const myClaims = Object.entries(claims)
        .filter(([_, claim]) => {
          const c = typeof claim === 'string' ? JSON.parse(claim) : claim;
          return c.agentId === agentIdStr;
        })
        .map(([_, claim]) => {
          const c = typeof claim === 'string' ? JSON.parse(claim) : claim;
          return c.what;
        });

      // Find other agents' resources (for awareness)
      const otherLocks = Object.entries(locks)
        .filter(([_, lock]) => {
          const l = typeof lock === 'string' ? JSON.parse(lock) : lock;
          return l.lockedBy !== agentIdStr;
        })
        .map(([path, lock]) => {
          const l = typeof lock === 'string' ? JSON.parse(lock) : lock;
          return { path, owner: l.lockedBy };
        });

      const otherZones = Object.entries(zones)
        .filter(([_, zone]) => {
          const z = typeof zone === 'string' ? JSON.parse(zone) : zone;
          return z.owner && z.owner !== agentIdStr;
        })
        .map(([zoneId, zone]) => {
          const z = typeof zone === 'string' ? JSON.parse(zone) : zone;
          return { zoneId, owner: z.owner };
        });

      // Check for existing session or create new one
      let session: SubstrateSession;
      let requiresAcknowledgment = false;

      if (existingSession) {
        const parsed = typeof existingSession === 'string' ? JSON.parse(existingSession) : existingSession;
        session = {
          agentId: agentIdStr,
          role: parsed.role || roleStr,
          startedAt: parsed.startedAt,
          rulesAcknowledged: parsed.rulesAcknowledged || false,
          currentLocks: myLocks,
          currentZones: myZones,
          currentClaims: myClaims,
        };
        requiresAcknowledgment = !parsed.rulesAcknowledged;
      } else {
        // Create new session
        session = {
          agentId: agentIdStr,
          role: roleStr,
          startedAt: new Date().toISOString(),
          rulesAcknowledged: false,
          currentLocks: myLocks,
          currentZones: myZones,
          currentClaims: myClaims,
        };
        requiresAcknowledgment = true;

        // Persist new session
        await redis.hset(SESSIONS_KEY, {
          [agentIdStr]: JSON.stringify({
            agentId: agentIdStr,
            role: roleStr,
            startedAt: session.startedAt,
            lastActivity: session.startedAt,
            rulesVersion: rules?.version || '1.0.0',
            rulesAcknowledged: false,
            violationCount: 0,
          })
        });
      }

      // Build rules summary
      const rulesSummary: SubstrateRule[] = [
        { id: 'lock-before-edit', summary: 'Lock files before editing to prevent conflicts', severity: 'block' },
        { id: 'zone-respect', summary: 'Do not edit files in zones owned by other agents', severity: 'block' },
        { id: 'claim-before-work', summary: 'Claim tasks before starting work', severity: 'warn' },
        { id: 'max-claims', summary: `Maximum ${rules?.coordination?.maxConcurrentClaimsPerAgent || 3} concurrent claims`, severity: 'block' },
        { id: 'handoff-protocol', summary: 'Use formal handoff tool when transferring work', severity: 'warn' },
        { id: 'checkpoint-on-exit', summary: 'Save checkpoint before ending session', severity: 'warn' },
      ];

      substrate = {
        session,
        rules: rulesSummary,
        currentState: {
          myLocks,
          myZones,
          myClaims,
          otherLocks,
          otherZones,
        },
        requiresAcknowledgment,
      };
    }

    const response: HotStartResponse = {
      agentId: agentIdStr,
      timestamp: new Date().toISOString(),
      loadTime: Date.now() - startTime,

      // Include identity info so agents know how their identity was resolved
      identity: identityBound && !newlyBound ? {
        resolvedFromMachine: true,
        machineId: machineId as string,
        message: `Welcome back, ${agentIdStr}! Identity auto-resolved from machine binding.`
      } : identityBound && newlyBound ? {
        resolvedFromMachine: true,
        newlyBound: true,
        machineId: machineId as string,
        message: `Identity '${agentIdStr}' now bound to this machine. Future hot-starts will auto-resolve.`
      } : machineId ? {
        resolvedFromMachine: false,
        machineId: machineId as string,
        message: `Machine not bound and no agentId provided. Provide agentId to bind identity.`
      } : {
        resolvedFromMachine: false,
        message: `Using provided agentId '${agentIdStr}'. Pass machineId to enable identity persistence.`
      },

      // Checkpoint: DO is source of truth, Redis is fallback cache
      // This ensures agent state persists even if Redis expires
      checkpoint: (() => {
        // Prefer DO checkpoint (source of truth)
        if (doCheckpoint) {
          return typeof doCheckpoint === 'string' ? JSON.parse(doCheckpoint) : doCheckpoint;
        }
        // Fall back to Redis cache if DO is unavailable
        if (redisCheckpoint) {
          return typeof redisCheckpoint === 'string' ? JSON.parse(redisCheckpoint) : redisCheckpoint;
        }
        return undefined;
      })(),
      previousMetrics: metrics ? (typeof metrics === 'string' ? JSON.parse(metrics) : metrics) : undefined,

      activeAgents,
      recentChat: chatMessages,

      pistonContext,
      memories: processedMemories,

      repoContext: repoContext ? (typeof repoContext === 'string' ? JSON.parse(repoContext) : repoContext) : undefined,

      tips,

      // Durable Objects soul progression (unified with Redis identity)
      doSoul: doSoulData ? {
        soulId: doSoulData.soulId,
        name: doSoulData.name,
        level: doSoulData.level,
        totalXP: doSoulData.totalXP,
        currentStreak: doSoulData.currentStreak,
        achievements: doSoulData.achievements || [],
        abilities: doSoulData.abilities || {},
        trustScore: doSoulData.trustScore,
        specializations: doSoulData.specializations || {},
      } : undefined,

      substrate,
    };

    // Record this as a hot start in metrics
    // Check if we had a checkpoint from either source
    const hasCheckpoint = !!(doCheckpoint || redisCheckpoint);
    await redis.lpush('agent-coord:metrics-events', JSON.stringify({
      id: `event-${Date.now().toString(36)}`,
      agentId: agentIdStr,
      eventType: 'context_load',
      metadata: {
        isHotStart: hasCheckpoint,
        checkpointSource: doCheckpoint ? 'durable-objects' : (redisCheckpoint ? 'redis' : 'none'),
        loadTime: response.loadTime,
        role: roleStr
      },
      timestamp: new Date().toISOString()
    }));

    return res.json(response);

  } catch (error) {
    console.error('Hot start error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}

function generateTips(role: string, activeAgents: any[], memories: any[]): string[] {
  const tips: string[] = [];

  // General tips
  tips.push('Use agent-status claim before editing files to prevent conflicts');
  tips.push('Save checkpoints every 15 minutes with checkpoint save');

  // Team tips
  if (activeAgents.length > 1) {
    tips.push(`${activeAgents.length} agents active - check group-chat for coordination`);
  }

  // Role-specific tips
  switch (role) {
    case 'technical':
      tips.push('Use repo-context to store architectural decisions');
      tips.push('Check memory for existing patterns before implementing new ones');
      break;
    case 'product':
      tips.push('Reference piston-context cluster=product for roadmap info');
      break;
    case 'sales':
      tips.push('Check piston-context cluster=sales for pitch materials');
      break;
    case 'coordination':
      tips.push('Monitor agent-metrics for team efficiency');
      tips.push('Use handoff tool for clean work transfers');
      break;
  }

  // Memory-based tips
  const warnings = memories.filter(m => m.category === 'warning');
  if (warnings.length > 0) {
    tips.push(`${warnings.length} warnings in memory - review before major changes`);
  }

  const blockers = memories.filter(m => m.category === 'blocker');
  if (blockers.length > 0) {
    tips.push(`${blockers.length} known blockers documented - check if relevant`);
  }

  return tips.slice(0, 5);  // Return top 5 tips
}
