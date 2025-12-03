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
  { id: 'context-cluster', name: 'context-cluster', category: 'context', description: 'Manage hierarchical context clusters for different domains.', file: 'src/tools/context.ts' },
  { id: 'hot-start', name: 'hot-start', category: 'context', description: 'Quick agent initialization with relevant context loaded.', file: 'src/tools/context.ts' },
  { id: 'share', name: 'share', category: 'context', description: 'Share and retrieve knowledge between agents.', file: 'src/tools/context.ts' },

  // Orchestration Tools (src/tools/orchestration.ts)
  { id: 'workflow', name: 'workflow', category: 'orchestration', description: 'Multi-agent collaboration workflows.', file: 'src/tools/orchestration.ts' },
  { id: 'hub', name: 'hub', category: 'orchestration', description: 'Central coordination hub for multi-agent projects.', file: 'src/tools/orchestration.ts' },

  // Integration Tools (src/tools/integrations.ts)
  { id: 'device', name: 'device', category: 'integrations', description: 'Manage Piston Labs Teltonika GPS device fleet.', file: 'src/tools/integrations.ts' },
  { id: 'aws-status', name: 'aws-status', category: 'integrations', description: 'Check Piston Labs AWS infrastructure status.', file: 'src/tools/integrations.ts' },
  { id: 'fleet-analytics', name: 'fleet-analytics', category: 'integrations', description: 'Get Piston Labs fleet analytics.', file: 'src/tools/integrations.ts' },
  { id: 'provision-device', name: 'provision-device', category: 'integrations', description: 'Provision a new Teltonika device for the fleet.', file: 'src/tools/integrations.ts' },
  { id: 'alerts', name: 'alerts', category: 'integrations', description: 'Manage fleet alerts.', file: 'src/tools/integrations.ts' },
  { id: 'generate-doc', name: 'generate-doc', category: 'integrations', description: 'Generate Piston Labs sales documents.', file: 'src/tools/integrations.ts' },
  { id: 'sales-file', name: 'sales-file', category: 'integrations', description: 'Save documents to Sales Engineering folders.', file: 'src/tools/integrations.ts' },
  { id: 'shop', name: 'shop', category: 'integrations', description: 'Manage Piston Labs sales pipeline.', file: 'src/tools/integrations.ts' },
  { id: 'sentry', name: 'sentry', category: 'integrations', description: 'Sentry error tracking integration.', file: 'src/tools/integrations.ts' },

  // Testing Tools (src/tools/testing.ts)
  { id: 'ui-test', name: 'ui-test', category: 'testing', description: 'Run UI tests for the dashboard.', file: 'src/tools/testing.ts' },
  { id: 'agent-test', name: 'agent-test', category: 'testing', description: 'Test agent capabilities and coordination.', file: 'src/tools/testing.ts' },

  // Spawn Tools (src/tools/spawn.ts)
  { id: 'spawn-agent', name: 'spawn-agent', category: 'orchestration', description: 'Spawn a new Claude Code CLI agent on demand.', file: 'src/tools/spawn.ts' },
  { id: 'spawn-batch', name: 'spawn-batch', category: 'orchestration', description: 'Spawn multiple agents at once (up to 10).', file: 'src/tools/spawn.ts' },
  { id: 'spawn-status', name: 'spawn-status', category: 'orchestration', description: 'Check if spawn service is running.', file: 'src/tools/spawn.ts' },
];

// External integrations
const INTEGRATIONS = [
  { id: 'sentry', name: 'Sentry', category: 'external', description: 'Error tracking and monitoring', status: process.env.SENTRY_AUTH_TOKEN ? 'configured' : 'mock', endpoint: '/api/sentry' },
  { id: 'linear', name: 'Linear', category: 'external', description: 'Issue tracking and project management', status: process.env.LINEAR_API_KEY ? 'configured' : 'mock', endpoint: '/api/linear' },
  { id: 'notion', name: 'Notion', category: 'external', description: 'Knowledge base and documentation', status: process.env.NOTION_TOKEN ? 'configured' : 'mock', endpoint: '/api/notion' },
  { id: 'github', name: 'GitHub', category: 'external', description: 'Code repository and webhook integration', status: 'active', endpoint: '/api/github-webhook' },
  { id: 'aws', name: 'AWS', category: 'external', description: 'Lambda, IoT Core, S3 infrastructure', status: 'active', endpoint: '/api/aws-status' },
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
