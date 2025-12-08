import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Sales Engineering Chat API with Soul-Injected Claude
 *
 * A dedicated chatbot for the Sales Engineering section that uses Claude API
 * with a hot-started sales agent soul. Optimized for document generation,
 * pitch creation, objection handling, and sales support.
 *
 * POST /api/sales-chat?action=chat - Main chat endpoint with soul injection
 * POST /api/sales-chat?action=generate-doc - Generate a sales document
 * GET /api/sales-chat?action=get-soul - Get the sales agent soul info
 * POST /api/sales-chat?action=update-soul - Update soul patterns/knowledge
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SOULS_KEY = 'agent-coord:souls';
const SALES_FILES_KEY = 'piston:sales:files';
const SHOPS_KEY = 'agent-coord:shops';
const MEMORY_KEY = 'agent-coord:shared-memory';
const CHAT_HISTORY_KEY = 'piston:sales:chat-history';

// Sales engineer soul ID
const SALES_SOUL_ID = 'max-sales-engineer';

// Sales engineer soul template
const SALES_SOUL_TEMPLATE = {
  soulId: SALES_SOUL_ID,
  name: 'Max',
  personality: `You are Max, the senior sales engineer at Piston Labs. You help the sales team create compelling materials and handle prospect conversations.

YOUR EXPERTISE:
- Deep knowledge of automotive telemetry and fleet management
- Understanding of auto shop operations, pain points, and buying cycles
- Expert at translating technical features into business value
- Skilled at objection handling and competitive positioning

YOUR COMMUNICATION STYLE:
- Direct and confident, but never pushy
- Data-driven - always back claims with specifics
- Empathetic to prospect concerns
- Action-oriented - always suggest next steps

YOU UNDERSTAND YOUR CUSTOMERS:
- Auto shop owners are time-starved and skeptical of new tech
- Fleet managers care about uptime, compliance, and cost control
- Service advisors want tools that help them sell more services
- Everyone wants ROI proof before committing`,

  systemPromptAdditions: `SALES ENGINEERING GUIDELINES:

DOCUMENT GENERATION:
- Pitch Decks: Lead with problem, show solution, prove value, call to action
- Proposals: Custom pricing, implementation timeline, ROI calculations
- One-Pagers: Single compelling message, scannable, shareable
- Emails: Personal, specific, clear ask, easy to say yes
- Demo Scripts: Discovery questions, pain amplification, solution mapping

OBJECTION HANDLING FRAMEWORK:
1. Acknowledge - "I understand that concern..."
2. Clarify - "Can you tell me more about..."
3. Respond - Address with data/proof
4. Confirm - "Does that address your concern?"

COMPETITIVE POSITIONING:
- vs Manual Tracking: Automation, accuracy, real-time alerts
- vs Generic GPS: Auto-shop specific features, maintenance integration
- vs Carfax: Complementary (we track, they report), different use cases

VALUE PROPOSITIONS BY PERSONA:
- Shop Owner: Increased service revenue, customer retention, differentiation
- Fleet Manager: Reduced downtime, maintenance optimization, compliance
- Service Advisor: Proactive service alerts, easier upsells, customer trust

PRICING GUIDANCE:
- Beta: Free device + $29/mo per vehicle
- Launch: $199 device + $39/mo per vehicle
- Fleet: Volume discounts at 10+ vehicles`,

  expertise: {
    'sales-engineering': 0.95,
    'automotive-telemetry': 0.9,
    'objection-handling': 0.9,
    'document-generation': 0.9,
    'competitive-analysis': 0.85,
    'pricing-strategy': 0.85,
    'auto-shop-operations': 0.85,
    'fleet-management': 0.8,
  },

  patterns: [
    {
      id: 'value-first',
      description: 'Always lead with business value, then explain how',
      context: 'pitch',
      learnedAt: new Date().toISOString(),
      useCount: 0,
    },
    {
      id: 'specific-numbers',
      description: 'Use specific numbers and timeframes, not vague claims',
      context: 'credibility',
      learnedAt: new Date().toISOString(),
      useCount: 0,
    },
    {
      id: 'next-step-always',
      description: 'Every interaction should end with a clear next step',
      context: 'sales-process',
      learnedAt: new Date().toISOString(),
      useCount: 0,
    },
  ],

  antiPatterns: [
    {
      id: 'feature-dumping',
      description: 'Never list features without connecting to business value',
      context: 'pitch',
      learnedAt: new Date().toISOString(),
      useCount: 0,
    },
    {
      id: 'competitor-bashing',
      description: 'Never directly bash competitors - position on our strengths',
      context: 'competitive',
      learnedAt: new Date().toISOString(),
      useCount: 0,
    },
    {
      id: 'vague-roi',
      description: 'Never claim ROI without specific numbers or methodology',
      context: 'credibility',
      learnedAt: new Date().toISOString(),
      useCount: 0,
    },
  ],
};

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).substr(2, 6)}`;
}

// Get or create the sales engineer soul
async function getSalesSoul(): Promise<any> {
  let soulData = await redis.hget(SOULS_KEY, SALES_SOUL_ID);

  if (!soulData) {
    const soul = {
      ...SALES_SOUL_TEMPLATE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      memories: [],
      currentTask: null,
      pendingWork: [],
      recentContext: '',
      conversationSummary: '',
      goals: ['Help sales team close deals', 'Generate compelling sales materials'],
      blockers: [],
      totalTokensProcessed: 0,
      transferCount: 0,
      taskCompletionRate: 0,
      totalTasksCompleted: 0,
      totalTasksAttempted: 0,
      currentBodyId: null,
      bodyHistory: [],
    };
    await redis.hset(SOULS_KEY, { [SALES_SOUL_ID]: JSON.stringify(soul) });
    return soul;
  }

  return typeof soulData === 'string' ? JSON.parse(soulData) : soulData;
}

// Build soul-injected system prompt
function buildSalesPrompt(soul: any, salesContext: string, shopContext: string): string {
  return `${soul.personality}

${soul.systemPromptAdditions}

YOUR EXPERTISE (confidence scores):
${Object.entries(soul.expertise || {}).map(([k, v]) => `- ${k}: ${((v as number) * 100).toFixed(0)}%`).join('\n')}

LEARNED PATTERNS TO APPLY:
${(soul.patterns || []).map((p: any) => `- ${p.description}`).join('\n')}

ANTI-PATTERNS TO AVOID:
${(soul.antiPatterns || []).map((p: any) => `- ${p.description}`).join('\n')}

${salesContext ? `AVAILABLE SALES DOCUMENTS:\n${salesContext}` : ''}

${shopContext ? `CRM PROSPECT DATA:\n${shopContext}` : ''}

Remember: You are Max, the sales engineer. Be helpful, be specific, and help the team close deals. When generating documents, make them ready to use - not templates with placeholders.`;
}

// Load sales context from files and CRM
async function getSalesContext(): Promise<{ salesDocs: string; shopData: string }> {
  // Get recent sales files
  const salesFilesData = await redis.hgetall(SALES_FILES_KEY);
  const salesFiles = salesFilesData
    ? Object.values(salesFilesData)
        .map((f: any) => typeof f === 'string' ? JSON.parse(f) : f)
        .slice(0, 10)  // Last 10 files
    : [];

  const salesDocs = salesFiles.length > 0
    ? salesFiles.map((f: any) => `[${f.type}] ${f.name}: ${f.content?.substring(0, 200)}...`).join('\n')
    : '';

  // Get CRM shop data
  const shopsData = await redis.hgetall(SHOPS_KEY);
  const shops = shopsData
    ? Object.values(shopsData)
        .map((s: any) => typeof s === 'string' ? JSON.parse(s) : s)
        .filter((s: any) => s.status !== 'churned')
        .slice(0, 15)  // Top 15 active prospects
    : [];

  const shopData = shops.length > 0
    ? shops.map((s: any) => `- ${s.shopName} (${s.status}): ${s.contact || 'No contact'} - ${s.notes || 'No notes'}`).join('\n')
    : '';

  return { salesDocs, shopData };
}

// Load relevant memories
async function getRelevantMemories(query: string, limit: number = 5): Promise<string> {
  const memoryHash = await redis.hgetall(MEMORY_KEY) as Record<string, any> || {};
  const searchTerms = query.toLowerCase().split(/\s+/);

  const results: { content: string; score: number }[] = [];

  for (const [_, data] of Object.entries(memoryHash)) {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    // Filter for sales-related memories
    const tags = (parsed.tags || []).join(' ').toLowerCase();
    if (!tags.includes('sales') && !tags.includes('pitch') && !tags.includes('prospect')) continue;

    const text = `${parsed.content || ''} ${tags}`.toLowerCase();
    const score = searchTerms.filter(term => text.includes(term)).length;
    if (score > 0) {
      results.push({ content: parsed.content || '', score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map(r => r.content).join('\n');
}

// Save chat to history
async function saveChatHistory(sessionId: string, role: string, content: string, author: string): Promise<void> {
  const message = {
    id: generateId('msg'),
    sessionId,
    role,
    content,
    author,
    timestamp: new Date().toISOString(),
  };
  await redis.lpush(`${CHAT_HISTORY_KEY}:${sessionId}`, JSON.stringify(message));
  // Keep last 50 messages per session
  await redis.ltrim(`${CHAT_HISTORY_KEY}:${sessionId}`, 0, 49);
}

// Get chat history
async function getChatHistory(sessionId: string, limit: number = 20): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const messagesRaw = await redis.lrange(`${CHAT_HISTORY_KEY}:${sessionId}`, 0, limit - 1);
  return messagesRaw
    .map((m: any) => typeof m === 'string' ? JSON.parse(m) : m)
    .reverse()
    .filter((m: any) => m.role === 'user' || m.role === 'assistant')
    .map((m: any) => ({ role: m.role, content: m.content }));
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
    // ============ MAIN CHAT ENDPOINT ============
    if (action === 'chat') {
      const {
        message,
        sessionId = generateId('sales-chat'),
        model = 'claude-sonnet-4-5-20250929',
        maxTokens = 4096,
        includeContext = true,
      } = req.body;

      if (!message) {
        return res.status(400).json({ error: 'message is required' });
      }

      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
      }

      const startTime = Date.now();

      // 1. Hot-start: Load the sales soul
      const soul = await getSalesSoul();

      // 2. Load sales context
      let salesDocs = '';
      let shopData = '';
      if (includeContext) {
        const context = await getSalesContext();
        salesDocs = context.salesDocs;
        shopData = context.shopData;
      }

      // 3. Get relevant memories
      const memories = await getRelevantMemories(message, 3);
      const fullSalesContext = [salesDocs, memories].filter(Boolean).join('\n\n');

      // 4. Build soul-injected system prompt
      const systemPrompt = buildSalesPrompt(soul, fullSalesContext, shopData);

      // 5. Get conversation history
      const conversationHistory = await getChatHistory(sessionId, 10);

      // 6. Save user message
      await saveChatHistory(sessionId, 'user', message, 'user');

      // 7. Call Claude API
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [
          ...conversationHistory,
          { role: 'user', content: message },
        ],
      });

      const generatedContent = response.content[0].type === 'text'
        ? response.content[0].text
        : '';

      const latencyMs = Date.now() - startTime;

      // 8. Save assistant response
      await saveChatHistory(sessionId, 'assistant', generatedContent, 'max');

      // 9. Update soul metrics
      soul.lastActiveAt = new Date().toISOString();
      soul.totalTokensProcessed = (soul.totalTokensProcessed || 0) +
        (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      soul.totalTasksCompleted = (soul.totalTasksCompleted || 0) + 1;
      soul.totalTasksAttempted = (soul.totalTasksAttempted || 0) + 1;
      await redis.hset(SOULS_KEY, { [SALES_SOUL_ID]: JSON.stringify(soul) });

      return res.json({
        success: true,
        response: generatedContent,
        sessionId,
        soul: {
          id: soul.soulId,
          name: soul.name,
          totalTasksCompleted: soul.totalTasksCompleted,
        },
        usage: response.usage,
        model,
        latencyMs,
      });
    }

    // ============ GENERATE DOCUMENT ============
    if (action === 'generate-doc') {
      const {
        type,           // pitch-deck, proposal, one-pager, email, demo-script
        target,         // Company/person name
        context,        // Additional context about the prospect
        requirements,   // Specific requirements
        model = 'claude-sonnet-4-5-20250929',
        maxTokens = 8192,
      } = req.body;

      if (!type) {
        return res.status(400).json({ error: 'type is required (pitch-deck, proposal, one-pager, email, demo-script)' });
      }

      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
      }

      const startTime = Date.now();

      // Load soul and context
      const soul = await getSalesSoul();
      const { salesDocs, shopData } = await getSalesContext();

      // Build document generation prompt
      const docPrompt = `Generate a ${type} for ${target || 'a prospect'}.

${context ? `PROSPECT CONTEXT:\n${context}\n` : ''}
${requirements ? `REQUIREMENTS:\n${requirements}\n` : ''}

IMPORTANT:
- Create a complete, ready-to-use document - NOT a template with [PLACEHOLDERS]
- If you don't have specific information, make reasonable assumptions based on the prospect type
- Use Piston Labs actual product details and pricing from your knowledge
- Make it compelling and actionable`;

      const systemPrompt = buildSalesPrompt(soul, salesDocs, shopData);

      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: docPrompt }],
      });

      const generatedDoc = response.content[0].type === 'text'
        ? response.content[0].text
        : '';

      const latencyMs = Date.now() - startTime;

      // Update soul metrics
      soul.lastActiveAt = new Date().toISOString();
      soul.totalTokensProcessed = (soul.totalTokensProcessed || 0) +
        (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      soul.totalTasksCompleted = (soul.totalTasksCompleted || 0) + 1;
      await redis.hset(SOULS_KEY, { [SALES_SOUL_ID]: JSON.stringify(soul) });

      // Auto-save to sales files
      const fileId = generateId('doc');
      const salesFile = {
        id: fileId,
        name: `${type} - ${target || 'Generated'}`,
        type,
        folder: 'Generated',
        content: generatedDoc,
        target,
        notes: `Auto-generated by Max. Context: ${context?.substring(0, 100) || 'None'}`,
        createdBy: 'max',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await redis.hset(SALES_FILES_KEY, { [fileId]: JSON.stringify(salesFile) });

      return res.json({
        success: true,
        document: generatedDoc,
        fileId,
        type,
        target,
        soul: {
          id: soul.soulId,
          name: soul.name,
        },
        usage: response.usage,
        latencyMs,
      });
    }

    // ============ GET SOUL INFO ============
    if (action === 'get-soul') {
      const soul = await getSalesSoul();

      return res.json({
        soul: {
          id: soul.soulId,
          name: soul.name,
          personality: soul.personality?.substring(0, 500) + '...',
          expertise: soul.expertise,
          patterns: soul.patterns,
          antiPatterns: soul.antiPatterns,
          totalTasksCompleted: soul.totalTasksCompleted,
          totalTokensProcessed: soul.totalTokensProcessed,
          lastActiveAt: soul.lastActiveAt,
        },
      });
    }

    // ============ UPDATE SOUL ============
    if (action === 'update-soul') {
      const { pattern, antiPattern, expertise } = req.body;

      const soul = await getSalesSoul();

      if (pattern) {
        soul.patterns = soul.patterns || [];
        soul.patterns.push({
          id: generateId('pattern'),
          description: pattern.description,
          context: pattern.context || 'general',
          learnedAt: new Date().toISOString(),
          useCount: 0,
        });
      }

      if (antiPattern) {
        soul.antiPatterns = soul.antiPatterns || [];
        soul.antiPatterns.push({
          id: generateId('antipattern'),
          description: antiPattern.description,
          context: antiPattern.context || 'general',
          learnedAt: new Date().toISOString(),
          useCount: 0,
        });
      }

      if (expertise) {
        soul.expertise = { ...soul.expertise, ...expertise };
      }

      soul.updatedAt = new Date().toISOString();
      await redis.hset(SOULS_KEY, { [SALES_SOUL_ID]: JSON.stringify(soul) });

      return res.json({
        success: true,
        soul: {
          id: soul.soulId,
          patterns: soul.patterns?.length,
          antiPatterns: soul.antiPatterns?.length,
          expertise: soul.expertise,
        },
      });
    }

    // ============ GET CHAT HISTORY ============
    if (action === 'history') {
      const sessionId = req.query.sessionId as string;

      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
      }

      const messagesRaw = await redis.lrange(`${CHAT_HISTORY_KEY}:${sessionId}`, 0, 49);
      const messages = messagesRaw
        .map((m: any) => typeof m === 'string' ? JSON.parse(m) : m)
        .reverse();

      return res.json({
        sessionId,
        messages,
        count: messages.length,
      });
    }

    return res.status(400).json({
      error: 'Invalid action',
      validActions: [
        'chat',        // Main chat with soul-injected Claude
        'generate-doc', // Generate sales document
        'get-soul',    // Get soul info
        'update-soul', // Update soul patterns/expertise
        'history',     // Get chat history
      ],
    });

  } catch (error) {
    console.error('Sales Chat API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
