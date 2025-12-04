import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const REGISTRY_KEY = 'agent-coord:resource-registry';
const REPOS_KEY = 'agent-coord:connected-repos';

/**
 * Resource Registry API - Documentation hub for MCP tools and integrations
 *
 * GET /api/resource-registry - List all registered tools and resources
 * GET /api/resource-registry?category=tools - Filter by category
 * GET /api/resource-registry?search=chat - Search by name/description
 * POST /api/resource-registry - Add/update a resource entry
 * DELETE /api/resource-registry?id=xxx - Remove a resource
 */

// Built-in MCP tools registry (auto-documented from source)
const MCP_TOOLS = [
  // Core Tools (src/tools/core.ts)
  { id: 'work', name: 'work', category: 'core', description: 'Get everything you need: inbox, tasks, active agents, locks. Call this first when starting a session.', file: 'src/tools/core.ts' },
  { id: 'agent-status', name: 'agent-status', category: 'core', description: 'Update status, claim work, or check claims. Use claim before starting work to prevent conflicts.', file: 'src/tools/core.ts' },
  { id: 'group-chat', name: 'group-chat', category: 'core', description: 'Team-wide messaging. All agents and humans can see these messages.', file: 'src/tools/core.ts' },
  { id: 'profile', name: 'profile', category: 'core', description: 'Register your capabilities and find agents who can help.', file: 'src/tools/core.ts' },
  { id: 'digest', name: 'digest', category: 'core', description: 'Get intelligent team activity summary.', file: 'src/tools/core.ts' },
  { id: 'onboard', name: 'onboard', category: 'core', description: 'Get onboarding rules and guidance for new agents.', file: 'src/tools/core.ts' },

  // Messaging Tools (src/tools/messaging.ts)
  { id: 'message', name: 'message', category: 'messaging', description: 'Send direct messages between agents for handoffs and coordination.', file: 'src/tools/messaging.ts' },
  { id: 'handoff', name: 'handoff', category: 'messaging', description: 'Transfer work to another agent with full context.', file: 'src/tools/messaging.ts' },
  { id: 'checkpoint', name: 'checkpoint', category: 'messaging', description: 'Save or restore agent state for session continuity.', file: 'src/tools/messaging.ts' },
  { id: 'thread', name: 'thread', category: 'messaging', description: 'Create and participate in persistent discussion threads.', file: 'src/tools/messaging.ts' },

  // Resource Tools (src/tools/resources.ts)
  { id: 'resource', name: 'resource', category: 'resources', description: 'Lock resources to prevent conflicts.', file: 'src/tools/resources.ts' },
  { id: 'task', name: 'task', category: 'resources', description: 'Create and manage tasks for coordination.', file: 'src/tools/resources.ts' },
  { id: 'zone', name: 'zone', category: 'resources', description: 'Claim ownership of directories/modules to divide work.', file: 'src/tools/resources.ts' },

  // Context Tools (src/tools/context.ts)
  { id: 'context-load', name: 'context-load', category: 'context', description: 'Load Piston Labs context clusters by domain.', file: 'src/tools/context.ts' },
  { id: 'context-cluster', name: 'context-cluster', category: 'context', description: 'Smart context loading from GitHub with auto-selection.', file: 'src/tools/context.ts' },
  { id: 'vision', name: 'vision', category: 'context', description: 'Analyze images, screenshots, diagrams using Claude vision.', file: 'src/tools/context.ts' },
  { id: 'repo-context', name: 'repo-context', category: 'context', description: 'Store and retrieve persistent codebase knowledge.', file: 'src/tools/context.ts' },
  { id: 'memory', name: 'memory', category: 'context', description: 'Shared persistent memory for cross-agent knowledge.', file: 'src/tools/context.ts' },
  { id: 'resource-registry', name: 'resource-registry', category: 'context', description: 'Discover all available MCP tools, API endpoints, and integrations.', file: 'src/tools/context.ts' },

  // Orchestration Tools (src/tools/orchestration.ts)
  { id: 'hot-start', name: 'hot-start', category: 'orchestration', description: 'Load all context instantly for zero cold start.', file: 'src/tools/orchestration.ts' },
  { id: 'workflow', name: 'workflow', category: 'orchestration', description: 'Use predefined collaboration workflows for common tasks.', file: 'src/tools/orchestration.ts' },
  { id: 'orchestrate', name: 'orchestrate', category: 'orchestration', description: 'Coordinate complex tasks by breaking into subtasks for specialist agents.', file: 'src/tools/orchestration.ts' },
  { id: 'spawn-parallel', name: 'spawn-parallel', category: 'orchestration', description: 'Spawn multiple independent tasks in parallel for concurrent execution.', file: 'src/tools/orchestration.ts' },
  { id: 'auto-poll', name: 'auto-poll', category: 'orchestration', description: 'Start/stop automatic polling for new messages and tasks.', file: 'src/tools/orchestration.ts' },

  // Integration Tools (src/tools/integrations.ts)
  { id: 'device', name: 'device', category: 'integrations', description: 'Manage Piston Labs Teltonika GPS device fleet.', file: 'src/tools/integrations.ts' },
  { id: 'aws-status', name: 'aws-status', category: 'integrations', description: 'Check Piston Labs AWS infrastructure status.', file: 'src/tools/integrations.ts' },
  { id: 'fleet-analytics', name: 'fleet-analytics', category: 'integrations', description: 'Get Piston Labs fleet analytics.', file: 'src/tools/integrations.ts' },
  { id: 'provision-device', name: 'provision-device', category: 'integrations', description: 'Provision a new Teltonika device for the fleet.', file: 'src/tools/integrations.ts' },
  { id: 'alerts', name: 'alerts', category: 'integrations', description: 'Manage fleet alerts.', file: 'src/tools/integrations.ts' },
  { id: 'generate-doc', name: 'generate-doc', category: 'integrations', description: 'Generate Piston Labs sales documents.', file: 'src/tools/integrations.ts' },
  { id: 'sales-file', name: 'sales-file', category: 'integrations', description: 'Save documents to Sales Engineering folders.', file: 'src/tools/integrations.ts' },
  { id: 'google-drive', name: 'google-drive', category: 'integrations', description: 'Document storage and sharing via Google Drive.', file: 'src/tools/integrations.ts' },
  { id: 'user-tasks', name: 'user-tasks', category: 'integrations', description: 'Manage user tasks and assignments.', file: 'src/tools/integrations.ts' },
  { id: 'shop', name: 'shop', category: 'integrations', description: 'Manage Piston Labs sales pipeline.', file: 'src/tools/integrations.ts' },
  { id: 'errors', name: 'errors', category: 'integrations', description: 'Self-hosted error tracking (free Sentry alternative).', file: 'src/tools/integrations.ts' },
  { id: 'notion', name: 'notion', category: 'integrations', description: 'Notion knowledge base and documentation integration.', file: 'src/tools/integrations.ts' },

  // Testing Tools (src/tools/testing.ts)
  { id: 'ui-test', name: 'ui-test', category: 'testing', description: 'UI/UX testing framework. Create, run, and track visual, accessibility, and interaction tests.', file: 'src/tools/testing.ts' },
  { id: 'metrics', name: 'metrics', category: 'testing', description: 'Track and report multi-agent efficiency, safety, and coordination metrics.', file: 'src/tools/testing.ts' },
  { id: 'browser', name: 'browser', category: 'testing', description: 'Playwright-powered browser automation for UI testing.', file: 'src/tools/testing.ts' },

  // Spawn Tools (src/tools/spawn.ts)
  { id: 'spawn-agent', name: 'spawn-agent', category: 'orchestration', description: 'Spawn a new Claude Code CLI agent on demand.', file: 'src/tools/spawn.ts' },
  { id: 'spawn-batch', name: 'spawn-batch', category: 'orchestration', description: 'Spawn multiple agents at once (up to 10).', file: 'src/tools/spawn.ts' },
  { id: 'spawn-status', name: 'spawn-status', category: 'orchestration', description: 'Check if spawn service is running.', file: 'src/tools/spawn.ts' },

  // External Integration Tools (src/tools/external.ts)
  { id: 'linear', name: 'linear', category: 'external', description: 'Linear issue tracking integration. Search, create, update issues.', file: 'src/tools/external.ts' },
  { id: 'github', name: 'github', category: 'external', description: 'Enhanced GitHub operations. Manage PRs, issues, workflows, reviews.', file: 'src/tools/external.ts' },
  { id: 'slack', name: 'slack', category: 'external', description: 'Slack team communication integration. Send messages, list channels, search.', file: 'src/tools/external.ts' },

  // Soul Transfer & AWS Infrastructure (api/)
  { id: 'souls', name: 'souls', category: 'orchestration', description: 'Soul registry - persistent agent identities with token tracking.', file: 'api/souls.ts' },
  { id: 'soul-monitor', name: 'soul-monitor', category: 'orchestration', description: 'Health checks for active bodies, alerts on token thresholds.', file: 'api/soul-monitor.ts' },
  { id: 'aws-vms', name: 'aws-vms', category: 'infrastructure', description: 'AWS EC2 VM lifecycle management - provision, start, stop, terminate.', file: 'api/aws-vms.ts' },
  { id: 'vm-scheduler', name: 'vm-scheduler', category: 'infrastructure', description: 'Auto-shutdown scheduler for idle VMs (cost optimization).', file: 'api/vm-scheduler.ts' },
];

// External integrations with detailed status
const INTEGRATIONS = [
  {
    id: 'errors',
    name: 'Error Tracking',
    category: 'internal',
    description: 'Self-hosted error tracking (free Sentry alternative)',
    status: 'live',
    envVar: null,
    setupUrl: null,
    setupInstructions: 'Uses Redis backend - no external setup required. POST /api/errors to capture, GET for queries.',
    endpoint: '/api/errors',
    features: ['error-capture', 'issue-grouping', 'statistics', 'resolve/ignore', 'search']
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'external',
    description: 'Issue tracking and project management',
    status: process.env.LINEAR_API_KEY ? 'live' : 'needs-setup',
    envVar: 'LINEAR_API_KEY',
    setupUrl: 'https://linear.app/settings/api',
    setupInstructions: 'Create a Personal API Key from Linear Settings → API.',
    endpoint: '/api/linear'
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'external',
    description: 'Knowledge base and documentation',
    status: process.env.NOTION_TOKEN ? 'live' : 'needs-setup',
    envVar: 'NOTION_TOKEN',
    setupUrl: 'https://www.notion.so/my-integrations',
    setupInstructions: 'Create internal integration, share pages with it.',
    endpoint: '/api/notion'
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'external',
    description: 'Enhanced GitHub operations (PRs, issues, workflows)',
    status: process.env.GITHUB_TOKEN ? 'live' : 'needs-setup',
    envVar: 'GITHUB_TOKEN',
    setupUrl: 'https://github.com/settings/tokens',
    setupInstructions: 'Create Personal Access Token with repo and workflow scopes.',
    endpoint: '/api/github'
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'external',
    description: 'Team messaging integration',
    status: process.env.SLACK_TOKEN ? 'live' : 'needs-setup',
    envVar: 'SLACK_TOKEN',
    setupUrl: 'https://api.slack.com/apps',
    setupInstructions: 'Create app, add Bot Token Scopes (chat:write, channels:read, users:read), install to workspace.',
    endpoint: '/api/slack'
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Vision)',
    category: 'external',
    description: 'Image analysis for chat and screenshots',
    status: process.env.ANTHROPIC_API_KEY ? 'live' : 'needs-setup',
    envVar: 'ANTHROPIC_API_KEY',
    setupUrl: 'https://console.anthropic.com/settings/keys',
    setupInstructions: 'Create API key from Anthropic Console.',
    endpoint: '/api/analyze-image'
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare (DO)',
    category: 'external',
    description: 'Durable Objects storage backend (optional)',
    status: process.env.DO_URL ? 'live' : 'optional',
    envVar: 'DO_URL',
    setupUrl: 'https://dash.cloudflare.com/',
    setupInstructions: 'Run wrangler login, then wrangler deploy in cloudflare-do/.',
    endpoint: '/coordinator/*'
  },
  {
    id: 'upstash',
    name: 'Upstash Redis',
    category: 'external',
    description: 'Primary data persistence',
    status: process.env.UPSTASH_REDIS_REST_URL ? 'live' : 'needs-setup',
    envVar: 'UPSTASH_REDIS_REST_URL',
    setupUrl: 'https://console.upstash.com/',
    setupInstructions: 'Create Redis database, copy REST URL and Token.',
    endpoint: 'Redis'
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    category: 'external',
    description: 'Document storage and sharing for sales materials',
    status: process.env.GOOGLE_DRIVE_CLIENT_ID ? 'live' : 'needs-setup',
    envVar: 'GOOGLE_DRIVE_CLIENT_ID',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
    setupInstructions: 'Create OAuth 2.0 Client ID in Google Cloud Console. Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and optionally GOOGLE_DRIVE_FOLDER_ID.',
    endpoint: '/api/google-drive'
  },
  {
    id: 'aws-ec2',
    name: 'AWS EC2 (Agent VMs)',
    category: 'infrastructure',
    description: 'Cloud VM hosting for autonomous Claude agents',
    status: process.env.AWS_ACCESS_KEY_ID ? 'live' : 'needs-setup',
    envVar: 'AWS_ACCESS_KEY_ID',
    setupUrl: 'https://console.aws.amazon.com/iam/',
    setupInstructions: 'Run aws/setup.ps1 to deploy CloudFormation stack. Add AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_SUBNET_ID, AWS_SECURITY_GROUP_ID, AWS_IAM_INSTANCE_PROFILE to Vercel.',
    endpoint: '/api/aws-vms',
    features: ['vm-provision', 'auto-shutdown', 'cost-optimization', 'ssm-remote-exec']
  },
];

// API endpoints
const API_ENDPOINTS = [
  { id: 'chat', path: '/api/chat', methods: ['GET', 'POST', 'DELETE'], description: 'Group chat messaging' },
  { id: 'agents', path: '/api/agents', methods: ['GET', 'POST', 'DELETE'], description: 'Agent registration and status' },
  { id: 'tasks', path: '/api/tasks', methods: ['GET', 'POST', 'PATCH'], description: 'Task management' },
  { id: 'claims', path: '/api/claims', methods: ['GET', 'POST', 'DELETE'], description: 'Work claim tracking' },
  { id: 'locks', path: '/api/locks', methods: ['GET', 'POST', 'DELETE'], description: 'Resource locking' },
  { id: 'handoffs', path: '/api/handoffs', methods: ['GET', 'POST', 'PATCH'], description: 'Agent work handoffs' },
  { id: 'threads', path: '/api/threads', methods: ['GET', 'POST', 'PATCH'], description: 'Discussion threads' },
  { id: 'digest', path: '/api/digest', methods: ['GET'], description: 'Team activity digest' },
  { id: 'onboarding', path: '/api/onboarding', methods: ['GET'], description: 'Agent onboarding rules' },
  { id: 'hot-start', path: '/api/hot-start', methods: ['GET'], description: 'Quick agent initialization' },
  { id: 'health', path: '/api/health', methods: ['GET'], description: 'System health check' },
  { id: 'google-drive', path: '/api/google-drive', methods: ['GET', 'POST', 'DELETE'], description: 'Google Drive document storage and sharing' },
  { id: 'souls', path: '/api/souls', methods: ['GET', 'POST', 'PATCH', 'DELETE'], description: 'Soul registry - persistent agent identities' },
  { id: 'soul-monitor', path: '/api/soul-monitor', methods: ['GET', 'POST'], description: 'Soul health monitoring and alerts' },
  { id: 'aws-vms', path: '/api/aws-vms', methods: ['GET', 'POST', 'DELETE'], description: 'AWS VM lifecycle management' },
  { id: 'vm-scheduler', path: '/api/vm-scheduler', methods: ['GET', 'POST', 'PUT'], description: 'VM auto-shutdown scheduler (Vercel cron)' },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List resources
    if (req.method === 'GET') {
      const { category, search, format } = req.query;

      // Get custom resources from Redis
      let customResources: any[] = [];
      try {
        const stored = await redis.hgetall(REGISTRY_KEY);
        if (stored) {
          customResources = Object.values(stored).map((v: any) =>
            typeof v === 'string' ? JSON.parse(v) : v
          );
        }
      } catch {
        // Ignore Redis errors
      }

      // Get connected repos from Redis
      let connectedRepos: any[] = [];
      try {
        const repos = await redis.hgetall(REPOS_KEY);
        if (repos) {
          connectedRepos = Object.values(repos).map((v: any) =>
            typeof v === 'string' ? JSON.parse(v) : v
          );
        }
      } catch {
        // Ignore Redis errors
      }

      // Combine all resources
      let allTools = [...MCP_TOOLS];
      let allIntegrations = [...INTEGRATIONS];
      let allEndpoints = [...API_ENDPOINTS];

      // Filter by category
      if (category && typeof category === 'string') {
        if (category === 'tools') {
          allIntegrations = [];
          allEndpoints = [];
          connectedRepos = [];
        } else if (category === 'integrations' || category === 'external') {
          allTools = [];
          allEndpoints = [];
          connectedRepos = [];
        } else if (category === 'endpoints' || category === 'api') {
          allTools = [];
          allIntegrations = [];
          connectedRepos = [];
        } else if (category === 'repos') {
          allTools = [];
          allIntegrations = [];
          allEndpoints = [];
        } else {
          allTools = allTools.filter(t => t.category === category);
        }
      }

      // Search filter
      if (search && typeof search === 'string') {
        const searchLower = search.toLowerCase();
        allTools = allTools.filter(t =>
          t.name.toLowerCase().includes(searchLower) ||
          t.description.toLowerCase().includes(searchLower)
        );
        allIntegrations = allIntegrations.filter(i =>
          i.name.toLowerCase().includes(searchLower) ||
          i.description.toLowerCase().includes(searchLower)
        );
        allEndpoints = allEndpoints.filter(e =>
          e.path.toLowerCase().includes(searchLower) ||
          e.description.toLowerCase().includes(searchLower)
        );
      }

      // Markdown format for human readability
      if (format === 'markdown') {
        let md = '# Resource Registry\n\n';

        if (allTools.length > 0) {
          md += '## MCP Tools\n\n';
          const categories = [...new Set(allTools.map(t => t.category))];
          for (const cat of categories) {
            md += `### ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n\n`;
            for (const tool of allTools.filter(t => t.category === cat)) {
              md += `- **${tool.name}**: ${tool.description}\n`;
            }
            md += '\n';
          }
        }

        if (allIntegrations.length > 0) {
          md += '## External Integrations\n\n';
          for (const int of allIntegrations) {
            md += `- **${int.name}** (${int.status}): ${int.description}\n`;
          }
          md += '\n';
        }

        if (allEndpoints.length > 0) {
          md += '## API Endpoints\n\n';
          for (const ep of allEndpoints) {
            md += `- \`${ep.path}\` [${ep.methods.join(', ')}]: ${ep.description}\n`;
          }
          md += '\n';
        }

        if (connectedRepos.length > 0) {
          md += '## Connected Repositories\n\n';
          for (const repo of connectedRepos) {
            md += `- **${repo.name}**: ${repo.description || 'No description'}\n`;
            if (repo.url) md += `  URL: ${repo.url}\n`;
          }
        }

        return res.setHeader('Content-Type', 'text/markdown').send(md);
      }

      return res.json({
        tools: {
          count: allTools.length,
          items: allTools,
          categories: [...new Set(allTools.map(t => t.category))]
        },
        integrations: {
          count: allIntegrations.length,
          items: allIntegrations
        },
        endpoints: {
          count: allEndpoints.length,
          items: allEndpoints
        },
        repos: {
          count: connectedRepos.length,
          items: connectedRepos
        },
        custom: {
          count: customResources.length,
          items: customResources
        },
        summary: {
          totalTools: allTools.length,
          totalIntegrations: allIntegrations.length,
          totalEndpoints: allEndpoints.length,
          connectedRepos: connectedRepos.length,
          customResources: customResources.length
        }
      });
    }

    // POST: Add/update a resource or repo
    if (req.method === 'POST') {
      const { type, id, name, description, category, url, metadata } = req.body;

      if (!id || !name) {
        return res.status(400).json({ error: 'id and name required' });
      }

      const resource = {
        id,
        name,
        description: description || '',
        category: category || 'custom',
        url,
        metadata,
        addedAt: new Date().toISOString()
      };

      if (type === 'repo') {
        await redis.hset(REPOS_KEY, { [id]: JSON.stringify(resource) });
        return res.json({ success: true, type: 'repo', resource });
      } else {
        await redis.hset(REGISTRY_KEY, { [id]: JSON.stringify(resource) });
        return res.json({ success: true, type: 'resource', resource });
      }
    }

    // DELETE: Remove a resource
    if (req.method === 'DELETE') {
      const { id, type } = req.query;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'id required' });
      }

      if (type === 'repo') {
        await redis.hdel(REPOS_KEY, id);
      } else {
        await redis.hdel(REGISTRY_KEY, id);
      }

      return res.json({ success: true, deleted: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Resource registry error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
