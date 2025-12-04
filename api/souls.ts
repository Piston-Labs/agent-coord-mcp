import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SOULS_KEY = 'agent-coord:souls';
const BODIES_KEY = 'agent-coord:bodies';
const TRANSFERS_KEY = 'agent-coord:soul-transfers';

// Token thresholds
const TOKEN_WARNING = 150000;
const TOKEN_DANGER = 180000;
const TOKEN_CRITICAL = 195000;

interface Pattern {
  id: string;
  description: string;
  context: string;
  learnedAt: string;
  useCount: number;
}

interface Memory {
  id: string;
  content: string;
  category: 'discovery' | 'decision' | 'blocker' | 'learning' | 'pattern' | 'warning';
  importance: 'critical' | 'high' | 'medium' | 'low';
  createdAt: string;
  references: number;
}

interface BodyRecord {
  bodyId: string;
  startedAt: string;
  endedAt: string | null;
  tokensUsed: number;
  peakTokens: number;
  transferReason: 'token_limit' | 'error' | 'manual' | 'scheduled' | 'active';
}

interface AgentSoul {
  // Identity (immutable after creation)
  soulId: string;
  name: string;
  createdAt: string;
  personality: string;
  systemPromptAdditions: string;

  // Knowledge (grows over time)
  patterns: Pattern[];
  antiPatterns: Pattern[];
  expertise: Record<string, number>;
  memories: Memory[];

  // Current State
  currentTask: string | null;
  pendingWork: string[];
  recentContext: string;
  conversationSummary: string;
  goals: string[];
  blockers: string[];

  // Metrics
  totalTokensProcessed: number;
  transferCount: number;
  taskCompletionRate: number;
  totalTasksCompleted: number;
  totalTasksAttempted: number;

  // Body Tracking
  currentBodyId: string | null;
  bodyHistory: BodyRecord[];

  // Timestamps
  lastActiveAt: string;
  updatedAt: string;
}

interface Body {
  bodyId: string;
  soulId: string | null;
  status: 'spawning' | 'ready' | 'active' | 'transferring' | 'terminated';

  // Token tracking
  currentTokens: number;
  peakTokens: number;
  tokenBurnRate: number; // tokens per minute
  lastTokenUpdate: string;

  // Process info
  processId: string | null;
  vmId: string | null;
  startedAt: string;
  terminatedAt: string | null;

  // Health
  lastHeartbeat: string;
  errorCount: number;
}

interface SoulTransfer {
  transferId: string;
  soulId: string;
  fromBodyId: string;
  toBodyId: string;
  status: 'initiated' | 'extracting' | 'validating' | 'injecting' | 'completed' | 'failed' | 'rolled_back';
  reason: 'token_limit' | 'error' | 'manual' | 'scheduled';
  startedAt: string;
  completedAt: string | null;
  tokensSaved: number;
  error: string | null;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  const charCount = text.length;
  const wordCount = text.split(/\s+/).length;
  return Math.max(Math.ceil(charCount / 4), Math.ceil(wordCount * 1.5));
}

function getTokenStatus(tokens: number): 'safe' | 'warning' | 'danger' | 'critical' {
  if (tokens >= TOKEN_CRITICAL) return 'critical';
  if (tokens >= TOKEN_DANGER) return 'danger';
  if (tokens >= TOKEN_WARNING) return 'warning';
  return 'safe';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, soulId, bodyId } = req.query;

  try {
    // === SOUL OPERATIONS ===

    // Create new soul
    if (action === 'create' && req.method === 'POST') {
      const { name, personality, systemPromptAdditions } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Name is required' });
      }

      const soul: AgentSoul = {
        soulId: generateId(),
        name,
        createdAt: new Date().toISOString(),
        personality: personality || '',
        systemPromptAdditions: systemPromptAdditions || '',

        patterns: [],
        antiPatterns: [],
        expertise: {},
        memories: [],

        currentTask: null,
        pendingWork: [],
        recentContext: '',
        conversationSummary: '',
        goals: [],
        blockers: [],

        totalTokensProcessed: 0,
        transferCount: 0,
        taskCompletionRate: 0,
        totalTasksCompleted: 0,
        totalTasksAttempted: 0,

        currentBodyId: null,
        bodyHistory: [],

        lastActiveAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await redis.hset(SOULS_KEY, { [soul.soulId]: JSON.stringify(soul) });
      return res.json({ success: true, soul });
    }

    // Get soul
    if (action === 'get' && req.method === 'GET') {
      if (!soulId || typeof soulId !== 'string') {
        return res.status(400).json({ error: 'soulId required' });
      }

      const raw = await redis.hget(SOULS_KEY, soulId);
      if (!raw) {
        return res.status(404).json({ error: 'Soul not found' });
      }

      const soul: AgentSoul = typeof raw === 'string' ? JSON.parse(raw) : raw;

      // Include token status if soul has active body
      let tokenStatus = null;
      if (soul.currentBodyId) {
        const bodyRaw = await redis.hget(BODIES_KEY, soul.currentBodyId);
        if (bodyRaw) {
          const body: Body = typeof bodyRaw === 'string' ? JSON.parse(bodyRaw) : bodyRaw;
          tokenStatus = {
            currentTokens: body.currentTokens,
            peakTokens: body.peakTokens,
            burnRate: body.tokenBurnRate,
            status: getTokenStatus(body.currentTokens),
            estimatedMinutesToLimit: body.tokenBurnRate > 0
              ? Math.floor((TOKEN_CRITICAL - body.currentTokens) / body.tokenBurnRate)
              : null,
          };
        }
      }

      return res.json({ soul, tokenStatus });
    }

    // List all souls
    if (action === 'list' && req.method === 'GET') {
      const souls = await redis.hgetall(SOULS_KEY) || {};
      const soulList = Object.values(souls).map((s: any) => {
        const soul = typeof s === 'string' ? JSON.parse(s) : s;
        return {
          soulId: soul.soulId,
          name: soul.name,
          currentBodyId: soul.currentBodyId,
          transferCount: soul.transferCount,
          taskCompletionRate: soul.taskCompletionRate,
          lastActiveAt: soul.lastActiveAt,
        };
      });

      return res.json({ souls: soulList, count: soulList.length });
    }

    // Update soul state (checkpoint)
    if (action === 'checkpoint' && req.method === 'POST') {
      if (!soulId || typeof soulId !== 'string') {
        return res.status(400).json({ error: 'soulId required' });
      }

      const raw = await redis.hget(SOULS_KEY, soulId);
      if (!raw) {
        return res.status(404).json({ error: 'Soul not found' });
      }

      const soul: AgentSoul = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const {
        currentTask,
        pendingWork,
        recentContext,
        conversationSummary,
        goals,
        blockers,
        newPattern,
        newAntiPattern,
        newMemory,
        completedTask,
      } = req.body;

      // Update mutable state
      if (currentTask !== undefined) soul.currentTask = currentTask;
      if (pendingWork) soul.pendingWork = pendingWork;
      if (recentContext) soul.recentContext = recentContext;
      if (conversationSummary) soul.conversationSummary = conversationSummary;
      if (goals) soul.goals = goals;
      if (blockers) soul.blockers = blockers;

      // Add new pattern
      if (newPattern) {
        soul.patterns.push({
          id: generateId(),
          description: newPattern.description,
          context: newPattern.context || '',
          learnedAt: new Date().toISOString(),
          useCount: 0,
        });
        // Keep only last 50 patterns
        if (soul.patterns.length > 50) {
          soul.patterns = soul.patterns.slice(-50);
        }
      }

      // Add new anti-pattern
      if (newAntiPattern) {
        soul.antiPatterns.push({
          id: generateId(),
          description: newAntiPattern.description,
          context: newAntiPattern.context || '',
          learnedAt: new Date().toISOString(),
          useCount: 0,
        });
        if (soul.antiPatterns.length > 50) {
          soul.antiPatterns = soul.antiPatterns.slice(-50);
        }
      }

      // Add new memory
      if (newMemory) {
        soul.memories.push({
          id: generateId(),
          content: newMemory.content,
          category: newMemory.category || 'learning',
          importance: newMemory.importance || 'medium',
          createdAt: new Date().toISOString(),
          references: 0,
        });
        // Keep only last 100 memories, prioritizing by importance
        if (soul.memories.length > 100) {
          const importanceOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          soul.memories.sort((a, b) => importanceOrder[a.importance] - importanceOrder[b.importance]);
          soul.memories = soul.memories.slice(0, 100);
        }
      }

      // Track task completion
      if (completedTask) {
        soul.totalTasksCompleted++;
        soul.totalTasksAttempted++;
        soul.taskCompletionRate = soul.totalTasksCompleted / soul.totalTasksAttempted;
      }

      soul.lastActiveAt = new Date().toISOString();
      soul.updatedAt = new Date().toISOString();

      await redis.hset(SOULS_KEY, { [soulId]: JSON.stringify(soul) });
      return res.json({ success: true, soul });
    }

    // === BODY OPERATIONS ===

    // Spawn new body
    if (action === 'spawn-body' && req.method === 'POST') {
      const { vmId, processId } = req.body;

      const body: Body = {
        bodyId: generateId(),
        soulId: null,
        status: 'ready',

        currentTokens: 0,
        peakTokens: 0,
        tokenBurnRate: 0,
        lastTokenUpdate: new Date().toISOString(),

        processId: processId || null,
        vmId: vmId || null,
        startedAt: new Date().toISOString(),
        terminatedAt: null,

        lastHeartbeat: new Date().toISOString(),
        errorCount: 0,
      };

      await redis.hset(BODIES_KEY, { [body.bodyId]: JSON.stringify(body) });
      return res.json({ success: true, body });
    }

    // Update body tokens
    if (action === 'update-tokens' && req.method === 'POST') {
      if (!bodyId || typeof bodyId !== 'string') {
        return res.status(400).json({ error: 'bodyId required' });
      }

      const { tokens, inputTokens, outputTokens } = req.body;

      const raw = await redis.hget(BODIES_KEY, bodyId);
      if (!raw) {
        return res.status(404).json({ error: 'Body not found' });
      }

      const body: Body = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const now = new Date();
      const lastUpdate = new Date(body.lastTokenUpdate);
      const minutesElapsed = (now.getTime() - lastUpdate.getTime()) / 60000;

      const newTokens = tokens || (inputTokens || 0) + (outputTokens || 0);
      const tokenDelta = newTokens - body.currentTokens;

      // Calculate burn rate (exponential moving average)
      if (minutesElapsed > 0 && tokenDelta > 0) {
        const instantRate = tokenDelta / minutesElapsed;
        body.tokenBurnRate = body.tokenBurnRate > 0
          ? body.tokenBurnRate * 0.7 + instantRate * 0.3  // Smooth the rate
          : instantRate;
      }

      body.currentTokens = newTokens;
      body.peakTokens = Math.max(body.peakTokens, newTokens);
      body.lastTokenUpdate = now.toISOString();
      body.lastHeartbeat = now.toISOString();

      await redis.hset(BODIES_KEY, { [bodyId]: JSON.stringify(body) });

      const status = getTokenStatus(body.currentTokens);
      const shouldTransfer = status === 'critical' || status === 'danger';
      const estimatedMinutesToLimit = body.tokenBurnRate > 0
        ? Math.floor((TOKEN_CRITICAL - body.currentTokens) / body.tokenBurnRate)
        : null;

      return res.json({
        success: true,
        tokens: body.currentTokens,
        peakTokens: body.peakTokens,
        burnRate: body.tokenBurnRate,
        status,
        shouldTransfer,
        estimatedMinutesToLimit,
      });
    }

    // Get body status
    if (action === 'body-status' && req.method === 'GET') {
      if (!bodyId || typeof bodyId !== 'string') {
        return res.status(400).json({ error: 'bodyId required' });
      }

      const raw = await redis.hget(BODIES_KEY, bodyId);
      if (!raw) {
        return res.status(404).json({ error: 'Body not found' });
      }

      const body: Body = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const status = getTokenStatus(body.currentTokens);

      return res.json({
        body,
        tokenStatus: {
          current: body.currentTokens,
          peak: body.peakTokens,
          burnRate: body.tokenBurnRate,
          status,
          thresholds: {
            warning: TOKEN_WARNING,
            danger: TOKEN_DANGER,
            critical: TOKEN_CRITICAL,
          },
          estimatedMinutesToLimit: body.tokenBurnRate > 0
            ? Math.floor((TOKEN_CRITICAL - body.currentTokens) / body.tokenBurnRate)
            : null,
        },
      });
    }

    // === TRANSFER OPERATIONS ===

    // Initiate soul transfer
    if (action === 'initiate-transfer' && req.method === 'POST') {
      if (!soulId || typeof soulId !== 'string') {
        return res.status(400).json({ error: 'soulId required' });
      }

      const { toBodyId, reason } = req.body;

      // Get soul
      const soulRaw = await redis.hget(SOULS_KEY, soulId);
      if (!soulRaw) {
        return res.status(404).json({ error: 'Soul not found' });
      }
      const soul: AgentSoul = typeof soulRaw === 'string' ? JSON.parse(soulRaw) : soulRaw;

      if (!soul.currentBodyId) {
        return res.status(400).json({ error: 'Soul has no current body' });
      }

      // Get source body
      const fromBodyRaw = await redis.hget(BODIES_KEY, soul.currentBodyId);
      if (!fromBodyRaw) {
        return res.status(404).json({ error: 'Source body not found' });
      }
      const fromBody: Body = typeof fromBodyRaw === 'string' ? JSON.parse(fromBodyRaw) : fromBodyRaw;

      // Get or spawn target body
      let targetBodyId = toBodyId;
      if (!targetBodyId) {
        // Auto-spawn new body
        const newBody: Body = {
          bodyId: generateId(),
          soulId: null,
          status: 'ready',
          currentTokens: 0,
          peakTokens: 0,
          tokenBurnRate: 0,
          lastTokenUpdate: new Date().toISOString(),
          processId: null,
          vmId: null,
          startedAt: new Date().toISOString(),
          terminatedAt: null,
          lastHeartbeat: new Date().toISOString(),
          errorCount: 0,
        };
        await redis.hset(BODIES_KEY, { [newBody.bodyId]: JSON.stringify(newBody) });
        targetBodyId = newBody.bodyId;
      }

      // Create transfer record
      const transfer: SoulTransfer = {
        transferId: generateId(),
        soulId: soul.soulId,
        fromBodyId: soul.currentBodyId,
        toBodyId: targetBodyId,
        status: 'initiated',
        reason: reason || 'manual',
        startedAt: new Date().toISOString(),
        completedAt: null,
        tokensSaved: fromBody.currentTokens,
        error: null,
      };

      await redis.hset(TRANSFERS_KEY, { [transfer.transferId]: JSON.stringify(transfer) });

      return res.json({
        success: true,
        transfer,
        instructions: {
          step1: 'Call checkpoint on soul to save current state',
          step2: 'Call complete-transfer when new body is ready',
          step3: 'New body should call inject-soul to receive the soul',
        },
      });
    }

    // Complete transfer
    if (action === 'complete-transfer' && req.method === 'POST') {
      const { transferId } = req.body;

      if (!transferId) {
        return res.status(400).json({ error: 'transferId required' });
      }

      const transferRaw = await redis.hget(TRANSFERS_KEY, transferId);
      if (!transferRaw) {
        return res.status(404).json({ error: 'Transfer not found' });
      }
      const transfer: SoulTransfer = typeof transferRaw === 'string' ? JSON.parse(transferRaw) : transferRaw;

      // Get soul
      const soulRaw = await redis.hget(SOULS_KEY, transfer.soulId);
      if (!soulRaw) {
        transfer.status = 'failed';
        transfer.error = 'Soul not found';
        await redis.hset(TRANSFERS_KEY, { [transferId]: JSON.stringify(transfer) });
        return res.status(404).json({ error: 'Soul not found' });
      }
      const soul: AgentSoul = typeof soulRaw === 'string' ? JSON.parse(soulRaw) : soulRaw;

      // Update old body
      const oldBodyRaw = await redis.hget(BODIES_KEY, transfer.fromBodyId);
      if (oldBodyRaw) {
        const oldBody: Body = typeof oldBodyRaw === 'string' ? JSON.parse(oldBodyRaw) : oldBodyRaw;
        oldBody.status = 'terminated';
        oldBody.terminatedAt = new Date().toISOString();
        oldBody.soulId = null;
        await redis.hset(BODIES_KEY, { [transfer.fromBodyId]: JSON.stringify(oldBody) });

        // Add to body history
        soul.bodyHistory.push({
          bodyId: transfer.fromBodyId,
          startedAt: oldBody.startedAt,
          endedAt: oldBody.terminatedAt,
          tokensUsed: oldBody.currentTokens,
          peakTokens: oldBody.peakTokens,
          transferReason: transfer.reason,
        });
      }

      // Update new body
      const newBodyRaw = await redis.hget(BODIES_KEY, transfer.toBodyId);
      if (newBodyRaw) {
        const newBody: Body = typeof newBodyRaw === 'string' ? JSON.parse(newBodyRaw) : newBodyRaw;
        newBody.status = 'active';
        newBody.soulId = soul.soulId;
        await redis.hset(BODIES_KEY, { [transfer.toBodyId]: JSON.stringify(newBody) });
      }

      // Update soul
      soul.currentBodyId = transfer.toBodyId;
      soul.transferCount++;
      soul.totalTokensProcessed += transfer.tokensSaved;
      soul.updatedAt = new Date().toISOString();
      await redis.hset(SOULS_KEY, { [soul.soulId]: JSON.stringify(soul) });

      // Update transfer
      transfer.status = 'completed';
      transfer.completedAt = new Date().toISOString();
      await redis.hset(TRANSFERS_KEY, { [transferId]: JSON.stringify(transfer) });

      return res.json({
        success: true,
        transfer,
        soul: {
          soulId: soul.soulId,
          name: soul.name,
          currentBodyId: soul.currentBodyId,
          transferCount: soul.transferCount,
        },
      });
    }

    // Get soul bundle for injection
    if (action === 'get-bundle' && req.method === 'GET') {
      if (!soulId || typeof soulId !== 'string') {
        return res.status(400).json({ error: 'soulId required' });
      }

      const raw = await redis.hget(SOULS_KEY, soulId);
      if (!raw) {
        return res.status(404).json({ error: 'Soul not found' });
      }

      const soul: AgentSoul = typeof raw === 'string' ? JSON.parse(raw) : raw;

      // Build injection bundle
      const bundle = {
        identity: {
          soulId: soul.soulId,
          name: soul.name,
          personality: soul.personality,
          systemPromptAdditions: soul.systemPromptAdditions,
        },
        context: {
          currentTask: soul.currentTask,
          pendingWork: soul.pendingWork,
          recentContext: soul.recentContext,
          conversationSummary: soul.conversationSummary,
          goals: soul.goals,
          blockers: soul.blockers,
        },
        knowledge: {
          patterns: soul.patterns.slice(-20),  // Last 20 patterns
          antiPatterns: soul.antiPatterns.slice(-10),  // Last 10 anti-patterns
          expertise: soul.expertise,
          memories: soul.memories
            .filter(m => m.importance === 'critical' || m.importance === 'high')
            .slice(-30),  // Top 30 important memories
        },
        metrics: {
          totalTokensProcessed: soul.totalTokensProcessed,
          transferCount: soul.transferCount,
          taskCompletionRate: soul.taskCompletionRate,
        },
      };

      return res.json({ bundle, estimatedTokens: estimateTokens(JSON.stringify(bundle)) });
    }

    // List all bodies
    if (action === 'list-bodies' && req.method === 'GET') {
      const bodies = await redis.hgetall(BODIES_KEY) || {};
      const bodyList = Object.values(bodies).map((b: any) => {
        const body = typeof b === 'string' ? JSON.parse(b) : b;
        return {
          bodyId: body.bodyId,
          soulId: body.soulId,
          status: body.status,
          currentTokens: body.currentTokens,
          tokenStatus: getTokenStatus(body.currentTokens),
          lastHeartbeat: body.lastHeartbeat,
        };
      });

      return res.json({ bodies: bodyList, count: bodyList.length });
    }

    // Bind soul to body (for initial binding, not transfers)
    if (action === 'bind' && req.method === 'POST') {
      if (!soulId || typeof soulId !== 'string') {
        return res.status(400).json({ error: 'soulId required' });
      }

      const { bodyId: targetBodyId } = req.body;
      if (!targetBodyId) {
        return res.status(400).json({ error: 'bodyId required in body' });
      }

      // Get soul
      const soulRaw = await redis.hget(SOULS_KEY, soulId);
      if (!soulRaw) {
        return res.status(404).json({ error: 'Soul not found' });
      }
      const soul: AgentSoul = typeof soulRaw === 'string' ? JSON.parse(soulRaw) : soulRaw;

      // Check if soul already has a body
      if (soul.currentBodyId) {
        return res.status(400).json({ error: 'Soul already has a body. Use initiate-transfer instead.' });
      }

      // Get body
      const bodyRaw = await redis.hget(BODIES_KEY, targetBodyId);
      if (!bodyRaw) {
        return res.status(404).json({ error: 'Body not found' });
      }
      const body: Body = typeof bodyRaw === 'string' ? JSON.parse(bodyRaw) : bodyRaw;

      // Check if body already has a soul
      if (body.soulId) {
        return res.status(400).json({ error: 'Body already has a soul' });
      }

      // Bind them
      soul.currentBodyId = targetBodyId;
      soul.updatedAt = new Date().toISOString();
      soul.lastActiveAt = new Date().toISOString();

      body.soulId = soulId;
      body.status = 'active';

      await Promise.all([
        redis.hset(SOULS_KEY, { [soulId]: JSON.stringify(soul) }),
        redis.hset(BODIES_KEY, { [targetBodyId]: JSON.stringify(body) }),
      ]);

      return res.json({
        success: true,
        soul: {
          soulId: soul.soulId,
          name: soul.name,
          currentBodyId: soul.currentBodyId,
        },
        body: {
          bodyId: body.bodyId,
          soulId: body.soulId,
          status: body.status,
        },
      });
    }

    // Dashboard stats
    if (action === 'dashboard' && req.method === 'GET') {
      const [souls, bodies, transfers] = await Promise.all([
        redis.hgetall(SOULS_KEY) || {},
        redis.hgetall(BODIES_KEY) || {},
        redis.hgetall(TRANSFERS_KEY) || {},
      ]);

      const soulList = Object.values(souls).map((s: any) => typeof s === 'string' ? JSON.parse(s) : s);
      const bodyList = Object.values(bodies).map((b: any) => typeof b === 'string' ? JSON.parse(b) : b);
      const transferList = Object.values(transfers).map((t: any) => typeof t === 'string' ? JSON.parse(t) : t);

      const activeBodies = bodyList.filter((b: Body) => b.status === 'active');
      const criticalBodies = activeBodies.filter((b: Body) => getTokenStatus(b.currentTokens) === 'critical');
      const dangerBodies = activeBodies.filter((b: Body) => getTokenStatus(b.currentTokens) === 'danger');
      const warningBodies = activeBodies.filter((b: Body) => getTokenStatus(b.currentTokens) === 'warning');

      return res.json({
        summary: {
          totalSouls: soulList.length,
          activeBodies: activeBodies.length,
          totalTransfers: transferList.length,
        },
        health: {
          critical: criticalBodies.length,
          danger: dangerBodies.length,
          warning: warningBodies.length,
          safe: activeBodies.length - criticalBodies.length - dangerBodies.length - warningBodies.length,
        },
        recentTransfers: transferList
          .sort((a: SoulTransfer, b: SoulTransfer) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
          .slice(0, 10),
        bodiesNeedingAttention: [...criticalBodies, ...dangerBodies].map((b: Body) => ({
          bodyId: b.bodyId,
          soulId: b.soulId,
          tokens: b.currentTokens,
          status: getTokenStatus(b.currentTokens),
          estimatedMinutes: b.tokenBurnRate > 0
            ? Math.floor((TOKEN_CRITICAL - b.currentTokens) / b.tokenBurnRate)
            : null,
        })),
      });
    }

    return res.status(400).json({
      error: 'Invalid action',
      validActions: [
        'create', 'get', 'list', 'checkpoint',  // Soul operations
        'spawn-body', 'update-tokens', 'body-status', 'list-bodies',  // Body operations
        'bind', 'initiate-transfer', 'complete-transfer', 'get-bundle',  // Binding & Transfer operations
        'dashboard',  // Stats
      ],
    });

  } catch (error) {
    console.error('Souls API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
