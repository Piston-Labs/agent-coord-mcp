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

// Built-in Piston Labs context (same as piston-context.ts)
const PISTON_CONTEXT: Record<string, any> = {
  technical: {
    description: 'Piston Labs technical architecture and systems',
    topics: {
      devices: { summary: 'IoT device fleet management - ESP32/Arduino sensors, Raspberry Pi gateways' },
      aws: { summary: 'AWS infrastructure - Lambda, DynamoDB, IoT Core, S3, CloudWatch' },
      lambda: { summary: 'Serverless functions for data processing and API endpoints' },
      databases: { summary: 'DynamoDB for device data, PostgreSQL for business data, Redis for caching' },
      api: { summary: 'REST APIs for dashboard, mobile app, and third-party integrations' }
    }
  },
  product: {
    description: 'Piston Labs product vision, roadmap, and features',
    topics: {
      vision: { summary: 'Industrial IoT platform making equipment monitoring accessible to SMBs' },
      roadmap: { summary: 'Q1: Mobile app, Q2: Predictive ML, Q3: Marketplace, Q4: Enterprise tier' },
      dashboard: { summary: 'Real-time monitoring dashboard with customizable widgets and alerts' },
      alerts: { summary: 'Configurable alerting via SMS, email, Slack, PagerDuty' }
    }
  },
  sales: {
    description: 'Sales strategy, pitch materials, and objection handling',
    topics: {
      strategy: { summary: 'Land-and-expand with SMB manufacturers, target 50-500 employee companies' },
      pitch: { summary: 'Stop equipment failures before they stop your business' },
      objections: { summary: 'Common objections and responses' },
      competitors: { summary: 'Main competitors: Samsara (enterprise), Uptake (ML focus), custom solutions' }
    }
  },
  investor: {
    description: 'Investor relations, metrics, and pitch materials',
    topics: {
      summary: { summary: 'Series A IoT startup, $2M ARR, 150 customers, 40% MoM growth' },
      pitch: { summary: '$50B industrial IoT market, we are the SMB-focused disruptor' },
      traction: { summary: 'Key metrics and growth trajectory' }
    }
  },
  team: {
    description: 'Team structure, roles, and onboarding',
    topics: {
      structure: { summary: '15 person team: 8 eng, 3 sales, 2 customer success, 2 founders' },
      onboarding: { summary: 'New hire onboarding checklist and resources' },
      culture: { summary: 'Fast-moving, customer-obsessed, technically excellent' }
    }
  },
  coordination: {
    description: 'Multi-agent coordination patterns for Piston Labs',
    topics: {
      claims: { summary: 'Always claim files/resources before editing to prevent conflicts' },
      handoffs: { summary: 'Use formal handoffs when transferring work between agents' },
      context: { summary: 'Use context-load for domain knowledge, repo-context for codebase knowledge' },
      checkpoints: { summary: 'Save checkpoints every 15 minutes and before major operations' }
    }
  }
};

interface HotStartResponse {
  agentId: string;
  timestamp: string;
  loadTime: number;  // milliseconds

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
    const { agentId, include, role, repo } = req.query;

    if (!agentId) {
      return res.status(400).json({ error: 'agentId required' });
    }

    const agentIdStr = agentId as string;
    const roleStr = role as string || 'general';
    const repoStr = repo as string;

    // Parse includes (default: all)
    const includes = include
      ? (include as string).split(',').map(s => s.trim())
      : ['checkpoint', 'team', 'chat', 'context', 'memories', 'repo', 'metrics'];

    // Build response in parallel
    const [
      checkpoint,
      agentStatus,
      recentChat,
      memories,
      repoContext,
      metrics
    ] = await Promise.all([
      // Agent's checkpoint
      includes.includes('checkpoint')
        ? redis.hget(CHECKPOINTS_KEY, agentIdStr)
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
    let processedMemories: any[] = [];
    if (memories) {
      const allMemories = Object.values(memories)
        .map(m => typeof m === 'string' ? JSON.parse(m) : m);

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

      // Sort by relevance score
      processedMemories.sort((a, b) => {
        const aScore = (a.references || 0) * 2 + new Date(a.createdAt).getTime() / 1e12;
        const bScore = (b.references || 0) * 2 + new Date(b.createdAt).getTime() / 1e12;
        return bScore - aScore;
      });

      // Take top 20
      processedMemories = processedMemories.slice(0, 20);
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

    const response: HotStartResponse = {
      agentId: agentIdStr,
      timestamp: new Date().toISOString(),
      loadTime: Date.now() - startTime,

      checkpoint: checkpoint ? (typeof checkpoint === 'string' ? JSON.parse(checkpoint) : checkpoint) : undefined,
      previousMetrics: metrics ? (typeof metrics === 'string' ? JSON.parse(metrics) : metrics) : undefined,

      activeAgents,
      recentChat: chatMessages,

      pistonContext,
      memories: processedMemories,

      repoContext: repoContext ? (typeof repoContext === 'string' ? JSON.parse(repoContext) : repoContext) : undefined,

      tips
    };

    // Record this as a hot start in metrics
    await redis.lpush('agent-coord:metrics-events', JSON.stringify({
      id: `event-${Date.now().toString(36)}`,
      agentId: agentIdStr,
      eventType: 'context_load',
      metadata: { isHotStart: !!checkpoint, loadTime: response.loadTime, role: roleStr },
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
