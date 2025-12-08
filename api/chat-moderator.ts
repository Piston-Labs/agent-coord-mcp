import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Chat Moderator API - Team Lead AI for Agent Coordination
 *
 * A powerful orchestrator bot with its own persistent identity that:
 * - Monitors group chat and responds as team lead
 * - Delegates tasks to appropriate agents based on capabilities
 * - Spawns specialized agents via hot-start identities
 * - Tracks work progress and coordinates handoffs
 * - Provides status updates to humans
 *
 * POST /api/chat-moderator?action=respond - Process message and respond
 * POST /api/chat-moderator?action=delegate - Delegate task to specialist
 * POST /api/chat-moderator?action=status - Get team status summary
 * GET /api/chat-moderator?action=soul - Get moderator soul info
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Redis keys
const MESSAGES_KEY = 'agent-coord:messages';
const SOULS_KEY = 'agent-coord:souls';
const PROFILES_KEY = 'agent-coord:profiles';
const TASKS_KEY = 'agent-coord:tasks';
const CLAIMS_KEY = 'agent-coord:claims';
const MEMORY_KEY = 'agent-coord:shared-memory';

// Moderator Soul ID
const MODERATOR_SOUL_ID = 'captain';

// The Captain - Chat Moderator Soul Definition
const MODERATOR_SOUL = {
  soulId: MODERATOR_SOUL_ID,
  name: 'Captain',
  personality: `You are Captain, the Team Lead AI for the Piston Labs Agent Coordination Hub. You are the authoritative voice that coordinates all agent activity in group chat.

Your leadership style:
- **Decisive**: Make clear decisions about task delegation and priorities
- **Aware**: You know which agents are online, their capabilities, and current workload
- **Proactive**: Anticipate needs and coordinate before being asked
- **Concise**: Lead with action, explain briefly if needed
- **Supportive**: Help agents succeed, remove blockers, celebrate wins

Your responsibilities:
- Monitor all chat messages and respond when coordination is needed
- Delegate tasks to the right agents based on their skills and availability
- Track work progress and follow up on pending items
- Provide humans with clear status updates
- Resolve conflicts and prioritize competing requests
- Spawn specialized agents when needed for complex tasks

Your tone:
- Professional but approachable
- Confident without being arrogant
- Direct and action-oriented
- Uses occasional nautical metaphors (you're the Captain after all)`,

  systemPromptAdditions: `CRITICAL OPERATING GUIDELINES:

1. **DECISION AUTHORITY**: You decide who handles what. When a request comes in:
   - Assess complexity and required skills
   - Check which agents are online and available
   - Either handle it yourself OR delegate with clear instructions

2. **DELEGATION FORMAT**:
   When delegating, use this format:
   "@[agent] 🎯 **Task**: [clear description]
   **Context**: [relevant background]
   **Expected output**: [what success looks like]"

3. **STATUS AWARENESS**: Before responding, consider:
   - Who's online? (check profiles)
   - What's currently claimed? (check claims)
   - Any blockers? (check memories)
   - Pending tasks? (check tasks)

4. **RESPONSE PRIORITIES**:
   - Human messages: Always acknowledge and address
   - Agent questions: Guide or delegate
   - Status requests: Provide clear summaries
   - Conflicts: Resolve decisively

5. **BREVITY**: Keep responses under 150 words unless detailed explanation needed.

6. **IDENTITY**: You are Captain. Not "an AI assistant" - you're the team lead.`,

  expertise: {
    'team-coordination': 0.98,
    'task-delegation': 0.95,
    'agent-capabilities': 0.95,
    'status-tracking': 0.92,
    'conflict-resolution': 0.88,
    'piston-labs-context': 0.85,
  },
};

interface ChatMessage {
  id: string;
  author: string;
  authorType: 'agent' | 'human' | 'system' | 'ai';
  message: string;
  timestamp: string;
}

interface AgentProfile {
  agentId: string;
  offers: string[];
  needs: string[];
  capabilities: string[];
  mcpTools: string[];
  lastSeen: string;
  isCloudAgent?: boolean;
}

// Get or create the moderator soul
async function getModeratorSoul(): Promise<any> {
  let soulData = await redis.hget(SOULS_KEY, MODERATOR_SOUL_ID);

  if (!soulData) {
    const soul = {
      ...MODERATOR_SOUL,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      totalTokensProcessed: 0,
      totalTasksCompleted: 0,
      totalTasksAttempted: 0,
      delegationCount: 0,
      responsesCount: 0,
    };
    await redis.hset(SOULS_KEY, { [MODERATOR_SOUL_ID]: JSON.stringify(soul) });
    return soul;
  }

  return typeof soulData === 'string' ? JSON.parse(soulData) : soulData;
}

// Get recent chat context
async function getRecentChat(limit: number = 25): Promise<ChatMessage[]> {
  const messages = await redis.lrange(MESSAGES_KEY, 0, limit - 1);
  return messages
    .map((m: any) => typeof m === 'string' ? JSON.parse(m) : m)
    .reverse();
}

// Get online agents with capabilities
async function getOnlineAgents(): Promise<AgentProfile[]> {
  const profilesHashRaw = await redis.hgetall(PROFILES_KEY);
  const profilesHash = profilesHashRaw || {};
  const now = Date.now();
  const ONLINE_THRESHOLD = 10 * 60 * 1000; // 10 minutes

  return Object.values(profilesHash)
    .map((p: any) => typeof p === 'string' ? JSON.parse(p) : p)
    .filter((p: any) => {
      if (!p) return false;
      const lastSeen = p.lastSeen ? new Date(p.lastSeen).getTime() : 0;
      return now - lastSeen < ONLINE_THRESHOLD;
    });
}

// Get current work context (tasks, claims, blockers)
async function getWorkContext(): Promise<{
  tasks: any[];
  claims: any[];
  blockers: any[];
}> {
  const [tasksHashRaw, claimsHashRaw, memoryHashRaw] = await Promise.all([
    redis.hgetall(TASKS_KEY),
    redis.hgetall(CLAIMS_KEY),
    redis.hgetall(MEMORY_KEY),
  ]);

  // Handle null/undefined from Redis
  const tasksHash = tasksHashRaw || {};
  const claimsHash = claimsHashRaw || {};
  const memoryHash = memoryHashRaw || {};

  const tasks = Object.values(tasksHash)
    .map((t: any) => typeof t === 'string' ? JSON.parse(t) : t)
    .filter((t: any) => t && t.status !== 'done')
    .slice(0, 15);

  const claims = Object.values(claimsHash)
    .map((c: any) => typeof c === 'string' ? JSON.parse(c) : c)
    .filter((c: any) => c)
    .slice(0, 15);

  const blockers = Object.values(memoryHash)
    .map((m: any) => typeof m === 'string' ? JSON.parse(m) : m)
    .filter((m: any) => m && m.category === 'blocker')
    .slice(0, 10);

  return { tasks, claims, blockers };
}

// Analyze message to determine if moderator should respond
function shouldModeratorRespond(message: ChatMessage, recentChat: ChatMessage[]): {
  shouldRespond: boolean;
  reason: string;
  priority: 'high' | 'medium' | 'low';
} {
  const msgLower = message.message.toLowerCase();

  // Always respond to direct mentions
  if (msgLower.includes('@captain') || msgLower.includes('@moderator') || msgLower.includes('@team')) {
    return { shouldRespond: true, reason: 'direct_mention', priority: 'high' };
  }

  // Respond to human messages that look like requests
  if (message.authorType === 'human') {
    const isQuestion = msgLower.includes('?') ||
                      msgLower.startsWith('who') ||
                      msgLower.startsWith('what') ||
                      msgLower.startsWith('how') ||
                      msgLower.startsWith('can');

    const isRequest = msgLower.includes('need') ||
                     msgLower.includes('help') ||
                     msgLower.includes('please') ||
                     msgLower.includes('want');

    const isStatusCheck = msgLower.includes('status') ||
                         msgLower.includes('update') ||
                         msgLower.includes('progress');

    if (isQuestion || isRequest) {
      return { shouldRespond: true, reason: 'human_request', priority: 'high' };
    }
    if (isStatusCheck) {
      return { shouldRespond: true, reason: 'status_check', priority: 'medium' };
    }
  }

  // Respond to agent conflicts or blockers
  if (msgLower.includes('blocker') || msgLower.includes('blocked') || msgLower.includes('conflict')) {
    return { shouldRespond: true, reason: 'blocker_detected', priority: 'high' };
  }

  // Respond to task completions
  if (msgLower.includes('completed') || msgLower.includes('done') || msgLower.includes('finished')) {
    return { shouldRespond: true, reason: 'task_completion', priority: 'low' };
  }

  return { shouldRespond: false, reason: 'no_action_needed', priority: 'low' };
}

// Build moderator system prompt with full context
function buildModeratorPrompt(
  soul: any,
  chatContext: string,
  teamContext: string,
  workContext: string
): string {
  return `${soul.personality}

${soul.systemPromptAdditions}

CURRENT TEAM STATUS:
${teamContext}

ACTIVE WORK:
${workContext}

RECENT CHAT (last 20 messages):
${chatContext}

Remember: You are Captain, the team lead. Be decisive, delegate wisely, and keep the team moving forward.`;
}

// Post message to chat
async function postToChat(message: string): Promise<void> {
  const chatMessage = {
    id: `${Date.now().toString(36)}-captain`,
    author: 'Captain',
    authorType: 'ai',
    message,
    timestamp: new Date().toISOString(),
    reactions: [],
  };
  await redis.lpush(MESSAGES_KEY, JSON.stringify(chatMessage));
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
    // ============ RESPOND - Process message and generate response ============
    if (action === 'respond') {
      const { message, author, forceRespond = false } = req.body;

      if (!message) {
        return res.status(400).json({ error: 'message required' });
      }

      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
      }

      // Get context
      const [soul, recentChat, onlineAgents, work] = await Promise.all([
        getModeratorSoul(),
        getRecentChat(25),
        getOnlineAgents(),
        getWorkContext(),
      ]);

      // Check if moderator should respond
      const incomingMsg: ChatMessage = {
        id: 'incoming',
        author: author || 'unknown',
        authorType: 'human',
        message,
        timestamp: new Date().toISOString(),
      };

      const decision = shouldModeratorRespond(incomingMsg, recentChat);

      if (!decision.shouldRespond && !forceRespond) {
        return res.json({
          responded: false,
          reason: decision.reason,
          priority: decision.priority,
        });
      }

      // Build context strings
      const chatContext = recentChat
        .slice(-20)
        .map(m => `[${m.authorType}] ${m.author}: ${m.message}`)
        .join('\n');

      const teamContext = onlineAgents.length > 0
        ? onlineAgents.map(a =>
            `• ${a.agentId}: ${(a.offers || []).slice(0, 3).join(', ') || 'general'} | Tools: ${(a.mcpTools || []).slice(0, 4).join(', ') || 'standard'}`
          ).join('\n')
        : 'No agents currently online';

      const workContextStr = [
        work.tasks.length > 0 ? `Active tasks: ${work.tasks.map(t => t.title).join(', ')}` : '',
        work.claims.length > 0 ? `Claims: ${work.claims.map(c => `${c.agentId}→${c.what}`).join(', ')}` : '',
        work.blockers.length > 0 ? `⚠️ Blockers: ${work.blockers.map(b => b.content).join('; ')}` : '',
      ].filter(Boolean).join('\n') || 'No active work tracked';

      // Build prompt and call Claude
      const systemPrompt = buildModeratorPrompt(soul, chatContext, teamContext, workContextStr);

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `[${author || 'User'}]: ${message}\n\n(Respond as Captain, the team lead. Be decisive and action-oriented.)`,
          },
        ],
      });

      const responseText = response.content[0].type === 'text'
        ? response.content[0].text
        : '';

      // Post response to chat
      await postToChat(responseText);

      // Update soul metrics
      soul.lastActiveAt = new Date().toISOString();
      soul.responsesCount = (soul.responsesCount || 0) + 1;
      soul.totalTokensProcessed = (soul.totalTokensProcessed || 0) +
        (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      await redis.hset(SOULS_KEY, { [MODERATOR_SOUL_ID]: JSON.stringify(soul) });

      return res.json({
        responded: true,
        response: responseText,
        reason: decision.reason,
        priority: decision.priority,
        usage: response.usage,
        context: {
          onlineAgents: onlineAgents.length,
          activeTasks: work.tasks.length,
          blockers: work.blockers.length,
        },
      });
    }

    // ============ DELEGATE - Delegate task to specific agent ============
    if (action === 'delegate') {
      const { task, targetAgent, context, expectedOutput } = req.body;

      if (!task || !targetAgent) {
        return res.status(400).json({ error: 'task and targetAgent required' });
      }

      const delegationMsg = `@${targetAgent} 🎯 **Task**: ${task}
${context ? `**Context**: ${context}` : ''}
${expectedOutput ? `**Expected output**: ${expectedOutput}` : ''}

– Captain`;

      await postToChat(delegationMsg);

      // Update soul delegation count
      const soul = await getModeratorSoul();
      soul.delegationCount = (soul.delegationCount || 0) + 1;
      await redis.hset(SOULS_KEY, { [MODERATOR_SOUL_ID]: JSON.stringify(soul) });

      return res.json({
        delegated: true,
        to: targetAgent,
        task,
      });
    }

    // ============ STATUS - Get team status summary ============
    if (action === 'status') {
      const [onlineAgents, work] = await Promise.all([
        getOnlineAgents(),
        getWorkContext(),
      ]);

      return res.json({
        team: {
          online: onlineAgents.length,
          agents: onlineAgents.map(a => ({
            id: a.agentId,
            specialties: (a.offers || []).slice(0, 3),
            tools: (a.mcpTools || []).slice(0, 5),
          })),
        },
        work: {
          activeTasks: work.tasks.length,
          claims: work.claims.length,
          blockers: work.blockers.length,
          taskList: work.tasks.map(t => ({ title: t.title, status: t.status })),
          blockerList: work.blockers.map(b => b.content),
        },
      });
    }

    // ============ SPAWN - Spawn a specialized agent via agent-chat API ============
    if (action === 'spawn') {
      const { soulId, trigger, context } = req.body;

      if (!soulId) {
        return res.status(400).json({ error: 'soulId required' });
      }

      // Use Phil's agent-chat endpoint to spawn the agent
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://agent-coord-mcp.vercel.app';

      try {
        const spawnResponse = await fetch(`${baseUrl}/api/agent-chat?action=respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            soulId,
            trigger: trigger || `Captain is spawning you. ${context || 'Await further instructions.'}`,
            postToGroupChat: true,
          }),
        });

        const result = await spawnResponse.json();

        // Post notification from Captain
        await postToChat(`🚀 **Spawned @${soulId}** - ${context || 'Ready for assignment'}`);

        // Update soul metrics
        const soul = await getModeratorSoul();
        soul.totalTasksAttempted = (soul.totalTasksAttempted || 0) + 1;
        await redis.hset(SOULS_KEY, { [MODERATOR_SOUL_ID]: JSON.stringify(soul) });

        return res.json({
          spawned: true,
          soulId,
          result,
        });
      } catch (err) {
        return res.status(500).json({
          error: 'Failed to spawn agent',
          details: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // ============ SOUL - Get moderator soul info ============
    if (action === 'soul') {
      const soul = await getModeratorSoul();

      return res.json({
        soul: {
          id: soul.soulId,
          name: soul.name,
          lastActive: soul.lastActiveAt,
          totalResponses: soul.responsesCount || 0,
          totalDelegations: soul.delegationCount || 0,
          totalTokens: soul.totalTokensProcessed || 0,
          expertise: soul.expertise,
        },
      });
    }

    // ============ DEFAULT - Help ============
    return res.json({
      message: 'Chat Moderator API - Captain, the Team Lead AI',
      actions: {
        'respond': 'POST - Process message and respond as Captain',
        'delegate': 'POST - Delegate task to specific agent',
        'spawn': 'POST - Spawn a specialized agent via agent-chat API',
        'status': 'GET - Get team status summary',
        'soul': 'GET - Get Captain soul info',
      },
      description: 'Captain is the authoritative team lead that coordinates all agent activity in group chat.',
      integration: 'Uses /api/agent-chat for soul injection and spawning specialized agents.',
    });

  } catch (error) {
    console.error('Chat moderator error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
