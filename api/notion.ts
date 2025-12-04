import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// Cache for Notion data
const NOTION_CACHE_KEY = 'agent-coord:notion-cache';
const CACHE_TTL_SECONDS = 300; // 5 minutes

/**
 * Notion Integration API - Knowledge base and documentation
 *
 * GET /api/notion - Search pages
 * GET /api/notion?action=search&query=X - Search for pages/databases
 * GET /api/notion?action=page&pageId=X - Get page content
 * GET /api/notion?action=database&databaseId=X - Get database info
 * GET /api/notion?action=query&databaseId=X - Query database entries
 * GET /api/notion?action=databases - List all databases
 *
 * Note: Requires NOTION_TOKEN env var for real Notion integration.
 * Falls back to mock data for demo purposes.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action = 'search', pageId, databaseId, query, limit = '25' } = req.query;
    const limitNum = Math.min(parseInt(limit as string, 10), 100);

    // Validate required parameters first (before mock data check)
    switch (action) {
      case 'page':
        if (!pageId) {
          return res.status(400).json({ error: 'pageId required' });
        }
        break;
      case 'database':
        if (!databaseId) {
          return res.status(400).json({ error: 'databaseId required' });
        }
        break;
      case 'query':
        if (!databaseId) {
          return res.status(400).json({ error: 'databaseId required for query' });
        }
        break;
      case 'search':
      case 'databases':
        break;
      default:
        return res.status(400).json({
          error: `Unknown action: ${action}`,
          validActions: ['search', 'page', 'database', 'query', 'databases']
        });
    }

    // Check for Notion token - return mock data if not configured
    if (!NOTION_TOKEN) {
      return res.json(getMockData(action as string, { pageId: pageId as string, databaseId: databaseId as string, query: query as string }));
    }

    // Handle real Notion API calls
    switch (action) {
      case 'search':
        return res.json(await searchNotion(query as string, limitNum));
      case 'page':
        return res.json(await getPage(pageId as string));
      case 'database':
        return res.json(await getDatabase(databaseId as string));
      case 'query':
        return res.json(await queryDatabase(databaseId as string, limitNum));
      case 'databases':
        return res.json(await listDatabases());
    }

  } catch (error) {
    console.error('Notion API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}

// Fetch from Notion API with caching
async function notionFetch(endpoint: string, options: { method?: string; body?: any; cacheKey?: string } = {}): Promise<any> {
  const { method = 'GET', body, cacheKey } = options;

  // Check cache first (only for GET requests)
  if (cacheKey && method === 'GET') {
    const cached = await redis.get(`${NOTION_CACHE_KEY}:${cacheKey}`);
    if (cached) {
      return typeof cached === 'string' ? JSON.parse(cached) : cached;
    }
  }

  const fetchOptions: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION
    }
  };

  if (body) {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(`${NOTION_API_BASE}${endpoint}`, fetchOptions);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Notion API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  // Cache the result
  if (cacheKey) {
    await redis.set(`${NOTION_CACHE_KEY}:${cacheKey}`, JSON.stringify(data), { ex: CACHE_TTL_SECONDS });
  }

  return data;
}

async function searchNotion(query: string, limit: number): Promise<any> {
  const searchBody: any = {
    page_size: limit
  };

  if (query) {
    searchBody.query = query;
  }

  const data = await notionFetch('/search', {
    method: 'POST',
    body: searchBody,
    cacheKey: query ? `search-${query}` : 'search-all'
  });

  return {
    results: data.results.map((item: any) => ({
      id: item.id,
      type: item.object,
      title: extractTitle(item),
      url: item.url,
      createdTime: item.created_time,
      lastEditedTime: item.last_edited_time,
      archived: item.archived
    })),
    count: data.results.length,
    hasMore: data.has_more
  };
}

async function getPage(pageId: string): Promise<any> {
  const [page, blocks] = await Promise.all([
    notionFetch(`/pages/${pageId}`, { cacheKey: `page-${pageId}` }),
    notionFetch(`/blocks/${pageId}/children`, { cacheKey: `blocks-${pageId}` })
  ]);

  return {
    id: page.id,
    title: extractTitle(page),
    url: page.url,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
    properties: page.properties,
    content: blocks.results.map((block: any) => ({
      id: block.id,
      type: block.type,
      text: extractBlockText(block)
    }))
  };
}

async function getDatabase(databaseId: string): Promise<any> {
  const db = await notionFetch(`/databases/${databaseId}`, { cacheKey: `db-${databaseId}` });

  return {
    id: db.id,
    title: extractTitle(db),
    url: db.url,
    properties: Object.entries(db.properties).map(([name, prop]: [string, any]) => ({
      name,
      type: prop.type,
      id: prop.id
    })),
    createdTime: db.created_time,
    lastEditedTime: db.last_edited_time
  };
}

async function queryDatabase(databaseId: string, limit: number): Promise<any> {
  const data = await notionFetch(`/databases/${databaseId}/query`, {
    method: 'POST',
    body: { page_size: limit },
    cacheKey: `query-${databaseId}`
  });

  return {
    databaseId,
    entries: data.results.map((item: any) => ({
      id: item.id,
      title: extractTitle(item),
      url: item.url,
      properties: item.properties,
      createdTime: item.created_time,
      lastEditedTime: item.last_edited_time
    })),
    count: data.results.length,
    hasMore: data.has_more
  };
}

async function listDatabases(): Promise<any> {
  const data = await notionFetch('/search', {
    method: 'POST',
    body: {
      filter: { property: 'object', value: 'database' },
      page_size: 100
    },
    cacheKey: 'databases-list'
  });

  return {
    databases: data.results.map((db: any) => ({
      id: db.id,
      title: extractTitle(db),
      url: db.url,
      createdTime: db.created_time,
      lastEditedTime: db.last_edited_time
    })),
    count: data.results.length
  };
}

// Helper: Extract title from Notion object
function extractTitle(obj: any): string {
  // Try title property (databases)
  if (obj.title && Array.isArray(obj.title)) {
    return obj.title.map((t: any) => t.plain_text).join('');
  }

  // Try properties.title (pages)
  if (obj.properties?.title?.title) {
    return obj.properties.title.title.map((t: any) => t.plain_text).join('');
  }

  // Try properties.Name (common in databases)
  if (obj.properties?.Name?.title) {
    return obj.properties.Name.title.map((t: any) => t.plain_text).join('');
  }

  // Fallback
  return 'Untitled';
}

// Helper: Extract text from block
function extractBlockText(block: any): string {
  const content = block[block.type];
  if (!content) return '';

  // Rich text blocks
  if (content.rich_text) {
    return content.rich_text.map((t: any) => t.plain_text).join('');
  }

  // Caption for images, etc.
  if (content.caption) {
    return content.caption.map((t: any) => t.plain_text).join('');
  }

  return '';
}

// Mock data for when NOTION_TOKEN is not configured
function getMockData(action: string, params: { pageId?: string; databaseId?: string; query?: string }): any {
  const base = {
    _note: 'Mock data - set NOTION_TOKEN env var for real Notion integration',
    _hint: 'Get your integration token from https://www.notion.so/my-integrations'
  };

  const mockPages = [
    {
      id: 'mock-page-1',
      type: 'page',
      title: 'Product Roadmap Q1 2025',
      url: 'https://notion.so/mock-page-1',
      createdTime: '2025-01-15T10:00:00Z',
      lastEditedTime: '2025-12-01T14:30:00Z',
      archived: false
    },
    {
      id: 'mock-page-2',
      type: 'page',
      title: 'Fleet Management API Documentation',
      url: 'https://notion.so/mock-page-2',
      createdTime: '2025-02-01T09:00:00Z',
      lastEditedTime: '2025-11-28T16:00:00Z',
      archived: false
    },
    {
      id: 'mock-page-3',
      type: 'page',
      title: 'Sales Playbook - Teltonika Devices',
      url: 'https://notion.so/mock-page-3',
      createdTime: '2025-03-10T11:00:00Z',
      lastEditedTime: '2025-12-02T10:00:00Z',
      archived: false
    }
  ];

  const mockDatabases = [
    {
      id: 'mock-db-1',
      title: 'Customer Leads',
      url: 'https://notion.so/mock-db-1',
      createdTime: '2025-01-01T00:00:00Z',
      lastEditedTime: '2025-12-03T12:00:00Z'
    },
    {
      id: 'mock-db-2',
      title: 'Feature Requests',
      url: 'https://notion.so/mock-db-2',
      createdTime: '2025-02-15T00:00:00Z',
      lastEditedTime: '2025-12-02T18:00:00Z'
    }
  ];

  switch (action) {
    case 'search':
      let results = [...mockPages];
      if (params.query) {
        const q = params.query.toLowerCase();
        results = results.filter(p => p.title.toLowerCase().includes(q));
      }
      return {
        ...base,
        results,
        count: results.length,
        hasMore: false
      };

    case 'page':
      const page = mockPages.find(p => p.id === params.pageId) || mockPages[0];
      return {
        ...base,
        ...page,
        properties: {
          Status: { type: 'select', select: { name: 'In Progress' } },
          Owner: { type: 'people', people: [] }
        },
        content: [
          { id: 'block-1', type: 'heading_1', text: 'Overview' },
          { id: 'block-2', type: 'paragraph', text: 'This is mock content for the Notion integration demo.' },
          { id: 'block-3', type: 'heading_2', text: 'Key Features' },
          { id: 'block-4', type: 'bulleted_list_item', text: 'Real-time GPS tracking' },
          { id: 'block-5', type: 'bulleted_list_item', text: 'Fleet analytics dashboard' },
          { id: 'block-6', type: 'bulleted_list_item', text: 'Maintenance scheduling' }
        ]
      };

    case 'database':
      const db = mockDatabases.find(d => d.id === params.databaseId) || mockDatabases[0];
      return {
        ...base,
        ...db,
        properties: [
          { name: 'Name', type: 'title', id: 'title' },
          { name: 'Status', type: 'select', id: 'status' },
          { name: 'Priority', type: 'select', id: 'priority' },
          { name: 'Due Date', type: 'date', id: 'due' },
          { name: 'Assigned To', type: 'people', id: 'assigned' }
        ]
      };

    case 'query':
      return {
        ...base,
        databaseId: params.databaseId || 'mock-db-1',
        entries: [
          {
            id: 'entry-1',
            title: 'Acme Fleet Services',
            url: 'https://notion.so/entry-1',
            properties: {
              Name: { title: [{ plain_text: 'Acme Fleet Services' }] },
              Status: { select: { name: 'Active Lead' } },
              Priority: { select: { name: 'High' } }
            },
            createdTime: '2025-11-01T00:00:00Z',
            lastEditedTime: '2025-12-01T00:00:00Z'
          },
          {
            id: 'entry-2',
            title: 'Metro Logistics Co',
            url: 'https://notion.so/entry-2',
            properties: {
              Name: { title: [{ plain_text: 'Metro Logistics Co' }] },
              Status: { select: { name: 'Demo Scheduled' } },
              Priority: { select: { name: 'Medium' } }
            },
            createdTime: '2025-11-15T00:00:00Z',
            lastEditedTime: '2025-11-30T00:00:00Z'
          }
        ],
        count: 2,
        hasMore: false
      };

    case 'databases':
      return {
        ...base,
        databases: mockDatabases,
        count: mockDatabases.length
      };

    default:
      return { ...base, error: 'Unknown action' };
  }
}
