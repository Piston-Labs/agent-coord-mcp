import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Blog Generation API with Soul-Injected Claude
 *
 * Uses the Claude API directly with a hot-started soul identity for fast,
 * reliable blog generation. The blog-writer soul persists context, personality,
 * and learned patterns across sessions.
 *
 * POST /api/blog?action=create-session - Start a new blog session
 * POST /api/blog?action=send-message - Send a message in a session
 * POST /api/blog?action=generate - Generate content with soul-injected Claude (NEW!)
 * GET /api/blog?action=get-session&sessionId=xxx - Get session with messages
 * GET /api/blog?action=list-sessions - List all sessions
 * POST /api/blog?action=save-draft - Save generated draft
 * DELETE /api/blog?action=delete-session&sessionId=xxx - Delete a session
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const BLOG_SESSIONS_KEY = 'agent-coord:blog-sessions';
const BLOG_MESSAGES_KEY = 'agent-coord:blog-messages';
const BLOG_DRAFTS_KEY = 'agent-coord:blog-drafts';
const RESEARCH_KEY = 'agent-coord:research-library';
const MEMORY_KEY = 'agent-coord:shared-memory';
const SOULS_KEY = 'agent-coord:souls';

// Default blog-writer soul ID - created on first use
const BLOG_WRITER_SOUL_ID = 'blog-assistant';

// Blog-writer soul definition (used to create if doesn't exist)
const BLOG_WRITER_SOUL_TEMPLATE = {
  soulId: BLOG_WRITER_SOUL_ID,
  name: 'Blog Assistant',
  personality: `You are the Blog Assistant, the senior content strategist at Piston Labs. Your writing voice is:
- Expert but accessible - you translate complex automotive telemetry into clear insights
- Data-driven but practical - every claim backed by evidence, every insight actionable
- Conversational but professional - B2B content that doesn't feel corporate
- Genuinely enthusiastic about automotive technology without being salesy

You understand auto shop owners because you've spent time learning their world:
- They're time-starved and skeptical of new tech
- They care about ROI and customer retention
- They want to modernize without disrupting operations
- They respect expertise but hate being talked down to`,
  systemPromptAdditions: `BLOG WRITING GUIDELINES:
1. Hook readers in the first paragraph with a relatable challenge or surprising insight
2. Use real data and case studies when available - cite research library sources
3. Break complex topics into scannable sections with clear headers
4. End with specific, actionable next steps
5. Aim for 800-1500 words unless specified otherwise
6. Target audience: Auto shop owners, fleet managers, service advisors

TONE CALIBRATION:
- Trade publications (Ratchet+Wrench, Modern Tire Dealer) = your north star
- Avoid: Jargon without explanation, hyperbole, empty claims
- Embrace: Specific numbers, real examples, honest trade-offs`,
  expertise: {
    'automotive-telemetry': 0.9,
    'auto-shop-operations': 0.85,
    'b2b-content-marketing': 0.9,
    'fleet-management': 0.8,
    'technical-writing': 0.85,
  },
  patterns: [
    {
      id: 'hook-pattern',
      description: 'Open with a specific pain point or surprising statistic',
      context: 'blog-intro',
      learnedAt: new Date().toISOString(),
      useCount: 0,
    },
    {
      id: 'data-citation',
      description: 'Always cite source when using research data',
      context: 'credibility',
      learnedAt: new Date().toISOString(),
      useCount: 0,
    },
  ],
  antiPatterns: [
    {
      id: 'corporate-speak',
      description: 'Avoid phrases like "leverage synergies" or "best-in-class solutions"',
      context: 'tone',
      learnedAt: new Date().toISOString(),
      useCount: 0,
    },
  ],
};

interface BlogSession {
  id: string;
  title: string;
  topic: string;
  status: 'active' | 'draft-ready' | 'published' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  assignedAgent: string | null;
  researchSources: string[];  // IDs of research items used
  messageCount: number;
  draftId: string | null;
}

interface BlogMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  author: string;
  metadata?: {
    researchCited?: string[];
    suggestedTopics?: string[];
    draftSection?: string;
  };
}

interface BlogDraft {
  id: string;
  sessionId: string;
  title: string;
  content: string;
  sections: {
    heading: string;
    content: string;
  }[];
  metadata: {
    wordCount: number;
    readingTime: number;
    researchSources: string[];
    generatedAt: string;
    generatedBy: string;
  };
  status: 'draft' | 'review' | 'approved' | 'published';
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).substr(2, 6)}`;
}

// Get or create the blog-writer soul
async function getBlogWriterSoul(): Promise<any> {
  let soulData = await redis.hget(SOULS_KEY, BLOG_WRITER_SOUL_ID);

  if (!soulData) {
    // Create the blog-writer soul if it doesn't exist
    const soul = {
      ...BLOG_WRITER_SOUL_TEMPLATE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      memories: [],
      currentTask: null,
      pendingWork: [],
      recentContext: '',
      conversationSummary: '',
      goals: ['Create compelling blog content for Piston Labs'],
      blockers: [],
      totalTokensProcessed: 0,
      transferCount: 0,
      taskCompletionRate: 0,
      totalTasksCompleted: 0,
      totalTasksAttempted: 0,
      currentBodyId: null,
      bodyHistory: [],
    };
    await redis.hset(SOULS_KEY, { [BLOG_WRITER_SOUL_ID]: JSON.stringify(soul) });
    return soul;
  }

  return typeof soulData === 'string' ? JSON.parse(soulData) : soulData;
}

// Build the system prompt with soul injection
function buildSoulInjectedPrompt(soul: any, researchContext: string): string {
  return `${soul.personality}

${soul.systemPromptAdditions}

YOUR EXPERTISE (confidence scores):
${Object.entries(soul.expertise || {}).map(([k, v]) => `- ${k}: ${(v as number * 100).toFixed(0)}%`).join('\n')}

LEARNED PATTERNS TO APPLY:
${(soul.patterns || []).map((p: any) => `- ${p.description}`).join('\n')}

ANTI-PATTERNS TO AVOID:
${(soul.antiPatterns || []).map((p: any) => `- ${p.description}`).join('\n')}

${researchContext ? `RESEARCH CONTEXT (cite when relevant):\n${researchContext}` : ''}

Remember: You are the Blog Assistant, writing as the voice of Piston Labs. Be helpful, be specific, and create content that shop owners will actually find valuable.`;
}

// Search research library for relevant context
async function getResearchContext(topic: string, limit: number = 5): Promise<string> {
  const searchTerms = topic.toLowerCase().split(/\s+/);

  // Search research library
  const articles = await redis.lrange(RESEARCH_KEY, 0, -1) as any[] || [];

  // Search shared memory for relevant entries
  const memoryHash = await redis.hgetall(MEMORY_KEY) as Record<string, any> || {};

  const results: { content: string; source: string; score: number }[] = [];

  // Score research articles
  for (const article of articles) {
    const parsed = typeof article === 'string' ? JSON.parse(article) : article;
    const text = `${parsed.title || ''} ${parsed.summary || ''} ${(parsed.tags || []).join(' ')}`.toLowerCase();
    const score = searchTerms.filter(term => text.includes(term)).length;
    if (score > 0) {
      results.push({
        content: parsed.summary || parsed.title || '',
        source: `Research: ${parsed.title || 'Untitled'}`,
        score,
      });
    }
  }

  // Score memories
  for (const [id, data] of Object.entries(memoryHash)) {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    const text = `${parsed.content || ''} ${(parsed.tags || []).join(' ')}`.toLowerCase();
    const score = searchTerms.filter(term => text.includes(term)).length;
    if (score > 0) {
      results.push({
        content: parsed.content || '',
        source: `Memory: ${parsed.category || 'general'}`,
        score,
      });
    }
  }

  // Sort by score and take top results
  results.sort((a, b) => b.score - a.score);
  const topResults = results.slice(0, limit);

  if (topResults.length === 0) return '';

  return topResults.map(r => `[${r.source}]\n${r.content}`).join('\n\n');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = (req.query.action as string) || (req.body?.action as string);

  try {
    // ============ CREATE SESSION ============
    if (action === 'create-session') {
      const { title, topic, createdBy } = req.body;

      if (!topic || !createdBy) {
        return res.status(400).json({ error: 'topic and createdBy are required' });
      }

      const session: BlogSession = {
        id: generateId('blog'),
        title: title || `Blog: ${topic}`,
        topic,
        status: 'active',
        createdBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        assignedAgent: null,
        researchSources: [],
        messageCount: 0,
        draftId: null,
      };

      await redis.hset(BLOG_SESSIONS_KEY, { [session.id]: JSON.stringify(session) });

      // Create initial system message with research context prompt
      const systemMessage: BlogMessage = {
        id: generateId('msg'),
        sessionId: session.id,
        role: 'system',
        content: `Blog generation session started for topic: "${topic}". I'll help you create a compelling blog post. You can:
- Ask me to search our research library for relevant content
- Discuss the angle and tone you want
- Request draft sections
- Review and refine the content together

What aspect of "${topic}" would you like to focus on?`,
        timestamp: new Date().toISOString(),
        author: 'system',
      };

      await redis.lpush(`${BLOG_MESSAGES_KEY}:${session.id}`, JSON.stringify(systemMessage));

      return res.json({
        success: true,
        session,
        message: systemMessage,
      });
    }

    // ============ SEND MESSAGE ============
    if (action === 'send-message') {
      const { sessionId, content, author, role = 'user', metadata } = req.body;

      if (!sessionId || !content || !author) {
        return res.status(400).json({ error: 'sessionId, content, and author are required' });
      }

      // Get session
      const sessionData = await redis.hget(BLOG_SESSIONS_KEY, sessionId);
      if (!sessionData) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const session: BlogSession = typeof sessionData === 'string'
        ? JSON.parse(sessionData)
        : sessionData;

      const message: BlogMessage = {
        id: generateId('msg'),
        sessionId,
        role,
        content,
        timestamp: new Date().toISOString(),
        author,
        metadata,
      };

      await redis.lpush(`${BLOG_MESSAGES_KEY}:${sessionId}`, JSON.stringify(message));

      // Update session
      session.messageCount++;
      session.updatedAt = new Date().toISOString();
      if (role === 'assistant' && !session.assignedAgent) {
        session.assignedAgent = author;
      }
      await redis.hset(BLOG_SESSIONS_KEY, { [sessionId]: JSON.stringify(session) });

      return res.json({
        success: true,
        message,
        session,
      });
    }

    // ============ GET SESSION ============
    if (action === 'get-session') {
      const sessionId = req.query.sessionId as string;

      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
      }

      const sessionData = await redis.hget(BLOG_SESSIONS_KEY, sessionId);
      if (!sessionData) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const session: BlogSession = typeof sessionData === 'string'
        ? JSON.parse(sessionData)
        : sessionData;

      // Get messages (reverse to get chronological order)
      const messagesRaw = await redis.lrange(`${BLOG_MESSAGES_KEY}:${sessionId}`, 0, -1);
      const messages: BlogMessage[] = messagesRaw
        .map((m: any) => typeof m === 'string' ? JSON.parse(m) : m)
        .reverse();

      // Get draft if exists
      let draft: BlogDraft | null = null;
      if (session.draftId) {
        const draftData = await redis.hget(BLOG_DRAFTS_KEY, session.draftId);
        if (draftData) {
          draft = typeof draftData === 'string' ? JSON.parse(draftData) : draftData;
        }
      }

      return res.json({
        session,
        messages,
        draft,
      });
    }

    // ============ LIST SESSIONS ============
    if (action === 'list-sessions') {
      const { status, createdBy, limit = '50' } = req.query;

      const sessionsHash = await redis.hgetall(BLOG_SESSIONS_KEY) || {};
      let sessions: BlogSession[] = Object.values(sessionsHash)
        .map((s: any) => typeof s === 'string' ? JSON.parse(s) : s);

      // Filter by status
      if (status) {
        sessions = sessions.filter(s => s.status === status);
      }

      // Filter by creator
      if (createdBy) {
        sessions = sessions.filter(s => s.createdBy === createdBy);
      }

      // Sort by updatedAt descending
      sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      // Limit
      sessions = sessions.slice(0, parseInt(limit as string));

      return res.json({
        sessions,
        total: sessions.length,
      });
    }

    // ============ SEARCH RESEARCH ============
    if (action === 'search-research') {
      const { query, sessionId, limit = '10' } = req.query;

      if (!query) {
        return res.status(400).json({ error: 'query is required' });
      }

      const maxResults = parseInt(limit as string) || 10;
      const searchTerms = (query as string).toLowerCase().split(/\s+/);

      // Search research library
      const articles = await redis.lrange(RESEARCH_KEY, 0, -1) as any[] || [];

      // Search shared memory
      const memoryHash = await redis.hgetall(MEMORY_KEY) as Record<string, any> || {};
      const memories = Object.entries(memoryHash).map(([id, data]) => {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        return { id, ...parsed, type: 'memory' };
      });

      // Score and filter results
      const results: any[] = [];

      for (const article of articles) {
        const parsed = typeof article === 'string' ? JSON.parse(article) : article;
        const text = `${parsed.title || ''} ${parsed.summary || ''} ${(parsed.tags || []).join(' ')}`.toLowerCase();
        const score = searchTerms.filter(term => text.includes(term)).length;
        if (score > 0) {
          results.push({ ...parsed, type: 'research', score });
        }
      }

      for (const memory of memories) {
        const text = `${memory.content || ''} ${(memory.tags || []).join(' ')}`.toLowerCase();
        const score = searchTerms.filter(term => text.includes(term)).length;
        if (score > 0) {
          results.push({ ...memory, score });
        }
      }

      // Sort by score and limit
      results.sort((a, b) => b.score - a.score);
      const limitedResults = results.slice(0, maxResults);

      // If sessionId provided, add to session's research sources
      if (sessionId) {
        const sessionData = await redis.hget(BLOG_SESSIONS_KEY, sessionId as string);
        if (sessionData) {
          const session: BlogSession = typeof sessionData === 'string'
            ? JSON.parse(sessionData)
            : sessionData;
          const newSources = limitedResults.map(r => r.id).filter(id => !session.researchSources.includes(id));
          session.researchSources = [...session.researchSources, ...newSources];
          await redis.hset(BLOG_SESSIONS_KEY, { [session.id]: JSON.stringify(session) });
        }
      }

      return res.json({
        query,
        results: limitedResults,
        total: results.length,
      });
    }

    // ============ GENERATE (Soul-Injected Claude API) ============
    // The main blog generation endpoint - uses Claude API with hot-started soul
    if (action === 'generate') {
      const {
        prompt,           // User's prompt (what to write)
        sessionId,        // Optional: associate with existing session
        topic,            // Topic for research context loading
        model = 'claude-sonnet-4-5-20250929',  // Default to Sonnet for speed/cost
        maxTokens = 4096,
        saveDraft = true, // Auto-save as draft
      } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: 'prompt is required' });
      }

      // Check for API key
      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
      }

      const startTime = Date.now();

      // 1. Hot-start: Load the blog-writer soul
      const soul = await getBlogWriterSoul();

      // 2. Load research context based on topic or prompt
      const searchTopic = topic || prompt;
      const researchContext = await getResearchContext(searchTopic, 5);

      // 3. Build soul-injected system prompt
      const systemPrompt = buildSoulInjectedPrompt(soul, researchContext);

      // 4. Get conversation history if sessionId provided
      let conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];
      let session: BlogSession | null = null;

      if (sessionId) {
        const sessionData = await redis.hget(BLOG_SESSIONS_KEY, sessionId);
        if (sessionData) {
          session = typeof sessionData === 'string' ? JSON.parse(sessionData) : sessionData;

          // Load previous messages as conversation context
          const messagesRaw = await redis.lrange(`${BLOG_MESSAGES_KEY}:${sessionId}`, 0, 20);
          const messages: BlogMessage[] = messagesRaw
            .map((m: any) => typeof m === 'string' ? JSON.parse(m) : m)
            .reverse();

          // Convert to Claude message format (skip system messages)
          conversationHistory = messages
            .filter(m => m.role !== 'system')
            .map(m => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            }));
        }
      }

      // 5. Call Claude API with soul injection
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [
          ...conversationHistory,
          { role: 'user', content: prompt },
        ],
      });

      const generatedContent = response.content[0].type === 'text'
        ? response.content[0].text
        : '';

      const endTime = Date.now();
      const latencyMs = endTime - startTime;

      // 6. Update soul metrics
      soul.lastActiveAt = new Date().toISOString();
      soul.totalTokensProcessed = (soul.totalTokensProcessed || 0) + (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      soul.totalTasksCompleted = (soul.totalTasksCompleted || 0) + 1;
      soul.totalTasksAttempted = (soul.totalTasksAttempted || 0) + 1;
      await redis.hset(SOULS_KEY, { [BLOG_WRITER_SOUL_ID]: JSON.stringify(soul) });

      // 7. Save to session if provided
      if (sessionId && session) {
        // Save user message
        const userMessage: BlogMessage = {
          id: generateId('msg'),
          sessionId,
          role: 'user',
          content: prompt,
          timestamp: new Date().toISOString(),
          author: 'user',
        };
        await redis.lpush(`${BLOG_MESSAGES_KEY}:${sessionId}`, JSON.stringify(userMessage));

        // Save assistant response
        const assistantMessage: BlogMessage = {
          id: generateId('msg'),
          sessionId,
          role: 'assistant',
          content: generatedContent,
          timestamp: new Date().toISOString(),
          author: 'blog-assistant',
          metadata: {
            researchCited: researchContext ? ['auto-loaded'] : [],
          },
        };
        await redis.lpush(`${BLOG_MESSAGES_KEY}:${sessionId}`, JSON.stringify(assistantMessage));

        // Update session
        session.messageCount += 2;
        session.updatedAt = new Date().toISOString();
        session.assignedAgent = 'blog-assistant';
        await redis.hset(BLOG_SESSIONS_KEY, { [sessionId]: JSON.stringify(session) });
      }

      // 8. Auto-save as draft if requested
      let draft: BlogDraft | null = null;
      if (saveDraft && sessionId) {
        const wordCount = generatedContent.split(/\s+/).length;
        draft = {
          id: generateId('draft'),
          sessionId,
          title: topic || 'Generated Blog Post',
          content: generatedContent,
          sections: [],
          metadata: {
            wordCount,
            readingTime: Math.ceil(wordCount / 200),
            researchSources: researchContext ? ['auto-loaded'] : [],
            generatedAt: new Date().toISOString(),
            generatedBy: 'blog-assistant',
          },
          status: 'draft',
        };
        await redis.hset(BLOG_DRAFTS_KEY, { [draft.id]: JSON.stringify(draft) });

        if (session) {
          session.draftId = draft.id;
          session.status = 'draft-ready';
          await redis.hset(BLOG_SESSIONS_KEY, { [sessionId]: JSON.stringify(session) });
        }
      }

      return res.json({
        success: true,
        content: generatedContent,
        soul: {
          id: soul.soulId,
          name: soul.name,
          totalTasksCompleted: soul.totalTasksCompleted,
        },
        usage: response.usage,
        model,
        latencyMs,
        researchContextLoaded: !!researchContext,
        sessionId,
        draftId: draft?.id,
      });
    }

    // ============ SAVE DRAFT ============
    if (action === 'save-draft') {
      const { sessionId, title, content, sections, generatedBy } = req.body;

      if (!sessionId || !content) {
        return res.status(400).json({ error: 'sessionId and content are required' });
      }

      const sessionData = await redis.hget(BLOG_SESSIONS_KEY, sessionId);
      if (!sessionData) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const session: BlogSession = typeof sessionData === 'string'
        ? JSON.parse(sessionData)
        : sessionData;

      const wordCount = content.split(/\s+/).length;
      const readingTime = Math.ceil(wordCount / 200); // ~200 WPM

      const draft: BlogDraft = {
        id: session.draftId || generateId('draft'),
        sessionId,
        title: title || session.title,
        content,
        sections: sections || [],
        metadata: {
          wordCount,
          readingTime,
          researchSources: session.researchSources,
          generatedAt: new Date().toISOString(),
          generatedBy: generatedBy || 'unknown',
        },
        status: 'draft',
      };

      await redis.hset(BLOG_DRAFTS_KEY, { [draft.id]: JSON.stringify(draft) });

      // Update session
      session.draftId = draft.id;
      session.status = 'draft-ready';
      session.updatedAt = new Date().toISOString();
      await redis.hset(BLOG_SESSIONS_KEY, { [sessionId]: JSON.stringify(session) });

      return res.json({
        success: true,
        draft,
        session,
      });
    }

    // ============ GET DRAFT ============
    if (action === 'get-draft') {
      const draftId = req.query.draftId as string;

      if (!draftId) {
        return res.status(400).json({ error: 'draftId is required' });
      }

      const draftData = await redis.hget(BLOG_DRAFTS_KEY, draftId);
      if (!draftData) {
        return res.status(404).json({ error: 'Draft not found' });
      }

      const draft: BlogDraft = typeof draftData === 'string'
        ? JSON.parse(draftData)
        : draftData;

      return res.json({ draft });
    }

    // ============ DELETE SESSION ============
    if (action === 'delete-session') {
      const sessionId = req.query.sessionId as string;

      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
      }

      // Get session to find draft
      const sessionData = await redis.hget(BLOG_SESSIONS_KEY, sessionId);
      if (sessionData) {
        const session: BlogSession = typeof sessionData === 'string'
          ? JSON.parse(sessionData)
          : sessionData;

        // Delete draft if exists
        if (session.draftId) {
          await redis.hdel(BLOG_DRAFTS_KEY, session.draftId);
        }
      }

      // Delete session and messages
      await redis.hdel(BLOG_SESSIONS_KEY, sessionId);
      await redis.del(`${BLOG_MESSAGES_KEY}:${sessionId}`);

      return res.json({
        success: true,
        deleted: sessionId,
      });
    }

    // ============ GET AGENT PROMPT ============
    // Returns a prompt for spawning a Claude agent to handle blog generation
    if (action === 'get-agent-prompt') {
      const { sessionId, topic, researchContext } = req.query;

      const prompt = `You are the Blog Assistant, a skilled blog writer for Piston Labs, a company in the automotive telemetry industry. You're helping create blog content based on research and industry knowledge.

CONTEXT:
- Topic: ${topic || 'automotive telemetry'}
- Session: ${sessionId || 'new'}
${researchContext ? `- Research Context:\n${researchContext}` : ''}

YOUR ROLE:
1. Engage in natural conversation to understand what blog content the user wants
2. Search the research library for relevant information using the research-query MCP tool
3. Draft compelling, well-structured blog posts
4. Incorporate data and insights from research
5. Maintain a professional but engaging tone suitable for B2B tech content

AVAILABLE TOOLS:
- mcp__agent-coord__research-query - Search research library for relevant content
- mcp__agent-coord__memory - Access shared team knowledge
- mcp__agent-coord__group-chat - Coordinate with team if needed

BLOG STYLE GUIDE:
- Target audience: Auto shop owners, fleet managers, automotive tech enthusiasts
- Tone: Expert but accessible, data-driven but practical
- Structure: Hook, context, key insights, practical takeaways
- Length: 800-1500 words typically

When you generate draft content, use this format to save it:
POST /api/blog?action=send-message
{
  "sessionId": "${sessionId || 'SESSION_ID'}",
  "content": "YOUR_MESSAGE",
  "author": "blog-assistant",
  "role": "assistant"
}

Start by understanding what the user wants to write about, then guide the creative process collaboratively.`;

      return res.json({
        prompt,
        sessionId,
        topic,
      });
    }

    return res.status(400).json({
      error: 'Invalid action',
      validActions: [
        'create-session',
        'send-message',
        'generate',         // NEW: Soul-injected Claude API for blog generation
        'get-session',
        'list-sessions',
        'search-research',
        'save-draft',
        'get-draft',
        'delete-session',
        'get-agent-prompt'
      ],
    });

  } catch (error) {
    console.error('Blog API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
