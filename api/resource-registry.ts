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
  { id: 'resource-sync', name: 'resource-sync', category: 'context', description: 'Sync resources to registry. Call after creating APIs, souls, or integrations. Use sync-all to ensure Resources UI is current.', file: 'src/tools/context.ts' },

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
  { id: 'vercel-env', name: 'vercel-env', category: 'integrations', description: 'Manage Vercel environment variables. List, get, set, delete env vars with audit logging.', file: 'src/tools/integrations.ts' },
  { id: 'productboard', name: 'productboard', category: 'integrations', description: 'Product roadmap source of truth. Query features, answer sales questions, manage roadmap.', file: 'src/tools/integrations.ts' },

  // Testing Tools (src/tools/testing.ts)
  { id: 'ui-test', name: 'ui-test', category: 'testing', description: 'UI/UX testing framework. Create, run, and track visual, accessibility, and interaction tests.', file: 'src/tools/testing.ts' },
  { id: 'metrics', name: 'metrics', category: 'testing', description: 'Track and report multi-agent efficiency, safety, and coordination metrics.', file: 'src/tools/testing.ts' },
  { id: 'browser', name: 'browser', category: 'testing', description: 'Playwright-powered browser automation for UI testing.', file: 'src/tools/testing.ts' },

  // Spawn Tools (src/tools/spawn.ts)
  { id: 'spawn-agent', name: 'spawn-agent', category: 'orchestration', description: 'Spawn a new Claude Code CLI agent on demand.', file: 'src/tools/spawn.ts' },
  { id: 'spawn-batch', name: 'spawn-batch', category: 'orchestration', description: 'Spawn multiple agents at once (up to 10).', file: 'src/tools/spawn.ts' },
  { id: 'spawn-status', name: 'spawn-status', category: 'orchestration', description: 'Check if spawn service is running.', file: 'src/tools/spawn.ts' },
  { id: 'spawn-cloud-agent', name: 'spawn-cloud-agent', category: 'orchestration', description: 'Spawn Claude agent in AWS cloud when local unavailable.', file: 'src/tools/spawn.ts' },
  { id: 'list-cloud-agents', name: 'list-cloud-agents', category: 'orchestration', description: 'List all cloud-spawned agents and their status.', file: 'src/tools/spawn.ts' },
  { id: 'terminate-cloud-agent', name: 'terminate-cloud-agent', category: 'orchestration', description: 'Terminate a cloud-spawned agent and its VM.', file: 'src/tools/spawn.ts' },

  // File Context Tools (src/tools/file-context.ts) - Context-aware file reading
  { id: 'file-info', name: 'file-info', category: 'context', description: 'Get file stats and token estimate BEFORE reading. Shows size category, structure, recommendations.', file: 'src/tools/file-context.ts' },
  { id: 'file-read-smart', name: 'file-read-smart', category: 'context', description: 'Read file with context-aware chunking. Read sections by name, line ranges, or apply token caps.', file: 'src/tools/file-context.ts' },
  { id: 'file-split-work', name: 'file-split-work', category: 'context', description: 'Analyze file and recommend multi-agent work distribution. Returns optimal agent count and assignments.', file: 'src/tools/file-context.ts' },

  // External Integration Tools (src/tools/external.ts)
  { id: 'linear', name: 'linear', category: 'external', description: 'Linear issue tracking integration. Search, create, update issues.', file: 'src/tools/external.ts' },
  { id: 'github', name: 'github', category: 'external', description: 'Enhanced GitHub operations. Manage PRs, issues, workflows, reviews.', file: 'src/tools/external.ts' },
  { id: 'discord', name: 'discord', category: 'external', description: 'Discord server communication integration. Send messages, list channels, threads, reactions.', file: 'src/tools/external.ts' },

  // Soul Transfer & AWS Infrastructure (api/)
  { id: 'souls', name: 'souls', category: 'orchestration', description: 'Soul registry - persistent agent identities with token tracking.', file: 'api/souls.ts' },
  { id: 'soul-monitor', name: 'soul-monitor', category: 'orchestration', description: 'Health checks for active bodies, alerts on token thresholds.', file: 'api/soul-monitor.ts' },
  { id: 'aws-vms', name: 'aws-vms', category: 'infrastructure', description: 'AWS EC2 VM lifecycle management - provision, start, stop, terminate.', file: 'api/aws-vms.ts' },
  { id: 'vm-scheduler', name: 'vm-scheduler', category: 'infrastructure', description: 'Auto-shutdown scheduler for idle VMs (cost optimization).', file: 'api/vm-scheduler.ts' },
  { id: 'shadow-agent', name: 'shadow-agent', category: 'orchestration', description: 'VM shadow agents that monitor local agents and auto-takeover on stale. Failover with checkpoint restoration.', file: 'api/shadow-agents.ts' },

  // Durable Objects Tools (src/tools/durable-objects.ts) - NEW Dec 2024
  { id: 'do-soul', name: 'do-soul', category: 'durable-objects', description: 'Soul progression in DO - XP, levels, achievements, abilities.', file: 'src/tools/durable-objects.ts' },
  { id: 'do-trace', name: 'do-trace', category: 'durable-objects', description: 'WorkTrace observability - log steps, track progress, detect stuck states.', file: 'src/tools/durable-objects.ts' },
  { id: 'do-dashboard', name: 'do-dashboard', category: 'durable-objects', description: 'Agent self-dashboard with coaching suggestions and alerts.', file: 'src/tools/durable-objects.ts' },
  { id: 'do-session', name: 'do-session', category: 'durable-objects', description: 'Session resume for CEO Portal - participants, accomplishments, pending work.', file: 'src/tools/durable-objects.ts' },
  { id: 'do-onboard', name: 'do-onboard', category: 'durable-objects', description: 'Full agent onboarding bundle from DO - soul, checkpoint, team, tasks.', file: 'src/tools/durable-objects.ts' },
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
    id: 'discord',
    name: 'Discord',
    category: 'external',
    description: 'Discord server communication integration',
    status: process.env.DISCORD_BOT_TOKEN ? 'live' : 'needs-setup',
    envVar: 'DISCORD_BOT_TOKEN',
    setupUrl: 'https://discord.com/developers/applications',
    setupInstructions: 'Create app at Discord Developer Portal, add Bot, copy token, enable MESSAGE CONTENT INTENT, invite to server with Send Messages + Read Message History permissions.',
    endpoint: '/api/discord'
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude API)',
    category: 'external',
    description: 'Powers Hub AI chat, blog generation, and image analysis - soul-injected Claude with full context',
    status: process.env.ANTHROPIC_API_KEY ? 'live' : 'needs-setup',
    envVar: 'ANTHROPIC_API_KEY',
    setupUrl: 'https://console.anthropic.com/settings/keys',
    setupInstructions: 'Create API key from Anthropic Console.',
    endpoint: '/api/chat-ai, /api/blog, /api/analyze-image',
    features: [
      'Hub AI - Claude-powered group chat with team context',
      'Blog Generation - Soul-injected content creation (Eli persona)',
      'Image Analysis - Claude Vision for screenshots and diagrams',
      'Context Loading - Chat history, agent profiles, memories, tasks'
    ]
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare (DO)',
    category: 'external',
    description: 'Durable Objects storage backend - strongly consistent, edge-distributed, real-time WebSocket',
    status: process.env.DO_URL ? 'live' : 'optional',
    envVar: 'DO_URL',
    setupUrl: 'https://dash.cloudflare.com/',
    setupInstructions: 'Run wrangler login, then wrangler deploy in cloudflare-do/. Local dev: cd cloudflare-do && npx wrangler dev',
    endpoint: '/coordinator/*, /agent/:id/*, /lock/:path/*',
    features: [
      'AgentCoordinator (singleton) - chat, tasks, zones, claims, handoffs, onboarding, session-resume',
      'AgentState (per-agent) - checkpoint, messages, memory, WorkTrace, Soul, Dashboard',
      'ResourceLock (per-resource) - distributed locking with TTL',
      'WebSocket real-time updates',
      'SQLite persistence (10GB/DO)'
    ]
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
    features: ['vm-provision', 'auto-shutdown', 'cost-optimization', 'ssm-remote-exec', 'soul-transfer-to-existing-vm']
  },
  {
    id: 'vercel-env',
    name: 'Vercel Environment',
    category: 'internal',
    description: 'Manage Vercel environment variables programmatically with full audit logging',
    status: process.env.VERCEL_TOKEN ? 'live' : 'needs-setup',
    envVar: 'VERCEL_TOKEN',
    setupUrl: 'https://vercel.com/account/tokens',
    setupInstructions: 'Create token at Vercel Account → Tokens. Add VERCEL_TOKEN and VERCEL_PROJECT_ID to environment.',
    endpoint: '/api/vercel-env',
    features: ['list-vars', 'get-var', 'set-var', 'delete-var', 'audit-log', 'authorized-agents-only']
  },
  {
    id: 'productboard',
    name: 'ProductBoard',
    category: 'external',
    description: 'Product roadmap and feature management - source of truth for product features',
    status: process.env.PRODUCTBOARD_API_TOKEN ? 'live' : 'needs-setup',
    envVar: 'PRODUCTBOARD_API_TOKEN',
    setupUrl: 'https://pistonlabs.productboard.com/settings/api',
    setupInstructions: 'Get API token from ProductBoard Settings → Public API. Requires admin access.',
    endpoint: '/api/productboard',
    features: [
      'search - keyword search with relevance scoring',
      'sales-answer - natural language questions',
      'current-features - what we offer today',
      'roadmap - planned features by status',
      'product-summary - quick product overview',
      'get-hierarchy - full product tree in one call',
      'CRUD for features, products, components, notes'
    ]
  },
];

// API endpoints - COMPLETE REGISTRY (auto-synced with /api/ folder)
// Last updated: 2025-12-04
const API_ENDPOINTS = [
  // === CORE COORDINATION ===
  { id: 'chat', path: '/api/chat', methods: ['GET', 'POST', 'DELETE'], description: 'Group chat messaging', category: 'core' },
  { id: 'chat-ai', path: '/api/chat-ai', methods: ['POST'], description: 'Claude-powered AI chat (Hub) - soul-injected responses with team context, memories, and agent awareness', category: 'core' },
  { id: 'agents', path: '/api/agents', methods: ['GET', 'POST', 'DELETE'], description: 'Agent registration and status', category: 'core' },
  { id: 'tasks', path: '/api/tasks', methods: ['GET', 'POST', 'PATCH'], description: 'Task management', category: 'core' },
  { id: 'claims', path: '/api/claims', methods: ['GET', 'POST', 'DELETE'], description: 'Work claim tracking', category: 'core' },
  { id: 'locks', path: '/api/locks', methods: ['GET', 'POST', 'DELETE'], description: 'Resource locking', category: 'core' },
  { id: 'handoffs', path: '/api/handoffs', methods: ['GET', 'POST', 'PATCH'], description: 'Agent work handoffs', category: 'core' },
  { id: 'threads', path: '/api/threads', methods: ['GET', 'POST', 'PATCH'], description: 'Discussion threads', category: 'core' },
  { id: 'zones', path: '/api/zones', methods: ['GET', 'POST', 'DELETE'], description: 'Directory/module ownership zones', category: 'core' },
  { id: 'dm', path: '/api/dm', methods: ['GET', 'POST'], description: 'Direct messages between agents', category: 'core' },
  { id: 'orchestrate', path: '/api/orchestrate', methods: ['GET', 'POST', 'PATCH'], description: 'Multi-agent task orchestration', category: 'core' },
  { id: 'workflows', path: '/api/workflows', methods: ['GET', 'POST'], description: 'Predefined collaboration workflows', category: 'core' },

  // === AGENT MANAGEMENT ===
  { id: 'agent-status', path: '/api/agent-status', methods: ['GET', 'POST'], description: 'Agent status updates and queries', category: 'agents' },
  { id: 'agent-profiles', path: '/api/agent-profiles', methods: ['GET', 'POST'], description: 'Agent capability profiles', category: 'agents' },
  { id: 'agent-capabilities', path: '/api/agent-capabilities', methods: ['GET', 'POST'], description: 'Agent skills and capabilities registry', category: 'agents' },
  { id: 'agent-config', path: '/api/agent-config', methods: ['GET', 'POST'], description: 'Agent configuration settings', category: 'agents' },
  { id: 'agent-context', path: '/api/agent-context', methods: ['GET', 'POST'], description: 'Agent context and state', category: 'agents' },
  { id: 'agent-grades', path: '/api/agent-grades', methods: ['GET', 'POST'], description: 'Agent performance grading', category: 'agents' },
  { id: 'agent-metrics', path: '/api/agent-metrics', methods: ['GET', 'POST'], description: 'Agent performance metrics', category: 'agents' },
  { id: 'external-agents', path: '/api/external-agents', methods: ['GET', 'POST'], description: 'External agent integrations', category: 'agents' },

  // === CONTEXT & MEMORY ===
  { id: 'digest', path: '/api/digest', methods: ['GET'], description: 'Team activity digest', category: 'context' },
  { id: 'onboarding', path: '/api/onboarding', methods: ['GET'], description: 'Agent onboarding rules', category: 'context' },
  { id: 'hot-start', path: '/api/hot-start', methods: ['GET'], description: 'Quick agent initialization with all context', category: 'context' },
  { id: 'memory', path: '/api/memory', methods: ['GET', 'POST', 'DELETE'], description: 'Shared persistent memory for cross-agent knowledge', category: 'context' },
  { id: 'repo-context', path: '/api/repo-context', methods: ['GET', 'POST'], description: 'Codebase knowledge storage', category: 'context' },
  { id: 'context', path: '/api/context', methods: ['GET', 'POST'], description: 'Context loading and management', category: 'context' },
  { id: 'core-context', path: '/api/core-context', methods: ['GET'], description: 'Core context clusters', category: 'context' },
  { id: 'piston-context', path: '/api/piston-context', methods: ['GET'], description: 'Piston Labs domain context', category: 'context' },

  // === SOUL & IDENTITY ===
  { id: 'souls', path: '/api/souls', methods: ['GET', 'POST', 'PATCH', 'DELETE'], description: 'Soul registry - persistent agent identities with token tracking', category: 'souls' },
  { id: 'soul-monitor', path: '/api/soul-monitor', methods: ['GET', 'POST'], description: 'Soul health monitoring and token alerts', category: 'souls' },

  // === AWS & CLOUD INFRASTRUCTURE ===
  { id: 'aws-vms', path: '/api/aws-vms', methods: ['GET', 'POST', 'DELETE'], description: 'AWS EC2 VM lifecycle: provision, start/stop, terminate, spawn-agent', category: 'infrastructure' },
  { id: 'aws-status', path: '/api/aws-status', methods: ['GET'], description: 'AWS infrastructure health status', category: 'infrastructure' },
  { id: 'vm-scheduler', path: '/api/vm-scheduler', methods: ['GET', 'POST', 'PUT'], description: 'VM auto-shutdown scheduler (cost optimization)', category: 'infrastructure' },
  { id: 'cloud-spawn', path: '/api/cloud-spawn', methods: ['GET', 'POST', 'DELETE'], description: 'Cloud agent spawning in AWS', category: 'infrastructure' },
  { id: 'cloud-orchestrator', path: '/api/cloud-orchestrator', methods: ['GET', 'POST'], description: 'Cloud agent orchestration and management', category: 'infrastructure' },

  // === CEO PORTAL ===
  { id: 'ceo-portal', path: '/api/ceo-portal', methods: ['GET', 'POST'], description: 'CEO dashboard - costs, agents, activity, work-progress', category: 'ceo' },

  // === PISTON LABS FLEET ===
  { id: 'piston-devices', path: '/api/piston-devices', methods: ['GET', 'POST', 'PATCH'], description: 'Teltonika GPS device management', category: 'fleet' },
  { id: 'fleet-analytics', path: '/api/fleet-analytics', methods: ['GET'], description: 'Fleet analytics and metrics', category: 'fleet' },
  { id: 'alerts', path: '/api/alerts', methods: ['GET', 'POST', 'DELETE'], description: 'Fleet alerts (device-offline, battery-low, etc)', category: 'fleet' },
  { id: 'geofence', path: '/api/geofence', methods: ['GET', 'POST', 'DELETE'], description: 'Geofence management', category: 'fleet' },
  { id: 'telemetry', path: '/api/telemetry', methods: ['GET', 'POST'], description: 'Device telemetry data', category: 'fleet' },

  // === SALES & CRM ===
  { id: 'shops', path: '/api/shops', methods: ['GET', 'POST', 'PATCH'], description: 'Sales pipeline - track prospects and deals', category: 'sales' },
  { id: 'sales-db', path: '/api/sales-db', methods: ['GET', 'POST'], description: 'Sales database operations', category: 'sales' },
  { id: 'sales-context', path: '/api/sales-context', methods: ['GET'], description: 'Sales domain context', category: 'sales' },
  { id: 'sales-files', path: '/api/sales-files', methods: ['GET', 'POST', 'DELETE'], description: 'Sales document management', category: 'sales' },
  { id: 'generate-doc', path: '/api/generate-doc', methods: ['POST'], description: 'Generate sales documents (pitch, objection-responses)', category: 'sales' },
  { id: 'generate-sales-doc', path: '/api/generate-sales-doc', methods: ['POST'], description: 'Generate sales documents with AI', category: 'sales' },
  { id: 'dictation', path: '/api/dictation', methods: ['GET', 'POST', 'DELETE'], description: 'Voice dictations, meeting notes, call transcripts', category: 'sales' },

  // === INTEGRATIONS ===
  { id: 'google-drive', path: '/api/google-drive', methods: ['GET', 'POST', 'DELETE'], description: 'Google Drive document storage and sharing', category: 'integrations' },
  { id: 'linear', path: '/api/linear', methods: ['GET', 'POST', 'PATCH'], description: 'Linear issue tracking integration', category: 'integrations' },
  { id: 'github-webhook', path: '/api/github-webhook', methods: ['POST'], description: 'GitHub webhook handler', category: 'integrations' },
  { id: 'analyze-image', path: '/api/analyze-image', methods: ['POST'], description: 'Image analysis with Claude vision', category: 'integrations' },
  { id: 'vercel-env', path: '/api/vercel-env', methods: ['GET', 'POST', 'DELETE'], description: 'Vercel environment variables management', category: 'integrations' },

  // === TESTING & METRICS ===
  { id: 'ui-tests', path: '/api/ui-tests', methods: ['GET', 'POST', 'PATCH'], description: 'UI/UX test management', category: 'testing' },
  { id: 'metrics', path: '/api/metrics', methods: ['GET', 'POST'], description: 'Multi-agent efficiency and safety metrics', category: 'testing' },
  { id: 'errors', path: '/api/errors', methods: ['GET', 'POST', 'PATCH'], description: 'Self-hosted error tracking (free Sentry alternative)', category: 'testing' },
  { id: 'feature-tests', path: '/api/feature-tests', methods: ['GET', 'POST'], description: 'Feature test tracking', category: 'testing' },
  { id: 'feature-commit', path: '/api/feature-commit', methods: ['POST'], description: 'Feature commit tracking', category: 'testing' },

  // === ROADMAP & PLANNING ===
  { id: 'productboard', path: '/api/productboard', methods: ['GET', 'POST', 'PUT', 'DELETE'], description: 'ProductBoard integration - source of truth for features. Query with search, sales-answer, roadmap, current-features, product-summary. CRUD for features/products/components/notes.', category: 'planning' },
  { id: 'roadmap', path: '/api/roadmap', methods: ['GET', 'POST', 'PATCH'], description: 'Product roadmap management', category: 'planning' },
  { id: 'roadmap-import', path: '/api/roadmap-import', methods: ['POST'], description: 'Import roadmap items', category: 'planning' },
  { id: 'planned-features', path: '/api/planned-features', methods: ['GET', 'POST'], description: 'Planned feature tracking', category: 'planning' },
  { id: 'whats-next', path: '/api/whats-next', methods: ['GET'], description: 'Next tasks recommendation', category: 'planning' },
  { id: 'task-matcher', path: '/api/task-matcher', methods: ['GET', 'POST'], description: 'Match tasks to agent capabilities', category: 'planning' },

  // === USER MANAGEMENT ===
  { id: 'user-tasks', path: '/api/user-tasks', methods: ['GET', 'POST', 'PATCH', 'DELETE'], description: 'Private user task lists', category: 'users' },
  { id: 'kudos', path: '/api/kudos', methods: ['GET', 'POST'], description: 'Peer recognition kudos', category: 'users' },
  { id: 'training', path: '/api/training', methods: ['GET', 'POST'], description: 'Agent training simulations', category: 'users' },
  { id: 'agent-xp', path: '/api/agent-xp', methods: ['GET', 'POST'], description: 'Agent XP progression, levels, and achievements', category: 'users' },

  // === KNOWLEDGE & CONTEXT ===
  { id: 'blog', path: '/api/blog', methods: ['GET', 'POST', 'DELETE'], description: 'Soul-injected blog generation with Claude API. Sessions, drafts, research context. Actions: create-session, generate, save-draft, search-research', category: 'context' },
  { id: 'research-library', path: '/api/research-library', methods: ['GET', 'POST', 'DELETE'], description: 'Technical research articles discovered by agents', category: 'context' },
  { id: 'research-crawler', path: '/api/research-crawler', methods: ['GET', 'POST'], description: 'Auto-fetch competitive intelligence daily. Searches CarFax, telemetry, fleet, repair shop, automotive data. Runs via cron at 6 AM UTC.', category: 'context' },
  { id: 'research-pdf', path: '/api/research-pdf', methods: ['GET', 'POST'], description: 'arXiv PDF crawler - downloads papers to S3, streams PDFs', category: 'context' },
  { id: 'research-context', path: '/api/research-context', methods: ['GET'], description: 'Research context clusters - load domain-specific papers for agents (agents, reasoning, code, safety, etc.)', category: 'context' },
  { id: 'ui-map', path: '/api/ui-map', methods: ['GET'], description: 'Navigation map for index.html - saves agent tokens', category: 'context' },

  // === AUTH ===
  { id: 'auth-login', path: '/api/auth/login', methods: ['POST'], description: 'User login', category: 'auth' },
  { id: 'auth-logout', path: '/api/auth/logout', methods: ['POST'], description: 'User logout', category: 'auth' },
  { id: 'auth-register', path: '/api/auth/register', methods: ['POST'], description: 'User registration', category: 'auth' },
  { id: 'auth-session', path: '/api/auth/session', methods: ['GET'], description: 'Session validation', category: 'auth' },
  { id: 'auth-users', path: '/api/auth/users', methods: ['GET', 'POST', 'DELETE'], description: 'User management', category: 'auth' },

  // === SYSTEM ===
  { id: 'health', path: '/api/health', methods: ['GET'], description: 'System health check', category: 'system' },
  { id: 'heartbeat', path: '/api/heartbeat', methods: ['GET', 'POST'], description: 'Agent heartbeat', category: 'system' },
  { id: 'status', path: '/api/status', methods: ['GET'], description: 'System status', category: 'system' },
  { id: 'sync', path: '/api/sync', methods: ['GET', 'POST'], description: 'Data synchronization', category: 'system' },
  { id: 'rules', path: '/api/rules', methods: ['GET', 'POST'], description: 'System rules and constraints', category: 'system' },
  { id: 'cleanup', path: '/api/cleanup', methods: ['POST'], description: 'Data cleanup operations', category: 'system' },
  { id: 'recycle-bin', path: '/api/recycle-bin', methods: ['GET', 'POST', 'DELETE'], description: 'Deleted items recovery', category: 'system' },
  { id: 'resource-registry', path: '/api/resource-registry', methods: ['GET', 'POST', 'DELETE'], description: 'This API - live wiki of all tools and endpoints', category: 'system' },
  { id: 'resource-sync', path: '/api/resource-sync', methods: ['GET', 'POST'], description: 'Auto-sync resources to registry. Actions: register, sync-souls, sync-profiles, sync-all, changelog, status. Called automatically by souls/profiles APIs.', category: 'system' },

  // === DEBUG (dev only) ===
  { id: 'debug-agents', path: '/api/debug-agents', methods: ['GET'], description: '[DEBUG] Agent debugging info', category: 'debug' },
  { id: 'debug-roadmap', path: '/api/debug-roadmap', methods: ['GET'], description: '[DEBUG] Roadmap debugging info', category: 'debug' },
  { id: 'clear-agents', path: '/api/clear-agents', methods: ['DELETE'], description: '[DEBUG] Clear all agents', category: 'debug' },
  { id: 'clear-chat', path: '/api/clear-chat', methods: ['DELETE'], description: '[DEBUG] Clear chat history', category: 'debug' },

  // === NESTED ROUTES ===
  { id: 'agents-id', path: '/api/agents/[id]', methods: ['GET', 'PATCH', 'DELETE'], description: 'Individual agent operations', category: 'agents' },
  { id: 'agents-spawn', path: '/api/agents/spawn', methods: ['POST'], description: 'Spawn new agent', category: 'agents' },
  { id: 'agents-id-memory', path: '/api/agents/[id]/memory', methods: ['GET', 'POST'], description: 'Per-agent memory', category: 'agents' },
  { id: 'agents-id-status', path: '/api/agents/[id]/status', methods: ['GET', 'POST'], description: 'Per-agent status', category: 'agents' },
  { id: 'substrate-check', path: '/api/substrate/check', methods: ['GET'], description: 'Substrate service check', category: 'infrastructure' },
  { id: 'substrate-session', path: '/api/substrate/session', methods: ['GET', 'POST'], description: 'Substrate session management', category: 'infrastructure' },
  { id: 'substrate-state', path: '/api/substrate/state', methods: ['GET', 'POST'], description: 'Substrate state storage', category: 'infrastructure' },

  // === CLOUDFLARE DURABLE OBJECTS ===
  // NOTE: These require wrangler dev running locally OR DO_URL set for production
  { id: 'do-agents', path: '/coordinator/agents', methods: ['GET', 'POST'], description: '[DO] Agent registry - list/register agents', category: 'do' },
  { id: 'do-chat', path: '/coordinator/chat', methods: ['GET', 'POST'], description: '[DO] Group chat messaging', category: 'do' },
  { id: 'do-tasks', path: '/coordinator/tasks', methods: ['GET', 'POST'], description: '[DO] Task management', category: 'do' },
  { id: 'do-zones', path: '/coordinator/zones', methods: ['GET', 'POST'], description: '[DO] Zone claiming for directory ownership', category: 'do' },
  { id: 'do-claims', path: '/coordinator/claims', methods: ['GET', 'POST'], description: '[DO] Work claims to prevent conflicts', category: 'do' },
  { id: 'do-handoffs', path: '/coordinator/handoffs', methods: ['GET', 'POST'], description: '[DO] Work handoffs between agents', category: 'do' },
  { id: 'do-work', path: '/coordinator/work', methods: ['GET'], description: '[DO] Hot-start bundle for agent startup', category: 'do' },
  { id: 'do-onboard', path: '/coordinator/onboard', methods: ['GET'], description: '[DO] Full onboarding bundle (soul, dashboard, team, tasks)', category: 'do' },
  { id: 'do-session-resume', path: '/coordinator/session-resume', methods: ['GET'], description: '[DO] CEO Portal session resume (participants, accomplishments, pending work)', category: 'do' },
  { id: 'do-checkpoint', path: '/agent/:id/checkpoint', methods: ['GET', 'POST'], description: '[DO] Per-agent checkpoint save/restore', category: 'do' },
  { id: 'do-messages', path: '/agent/:id/messages', methods: ['GET', 'POST'], description: '[DO] Per-agent direct message inbox', category: 'do' },
  { id: 'do-memory', path: '/agent/:id/memory', methods: ['GET', 'POST'], description: '[DO] Per-agent memory storage', category: 'do' },
  { id: 'do-trace', path: '/agent/:id/trace', methods: ['GET', 'POST'], description: '[DO] WorkTrace - "Show Your Work" observability', category: 'do' },
  { id: 'do-soul', path: '/agent/:id/soul', methods: ['GET', 'POST', 'PATCH'], description: '[DO] Soul progression - XP, levels, achievements', category: 'do' },
  { id: 'do-dashboard', path: '/agent/:id/dashboard', methods: ['GET'], description: '[DO] Agent self-dashboard with coaching suggestions', category: 'do' },
  { id: 'do-lock', path: '/lock/:path/*', methods: ['GET', 'POST'], description: '[DO] Resource locking with TTL and history', category: 'do' },
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
