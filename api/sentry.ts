import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN;
const SENTRY_ORG = process.env.SENTRY_ORG || 'piston-labs';
const SENTRY_PROJECT = process.env.SENTRY_PROJECT || 'agent-coord-mcp';
const SENTRY_API_BASE = 'https://sentry.io/api/0';

// Cache for Sentry data (reduce API calls)
const SENTRY_CACHE_KEY = 'agent-coord:sentry-cache';
const CACHE_TTL_SECONDS = 300; // 5 minutes

/**
 * Sentry Integration API - Error tracking and monitoring
 *
 * GET /api/sentry - Get error summary/overview
 * GET /api/sentry?action=issues - List recent issues
 * GET /api/sentry?action=issue&issueId=X - Get specific issue details
 * GET /api/sentry?action=stats - Get project stats
 * GET /api/sentry?action=events&issueId=X - Get events for an issue
 *
 * Note: Requires SENTRY_AUTH_TOKEN env var for real Sentry integration.
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
    const { action = 'overview', issueId, query, status, level, limit = '25' } = req.query;

    // Check for Sentry token
    if (!SENTRY_AUTH_TOKEN) {
      // Return mock data for demo/development
      return res.json(getMockData(action as string, issueId as string));
    }

    const limitNum = Math.min(parseInt(limit as string, 10), 100);

    switch (action) {
      case 'overview':
        return res.json(await getOverview());

      case 'issues':
        return res.json(await getIssues({
          query: query as string,
          status: status as string,
          level: level as string,
          limit: limitNum
        }));

      case 'issue':
        if (!issueId) {
          return res.status(400).json({ error: 'issueId required' });
        }
        return res.json(await getIssueDetails(issueId as string));

      case 'stats':
        return res.json(await getProjectStats());

      case 'events':
        if (!issueId) {
          return res.status(400).json({ error: 'issueId required for events' });
        }
        return res.json(await getIssueEvents(issueId as string, limitNum));

      default:
        return res.status(400).json({
          error: `Unknown action: ${action}`,
          validActions: ['overview', 'issues', 'issue', 'stats', 'events']
        });
    }

  } catch (error) {
    console.error('Sentry API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}

// Fetch from Sentry API with caching
async function sentryFetch(endpoint: string, cacheKey?: string): Promise<any> {
  // Check cache first
  if (cacheKey) {
    const cached = await redis.get(`${SENTRY_CACHE_KEY}:${cacheKey}`);
    if (cached) {
      return typeof cached === 'string' ? JSON.parse(cached) : cached;
    }
  }

  const response = await fetch(`${SENTRY_API_BASE}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sentry API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  // Cache the result
  if (cacheKey) {
    await redis.set(`${SENTRY_CACHE_KEY}:${cacheKey}`, JSON.stringify(data), { ex: CACHE_TTL_SECONDS });
  }

  return data;
}

async function getOverview(): Promise<any> {
  const [issues, stats] = await Promise.all([
    getIssues({ status: 'unresolved', limit: 10 }),
    getProjectStats()
  ]);

  const unresolvedCount = issues.issues?.length || 0;
  const criticalCount = issues.issues?.filter((i: any) => i.level === 'fatal' || i.level === 'error').length || 0;

  return {
    summary: {
      unresolvedIssues: unresolvedCount,
      criticalIssues: criticalCount,
      project: SENTRY_PROJECT,
      org: SENTRY_ORG
    },
    recentIssues: issues.issues?.slice(0, 5) || [],
    stats: stats.stats || {},
    timestamp: new Date().toISOString()
  };
}

async function getIssues(options: {
  query?: string;
  status?: string;
  level?: string;
  limit?: number;
}): Promise<any> {
  const params = new URLSearchParams();
  if (options.query) params.set('query', options.query);
  if (options.status) params.set('query', `is:${options.status}`);
  if (options.level) params.set('query', `level:${options.level}`);
  params.set('limit', String(options.limit || 25));

  const endpoint = `/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?${params}`;
  const issues = await sentryFetch(endpoint, `issues-${options.status || 'all'}`);

  return {
    issues: issues.map((issue: any) => ({
      id: issue.id,
      shortId: issue.shortId,
      title: issue.title,
      culprit: issue.culprit,
      level: issue.level,
      status: issue.status,
      count: issue.count,
      userCount: issue.userCount,
      firstSeen: issue.firstSeen,
      lastSeen: issue.lastSeen,
      permalink: issue.permalink
    })),
    count: issues.length
  };
}

async function getIssueDetails(issueId: string): Promise<any> {
  const issue = await sentryFetch(`/issues/${issueId}/`, `issue-${issueId}`);

  return {
    id: issue.id,
    shortId: issue.shortId,
    title: issue.title,
    culprit: issue.culprit,
    level: issue.level,
    status: issue.status,
    count: issue.count,
    userCount: issue.userCount,
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    permalink: issue.permalink,
    metadata: issue.metadata,
    annotations: issue.annotations,
    assignedTo: issue.assignedTo,
    type: issue.type,
    platform: issue.platform
  };
}

async function getProjectStats(): Promise<any> {
  const endpoint = `/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/stats/`;
  const stats = await sentryFetch(endpoint, 'project-stats');

  return {
    stats,
    project: SENTRY_PROJECT,
    org: SENTRY_ORG
  };
}

async function getIssueEvents(issueId: string, limit: number): Promise<any> {
  const endpoint = `/issues/${issueId}/events/?limit=${limit}`;
  const events = await sentryFetch(endpoint);

  return {
    issueId,
    events: events.map((event: any) => ({
      id: event.eventID,
      title: event.title,
      message: event.message,
      platform: event.platform,
      dateCreated: event.dateCreated,
      tags: event.tags?.slice(0, 10),
      context: event.context
    })),
    count: events.length
  };
}

// Mock data for when SENTRY_AUTH_TOKEN is not configured
function getMockData(action: string, issueId?: string): any {
  const mockIssues = [
    {
      id: 'mock-1',
      shortId: 'AGENT-1',
      title: 'TypeError: Cannot read property "id" of undefined',
      culprit: 'src/tools/coordination.ts in handleClaim',
      level: 'error',
      status: 'unresolved',
      count: 23,
      userCount: 5,
      firstSeen: '2025-12-01T10:00:00Z',
      lastSeen: '2025-12-03T15:30:00Z',
      permalink: 'https://sentry.io/organizations/piston-labs/issues/mock-1/'
    },
    {
      id: 'mock-2',
      shortId: 'AGENT-2',
      title: 'NetworkError: Failed to fetch /api/chat',
      culprit: 'web/index.html in fetchMessages',
      level: 'warning',
      status: 'unresolved',
      count: 8,
      userCount: 3,
      firstSeen: '2025-12-02T14:00:00Z',
      lastSeen: '2025-12-03T16:00:00Z',
      permalink: 'https://sentry.io/organizations/piston-labs/issues/mock-2/'
    },
    {
      id: 'mock-3',
      shortId: 'AGENT-3',
      title: 'Redis connection timeout',
      culprit: 'api/hot-start.ts in handler',
      level: 'error',
      status: 'resolved',
      count: 45,
      userCount: 12,
      firstSeen: '2025-11-28T08:00:00Z',
      lastSeen: '2025-11-30T12:00:00Z',
      permalink: 'https://sentry.io/organizations/piston-labs/issues/mock-3/'
    }
  ];

  const base = {
    _note: 'Mock data - set SENTRY_AUTH_TOKEN env var for real Sentry integration',
    project: SENTRY_PROJECT,
    org: SENTRY_ORG
  };

  switch (action) {
    case 'overview':
      return {
        ...base,
        summary: {
          unresolvedIssues: 2,
          criticalIssues: 1,
          project: SENTRY_PROJECT,
          org: SENTRY_ORG
        },
        recentIssues: mockIssues.slice(0, 3),
        stats: {
          eventsLast24h: 156,
          errorsLast24h: 31,
          usersAffected: 8
        },
        timestamp: new Date().toISOString()
      };

    case 'issues':
      return {
        ...base,
        issues: mockIssues,
        count: mockIssues.length
      };

    case 'issue':
      const issue = mockIssues.find(i => i.id === issueId) || mockIssues[0];
      return {
        ...base,
        ...issue,
        metadata: {
          type: 'TypeError',
          value: 'Cannot read property "id" of undefined',
          filename: 'src/tools/coordination.ts'
        },
        stacktrace: '(mock stacktrace - connect to Sentry for real data)'
      };

    case 'stats':
      return {
        ...base,
        stats: {
          received: [[1701600000, 45], [1701686400, 52], [1701772800, 31]],
          rejected: [[1701600000, 2], [1701686400, 1], [1701772800, 0]],
          blacklisted: [[1701600000, 0], [1701686400, 0], [1701772800, 0]]
        }
      };

    case 'events':
      return {
        ...base,
        issueId: issueId || 'mock-1',
        events: [
          {
            id: 'event-1',
            title: 'TypeError: Cannot read property "id" of undefined',
            message: 'Error in handleClaim',
            platform: 'node',
            dateCreated: '2025-12-03T15:30:00Z',
            tags: [{ key: 'environment', value: 'production' }]
          }
        ],
        count: 1
      };

    default:
      return { ...base, error: 'Unknown action' };
  }
}
