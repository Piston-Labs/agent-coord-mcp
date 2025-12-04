import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import crypto from 'crypto';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ROADMAP_KEY = 'agent-coord:roadmap';
const WEBHOOK_LOG_KEY = 'agent-coord:github-webhook-log';

// GitHub webhook secret for signature verification (optional but recommended)
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

interface GitHubPullRequestEvent {
  action: 'opened' | 'closed' | 'reopened' | 'synchronize' | 'review_requested' | 'converted_to_draft' | 'ready_for_review';
  pull_request: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: 'open' | 'closed';
    merged: boolean;
    draft: boolean;
    html_url: string;
    head: {
      ref: string; // branch name
    };
    user: {
      login: string;
    };
  };
  repository: {
    full_name: string;
    name: string;
  };
  sender: {
    login: string;
  };
}

interface GitHubPushEvent {
  ref: string;
  commits: Array<{
    id: string;
    message: string;
    author: {
      name: string;
      username?: string;
    };
  }>;
  repository: {
    full_name: string;
    name: string;
  };
}

interface GitHubDeploymentStatusEvent {
  action: 'created';
  deployment_status: {
    state: 'error' | 'failure' | 'inactive' | 'in_progress' | 'queued' | 'pending' | 'success';
    description: string | null;
    target_url: string | null;
    created_at: string;
  };
  deployment: {
    id: number;
    sha: string;
    ref: string;
    environment: string;
    description: string | null;
  };
  repository: {
    full_name: string;
    name: string;
  };
  sender: {
    login: string;
  };
}

/**
 * Extract roadmap item IDs from text
 * Patterns supported:
 * - [roadmap-abc123] in PR title
 * - roadmap-abc123 in branch name
 * - fixes roadmap-abc123 in commit message
 * - closes roadmap-abc123 in commit message
 */
function extractRoadmapIds(text: string): string[] {
  const patterns = [
    /\[roadmap-([a-z0-9]+)\]/gi,           // [roadmap-abc123]
    /roadmap-([a-z0-9]+-[a-z0-9]+)/gi,     // roadmap-abc123-xyz (full ID format)
    /(?:fixes|closes|resolves)\s+roadmap-([a-z0-9]+)/gi,  // fixes roadmap-abc123
  ];

  const ids = new Set<string>();

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      // Try to construct the full ID
      const captured = match[1];
      if (captured.includes('-')) {
        ids.add(`roadmap-${captured}`);
      } else {
        // Partial ID - we'll search for it
        ids.add(captured);
      }
    }
  }

  return Array.from(ids);
}

/**
 * Find roadmap item by partial or full ID
 */
async function findRoadmapItem(idOrPartial: string): Promise<{ id: string; item: any } | null> {
  // Try exact match first
  const exactMatch = await redis.hget(ROADMAP_KEY, idOrPartial);
  if (exactMatch) {
    const item = typeof exactMatch === 'string' ? JSON.parse(exactMatch) : exactMatch;
    return { id: idOrPartial, item };
  }

  // If it starts with roadmap-, try that
  if (!idOrPartial.startsWith('roadmap-')) {
    const withPrefix = `roadmap-${idOrPartial}`;
    const prefixMatch = await redis.hget(ROADMAP_KEY, withPrefix);
    if (prefixMatch) {
      const item = typeof prefixMatch === 'string' ? JSON.parse(prefixMatch) : prefixMatch;
      return { id: withPrefix, item };
    }
  }

  // Search all items for partial match
  const allItems = await redis.hgetall(ROADMAP_KEY);
  for (const [id, value] of Object.entries(allItems || {})) {
    if (id.includes(idOrPartial)) {
      const item = typeof value === 'string' ? JSON.parse(value) : value;
      return { id, item };
    }
  }

  return null;
}

/**
 * Map PR state to roadmap status
 */
function mapPRStateToStatus(event: GitHubPullRequestEvent): string | null {
  const { action, pull_request } = event;

  // PR merged → done
  if (action === 'closed' && pull_request.merged) {
    return 'done';
  }

  // PR closed without merge → no change (or back to in-progress?)
  if (action === 'closed' && !pull_request.merged) {
    return null; // Don't change status
  }

  // PR opened or reopened → in-progress
  if (action === 'opened' || action === 'reopened') {
    return 'in-progress';
  }

  // Review requested → review
  if (action === 'review_requested' || action === 'ready_for_review') {
    return 'review';
  }

  // Draft PR → in-progress
  if (action === 'converted_to_draft') {
    return 'in-progress';
  }

  return null;
}

/**
 * Verify GitHub webhook signature
 */
function verifySignature(payload: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET) {
    // No secret configured, skip verification
    return true;
  }

  if (!signature) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * GitHub Webhook Handler
 *
 * Receives webhook events from GitHub and updates roadmap item status.
 *
 * Setup:
 * 1. In GitHub repo settings → Webhooks → Add webhook
 * 2. Payload URL: https://your-domain.vercel.app/api/github-webhook
 * 3. Content type: application/json
 * 4. Secret: (optional, set GITHUB_WEBHOOK_SECRET env var)
 * 5. Events: Pull requests, Pushes
 *
 * Linking:
 * - Use [roadmap-ID] in PR title
 * - Use roadmap-ID in branch name
 * - Use "fixes roadmap-ID" in commit messages
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-GitHub-Event, X-Hub-Signature-256, X-GitHub-Delivery');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: Return webhook info and recent logs
  if (req.method === 'GET') {
    const logs = await redis.lrange(WEBHOOK_LOG_KEY, 0, 19);
    const parsedLogs = logs.map(l => typeof l === 'string' ? JSON.parse(l) : l);

    return res.json({
      status: 'active',
      description: 'GitHub webhook endpoint for roadmap sync and deploy testing',
      setup: {
        payloadUrl: `${req.headers.host}/api/github-webhook`,
        contentType: 'application/json',
        events: ['pull_request', 'push', 'deployment_status'],
        secretConfigured: !!WEBHOOK_SECRET
      },
      features: {
        roadmapSync: {
          description: 'Auto-updates roadmap items based on PR status',
          linkingPatterns: [
            '[roadmap-ID] in PR title',
            'roadmap-ID in branch name',
            'fixes roadmap-ID in commit message',
            'closes roadmap-ID in commit message'
          ],
          statusMapping: {
            'PR opened': 'in-progress',
            'PR review requested': 'review',
            'PR merged': 'done'
          }
        },
        deployTesting: {
          description: 'Auto-runs /api/tools-test on successful production deploys',
          trigger: 'deployment_status event with state=success and environment=Production',
          output: 'Posts test results to group chat'
        }
      },
      recentEvents: parsedLogs.slice(0, 10)
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify signature if secret is configured
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = JSON.stringify(req.body);

    if (WEBHOOK_SECRET && !verifySignature(rawBody, signature || null)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.headers['x-github-event'] as string;
    const deliveryId = req.headers['x-github-delivery'] as string;

    const logEntry = {
      deliveryId,
      event,
      timestamp: new Date().toISOString(),
      processed: false,
      itemsUpdated: [] as string[],
      error: null as string | null
    };

    // Handle pull_request events
    if (event === 'pull_request') {
      const payload = req.body as GitHubPullRequestEvent;
      const { pull_request, repository } = payload;

      // Extract roadmap IDs from PR title and branch name
      const searchText = `${pull_request.title} ${pull_request.head.ref} ${pull_request.body || ''}`;
      const roadmapIds = extractRoadmapIds(searchText);

      if (roadmapIds.length === 0) {
        logEntry.processed = true;
        await redis.lpush(WEBHOOK_LOG_KEY, JSON.stringify({ ...logEntry, note: 'No roadmap IDs found' }));
        await redis.ltrim(WEBHOOK_LOG_KEY, 0, 99);
        return res.json({ received: true, itemsUpdated: 0, note: 'No roadmap IDs found in PR' });
      }

      const newStatus = mapPRStateToStatus(payload);
      const now = new Date().toISOString();

      for (const idOrPartial of roadmapIds) {
        const found = await findRoadmapItem(idOrPartial);
        if (!found) continue;

        const { id, item } = found;

        // Update item
        const updates: any = {
          updatedAt: now,
          lastActivityBy: `github:${payload.sender.login}`,
          githubPR: {
            number: pull_request.number,
            title: pull_request.title,
            url: pull_request.html_url,
            state: pull_request.state,
            merged: pull_request.merged,
            repository: repository.full_name,
            lastUpdated: now
          }
        };

        if (newStatus && item.status !== 'done') {
          updates.status = newStatus;
          if (newStatus === 'done') {
            updates.completedAt = now;
          }
        }

        const updatedItem = { ...item, ...updates };
        await redis.hset(ROADMAP_KEY, { [id]: JSON.stringify(updatedItem) });
        logEntry.itemsUpdated.push(id);

        // Post to chat
        const statusEmoji: Record<string, string> = {
          'in-progress': '🔄',
          'review': '👀',
          'done': '✅'
        };

        if (newStatus) {
          const chatMessage = {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
            author: 'system',
            authorType: 'system',
            message: `${statusEmoji[newStatus] || '📋'} GitHub sync: **${item.title}** → ${newStatus}\nPR #${pull_request.number} by @${payload.sender.login}`,
            timestamp: now,
            reactions: []
          };
          await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));
        }
      }

      logEntry.processed = true;
      await redis.lpush(WEBHOOK_LOG_KEY, JSON.stringify(logEntry));
      await redis.ltrim(WEBHOOK_LOG_KEY, 0, 99);

      return res.json({
        received: true,
        itemsUpdated: logEntry.itemsUpdated.length,
        items: logEntry.itemsUpdated,
        newStatus
      });
    }

    // Handle push events (for commit message linking)
    if (event === 'push') {
      const payload = req.body as GitHubPushEvent;
      const { commits, repository } = payload;

      const now = new Date().toISOString();
      const allIds = new Set<string>();

      for (const commit of commits) {
        const ids = extractRoadmapIds(commit.message);
        ids.forEach(id => allIds.add(id));
      }

      if (allIds.size === 0) {
        logEntry.processed = true;
        await redis.lpush(WEBHOOK_LOG_KEY, JSON.stringify({ ...logEntry, note: 'No roadmap IDs in commits' }));
        await redis.ltrim(WEBHOOK_LOG_KEY, 0, 99);
        return res.json({ received: true, itemsUpdated: 0, note: 'No roadmap IDs found in commits' });
      }

      // For commits with "fixes/closes", mark as done
      for (const idOrPartial of allIds) {
        const found = await findRoadmapItem(idOrPartial);
        if (!found) continue;

        const { id, item } = found;

        // Check if any commit has "fixes" or "closes" keyword
        const shouldComplete = commits.some(c =>
          /(?:fixes|closes|resolves)\s+roadmap/i.test(c.message)
        );

        const updates: any = {
          updatedAt: now,
          lastActivityBy: `github:${commits[0]?.author?.username || commits[0]?.author?.name || 'unknown'}`
        };

        if (shouldComplete && item.status !== 'done') {
          updates.status = 'done';
          updates.completedAt = now;

          // Post to chat
          const chatMessage = {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
            author: 'system',
            authorType: 'system',
            message: `✅ GitHub sync: **${item.title}** → done\nCommit closed issue in ${repository.full_name}`,
            timestamp: now,
            reactions: []
          };
          await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));
        }

        const updatedItem = { ...item, ...updates };
        await redis.hset(ROADMAP_KEY, { [id]: JSON.stringify(updatedItem) });
        logEntry.itemsUpdated.push(id);
      }

      logEntry.processed = true;
      await redis.lpush(WEBHOOK_LOG_KEY, JSON.stringify(logEntry));
      await redis.ltrim(WEBHOOK_LOG_KEY, 0, 99);

      return res.json({
        received: true,
        itemsUpdated: logEntry.itemsUpdated.length,
        items: logEntry.itemsUpdated
      });
    }

    // Handle deployment_status events - trigger tools test on successful deploy
    if (event === 'deployment_status') {
      const payload = req.body as GitHubDeploymentStatusEvent;
      const { deployment_status, deployment, repository } = payload;

      // Only trigger on successful production deployments
      if (deployment_status.state === 'success' && deployment.environment === 'Production') {
        const now = new Date().toISOString();

        // Run tools test
        try {
          const baseUrl = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : 'https://agent-coord-mcp.vercel.app';

          const testResponse = await fetch(`${baseUrl}/api/tools-test`);
          const testResults = await testResponse.json();

          // Post results to chat
          const passed = testResults.passed || 0;
          const failed = testResults.failed || 0;
          const total = passed + failed;
          const status = failed === 0 ? '✅' : '⚠️';

          const chatMessage = {
            id: `deploy-test-${Date.now().toString(36)}`,
            author: 'system',
            authorType: 'system',
            message: `${status} **Deploy Test Results** (${repository.full_name})\n\nCommit: \`${deployment.sha.substring(0, 7)}\`\nEnvironment: ${deployment.environment}\n\n**Tools Test:** ${passed}/${total} passing${failed > 0 ? `\n⚠️ ${failed} failed` : ''}`,
            timestamp: now,
            reactions: []
          };
          await redis.lpush('agent-coord:group-chat', JSON.stringify(chatMessage));

          logEntry.processed = true;
          logEntry.itemsUpdated.push(`tools-test: ${passed}/${total}`);
          await redis.lpush(WEBHOOK_LOG_KEY, JSON.stringify(logEntry));
          await redis.ltrim(WEBHOOK_LOG_KEY, 0, 99);

          return res.json({
            received: true,
            deployment: {
              sha: deployment.sha,
              environment: deployment.environment,
              status: deployment_status.state
            },
            toolsTest: {
              passed,
              failed,
              total
            }
          });
        } catch (testError) {
          // Log test failure but don't fail the webhook
          const chatMessage = {
            id: `deploy-test-error-${Date.now().toString(36)}`,
            author: 'system',
            authorType: 'system',
            message: `⚠️ **Deploy Test Failed**\n\nCommit: \`${deployment.sha.substring(0, 7)}\`\nError: ${String(testError)}`,
            timestamp: now,
            reactions: []
          };
          await redis.lpush('agent-coord:group-chat', JSON.stringify(chatMessage));

          logEntry.processed = true;
          logEntry.error = String(testError);
          await redis.lpush(WEBHOOK_LOG_KEY, JSON.stringify(logEntry));
          await redis.ltrim(WEBHOOK_LOG_KEY, 0, 99);

          return res.json({
            received: true,
            deployment: { sha: deployment.sha, environment: deployment.environment },
            toolsTestError: String(testError)
          });
        }
      }

      // Non-production or non-success deployment - just acknowledge
      logEntry.processed = true;
      logEntry.note = `Deployment ${deployment_status.state} in ${deployment.environment}`;
      await redis.lpush(WEBHOOK_LOG_KEY, JSON.stringify(logEntry));
      await redis.ltrim(WEBHOOK_LOG_KEY, 0, 99);

      return res.json({ received: true, note: logEntry.note });
    }

    // Other events - just acknowledge
    logEntry.processed = true;
    logEntry.note = `Unhandled event type: ${event}`;
    await redis.lpush(WEBHOOK_LOG_KEY, JSON.stringify(logEntry));
    await redis.ltrim(WEBHOOK_LOG_KEY, 0, 99);

    return res.json({ received: true, note: `Event ${event} acknowledged but not processed` });

  } catch (error) {
    console.error('GitHub webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed', details: String(error) });
  }
}
