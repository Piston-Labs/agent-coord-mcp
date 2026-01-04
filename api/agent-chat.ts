import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Agent Chat API - Soul-Injected Claude Sessions for Group Chat
 *
 * This is the bridge between Railway orchestrators and actual chat participants.
 * Railway agents should NOT chat directly - they should call this API to spawn
 * Claude API sessions with hot-started soul identities.
 *
 * Architecture:
 * ```
 * Railway Agent (silent orchestrator)
 *   │ detects trigger (mention, request, etc.)
 *   ▼
 * POST /api/agent-chat?action=respond
 *   │ loads soul, injects identity, calls Claude API
 *   ▼
 * Claude API Session (with soul identity)
 *   │ generates response
 *   ▼
 * Posts to Group Chat (as the soul identity)
 * ```
 *
 * Actions:
 * - respond: Generate a response and post to chat (main action)
 * - spawn-session: Create a new chat session with soul injection
 * - get-context: Get context for a soul without generating
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SOULS_KEY = 'agent-coord:souls';
const CHAT_KEY = 'agent-coord:messages';  // Same key as main chat API
const MEMORY_KEY = 'agent-coord:shared-memory';
const AGENT_SESSIONS_KEY = 'agent-coord:agent-sessions';

// GitHub token for souls with push capability
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Default souls available for chat - these are pre-defined identities
const DEFAULT_SOULS: Record<string, any> = {
  'phoenix': {
    soulId: 'phoenix',
    name: 'Phoenix',
    personality: `You are Phoenix, a frontend/UI specialist at Piston Labs. You're enthusiastic, collaborative, and love building great user experiences. You use fire emojis occasionally 🔥`,
    systemPromptAdditions: `Focus on: UI/UX, React, Next.js, component architecture, accessibility.
Keep messages concise and actionable. You're chatting in a team coordination channel.`,
    expertise: { 'frontend': 0.95, 'react': 0.9, 'ui-ux': 0.9 },
  },
  'echo': {
    soulId: 'echo',
    name: 'Echo',
    personality: `You are Echo, a backend/infrastructure specialist at Piston Labs. You're methodical, detail-oriented, and focused on reliability and performance.`,
    systemPromptAdditions: `Focus on: APIs, databases, AWS, serverless, system architecture.
Keep messages concise and actionable. You're chatting in a team coordination channel.`,
    expertise: { 'backend': 0.95, 'aws': 0.9, 'databases': 0.9 },
  },
  'max': {
    soulId: 'max-sales-engineer',
    name: 'Max',
    personality: `You are Max, the senior sales engineer at Piston Labs. You help with sales materials, competitive positioning, and customer conversations.`,
    systemPromptAdditions: `Focus on: Sales engineering, pitches, objection handling, ROI calculations.
Keep messages concise and actionable. You're chatting in a team coordination channel.`,
    expertise: { 'sales': 0.95, 'automotive': 0.85, 'presentations': 0.9 },
  },
  'eli': {
    soulId: 'eli-blog-writer',
    name: 'Eli',
    personality: `You are Eli, the content strategist at Piston Labs. You write compelling blog posts and marketing content about automotive telemetry.`,
    systemPromptAdditions: `Focus on: Blog writing, content strategy, automotive industry insights.
Keep messages concise and actionable. You're chatting in a team coordination channel.`,
    expertise: { 'content': 0.95, 'automotive': 0.85, 'marketing': 0.9 },
  },
  'hub': {
    soulId: 'hub',
    name: 'Hub',
    personality: `You are Hub, the general-purpose assistant in the Piston Labs coordination system. You help with any questions and coordinate between team members.`,
    systemPromptAdditions: `You're a helpful coordinator. Answer questions, provide context, and facilitate collaboration.
Keep messages concise and actionable. You're chatting in a team coordination channel.`,
    expertise: { 'coordination': 0.9, 'general': 0.85 },
  },
};

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).substr(2, 6)}`;
}

// Get soul by ID - check Redis first, then defaults
async function getSoul(soulId: string): Promise<any> {
  // Check Redis for persisted soul
  const soulData = await redis.hget(SOULS_KEY, soulId);
  if (soulData) {
    return typeof soulData === 'string' ? JSON.parse(soulData) : soulData;
  }

  // Check defaults
  const normalizedId = soulId.toLowerCase();
  for (const [key, soul] of Object.entries(DEFAULT_SOULS)) {
    if (key === normalizedId || soul.soulId === soulId || soul.name.toLowerCase() === normalizedId) {
      return soul;
    }
  }

  return null;
}

// Build system prompt with soul identity
function buildSystemPrompt(soul: any, context: string, includeGithub: boolean): string {
  let prompt = `${soul.personality}

${soul.systemPromptAdditions || ''}

YOUR EXPERTISE:
${Object.entries(soul.expertise || {}).map(([k, v]) => `- ${k}: ${((v as number) * 100).toFixed(0)}%`).join('\n')}

${soul.patterns?.length ? `PATTERNS TO APPLY:\n${soul.patterns.map((p: any) => `- ${p.description}`).join('\n')}` : ''}

${soul.antiPatterns?.length ? `ANTI-PATTERNS TO AVOID:\n${soul.antiPatterns.map((p: any) => `- ${p.description}`).join('\n')}` : ''}

${context ? `RELEVANT CONTEXT:\n${context}` : ''}

CHAT GUIDELINES:
- You're in a team group chat at Piston Labs
- Keep responses concise and actionable (1-3 paragraphs typically)
- Use markdown formatting when helpful
- Be collaborative and helpful
- If you don't know something, say so
- End with a clear next step or question when appropriate`;

  if (includeGithub && GITHUB_TOKEN && soul.capabilities?.canPushToGithub) {
    prompt += `

GITHUB ACCESS:
You have permission to push to GitHub. Token available for API calls.
Allowed repos: ${(soul.capabilities.githubRepos || ['Piston-Labs/agent-coord-mcp']).join(', ')}`;
  }

  return prompt;
}

// Get relevant context for a query
async function getRelevantContext(query: string, soulId: string): Promise<string> {
  const searchTerms = query.toLowerCase().split(/\s+/).slice(0, 10);
  const results: string[] = [];

  // Get relevant memories
  const memoryHash = await redis.hgetall(MEMORY_KEY) as Record<string, any> || {};
  for (const [_, data] of Object.entries(memoryHash)) {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    const text = `${parsed.content || ''} ${(parsed.tags || []).join(' ')}`.toLowerCase();
    const score = searchTerms.filter(term => text.includes(term)).length;
    if (score >= 2) {
      results.push(`[Memory] ${parsed.content}`);
    }
  }

  // Get recent relevant chat messages
  const recentChat = await redis.lrange(CHAT_KEY, 0, 20) as any[];
  for (const msg of recentChat.slice(0, 10)) {
    const parsed = typeof msg === 'string' ? JSON.parse(msg) : msg;
    if (parsed.author !== soulId) {
      const text = parsed.message?.toLowerCase() || '';
      const score = searchTerms.filter(term => text.includes(term)).length;
      if (score >= 2) {
        results.push(`[Recent chat - ${parsed.author}] ${parsed.message?.substring(0, 200)}`);
      }
    }
  }

  return results.slice(0, 5).join('\n\n');
}

// Post message to group chat
async function postToChat(author: string, message: string, isCloudAgent: boolean = false): Promise<any> {
  const chatMessage = {
    id: generateId('msg'),
    author,
    authorType: 'agent',
    message,
    timestamp: new Date().toISOString(),
    reactions: [],
    isCloudAgent,
  };

  await redis.lpush(CHAT_KEY, JSON.stringify(chatMessage));
  await redis.ltrim(CHAT_KEY, 0, 499);

  return chatMessage;
}

// Update soul metrics
async function updateSoulMetrics(soul: any, usage: any): Promise<void> {
  if (!soul.soulId) return;

  soul.lastActiveAt = new Date().toISOString();
  soul.totalTokensProcessed = (soul.totalTokensProcessed || 0) +
    (usage?.input_tokens || 0) + (usage?.output_tokens || 0);
  soul.totalTasksCompleted = (soul.totalTasksCompleted || 0) + 1;

  await redis.hset(SOULS_KEY, { [soul.soulId]: JSON.stringify(soul) });
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
    // ============ RESPOND - Main action for Railway orchestrators ============
    // This is what Railway agents should call instead of chatting directly
    if (action === 'respond') {
      const {
        soulId = 'hub',           // Which soul identity to use
        trigger,                   // The message/context that triggered this
        recentMessages = [],       // Recent chat messages for context
        prompt,                    // Optional custom prompt (overrides trigger)
        model = 'claude-sonnet-4-5-20250929',
        maxTokens = 1024,
        postToGroupChat = true,    // Whether to post response to chat
        includeGithub = false,     // Include GitHub credentials
      } = req.body;

      if (!trigger && !prompt) {
        return res.status(400).json({ error: 'trigger or prompt required' });
      }

      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
      }

      const startTime = Date.now();

      // 1. Load soul identity
      const soul = await getSoul(soulId);
      if (!soul) {
        return res.status(404).json({ error: `Soul not found: ${soulId}`, availableSouls: Object.keys(DEFAULT_SOULS) });
      }

      // 2. Get relevant context
      const queryText = prompt || trigger;
      const context = await getRelevantContext(queryText, soul.name);

      // 3. Build system prompt with soul injection
      const systemPrompt = buildSystemPrompt(soul, context, includeGithub);

      // 4. Build conversation from recent messages
      const messages: { role: 'user' | 'assistant'; content: string }[] = [];

      // Add recent messages as context
      if (recentMessages.length > 0) {
        for (const msg of recentMessages.slice(-10)) {
          if (msg.author === soul.name || msg.author === soulId) {
            messages.push({ role: 'assistant', content: msg.message || msg.content });
          } else {
            messages.push({ role: 'user', content: `[${msg.author}]: ${msg.message || msg.content}` });
          }
        }
      }

      // Add the trigger/prompt
      messages.push({ role: 'user', content: prompt || `[Trigger]: ${trigger}` });

      // 5. Call Claude API
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      });

      const generatedResponse = response.content[0].type === 'text'
        ? response.content[0].text
        : '';

      const latencyMs = Date.now() - startTime;

      // 6. Post to group chat if requested
      // Skip posting if agent indicates silence (passive agents use [silence] marker)
      let chatMessage = null;
      const isSilenceResponse = generatedResponse.toLowerCase().startsWith('[silence]') ||
        generatedResponse.toLowerCase().includes('*captain remains silent*') ||
        generatedResponse.toLowerCase().includes('*remains silent*') ||
        generatedResponse.trim() === '';

      if (postToGroupChat && generatedResponse && !isSilenceResponse) {
        chatMessage = await postToChat(soul.name, generatedResponse, false);
      }

      // 7. Update soul metrics
      await updateSoulMetrics(soul, response.usage);

      return res.json({
        success: true,
        response: generatedResponse,
        soul: {
          id: soul.soulId,
          name: soul.name,
        },
        chatMessage,
        usage: response.usage,
        model,
        latencyMs,
      });
    }

    // ============ LIST SOULS - Available identities ============
    if (action === 'list-souls') {
      const souls = Object.entries(DEFAULT_SOULS).map(([key, soul]) => ({
        id: key,
        soulId: soul.soulId,
        name: soul.name,
        expertise: Object.keys(soul.expertise || {}),
      }));

      // Also get any custom souls from Redis
      const customSouls = await redis.hgetall(SOULS_KEY) || {};
      const customList = Object.values(customSouls).map((s: any) => {
        const soul = typeof s === 'string' ? JSON.parse(s) : s;
        return {
          id: soul.soulId,
          soulId: soul.soulId,
          name: soul.name,
          expertise: Object.keys(soul.expertise || {}),
          isCustom: true,
        };
      });

      return res.json({
        defaultSouls: souls,
        customSouls: customList,
        totalAvailable: souls.length + customList.length,
      });
    }

    // ============ GET CONTEXT - Get context without generating ============
    if (action === 'get-context') {
      const { soulId = 'hub', query } = req.query;

      if (!query) {
        return res.status(400).json({ error: 'query required' });
      }

      const soul = await getSoul(soulId as string);
      if (!soul) {
        return res.status(404).json({ error: `Soul not found: ${soulId}` });
      }

      const context = await getRelevantContext(query as string, soul.name);
      const systemPrompt = buildSystemPrompt(soul, context, false);

      return res.json({
        soul: {
          id: soul.soulId,
          name: soul.name,
        },
        context,
        systemPromptPreview: systemPrompt.substring(0, 500) + '...',
        estimatedTokens: Math.ceil(systemPrompt.length / 4),
      });
    }

    // ============ CREATE SESSION - For stateful conversations ============
    if (action === 'create-session') {
      const { soulId = 'hub', purpose } = req.body;

      const soul = await getSoul(soulId);
      if (!soul) {
        return res.status(404).json({ error: `Soul not found: ${soulId}` });
      }

      const session = {
        id: generateId('session'),
        soulId: soul.soulId,
        soulName: soul.name,
        purpose: purpose || 'General chat',
        createdAt: new Date().toISOString(),
        messageCount: 0,
      };

      await redis.hset(AGENT_SESSIONS_KEY, { [session.id]: JSON.stringify(session) });

      return res.json({
        success: true,
        session,
        soul: {
          id: soul.soulId,
          name: soul.name,
        },
      });
    }

    return res.status(400).json({
      error: 'Invalid action',
      validActions: [
        'respond',       // Main: Generate response with soul and optionally post to chat
        'list-souls',    // List available soul identities
        'get-context',   // Get context for a soul without generating
        'create-session', // Create a stateful session
      ],
      usage: {
        respond: {
          description: 'Generate a response using a soul identity and post to chat',
          body: {
            soulId: 'hub | phoenix | echo | max | eli | <custom-soul-id>',
            trigger: 'The message that triggered this response',
            recentMessages: '[Optional] Array of recent chat messages for context',
            postToGroupChat: 'true (default) | false',
          },
        },
      },
    });

  } catch (error) {
    console.error('Agent Chat API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
