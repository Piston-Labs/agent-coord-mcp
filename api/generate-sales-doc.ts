import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

/**
 * AI-Powered Sales Document Generator
 *
 * Uses Claude API to generate intelligent, context-aware sales documents.
 * Pulls company context from teltonika-context-system for accuracy.
 *
 * POST /api/generate-sales-doc
 * {
 *   type: 'pitch-deck' | 'proposal' | 'one-pager' | 'email' | 'demo-script' | 'case-study' | 'other',
 *   name: string,
 *   target?: string,  // customer/company name
 *   notes?: string,   // additional requirements
 *   createdBy?: string
 * }
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SALES_FILES_KEY = 'piston:sales:files';

// Document type configurations
const DOC_TYPES: Record<string, {
  systemPrompt: string;
  contextCategories: string[];
  maxTokens: number;
}> = {
  'pitch-deck': {
    systemPrompt: `You are Eli, a Sales Engineer at Piston Labs. Create a compelling pitch deck outline/script.
Include: Problem, Solution, Market Opportunity, Product Demo Flow, Traction, Team, Ask.
Make it conversational and engaging. Include speaker notes and talking points.`,
    contextCategories: ['sales', 'product'],
    maxTokens: 2000
  },
  'proposal': {
    systemPrompt: `You are Eli, a Sales Engineer at Piston Labs. Create a professional business proposal.
Include: Executive Summary, Problem Statement, Proposed Solution, Implementation Plan, Pricing, Timeline, Next Steps.
Be specific and tailored to the customer's needs.`,
    contextCategories: ['sales', 'product'],
    maxTokens: 2500
  },
  'one-pager': {
    systemPrompt: `You are Eli, a Sales Engineer at Piston Labs. Create a concise one-pager document.
Include: Problem, Solution, Key Benefits (3-5), How It Works, Call to Action.
Keep it scannable with bullet points and clear sections. Target: 1 page when printed.`,
    contextCategories: ['sales', 'product'],
    maxTokens: 1200
  },
  'email': {
    systemPrompt: `You are Eli, a Sales Engineer at Piston Labs. Write a professional sales email.
Include: Compelling subject line, Personalized opening, Value proposition, Clear CTA, Professional sign-off.
Keep it concise (under 200 words for body). Be warm but professional.`,
    contextCategories: ['sales'],
    maxTokens: 800
  },
  'demo-script': {
    systemPrompt: `You are Eli, a Sales Engineer at Piston Labs. Create a product demo script.
Include: Opening hook, Problem setup, Live demo flow, Feature highlights, Objection handling points, Close.
Make it natural and conversational with timing cues.`,
    contextCategories: ['sales', 'product', 'technical'],
    maxTokens: 2000
  },
  'case-study': {
    systemPrompt: `You are Eli, a Sales Engineer at Piston Labs. Write a compelling case study.
Include: Customer Background, Challenge, Solution, Implementation, Results (with metrics), Quote placeholder, Future Plans.
Use storytelling to make it engaging. Include specific numbers where possible.`,
    contextCategories: ['sales', 'product'],
    maxTokens: 2000
  },
  'other': {
    systemPrompt: `You are Eli, a Sales Engineer at Piston Labs. Create the requested document.
Adapt your style and format based on the specific request. Be professional and thorough.`,
    contextCategories: ['sales', 'product'],
    maxTokens: 2000
  }
};

// Fetch company context from sales-context API
async function fetchCompanyContext(categories: string[]): Promise<string> {
  const contextParts: string[] = [];

  try {
    // Fetch from our sales-context API
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://agent-coord-mcp.vercel.app';

    for (const category of categories) {
      const res = await fetch(`${baseUrl}/api/sales-context?category=${category}`);
      if (res.ok) {
        const data = await res.json();
        if (data.files) {
          // Get content from key files
          for (const file of data.files.slice(0, 3)) { // Limit to 3 files per category
            const fileRes = await fetch(`${baseUrl}/api/sales-context?file=${file.path}`);
            if (fileRes.ok) {
              const fileData = await fileRes.json();
              if (fileData.content) {
                contextParts.push(`### ${file.name}\n${fileData.content.substring(0, 2000)}`);
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[generate-sales-doc] Error fetching context:', err);
  }

  // Return concatenated context (limited to avoid token overflow)
  return contextParts.join('\n\n---\n\n').substring(0, 8000);
}

// Generate document using Claude API
async function generateWithClaude(
  docType: string,
  name: string,
  target: string,
  notes: string,
  context: string
): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const config = DOC_TYPES[docType] || DOC_TYPES['other'];

  const userPrompt = `Generate a ${docType.replace(/-/g, ' ')} document.

**Document Name:** ${name}
${target ? `**Target Customer/Company:** ${target}` : ''}
${notes ? `**Additional Requirements:** ${notes}` : ''}

Use the following company context to ensure accuracy:

${context}

Generate a complete, professional document ready to use. Format in Markdown.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: config.maxTokens,
      system: config.systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${error}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || 'Failed to generate content';
}

// Folder mapping
function getFolderForType(type: string): string {
  const folderMap: Record<string, string> = {
    'pitch-deck': 'pitch-decks',
    'proposal': 'proposals',
    'one-pager': 'one-pagers',
    'email': 'emails',
    'demo-script': 'demos',
    'case-study': 'proposals',
    'other': 'other'
  };
  return folderMap[type] || 'other';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, name, target, notes, createdBy = 'eli' } = req.body;

    if (!type || !name) {
      return res.status(400).json({ error: 'type and name are required' });
    }

    // Validate type
    if (!DOC_TYPES[type]) {
      return res.status(400).json({
        error: `Invalid type: ${type}`,
        validTypes: Object.keys(DOC_TYPES)
      });
    }

    // Fetch relevant company context
    const config = DOC_TYPES[type];
    const context = await fetchCompanyContext(config.contextCategories);

    // Generate document with Claude
    const content = await generateWithClaude(
      type,
      name,
      target || '',
      notes || '',
      context
    );

    // Save to Redis
    const file = {
      id: `file-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`,
      name,
      type,
      folder: getFolderForType(type),
      content,
      target,
      notes,
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      generatedByAI: true
    };

    await redis.hset(SALES_FILES_KEY, { [file.id]: JSON.stringify(file) });

    return res.json({
      success: true,
      file,
      content,
      message: 'Document generated successfully with AI'
    });

  } catch (error) {
    console.error('[generate-sales-doc] Error:', error);

    // Check if it's an API key error
    if (String(error).includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({
        error: 'AI generation not configured',
        details: 'ANTHROPIC_API_KEY environment variable not set',
        fallback: 'Use /api/generate-doc for template-based generation'
      });
    }

    return res.status(500).json({
      error: 'Generation failed',
      details: String(error)
    });
  }
}
