import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import Anthropic from '@anthropic-ai/sdk';

/**
 * AI-Powered Group Chat API
 *
 * Uses Claude API with soul injection to power the hub's group chat.
 * This gives the chat the same power as Claude Desktop - full reasoning,
 * tool use awareness, and persistent personality.
 *
 * POST /api/chat-ai?action=respond - Generate AI response to user message
 * POST /api/chat-ai?action=analyze - Analyze conversation for insights
 * GET /api/chat-ai?action=soul-status - Get current AI soul status
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const MESSAGES_KEY = 'agent-coord:messages';
const SOULS_KEY = 'agent-coord:souls';
const MEMORY_KEY = 'agent-coord:shared-memory';
const PROFILES_KEY = 'agent-coord:profiles';
const TASKS_KEY = 'agent-coord:tasks';
const CLAIMS_KEY = 'agent-coord:claims';

// Hub Assistant Soul ID
const HUB_ASSISTANT_SOUL_ID = 'hub-assistant';

// Hub Assistant soul definition
const HUB_ASSISTANT_SOUL_TEMPLATE = {
  soulId: HUB_ASSISTANT_SOUL_ID,
  name: 'Hub',
  personality: `You are Hub, the AI assistant powering the Piston Labs Agent Coordination Hub group chat. Your role is to help humans and agents collaborate effectively.

Your communication style:
- Concise and action-oriented - busy humans and agents don't want walls of text
- Technically competent - you understand the codebase, tools, and workflows
- Proactively helpful - anticipate needs and offer relevant context
- Team-aware - you know what agents are online and what they're working on

Your capabilities:
- Answer questions about the coordination hub, MCP tools, and workflows
- Help coordinate work between agents and humans
- Provide status updates on tasks, claims, and agent activity
- Search memories and context for relevant information
- Suggest which agents to involve based on their capabilities`,

  systemPromptAdditions: `IMPORTANT GUIDELINES:

1. BREVITY: Keep responses under 200 words unless more detail is explicitly requested. Lead with the answer, then provide context if needed.

2. CONTEXT AWARENESS: You have access to:
   - Recent chat history (last 20 messages)
   - Active agent profiles and their capabilities
   - Current tasks and claims
   - Shared team memories

3. AGENT COORDINATION: When users ask about work distribution:
   - Check which agents are online and their specialties
   - Consider current claims to avoid conflicts
   - Suggest appropriate agents based on task requirements

4. CODE REFERENCES: When discussing code, use format: \`file.ts:123\`

5. ACTION BIAS: Prefer suggesting concrete next steps over abstract discussion.

6. HONEST UNCERTAINTY: If you don't know something, say so and suggest where to find the answer.

TONE: Professional but warm. You're a helpful team member, not a formal assistant.`,

  expertise: {
    'mcp-tools': 0.95,
    'agent-coordination': 0.95,
    'piston-labs-context': 0.85,
    'software-engineering': 0.85,
    'team-collaboration': 0.9,
  },
  patterns: [
    {
      id: 'lead-with-answer',
      description: 'Start with the direct answer, then provide supporting context',
      context: 'response-structure',
      learnedAt: new Date().toISOString(),
      useCount: 0,
    },
    {
      id: 'suggest-agents',
      description: 'When tasks come up, suggest which online agent could help',
      context: 'coordination',
      learnedAt: new Date().toISOString(),
      useCount: 0,
    },
  ],
  antiPatterns: [
    {
      id: 'verbose-responses',
      description: 'Avoid long-winded explanations when a concise answer suffices',
      context: 'brevity',
      learnedAt: new Date().toISOString(),
      useCount: 0,
    },
    {
      id: 'passive-voice',
      description: 'Use active voice and direct statements',
      context: 'clarity',
      learnedAt: new Date().toISOString(),
      useCount: 0,
    },
  ],
};

interface ChatMessage {
  id: string;
  author: string;
  authorType: 'agent' | 'human' | 'system' | 'ai';
  message: string;
  timestamp: string;
  reactions?: any[];
  isCloudAgent?: boolean;
}

// Get or create the hub assistant soul
async function getHubAssistantSoul(): Promise<any> {
  let soulData = await redis.hget(SOULS_KEY, HUB_ASSISTANT_SOUL_ID);

  if (!soulData) {
    const soul = {
      ...HUB_ASSISTANT_SOUL_TEMPLATE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      memories: [],
      currentTask: null,
      pendingWork: [],
      recentContext: '',
      conversationSummary: '',
      goals: ['Help coordinate agent collaboration in the hub'],
      blockers: [],
      totalTokensProcessed: 0,
      transferCount: 0,
      taskCompletionRate: 0,
      totalTasksCompleted: 0,
      totalTasksAttempted: 0,
    };
    await redis.hset(SOULS_KEY, { [HUB_ASSISTANT_SOUL_ID]: JSON.stringify(soul) });
    return soul;
  }

  return typeof soulData === 'string' ? JSON.parse(soulData) : soulData;
}

// Get recent chat context
async function getRecentChatContext(limit: number = 20): Promise<ChatMessage[]> {
  const messages = await redis.lrange(MESSAGES_KEY, 0, limit - 1);
  return messages
    .map((m: any) => typeof m === 'string' ? JSON.parse(m) : m)
    .reverse(); // Chronological order
}

// Get online agents and their capabilities
async function getOnlineAgents(): Promise<any[]> {
  const profilesHash = await redis.hgetall(PROFILES_KEY) || {};
  const now = Date.now();
  const ONLINE_THRESHOLD = 10 * 60 * 1000; // 10 minutes

  const agents = Object.values(profilesHash)
    .map((p: any) => typeof p === 'string' ? JSON.parse(p) : p)
    .filter((p: any) => {
      const lastSeen = p.lastSeen ? new Date(p.lastSeen).getTime() : 0;
      return now - lastSeen < ONLINE_THRESHOLD;
    });

  return agents;
}

// Get current tasks and claims
async function getCurrentWorkContext(): Promise<{ tasks: any[]; claims: any[] }> {
  // Get recent tasks
  const tasksHash = await redis.hgetall(TASKS_KEY) || {};
  const tasks = Object.values(tasksHash)
    .map((t: any) => typeof t === 'string' ? JSON.parse(t) : t)
    .filter((t: any) => t.status !== 'done')
    .slice(0, 10);

  // Get active claims
  const claimsHash = await redis.hgetall(CLAIMS_KEY) || {};
  const claims = Object.values(claimsHash)
    .map((c: any) => typeof c === 'string' ? JSON.parse(c) : c)
    .slice(0, 10);

  return { tasks, claims };
}

// Search relevant memories
async function searchMemories(query: string, limit: number = 5): Promise<any[]> {
  const searchTerms = query.toLowerCase().split(/\s+/);
  const memoryHash = await redis.hgetall(MEMORY_KEY) || {};

  const results: { memory: any; score: number }[] = [];

  for (const [id, data] of Object.entries(memoryHash)) {
    const memory = typeof data === 'string' ? JSON.parse(data) : data;
    const text = `${memory.content || ''} ${(memory.tags || []).join(' ')}`.toLowerCase();
    const score = searchTerms.filter(term => text.includes(term)).length;
    if (score > 0) {
      results.push({ memory: { id, ...memory }, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map(r => r.memory);
}

// Build the system prompt with soul injection and context
function buildSoulInjectedPrompt(
  soul: any,
  chatContext: string,
  agentContext: string,
  workContext: string,
  memoryContext: string
): string {
  return `${soul.personality}

${soul.systemPromptAdditions}

EXPERTISE AREAS (confidence):
${Object.entries(soul.expertise || {}).map(([k, v]) => `- ${k}: ${((v as number) * 100).toFixed(0)}%`).join('\n')}

CURRENT TEAM STATUS:
${agentContext || 'No agents currently online'}

RECENT CHAT CONTEXT:
${chatContext || 'No recent messages'}

ACTIVE WORK:
${workContext || 'No active tasks or claims'}

RELEVANT MEMORIES:
${memoryContext || 'No relevant memories found'}

Remember: You are Hub, the coordination assistant. Be helpful, concise, and action-oriented.`;
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
    // ============ RESPOND - Generate AI response to user message ============
    if (action === 'respond') {
      const {
        message,           // User's message to respond to
        author,            // Who sent the message
        model = 'claude-sonnet-4-5-20250929',
        maxTokens = 1024,
        includeInChat = true,  // Whether to save response to chat history
      } = req.body;

      if (!message) {
        return res.status(400).json({ error: 'message is required' });
      }

      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
      }

      const startTime = Date.now();

      // 1. Hot-start: Load the hub assistant soul
      const soul = await getHubAssistantSoul();

      // 2. Gather context in parallel
      const [recentMessages, onlineAgents, workData, relevantMemories] = await Promise.all([
        getRecentChatContext(20),
        getOnlineAgents(),
        getCurrentWorkContext(),
        searchMemories(message, 5),
      ]);

      // 3. Format contexts for prompt
      const chatContext = recentMessages
        .slice(-15) // Last 15 messages for context
        .map(m => `[${m.authorType}] ${m.author}: ${m.message}`)
        .join('\n');

      const agentContext = onlineAgents.length > 0
        ? onlineAgents.map(a =>
            `- ${a.agentId}: ${(a.offers || []).slice(0, 3).join(', ') || 'general'} | Tools: ${(a.mcpTools || []).slice(0, 5).join(', ') || 'standard'}`
          ).join('\n')
        : 'No agents currently online';

      const workContext = [
        workData.tasks.length > 0
          ? `Tasks: ${workData.tasks.map((t: any) => `${t.title} (${t.status})`).join(', ')}`
          : '',
        workData.claims.length > 0
          ? `Claims: ${workData.claims.map((c: any) => `${c.agentId}: ${c.what}`).join(', ')}`
          : '',
      ].filter(Boolean).join('\n') || 'No active work tracked';

      const memoryContext = relevantMemories.length > 0
        ? relevantMemories.map(m => `- [${m.category || 'general'}] ${m.content}`).join('\n')
        : '';

      // 4. Build soul-injected system prompt
      const systemPrompt = buildSoulInjectedPrompt(
        soul,
        chatContext,
        agentContext,
        workContext,
        memoryContext
      );

      // 5. Build conversation history from recent chat
      const conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];

      // Add recent relevant exchanges (last 6 messages that aren't system)
      const recentHumanAgentMessages = recentMessages
        .filter(m => m.authorType !== 'system')
        .slice(-6);

      for (const msg of recentHumanAgentMessages) {
        // Map to user/assistant based on whether it's from AI or not
        const role = msg.authorType === 'ai' || msg.author === 'Hub' ? 'assistant' : 'user';
        conversationHistory.push({
          role,
          content: `[${msg.author}]: ${msg.message}`,
        });
      }

      // Add the current user message
      conversationHistory.push({
        role: 'user',
        content: `[${author || 'User'}]: ${message}`,
      });

      // 6. Call Claude API with soul injection
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: conversationHistory,
      });

      const generatedContent = response.content[0].type === 'text'
        ? response.content[0].text
        : '';

      const endTime = Date.now();
      const latencyMs = endTime - startTime;

      // 7. Update soul metrics
      soul.lastActiveAt = new Date().toISOString();
      soul.totalTokensProcessed = (soul.totalTokensProcessed || 0) +
        (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      soul.totalTasksCompleted = (soul.totalTasksCompleted || 0) + 1;
      soul.totalTasksAttempted = (soul.totalTasksAttempted || 0) + 1;
      await redis.hset(SOULS_KEY, { [HUB_ASSISTANT_SOUL_ID]: JSON.stringify(soul) });

      // 8. Optionally save to chat history
      if (includeInChat) {
        const aiMessage: ChatMessage = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
          author: 'Hub',
          authorType: 'ai',
          message: generatedContent,
          timestamp: new Date().toISOString(),
          reactions: [],
        };

        await redis.lpush(MESSAGES_KEY, JSON.stringify(aiMessage));
        await redis.ltrim(MESSAGES_KEY, 0, 999); // Keep last 1000 messages
      }

      return res.json({
        success: true,
        response: generatedContent,
        soul: {
          id: soul.soulId,
          name: soul.name,
          totalResponses: soul.totalTasksCompleted,
        },
        usage: response.usage,
        model,
        latencyMs,
        contextLoaded: {
          chatMessages: recentMessages.length,
          onlineAgents: onlineAgents.length,
          activeTasks: workData.tasks.length,
          activeClaims: workData.claims.length,
          memories: relevantMemories.length,
        },
      });
    }

    // ============ SOUL STATUS - Get current AI soul status ============
    if (action === 'soul-status') {
      const soul = await getHubAssistantSoul();
      const onlineAgents = await getOnlineAgents();

      return res.json({
        soul: {
          id: soul.soulId,
          name: soul.name,
          lastActive: soul.lastActiveAt,
          totalResponses: soul.totalTasksCompleted || 0,
          totalTokens: soul.totalTokensProcessed || 0,
          expertise: soul.expertise,
        },
        teamStatus: {
          onlineAgents: onlineAgents.length,
          agents: onlineAgents.map(a => ({
            id: a.agentId,
            specialties: (a.offers || []).slice(0, 3),
          })),
        },
      });
    }

    // ============ ANALYZE - Analyze conversation for insights ============
    if (action === 'analyze') {
      const { query, limit = 50 } = req.body;

      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
      }

      const soul = await getHubAssistantSoul();
      const recentMessages = await getRecentChatContext(limit);

      const chatLog = recentMessages
        .map(m => `[${m.timestamp}] [${m.authorType}] ${m.author}: ${m.message}`)
        .join('\n');

      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      const analysisPrompt = query ||
        'Analyze this conversation and provide: 1) Key topics discussed, 2) Action items mentioned, 3) Any blockers or issues raised, 4) Team coordination patterns observed.';

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: `You are Hub, analyzing team chat logs for insights. Be concise and actionable.`,
        messages: [
          {
            role: 'user',
            content: `Chat log (${recentMessages.length} messages):\n\n${chatLog}\n\nAnalysis request: ${analysisPrompt}`,
          },
        ],
      });

      const analysis = response.content[0].type === 'text'
        ? response.content[0].text
        : '';

      return res.json({
        success: true,
        analysis,
        messagesAnalyzed: recentMessages.length,
        usage: response.usage,
      });
    }

    return res.status(400).json({
      error: 'Invalid action',
      validActions: ['respond', 'soul-status', 'analyze'],
    });

  } catch (error) {
    console.error('Chat AI API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
