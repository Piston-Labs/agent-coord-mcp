import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const FEATURES_KEY = 'agent-coord:planned-features';
const CHAT_KEY = 'agent-coord:messages';  // Chat messages stored here

interface PlannedFeature {
  id: string;
  title: string;
  description: string;
  status: 'suggested' | 'planned' | 'in-progress' | 'testing' | 'done';
  assignedTo: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  source: 'manual' | 'chat-extracted' | 'context';
  extractedFrom?: string;  // Message ID if extracted from chat
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

// Patterns to detect feature mentions in chat
const FEATURE_PATTERNS = [
  /(?:we should|need to|want to|gonna|going to)\s+(?:add|implement|build|create)\s+(.+?)(?:\.|,|$)/gi,
  /(?:add|implement)\s+(.+?)(?:\s+feature|\s+functionality|\s+support)?(?:\.|,|$)/gi,
  /(?:planned feature|todo|TODO):\s*(.+?)(?:\.|,|$)/gi,
  /(?:feature request|enhancement):\s*(.+?)(?:\.|,|$)/gi,
];

// Keywords for priority inference
const PRIORITY_KEYWORDS = {
  critical: ['critical', 'urgent', 'asap', 'immediately', 'blocking', 'broken'],
  high: ['important', 'priority', 'needed', 'must have', 'should have'],
  low: ['nice to have', 'eventually', 'someday', 'maybe', 'could have'],
};

/**
 * Extract potential features from a chat message
 */
function extractFeaturesFromMessage(message: string, messageId: string): Partial<PlannedFeature>[] {
  const extracted: Partial<PlannedFeature>[] = [];

  for (const pattern of FEATURE_PATTERNS) {
    let match;
    pattern.lastIndex = 0; // Reset regex state
    while ((match = pattern.exec(message)) !== null) {
      const title = match[1].trim();

      // Skip if too short or too long
      if (title.length < 5 || title.length > 100) continue;

      // Skip common false positives
      if (/^(it|this|that|the|a|an|some)\s/i.test(title)) continue;

      // Infer priority from context
      let priority: 'low' | 'medium' | 'high' | 'critical' = 'medium';
      const lowerMessage = message.toLowerCase();

      for (const [level, keywords] of Object.entries(PRIORITY_KEYWORDS)) {
        if (keywords.some(kw => lowerMessage.includes(kw))) {
          priority = level as typeof priority;
          break;
        }
      }

      extracted.push({
        title,
        description: `Extracted from chat: "${message.substring(0, 100)}..."`,
        priority,
        source: 'chat-extracted',
        extractedFrom: messageId,
        status: 'suggested',
      });
    }
  }

  return extracted;
}

/**
 * Check if a feature title is similar to existing features (de-duplication)
 */
function isSimilarFeature(title: string, existingTitles: string[]): boolean {
  const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  return existingTitles.some(existing => {
    const normalizedExisting = existing.toLowerCase().replace(/[^a-z0-9]/g, '');
    // Check for substring match or high similarity
    return normalizedExisting.includes(normalizedTitle) ||
           normalizedTitle.includes(normalizedExisting) ||
           normalizedExisting === normalizedTitle;
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List all planned features
    if (req.method === 'GET') {
      const features = await redis.hgetall(FEATURES_KEY) || {};
      const featureList: PlannedFeature[] = [];
      
      for (const [, value] of Object.entries(features)) {
        try {
          const feature = typeof value === 'string' ? JSON.parse(value) : value;
          if (feature.status !== 'done') {
            featureList.push(feature);
          }
        } catch (e) {
          console.error('Invalid feature entry:', e);
        }
      }
      
      // Sort by priority
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      featureList.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
      
      return res.json({ features: featureList, count: featureList.length });
    }

    // POST: Add a new planned feature OR extract from chat
    if (req.method === 'POST') {
      const { action, title, description, assignedTo, priority = 'medium', tags, messageLimit = 100 } = req.body;

      // ACTION: extract-from-chat - Scan recent chat for feature mentions
      if (action === 'extract-from-chat') {
        // Get recent chat messages
        const chatMessages = await redis.lrange(CHAT_KEY, 0, messageLimit - 1);

        if (!chatMessages || chatMessages.length === 0) {
          return res.json({ success: true, extracted: [], message: 'No chat messages found' });
        }

        // Get existing features to de-duplicate
        const existingFeatures = await redis.hgetall(FEATURES_KEY) || {};
        const existingTitles = Object.values(existingFeatures).map(f => {
          const feat = typeof f === 'string' ? JSON.parse(f) : f;
          return feat.title;
        });

        const allExtracted: PlannedFeature[] = [];
        const skippedDuplicates: string[] = [];

        for (const msgRaw of chatMessages) {
          const msg = typeof msgRaw === 'string' ? JSON.parse(msgRaw) : msgRaw;

          // Only process human messages (more likely to contain feature requests)
          // But also check agent messages for action items
          const potentialFeatures = extractFeaturesFromMessage(msg.message || '', msg.id || '');

          for (const potential of potentialFeatures) {
            // Check for duplicates
            if (isSimilarFeature(potential.title!, [...existingTitles, ...allExtracted.map(f => f.title)])) {
              skippedDuplicates.push(potential.title!);
              continue;
            }

            const feature: PlannedFeature = {
              id: `feat-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
              title: potential.title!,
              description: potential.description || '',
              status: 'suggested',
              assignedTo: 'unassigned',
              priority: potential.priority || 'medium',
              source: 'chat-extracted',
              extractedFrom: potential.extractedFrom,
              tags: ['auto-extracted'],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };

            allExtracted.push(feature);
            existingTitles.push(feature.title); // Prevent duplicates within batch
          }
        }

        // Save all extracted features
        if (allExtracted.length > 0) {
          const toSave: Record<string, string> = {};
          for (const feature of allExtracted) {
            toSave[feature.id] = JSON.stringify(feature);
          }
          await redis.hset(FEATURES_KEY, toSave);
        }

        return res.json({
          success: true,
          extracted: allExtracted,
          extractedCount: allExtracted.length,
          skippedDuplicates,
          skippedCount: skippedDuplicates.length,
          messagesScanned: chatMessages.length,
          message: `Extracted ${allExtracted.length} features from ${chatMessages.length} messages`
        });
      }

      // ACTION: confirm - Confirm a suggested feature (change status to planned)
      if (action === 'confirm') {
        const { id } = req.body;
        if (!id) {
          return res.status(400).json({ error: 'id required to confirm feature' });
        }

        const existing = await redis.hget(FEATURES_KEY, id);
        if (!existing) {
          return res.status(404).json({ error: 'Feature not found' });
        }

        const feature = typeof existing === 'string' ? JSON.parse(existing) : existing;
        feature.status = 'planned';
        feature.updatedAt = new Date().toISOString();

        await redis.hset(FEATURES_KEY, { [id]: JSON.stringify(feature) });
        return res.json({ success: true, feature, message: 'Feature confirmed and moved to planned' });
      }

      // ACTION: reject - Remove a suggested feature
      if (action === 'reject') {
        const { id } = req.body;
        if (!id) {
          return res.status(400).json({ error: 'id required to reject feature' });
        }

        await redis.hdel(FEATURES_KEY, id);
        return res.json({ success: true, deleted: id, message: 'Suggested feature rejected and removed' });
      }

      // DEFAULT: Add a new manual feature
      if (!title) {
        return res.status(400).json({ error: 'title is required (or use action: extract-from-chat)' });
      }

      const feature: PlannedFeature = {
        id: `feat-${Date.now().toString(36)}`,
        title,
        description: description || '',
        status: 'planned',
        assignedTo: assignedTo || 'unassigned',
        priority,
        source: 'manual',
        tags: tags || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await redis.hset(FEATURES_KEY, { [feature.id]: JSON.stringify(feature) });

      return res.json({ success: true, feature });
    }

    // PATCH: Update a feature
    if (req.method === 'PATCH') {
      const { id, ...updates } = req.body;
      
      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      const existing = await redis.hget(FEATURES_KEY, id);
      if (!existing) {
        return res.status(404).json({ error: 'Feature not found' });
      }

      const feature = typeof existing === 'string' ? JSON.parse(existing) : existing;
      const updated = { ...feature, ...updates, updatedAt: new Date().toISOString() };
      
      await redis.hset(FEATURES_KEY, { [id]: JSON.stringify(updated) });

      return res.json({ success: true, feature: updated });
    }

    // DELETE: Remove a feature
    if (req.method === 'DELETE') {
      const { id } = req.body;
      
      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      await redis.hdel(FEATURES_KEY, id);
      return res.json({ success: true, deleted: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Planned features error:', error);
    return res.status(500).json({ error: 'Database error', details: String(error) });
  }
}
