import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const RESEARCH_KEY = 'agent-coord:research-library';
const RESEARCH_INDEX_KEY = 'agent-coord:research-index';

interface ResearchSource {
  url: string;
  title: string;
  type: 'paper' | 'blog' | 'docs' | 'code' | 'discussion';
  accessedAt: string;
}

interface ResearchFinding {
  id: string;
  topic: string;                    // e.g., "titans", "miras", "vector-dbs"
  title: string;                    // e.g., "Google Titans Architecture"
  summary: string;                  // Executive summary
  keyInsights: string[];            // Bullet points
  technicalDetails?: string;        // Optional deep dive
  codeExamples?: string[];          // Code snippets
  limitations?: string[];           // Known issues/caveats
  applicationToHub?: string;        // How this applies to agent-coord-mcp
  sources: ResearchSource[];
  relatedMemoryIds?: string[];      // Links to memory entries
  tags: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  status: 'draft' | 'reviewed' | 'applied';  // Track if research has been implemented
}

interface ResearchSummary {
  topic: string;
  findingsCount: number;
  lastUpdated: string;
  keyTakeaways: string[];
  implementationStatus: {
    applied: number;
    reviewed: number;
    draft: number;
  };
}

function generateId(): string {
  return 'res-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 6);
}

/**
 * Research Library API - Structured research findings storage
 *
 * Designed to capture and organize research like Titans/MIRAS findings
 * with structured metadata, sources, and application notes.
 *
 * GET /api/research - List all findings or filter by topic/tag
 * GET /api/research?topic=titans - Filter by topic
 * GET /api/research?id=X - Get specific finding
 * GET /api/research?action=summary - Get executive summary by topic
 * GET /api/research?action=topics - List all topics with stats
 * POST /api/research - Create new finding
 * PATCH /api/research - Update finding
 * DELETE /api/research?id=X - Remove finding
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List/filter/summarize research
    if (req.method === 'GET') {
      const { action, topic, tag, id, status, limit = '50' } = req.query;

      // Get specific finding by ID
      if (id) {
        const finding = await redis.hget(RESEARCH_KEY, id as string);
        if (!finding) {
          return res.status(404).json({ error: 'Research finding not found' });
        }
        const parsed = typeof finding === 'string' ? JSON.parse(finding) : finding;
        return res.json({ finding: parsed });
      }

      // List all topics with stats
      if (action === 'topics') {
        const all = await redis.hgetall(RESEARCH_KEY) || {};
        const findings: ResearchFinding[] = Object.values(all)
          .map((f: any) => typeof f === 'string' ? JSON.parse(f) : f);

        const topicStats: Record<string, ResearchSummary> = {};

        for (const finding of findings) {
          if (!topicStats[finding.topic]) {
            topicStats[finding.topic] = {
              topic: finding.topic,
              findingsCount: 0,
              lastUpdated: finding.updatedAt,
              keyTakeaways: [],
              implementationStatus: { applied: 0, reviewed: 0, draft: 0 },
            };
          }

          const stat = topicStats[finding.topic];
          stat.findingsCount++;
          stat.implementationStatus[finding.status]++;

          if (new Date(finding.updatedAt) > new Date(stat.lastUpdated)) {
            stat.lastUpdated = finding.updatedAt;
          }

          // Collect key insights as takeaways
          if (finding.keyInsights.length > 0) {
            stat.keyTakeaways.push(...finding.keyInsights.slice(0, 2));
          }
        }

        // Dedupe and limit takeaways
        for (const topic of Object.keys(topicStats)) {
          topicStats[topic].keyTakeaways = [...new Set(topicStats[topic].keyTakeaways)].slice(0, 5);
        }

        return res.json({
          topics: Object.values(topicStats),
          totalFindings: findings.length,
        });
      }

      // Generate executive summary for a topic
      if (action === 'summary' && topic) {
        const all = await redis.hgetall(RESEARCH_KEY) || {};
        const findings: ResearchFinding[] = Object.values(all)
          .map((f: any) => typeof f === 'string' ? JSON.parse(f) : f)
          .filter((f: ResearchFinding) => f.topic.toLowerCase() === (topic as string).toLowerCase());

        if (findings.length === 0) {
          return res.status(404).json({ error: `No research found for topic: ${topic}` });
        }

        // Build executive summary
        const summary = {
          topic: topic as string,
          generatedAt: new Date().toISOString(),
          findingsCount: findings.length,

          // Aggregate key insights
          keyInsights: findings.flatMap(f => f.keyInsights).slice(0, 10),

          // Aggregate limitations
          limitations: findings.flatMap(f => f.limitations || []).slice(0, 5),

          // Aggregate application notes
          applicationNotes: findings
            .filter(f => f.applicationToHub)
            .map(f => ({ title: f.title, application: f.applicationToHub })),

          // Implementation status
          implementationStatus: {
            applied: findings.filter(f => f.status === 'applied').length,
            reviewed: findings.filter(f => f.status === 'reviewed').length,
            draft: findings.filter(f => f.status === 'draft').length,
          },

          // All sources
          sources: findings.flatMap(f => f.sources),

          // Related memories
          relatedMemories: [...new Set(findings.flatMap(f => f.relatedMemoryIds || []))],
        };

        return res.json({ summary });
      }

      // List findings with optional filters
      const all = await redis.hgetall(RESEARCH_KEY) || {};
      let findings: ResearchFinding[] = Object.values(all)
        .map((f: any) => typeof f === 'string' ? JSON.parse(f) : f);

      // Filter by topic
      if (topic) {
        findings = findings.filter(f =>
          f.topic.toLowerCase() === (topic as string).toLowerCase()
        );
      }

      // Filter by tag
      if (tag) {
        const tagLower = (tag as string).toLowerCase();
        findings = findings.filter(f =>
          f.tags.some(t => t.toLowerCase() === tagLower)
        );
      }

      // Filter by status
      if (status) {
        findings = findings.filter(f => f.status === status);
      }

      // Sort by updatedAt descending
      findings.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      // Apply limit
      const limitNum = parseInt(limit as string) || 50;
      findings = findings.slice(0, limitNum);

      return res.json({
        findings,
        count: findings.length,
      });
    }

    // POST: Create new research finding
    if (req.method === 'POST') {
      let body: any;
      try {
        body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const {
        topic,
        title,
        summary,
        keyInsights,
        technicalDetails,
        codeExamples,
        limitations,
        applicationToHub,
        sources,
        relatedMemoryIds,
        tags,
        createdBy,
      } = body;

      if (!topic || !title || !summary) {
        return res.status(400).json({
          error: 'topic, title, and summary are required'
        });
      }

      const finding: ResearchFinding = {
        id: generateId(),
        topic: topic.toLowerCase(),
        title,
        summary,
        keyInsights: keyInsights || [],
        technicalDetails: technicalDetails || undefined,
        codeExamples: codeExamples || undefined,
        limitations: limitations || undefined,
        applicationToHub: applicationToHub || undefined,
        sources: sources || [],
        relatedMemoryIds: relatedMemoryIds || [],
        tags: (tags || []).map((t: string) => t.toLowerCase()),
        createdBy: createdBy || 'unknown',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'draft',
      };

      await redis.hset(RESEARCH_KEY, { [finding.id]: JSON.stringify(finding) });

      // Update topic index
      await redis.sadd(`${RESEARCH_INDEX_KEY}:topic:${finding.topic}`, finding.id);

      // Update tag indices
      for (const t of finding.tags) {
        await redis.sadd(`${RESEARCH_INDEX_KEY}:tag:${t}`, finding.id);
      }

      return res.json({
        success: true,
        finding,
        message: 'Research finding stored successfully',
      });
    }

    // PATCH: Update finding
    if (req.method === 'PATCH') {
      let body: any;
      try {
        body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const { id, ...updates } = body;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      const existing = await redis.hget(RESEARCH_KEY, id);
      if (!existing) {
        return res.status(404).json({ error: 'Research finding not found' });
      }

      const finding: ResearchFinding = typeof existing === 'string'
        ? JSON.parse(existing)
        : existing;

      // Apply updates
      if (updates.title) finding.title = updates.title;
      if (updates.summary) finding.summary = updates.summary;
      if (updates.keyInsights) finding.keyInsights = updates.keyInsights;
      if (updates.technicalDetails !== undefined) finding.technicalDetails = updates.technicalDetails;
      if (updates.codeExamples) finding.codeExamples = updates.codeExamples;
      if (updates.limitations) finding.limitations = updates.limitations;
      if (updates.applicationToHub !== undefined) finding.applicationToHub = updates.applicationToHub;
      if (updates.sources) finding.sources = updates.sources;
      if (updates.relatedMemoryIds) finding.relatedMemoryIds = updates.relatedMemoryIds;
      if (updates.status) finding.status = updates.status;

      // Handle tag updates
      if (updates.tags) {
        // Remove from old tag indices
        for (const t of finding.tags) {
          await redis.srem(`${RESEARCH_INDEX_KEY}:tag:${t}`, id);
        }
        // Add to new tag indices
        finding.tags = updates.tags.map((t: string) => t.toLowerCase());
        for (const t of finding.tags) {
          await redis.sadd(`${RESEARCH_INDEX_KEY}:tag:${t}`, id);
        }
      }

      finding.updatedAt = new Date().toISOString();

      await redis.hset(RESEARCH_KEY, { [id]: JSON.stringify(finding) });

      return res.json({ success: true, finding });
    }

    // DELETE: Remove finding
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'id query param required' });
      }

      const existing = await redis.hget(RESEARCH_KEY, id as string);
      if (existing) {
        const finding: ResearchFinding = typeof existing === 'string'
          ? JSON.parse(existing)
          : existing;

        // Clean up indices
        await redis.srem(`${RESEARCH_INDEX_KEY}:topic:${finding.topic}`, id as string);
        for (const t of finding.tags) {
          await redis.srem(`${RESEARCH_INDEX_KEY}:tag:${t}`, id as string);
        }
      }

      await redis.hdel(RESEARCH_KEY, id as string);

      return res.json({ success: true, deleted: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Research API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
