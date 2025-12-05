import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import Anthropic from '@anthropic-ai/sdk';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-west-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const BUCKET_NAME = process.env.RESEARCH_PDF_BUCKET || 'piston-labs-research-papers';
const RESEARCH_KEY = 'agent-coord:research-library';
const ANALYSIS_KEY = 'agent-coord:research-analysis';

interface PaperAnalysis {
  articleId: string;
  title: string;
  analyzedAt: string;

  // Core content
  abstract: string;
  keyContributions: string[];
  methodology: string;

  // Learning content
  keyConcepts: Array<{
    term: string;
    definition: string;
    importance: string;
  }>;

  prerequisites: string[];
  relatedPapers: string[];

  // Code & implementation
  codeExamples: Array<{
    description: string;
    pseudocode: string;
    language?: string;
  }>;

  implementationTips: string[];

  // Quiz questions for learning
  quizQuestions: Array<{
    question: string;
    options: string[];
    correctAnswer: number;
    explanation: string;
  }>;

  // Metadata
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  estimatedReadTime: number; // minutes
  tags: string[];
}

/**
 * Research Analysis API - AI-powered paper analysis
 *
 * GET /api/research-analyze?articleId=xxx - Get analysis for a paper
 * GET /api/research-analyze?action=list - List all analyzed papers
 * GET /api/research-analyze?action=stats - Get analysis statistics
 *
 * POST /api/research-analyze?action=analyze - Analyze a single paper
 *   body: { articleId, agentId }
 *
 * POST /api/research-analyze?action=analyze-batch - Analyze multiple papers
 *   body: { limit: 5, agentId }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action, articleId } = req.query;

    // GET: Single paper analysis
    if (req.method === 'GET' && articleId && typeof articleId === 'string') {
      const analysis = await redis.hget(ANALYSIS_KEY, articleId);
      if (!analysis) {
        return res.status(404).json({ error: 'Analysis not found. Run POST ?action=analyze first.' });
      }
      return res.json(typeof analysis === 'string' ? JSON.parse(analysis) : analysis);
    }

    // GET: List analyzed papers
    if (req.method === 'GET' && action === 'list') {
      const analyses = await redis.hgetall(ANALYSIS_KEY);
      const list = Object.entries(analyses || {}).map(([id, data]) => {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        return {
          articleId: id,
          title: parsed.title,
          difficulty: parsed.difficulty,
          analyzedAt: parsed.analyzedAt,
          conceptCount: parsed.keyConcepts?.length || 0,
          quizCount: parsed.quizQuestions?.length || 0,
        };
      });
      return res.json({ count: list.length, analyses: list });
    }

    // GET: Stats
    if (req.method === 'GET' && action === 'stats') {
      const analyses = await redis.hgetall(ANALYSIS_KEY);
      const articles: any[] = await redis.lrange(RESEARCH_KEY, 0, -1) || [];
      const withPdf = articles.filter(a => a.pdfS3Key).length;
      const analyzed = Object.keys(analyses || {}).length;

      return res.json({
        totalArticles: articles.length,
        withPdf,
        analyzed,
        pendingAnalysis: withPdf - analyzed,
        coverage: withPdf > 0 ? Math.round((analyzed / withPdf) * 100) : 0,
      });
    }

    // POST: Analyze single paper
    if (req.method === 'POST' && action === 'analyze') {
      const { articleId: targetId, agentId } = req.body;

      if (!targetId) {
        return res.status(400).json({ error: 'articleId required' });
      }

      const result = await analyzePaper(targetId, agentId || 'system');
      return res.status(result.success ? 200 : 400).json(result);
    }

    // POST: Batch analyze
    if (req.method === 'POST' && action === 'analyze-batch') {
      const { limit = 3, agentId } = req.body;

      // Get papers with PDFs that haven't been analyzed
      const articles: any[] = await redis.lrange(RESEARCH_KEY, 0, -1) || [];
      const analyses = await redis.hgetall(ANALYSIS_KEY) || {};

      const pending = articles
        .filter(a => a.pdfS3Key && !analyses[a.id])
        .slice(0, Math.min(limit, 3)); // Max 3 per batch due to API costs

      if (pending.length === 0) {
        return res.json({ message: 'No papers pending analysis', analyzed: 0 });
      }

      const results = [];
      for (const article of pending) {
        const result = await analyzePaper(article.id, agentId || 'system');
        results.push({ articleId: article.id, success: result.success });
      }

      return res.json({
        analyzed: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
      });
    }

    // Default: show usage
    return res.json({
      usage: {
        'GET ?articleId=xxx': 'Get analysis for specific paper',
        'GET ?action=list': 'List all analyzed papers',
        'GET ?action=stats': 'Get analysis statistics',
        'POST ?action=analyze': 'Analyze single paper (body: {articleId, agentId})',
        'POST ?action=analyze-batch': 'Analyze batch (body: {limit, agentId})',
      },
    });

  } catch (error) {
    console.error('Research analyze error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function analyzePaper(articleId: string, agentId: string): Promise<any> {
  try {
    // Get article metadata
    const articles: any[] = await redis.lrange(RESEARCH_KEY, 0, -1) || [];
    const article = articles.find(a => a.id === articleId);

    if (!article) {
      return { success: false, error: 'Article not found' };
    }

    if (!article.pdfS3Key) {
      return { success: false, error: 'PDF not available for this article' };
    }

    // Fetch PDF from S3
    const pdfResponse = await s3.send(new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: article.pdfS3Key,
    }));

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    const stream = pdfResponse.Body as any;
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const pdfBuffer = Buffer.concat(chunks);
    const pdfBase64 = pdfBuffer.toString('base64');

    // Use Claude to analyze the PDF
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: `Analyze this research paper and extract structured information for a learning platform.

Return a JSON object with this exact structure:
{
  "abstract": "Brief abstract/summary (2-3 sentences)",
  "keyContributions": ["contribution 1", "contribution 2", ...],
  "methodology": "Brief description of the approach/method",
  "keyConcepts": [
    {"term": "concept name", "definition": "clear definition", "importance": "why it matters"}
  ],
  "prerequisites": ["prerequisite knowledge 1", "prerequisite 2"],
  "relatedPapers": ["related paper title 1", "related paper 2"],
  "codeExamples": [
    {"description": "what this shows", "pseudocode": "simplified code/algorithm", "language": "python"}
  ],
  "implementationTips": ["tip 1", "tip 2"],
  "quizQuestions": [
    {
      "question": "question text",
      "options": ["A) option", "B) option", "C) option", "D) option"],
      "correctAnswer": 0,
      "explanation": "why this is correct"
    }
  ],
  "difficulty": "beginner|intermediate|advanced|expert",
  "estimatedReadTime": 30,
  "tags": ["tag1", "tag2"]
}

Generate 3-5 key concepts, 2-3 code examples, and 3-5 quiz questions. Be educational and clear.
Return ONLY valid JSON, no markdown or explanation.`,
            },
          ],
        },
      ],
    });

    // Parse Claude's response
    const content = response.content[0];
    if (content.type !== 'text') {
      return { success: false, error: 'Unexpected response format' };
    }

    let analysisData;
    try {
      // Clean up the response - remove any markdown code blocks
      let jsonText = content.text.trim();
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.slice(7);
      }
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.slice(3);
      }
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.slice(0, -3);
      }
      analysisData = JSON.parse(jsonText.trim());
    } catch (e) {
      return { success: false, error: 'Failed to parse analysis response', raw: content.text };
    }

    // Build full analysis object
    const analysis: PaperAnalysis = {
      articleId,
      title: article.title,
      analyzedAt: new Date().toISOString(),
      ...analysisData,
    };

    // Store in Redis
    await redis.hset(ANALYSIS_KEY, {
      [articleId]: JSON.stringify(analysis),
    });

    return {
      success: true,
      articleId,
      title: article.title,
      conceptCount: analysis.keyConcepts?.length || 0,
      quizCount: analysis.quizQuestions?.length || 0,
    };

  } catch (error: any) {
    console.error('Analysis error:', error);
    return { success: false, error: error.message };
  }
}
