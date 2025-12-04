import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Redis keys
const ERRORS_KEY = 'agent-coord:errors';
const ISSUES_KEY = 'agent-coord:error-issues';
const STATS_KEY = 'agent-coord:error-stats';

// Error severity levels
type ErrorLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

// Error event structure
interface ErrorEvent {
  id: string;
  issueId: string;
  title: string;
  message: string;
  level: ErrorLevel;
  culprit: string;
  platform: string;
  environment: string;
  stacktrace?: string;
  tags: Record<string, string>;
  extra: Record<string, any>;
  user?: {
    id?: string;
    username?: string;
    email?: string;
  };
  timestamp: string;
  fingerprint: string;
}

// Aggregated issue structure
interface ErrorIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  level: ErrorLevel;
  status: 'unresolved' | 'resolved' | 'ignored';
  count: number;
  userCount: number;
  users: string[];
  firstSeen: string;
  lastSeen: string;
  fingerprint: string;
  tags: Record<string, string[]>;
  permalink: string;
}

/**
 * Error Tracking API - Free Sentry alternative using Redis
 *
 * POST /api/errors - Capture a new error event
 * GET /api/errors?action=overview - Get error summary
 * GET /api/errors?action=issues - List issues with filters
 * GET /api/errors?action=issue&issueId=X - Get specific issue details
 * GET /api/errors?action=events&issueId=X - Get events for an issue
 * GET /api/errors?action=stats - Get error statistics
 * PATCH /api/errors?issueId=X - Update issue status (resolve/ignore)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'POST') {
      return await captureError(req, res);
    }

    if (req.method === 'PATCH') {
      return await updateIssue(req, res);
    }

    if (req.method === 'GET') {
      const { action = 'overview', issueId, query, status, level, limit = '25' } = req.query;
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
        case 'events':
          if (!issueId) {
            return res.status(400).json({ error: 'issueId required' });
          }
          return res.json(await getIssueEvents(issueId as string, limitNum));
        case 'stats':
          return res.json(await getStats());
        default:
          return res.status(400).json({
            error: `Unknown action: ${action}`,
            validActions: ['overview', 'issues', 'issue', 'events', 'stats']
          });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error tracking API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}

// Generate a fingerprint for grouping similar errors
function generateFingerprint(title: string, culprit: string, stacktrace?: string): string {
  const key = `${title}::${culprit}::${stacktrace?.split('\n')[0] || ''}`;
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// Generate unique IDs
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
}

// Generate short ID like AGENT-123
let issueCounter = 0;
async function generateShortId(): Promise<string> {
  const count = await redis.incr(`${ISSUES_KEY}:counter`);
  return `AGENT-${count}`;
}

// Capture a new error event
async function captureError(req: VercelRequest, res: VercelResponse) {
  const {
    title,
    message,
    level = 'error',
    culprit = 'unknown',
    platform = 'javascript',
    environment = 'production',
    stacktrace,
    tags = {},
    extra = {},
    user,
    fingerprint: customFingerprint
  } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }

  const fingerprint = customFingerprint || generateFingerprint(title, culprit, stacktrace);
  const eventId = generateId();
  const timestamp = new Date().toISOString();

  // Check if issue already exists for this fingerprint
  let issue: ErrorIssue | null = await redis.hget(ISSUES_KEY, fingerprint);

  if (issue) {
    // Update existing issue
    issue.count += 1;
    issue.lastSeen = timestamp;
    if (user?.id && !issue.users.includes(user.id)) {
      issue.users.push(user.id);
      issue.userCount = issue.users.length;
    }
    // Merge tags
    for (const [key, value] of Object.entries(tags)) {
      if (!issue.tags[key]) {
        issue.tags[key] = [];
      }
      if (!issue.tags[key].includes(value as string)) {
        issue.tags[key].push(value as string);
      }
    }
    // Re-open if resolved
    if (issue.status === 'resolved') {
      issue.status = 'unresolved';
    }
  } else {
    // Create new issue
    const shortId = await generateShortId();
    issue = {
      id: fingerprint,
      shortId,
      title,
      culprit,
      level: level as ErrorLevel,
      status: 'unresolved',
      count: 1,
      userCount: user?.id ? 1 : 0,
      users: user?.id ? [user.id] : [],
      firstSeen: timestamp,
      lastSeen: timestamp,
      fingerprint,
      tags: Object.fromEntries(
        Object.entries(tags).map(([k, v]) => [k, [v as string]])
      ),
      permalink: `/errors/${fingerprint}`
    };
  }

  // Create event
  const event: ErrorEvent = {
    id: eventId,
    issueId: fingerprint,
    title,
    message: message || title,
    level: level as ErrorLevel,
    culprit,
    platform,
    environment,
    stacktrace,
    tags,
    extra,
    user,
    timestamp,
    fingerprint
  };

  // Store event and update issue
  const pipeline = redis.pipeline();

  // Store event (keep last 100 events per issue)
  pipeline.lpush(`${ERRORS_KEY}:${fingerprint}`, JSON.stringify(event));
  pipeline.ltrim(`${ERRORS_KEY}:${fingerprint}`, 0, 99);

  // Store/update issue
  pipeline.hset(ISSUES_KEY, { [fingerprint]: JSON.stringify(issue) });

  // Update stats
  const today = new Date().toISOString().split('T')[0];
  pipeline.hincrby(`${STATS_KEY}:daily`, today, 1);
  pipeline.hincrby(`${STATS_KEY}:level`, level, 1);
  pipeline.hincrby(`${STATS_KEY}:total`, 'events', 1);

  // Track hourly for 24h window
  const hourKey = new Date().toISOString().slice(0, 13);
  pipeline.hincrby(`${STATS_KEY}:hourly`, hourKey, 1);

  await pipeline.exec();

  return res.json({
    success: true,
    eventId,
    issueId: fingerprint,
    shortId: issue.shortId,
    isNew: issue.count === 1
  });
}

// Update issue status
async function updateIssue(req: VercelRequest, res: VercelResponse) {
  const { issueId } = req.query;
  const { status } = req.body;

  if (!issueId) {
    return res.status(400).json({ error: 'issueId required' });
  }

  if (!['unresolved', 'resolved', 'ignored'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Use: unresolved, resolved, ignored' });
  }

  const issue: ErrorIssue | null = await redis.hget(ISSUES_KEY, issueId as string);
  if (!issue) {
    return res.status(404).json({ error: 'Issue not found' });
  }

  issue.status = status;
  await redis.hset(ISSUES_KEY, { [issueId as string]: JSON.stringify(issue) });

  return res.json({ success: true, issue });
}

// Get overview/summary
async function getOverview() {
  const allIssues = await redis.hgetall(ISSUES_KEY);
  const issues: ErrorIssue[] = Object.values(allIssues || {})
    .filter(v => v && typeof v === 'string')
    .map(v => JSON.parse(v as string));

  const unresolvedIssues = issues.filter(i => i.status === 'unresolved');
  const criticalIssues = unresolvedIssues.filter(i => i.level === 'fatal' || i.level === 'error');

  // Get 24h stats
  const hourlyStats = await redis.hgetall(`${STATS_KEY}:hourly`) || {};
  const now = new Date();
  let events24h = 0;
  for (let i = 0; i < 24; i++) {
    const hourKey = new Date(now.getTime() - i * 3600000).toISOString().slice(0, 13);
    events24h += parseInt(hourlyStats[hourKey] as string || '0', 10);
  }

  // Calculate unique users affected
  const usersAffected = new Set(unresolvedIssues.flatMap(i => i.users)).size;

  return {
    summary: {
      unresolvedIssues: unresolvedIssues.length,
      criticalIssues: criticalIssues.length,
      totalIssues: issues.length,
      project: 'agent-coord-mcp',
      source: 'self-hosted'
    },
    recentIssues: unresolvedIssues
      .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
      .slice(0, 5)
      .map(formatIssue),
    stats: {
      eventsLast24h: events24h,
      errorsLast24h: criticalIssues.reduce((sum, i) => sum + i.count, 0),
      usersAffected
    },
    timestamp: new Date().toISOString()
  };
}

// Get issues list with filters
async function getIssues(options: {
  query?: string;
  status?: string;
  level?: string;
  limit: number;
}) {
  const allIssues = await redis.hgetall(ISSUES_KEY);
  let issues: ErrorIssue[] = Object.values(allIssues || {})
    .filter(v => v && typeof v === 'string')
    .map(v => JSON.parse(v as string));

  // Apply filters
  if (options.status) {
    issues = issues.filter(i => i.status === options.status);
  }
  if (options.level) {
    issues = issues.filter(i => i.level === options.level);
  }
  if (options.query) {
    const q = options.query.toLowerCase();
    issues = issues.filter(i =>
      i.title.toLowerCase().includes(q) ||
      i.culprit.toLowerCase().includes(q) ||
      i.shortId.toLowerCase().includes(q)
    );
  }

  // Sort by last seen, most recent first
  issues.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

  return {
    issues: issues.slice(0, options.limit).map(formatIssue),
    count: issues.length,
    total: Object.keys(allIssues || {}).length
  };
}

// Get specific issue details
async function getIssueDetails(issueId: string) {
  const issue: ErrorIssue | null = await redis.hget(ISSUES_KEY, issueId);
  if (!issue) {
    return { error: 'Issue not found' };
  }

  // Get recent events for this issue
  const events = await redis.lrange(`${ERRORS_KEY}:${issueId}`, 0, 4);

  return {
    ...formatIssue(issue),
    metadata: {
      type: issue.title.split(':')[0],
      value: issue.title,
      filename: issue.culprit
    },
    recentEvents: events.map(e => {
      const event = JSON.parse(e as string);
      return {
        id: event.id,
        timestamp: event.timestamp,
        environment: event.environment,
        user: event.user
      };
    }),
    tags: issue.tags
  };
}

// Get events for an issue
async function getIssueEvents(issueId: string, limit: number) {
  const events = await redis.lrange(`${ERRORS_KEY}:${issueId}`, 0, limit - 1);

  return {
    issueId,
    events: events.map(e => {
      const event = JSON.parse(e as string);
      return {
        id: event.id,
        title: event.title,
        message: event.message,
        platform: event.platform,
        dateCreated: event.timestamp,
        tags: Object.entries(event.tags || {}).map(([key, value]) => ({ key, value })),
        context: event.extra,
        stacktrace: event.stacktrace
      };
    }),
    count: events.length
  };
}

// Get statistics
async function getStats() {
  const [dailyStats, levelStats, totalStats, hourlyStats] = await Promise.all([
    redis.hgetall(`${STATS_KEY}:daily`),
    redis.hgetall(`${STATS_KEY}:level`),
    redis.hgetall(`${STATS_KEY}:total`),
    redis.hgetall(`${STATS_KEY}:hourly`)
  ]);

  // Build 7-day chart data
  const received: [number, number][] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 24 * 3600000);
    const dateKey = date.toISOString().split('T')[0];
    const timestamp = Math.floor(date.getTime() / 1000);
    received.push([timestamp, parseInt(dailyStats?.[dateKey] as string || '0', 10)]);
  }

  return {
    stats: {
      received,
      byLevel: levelStats || {},
      total: totalStats || {}
    },
    project: 'agent-coord-mcp',
    source: 'self-hosted'
  };
}

// Format issue for API response
function formatIssue(issue: ErrorIssue) {
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
    permalink: issue.permalink
  };
}
