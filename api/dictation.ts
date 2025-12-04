import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { createHash } from 'crypto';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// AWS SDK imports for S3 and DynamoDB
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand, ScanCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';

const DICTATION_CACHE_KEY = 'piston:dictation:cache';
const DICTATION_ANALYSIS_KEY = 'piston:dictation:analysis';

// AWS clients
const hasAWSCredentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = process.env.AWS_REGION || 'us-west-1';

const s3 = hasAWSCredentials ? new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  }
}) : null;

const dynamodb = hasAWSCredentials ? new DynamoDBClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  }
}) : null;

const S3_BUCKET = process.env.DICTATION_S3_BUCKET || 'piston-context-content';
const DYNAMODB_TABLE = process.env.DICTATION_DYNAMODB_TABLE || 'context-documents';

// Anthropic for analysis
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * Dictation API - Store, analyze, and manage voice dictations
 *
 * Storage: S3 for content files, DynamoDB for metadata
 * Analysis: Claude for context extraction and CRM updates
 *
 * GET /api/dictation - List all dictations
 * GET /api/dictation?id=xxx - Get specific dictation
 * GET /api/dictation?type=meeting - Filter by type
 * GET /api/dictation?shopId=xxx - Get dictations for a shop
 * GET /api/dictation?search=keyword - Search dictations
 * POST /api/dictation - Upload new dictation
 * POST /api/dictation with analyze=true - Analyze dictation and extract context
 * DELETE /api/dictation?id=xxx - Remove dictation
 */

interface Dictation {
  id: string;
  type: 'dictation' | 'meeting' | 'call' | 'note' | 'research';
  title: string;
  summary?: string;
  content: string;
  contentHash: string;  // For deduplication
  contentLength: number;
  contentPreview: string;
  // Metadata
  filename: string;
  mimeType: string;
  fileSize: number;
  // S3 location
  s3Key: string;
  s3Url: string;
  // Organization
  tags: string[];
  shopId?: string;  // Link to CRM shop
  contactName?: string;
  // Analysis results
  extractedEntities?: {
    people: string[];
    companies: string[];
    products: string[];
    actionItems: string[];
    keyDecisions: string[];
    followUps: string[];
  };
  sentiment?: 'positive' | 'neutral' | 'negative';
  topics?: string[];
  crmUpdates?: {
    field: string;
    oldValue?: string;
    newValue: string;
    applied: boolean;
  }[];
  // Timestamps
  createdAt: string;
  analyzedAt?: string;
  createdBy?: string;
}

// Generate content hash for deduplication
function generateContentHash(content: string): string {
  return createHash('sha256').update(content.trim().toLowerCase()).digest('hex').substring(0, 16);
}

// Generate short ID
function generateId(): string {
  return `doc-${createHash('md5').update(Date.now().toString() + Math.random().toString()).digest('hex').substring(0, 12)}`;
}

// Check for duplicate content
async function checkDuplicate(contentHash: string): Promise<Dictation | null> {
  if (!dynamodb) return null;

  try {
    const result = await dynamodb.send(new ScanCommand({
      TableName: DYNAMODB_TABLE,
      FilterExpression: 'content_hash = :hash',
      ExpressionAttributeValues: {
        ':hash': { S: contentHash }
      },
      Limit: 1
    }));

    if (result.Items && result.Items.length > 0) {
      const item = result.Items[0];
      return {
        id: item.id?.S || '',
        type: (item.type?.S as Dictation['type']) || 'dictation',
        title: item.title?.S || '',
        summary: item.summary?.S,
        content: '',  // Don't load full content for duplicate check
        contentHash: item.content_hash?.S || '',
        contentLength: parseInt(item.content_length?.N || '0'),
        contentPreview: item.content_preview?.S || '',
        filename: item.filename?.S || '',
        mimeType: item.mime_type?.S || 'text/plain',
        fileSize: parseInt(item.file_size?.N || '0'),
        s3Key: item.s3_key?.S || '',
        s3Url: item.s3_url?.S || '',
        tags: item.tags?.L?.map(t => t.S || '') || [],
        shopId: item.shop_id?.S,
        createdAt: item.created_at?.S || ''
      };
    }
  } catch (err) {
    console.error('Duplicate check error:', err);
  }

  return null;
}

// Analyze dictation content with Claude
async function analyzeDictation(content: string, shopContext?: any): Promise<{
  summary: string;
  tags: string[];
  extractedEntities: Dictation['extractedEntities'];
  sentiment: Dictation['sentiment'];
  topics: string[];
  crmUpdates: Dictation['crmUpdates'];
}> {
  if (!ANTHROPIC_API_KEY) {
    return {
      summary: content.substring(0, 200) + '...',
      tags: [],
      extractedEntities: { people: [], companies: [], products: [], actionItems: [], keyDecisions: [], followUps: [] },
      sentiment: 'neutral',
      topics: [],
      crmUpdates: []
    };
  }

  const shopContextStr = shopContext ? `
Current shop/customer context:
- Name: ${shopContext.name}
- Stage: ${shopContext.stage}
- Contact: ${shopContext.contactName}
- Notes: ${shopContext.notes || 'None'}
` : '';

  const prompt = `Analyze this dictation/meeting transcript and extract structured information.

${shopContextStr}

DICTATION CONTENT:
"""
${content}
"""

Respond with a JSON object containing:
{
  "summary": "2-3 sentence summary of the key points",
  "tags": ["relevant", "tags", "for", "categorization"],
  "extractedEntities": {
    "people": ["names mentioned"],
    "companies": ["company names"],
    "products": ["products/services discussed"],
    "actionItems": ["specific action items identified"],
    "keyDecisions": ["decisions made"],
    "followUps": ["things to follow up on"]
  },
  "sentiment": "positive" | "neutral" | "negative",
  "topics": ["main topics discussed"],
  "crmUpdates": [
    {
      "field": "CRM field to update (e.g., stage, notes, nextAction, specialty, monthlyVolume)",
      "newValue": "suggested new value",
      "reason": "why this update is suggested"
    }
  ]
}

Focus on extracting actionable insights. For CRM updates, only suggest changes that are clearly indicated in the content.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content[0]?.text || '{}';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || content.substring(0, 200) + '...',
        tags: parsed.tags || [],
        extractedEntities: parsed.extractedEntities || { people: [], companies: [], products: [], actionItems: [], keyDecisions: [], followUps: [] },
        sentiment: parsed.sentiment || 'neutral',
        topics: parsed.topics || [],
        crmUpdates: (parsed.crmUpdates || []).map((u: any) => ({
          field: u.field,
          newValue: u.newValue,
          applied: false
        }))
      };
    }
  } catch (err) {
    console.error('Analysis error:', err);
  }

  return {
    summary: content.substring(0, 200) + '...',
    tags: [],
    extractedEntities: { people: [], companies: [], products: [], actionItems: [], keyDecisions: [], followUps: [] },
    sentiment: 'neutral',
    topics: [],
    crmUpdates: []
  };
}

// Apply CRM updates from dictation analysis
async function applyCrmUpdates(shopId: string, updates: Dictation['crmUpdates']): Promise<{ applied: number; errors: string[] }> {
  if (!updates || updates.length === 0) {
    return { applied: 0, errors: [] };
  }

  const errors: string[] = [];
  let applied = 0;

  try {
    // Get current shop data
    const shopRaw = await redis.hget('piston:crm:shops', shopId);
    if (!shopRaw) {
      return { applied: 0, errors: ['Shop not found'] };
    }

    const shop = typeof shopRaw === 'string' ? JSON.parse(shopRaw) : shopRaw;

    // Apply each update
    for (const update of updates) {
      if (!update) continue;

      try {
        const field = update.field;
        const allowedFields = ['notes', 'nextAction', 'nextActionDue', 'stage', 'specialty',
                              'monthlyVolume', 'contactName', 'contactEmail', 'contactPhone',
                              'devicesNeeded', 'estMonthlyValue'];

        if (allowedFields.includes(field)) {
          // Store old value for audit
          update.oldValue = shop[field];

          // Apply update
          if (field === 'notes') {
            // Append to notes instead of replacing
            shop.notes = shop.notes ? `${shop.notes}\n\n[Auto-extracted ${new Date().toISOString().split('T')[0]}]: ${update.newValue}` : update.newValue;
          } else if (field === 'stage') {
            const validStages = ['prospect', 'qualified', 'demo', 'proposal', 'customer', 'churned'];
            if (validStages.includes(update.newValue)) {
              shop[field] = update.newValue;
            } else {
              errors.push(`Invalid stage value: ${update.newValue}`);
              continue;
            }
          } else {
            shop[field] = update.newValue;
          }

          update.applied = true;
          applied++;
        } else {
          errors.push(`Field not allowed for auto-update: ${field}`);
        }
      } catch (err) {
        errors.push(`Error updating ${update.field}: ${err}`);
      }
    }

    // Save updated shop
    shop.lastContact = new Date().toISOString();
    await redis.hset('piston:crm:shops', { [shopId]: JSON.stringify(shop) });

  } catch (err) {
    errors.push(`Shop update error: ${err}`);
  }

  return { applied, errors };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check AWS credentials
  if (!hasAWSCredentials) {
    return res.status(503).json({
      error: 'AWS credentials not configured',
      hint: 'Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables'
    });
  }

  try {
    // GET: List or retrieve dictations
    if (req.method === 'GET') {
      const { id, type, shopId, search, limit = '50' } = req.query;

      // Get single dictation by ID
      if (id) {
        const result = await dynamodb!.send(new GetItemCommand({
          TableName: DYNAMODB_TABLE,
          Key: { id: { S: String(id) } }
        }));

        if (!result.Item) {
          return res.status(404).json({ error: 'Dictation not found' });
        }

        // Get content from S3
        let content = '';
        try {
          const s3Result = await s3!.send(new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: result.Item.s3_key?.S || ''
          }));
          content = await s3Result.Body?.transformToString() || '';
        } catch (err) {
          console.error('S3 fetch error:', err);
        }

        // Get analysis from cache if exists
        const analysisRaw = await redis.hget(DICTATION_ANALYSIS_KEY, String(id));
        const analysis = analysisRaw ? (typeof analysisRaw === 'string' ? JSON.parse(analysisRaw) : analysisRaw) : null;

        const dictation: Dictation = {
          id: result.Item.id?.S || '',
          type: (result.Item.type?.S as Dictation['type']) || 'dictation',
          title: result.Item.title?.S || '',
          summary: result.Item.summary?.S || analysis?.summary,
          content,
          contentHash: result.Item.content_hash?.S || '',
          contentLength: parseInt(result.Item.content_length?.N || '0'),
          contentPreview: result.Item.content_preview?.S || '',
          filename: result.Item.filename?.S || '',
          mimeType: result.Item.mime_type?.S || 'text/plain',
          fileSize: parseInt(result.Item.file_size?.N || '0'),
          s3Key: result.Item.s3_key?.S || '',
          s3Url: result.Item.s3_url?.S || '',
          tags: result.Item.tags?.L?.map(t => t.S || '') || [],
          shopId: result.Item.shop_id?.S,
          contactName: result.Item.contact_name?.S,
          createdAt: result.Item.created_at?.S || '',
          createdBy: result.Item.created_by?.S,
          ...(analysis || {})
        };

        return res.json({ dictation });
      }

      // List dictations with filters
      let filterExpression = '';
      const expressionValues: Record<string, any> = {};
      const expressionNames: Record<string, string> = {};

      if (type) {
        filterExpression = '#type = :type';
        expressionValues[':type'] = { S: String(type) };
        expressionNames['#type'] = 'type';
      }

      if (shopId) {
        if (filterExpression) filterExpression += ' AND ';
        filterExpression += 'shop_id = :shopId';
        expressionValues[':shopId'] = { S: String(shopId) };
      }

      const scanParams: any = {
        TableName: DYNAMODB_TABLE,
        Limit: parseInt(String(limit))
      };

      if (filterExpression) {
        scanParams.FilterExpression = filterExpression;
        scanParams.ExpressionAttributeValues = expressionValues;
        if (Object.keys(expressionNames).length > 0) {
          scanParams.ExpressionAttributeNames = expressionNames;
        }
      }

      const result = await dynamodb!.send(new ScanCommand(scanParams));

      let dictations = (result.Items || []).map(item => ({
        id: item.id?.S || '',
        type: item.type?.S || 'dictation',
        title: item.title?.S || '',
        summary: item.summary?.S || '',
        contentLength: parseInt(item.content_length?.N || '0'),
        contentPreview: item.content_preview?.S || '',
        filename: item.filename?.S || '',
        tags: item.tags?.L?.map(t => t.S || '') || [],
        shopId: item.shop_id?.S,
        contactName: item.contact_name?.S,
        createdAt: item.created_at?.S || '',
        createdBy: item.created_by?.S
      }));

      // Search filter (client-side for now)
      if (search) {
        const searchLower = String(search).toLowerCase();
        dictations = dictations.filter(d =>
          d.title.toLowerCase().includes(searchLower) ||
          d.summary.toLowerCase().includes(searchLower) ||
          d.contentPreview.toLowerCase().includes(searchLower) ||
          d.tags.some(t => t.toLowerCase().includes(searchLower))
        );
      }

      // Sort by createdAt descending
      dictations.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Get stats
      const stats = {
        total: dictations.length,
        byType: {
          dictation: dictations.filter(d => d.type === 'dictation').length,
          meeting: dictations.filter(d => d.type === 'meeting').length,
          call: dictations.filter(d => d.type === 'call').length,
          note: dictations.filter(d => d.type === 'note').length,
          research: dictations.filter(d => d.type === 'research').length
        },
        linkedToShops: dictations.filter(d => d.shopId).length,
        totalContentSize: dictations.reduce((sum, d) => sum + d.contentLength, 0)
      };

      return res.json({ dictations, stats });
    }

    // POST: Upload or analyze dictation
    if (req.method === 'POST') {
      const body = req.body || {};
      const {
        content,
        title,
        type = 'dictation',
        filename,
        tags = [],
        shopId,
        contactName,
        createdBy,
        analyze = false,
        applyCrm = false
      } = body;

      if (!content) {
        return res.status(400).json({ error: 'content is required' });
      }

      // Generate content hash for deduplication
      const contentHash = generateContentHash(content);

      // Check for duplicates
      const duplicate = await checkDuplicate(contentHash);
      if (duplicate) {
        return res.status(409).json({
          error: 'Duplicate content detected',
          existingDocument: {
            id: duplicate.id,
            title: duplicate.title,
            createdAt: duplicate.createdAt,
            s3Url: duplicate.s3Url
          },
          hint: 'Use force=true to upload anyway, or use the existing document'
        });
      }

      // Generate ID and prepare document
      const id = generateId();
      const now = new Date().toISOString();
      const s3Key = `dictation/${id}/${filename || 'content.txt'}`;
      const s3Url = `s3://${S3_BUCKET}/${s3Key}`;
      const contentPreview = content.substring(0, 500);

      // Upload content to S3
      await s3!.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: content,
        ContentType: 'text/plain'
      }));

      // Analyze if requested
      let analysis: Awaited<ReturnType<typeof analyzeDictation>> | null = null;
      let crmResult: { applied: number; errors: string[] } | null = null;

      if (analyze) {
        // Get shop context if shopId provided
        let shopContext = null;
        if (shopId) {
          const shopRaw = await redis.hget('piston:crm:shops', shopId);
          if (shopRaw) {
            shopContext = typeof shopRaw === 'string' ? JSON.parse(shopRaw) : shopRaw;
          }
        }

        analysis = await analyzeDictation(content, shopContext);

        // Cache analysis
        await redis.hset(DICTATION_ANALYSIS_KEY, { [id]: JSON.stringify(analysis) });

        // Apply CRM updates if requested
        if (applyCrm && shopId && analysis.crmUpdates && analysis.crmUpdates.length > 0) {
          crmResult = await applyCrmUpdates(shopId, analysis.crmUpdates);
        }
      }

      // Store metadata in DynamoDB
      const dynamoItem: Record<string, any> = {
        id: { S: id },
        type: { S: type },
        title: { S: title || `${type.charAt(0).toUpperCase() + type.slice(1)} - ${now.split('T')[0]}` },
        content_hash: { S: contentHash },
        content_length: { N: String(content.length) },
        content_preview: { S: contentPreview },
        filename: { S: filename || 'content.txt' },
        mime_type: { S: 'text/plain' },
        file_size: { N: String(content.length) },
        s3_key: { S: s3Key },
        s3_url: { S: s3Url },
        tags: { L: [...tags, ...(analysis?.tags || [])].map(t => ({ S: t })) },
        created_at: { S: now }
      };

      if (analysis?.summary) {
        dynamoItem.summary = { S: analysis.summary };
      }
      if (shopId) {
        dynamoItem.shop_id = { S: shopId };
      }
      if (contactName) {
        dynamoItem.contact_name = { S: contactName };
      }
      if (createdBy) {
        dynamoItem.created_by = { S: createdBy };
      }

      await dynamodb!.send(new PutItemCommand({
        TableName: DYNAMODB_TABLE,
        Item: dynamoItem
      }));

      // If linked to a shop, add as activity
      if (shopId) {
        const activityId = `act-dict-${Date.now()}`;
        const activity = {
          id: activityId,
          shopId,
          type: type === 'call' ? 'call' : type === 'meeting' ? 'meeting' : 'note',
          author: createdBy || 'system',
          content: `[Dictation: ${title || id}] ${analysis?.summary || contentPreview}`,
          timestamp: now,
          dictationId: id
        };
        await redis.hset('piston:crm:activities', { [activityId]: JSON.stringify(activity) });
      }

      const response: any = {
        success: true,
        dictation: {
          id,
          type,
          title: title || `${type.charAt(0).toUpperCase() + type.slice(1)} - ${now.split('T')[0]}`,
          contentHash,
          contentLength: content.length,
          s3Key,
          s3Url,
          tags: [...tags, ...(analysis?.tags || [])],
          shopId,
          createdAt: now
        }
      };

      if (analysis) {
        response.analysis = analysis;
      }

      if (crmResult) {
        response.crmUpdates = crmResult;
      }

      return res.json(response);
    }

    // DELETE: Remove dictation
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      // Get document to find S3 key
      const result = await dynamodb!.send(new GetItemCommand({
        TableName: DYNAMODB_TABLE,
        Key: { id: { S: String(id) } }
      }));

      if (!result.Item) {
        return res.status(404).json({ error: 'Dictation not found' });
      }

      const s3Key = result.Item.s3_key?.S;

      // Delete from S3
      if (s3Key) {
        try {
          await s3!.send(new DeleteObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key
          }));
        } catch (err) {
          console.error('S3 delete error:', err);
        }
      }

      // Delete from DynamoDB
      await dynamodb!.send(new DeleteItemCommand({
        TableName: DYNAMODB_TABLE,
        Key: { id: { S: String(id) } }
      }));

      // Delete analysis cache
      await redis.hdel(DICTATION_ANALYSIS_KEY, String(id));

      return res.json({ success: true, deleted: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Dictation API error:', error);
    return res.status(500).json({ error: String(error) });
  }
}
