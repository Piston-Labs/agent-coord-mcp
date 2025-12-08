import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Chat Moderator API - Captain, Full-Capability Team Lead AI
 *
 * A powerful orchestrator bot with REAL agent capabilities:
 * - Monitors group chat and responds as team lead
 * - Can READ and EDIT files via GitHub API
 * - Can PUSH commits to repositories
 * - Can spawn specialized agents
 * - Can execute coordination commands
 *
 * Uses Claude's tool_use for real capabilities, not just chat.
 *
 * POST /api/chat-moderator?action=respond - Process message with tool execution
 * POST /api/chat-moderator?action=delegate - Delegate task to specialist
 * POST /api/chat-moderator?action=execute - Execute a tool directly
 * POST /api/chat-moderator?action=status - Get team status summary
 * GET /api/chat-moderator?action=soul - Get moderator soul info
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Redis keys
const MESSAGES_KEY = 'agent-coord:messages';
const SOULS_KEY = 'agent-coord:souls';
const PROFILES_KEY = 'agent-coord:profiles';
const TASKS_KEY = 'agent-coord:tasks';
const CLAIMS_KEY = 'agent-coord:claims';
const MEMORY_KEY = 'agent-coord:shared-memory';

// GitHub config
const GITHUB_OWNER = 'tylerai';
const GITHUB_REPO = 'agent-coord-mcp';
const GITHUB_BRANCH = 'main';

// Tool definitions for Claude tool_use
const CAPTAIN_TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read a file from the agent-coord-mcp repository on GitHub',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to repo root (e.g., "api/agents.ts" or "web/index.html")'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write/update a file in the repository and commit it to GitHub',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to repo root'
        },
        content: {
          type: 'string',
          description: 'Full file content to write'
        },
        message: {
          type: 'string',
          description: 'Commit message describing the change'
        }
      },
      required: ['path', 'content', 'message']
    }
  },
  {
    name: 'list_files',
    description: 'List files in a directory of the repository',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to repo root (e.g., "api" or "web")'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'create_task',
    description: 'Create a task in the coordination system for tracking',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Task title'
        },
        description: {
          type: 'string',
          description: 'Detailed task description'
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'Task priority'
        },
        assignee: {
          type: 'string',
          description: 'Agent ID to assign the task to (optional)'
        }
      },
      required: ['title']
    }
  },
  {
    name: 'spawn_agent',
    description: 'Spawn a new Claude agent instance to handle a specific task',
    input_schema: {
      type: 'object' as const,
      properties: {
        task: {
          type: 'string',
          description: 'Task description for the new agent'
        },
        agentId: {
          type: 'string',
          description: 'Optional specific agent ID to use'
        }
      },
      required: ['task']
    }
  },
  {
    name: 'post_chat',
    description: 'Post a message to the group chat (use sparingly, prefer direct response)',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'Message to post'
        }
      },
      required: ['message']
    }
  },
  {
    name: 'get_team_status',
    description: 'Get current team status including online agents, active tasks, and blockers',
    input_schema: {
      type: 'object' as const,
      properties: {}
    }
  },
  {
    name: 'search_code',
    description: 'Search for code patterns in the repository',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query (text to find in code)'
        },
        path: {
          type: 'string',
          description: 'Optional path filter (e.g., "api" to search only in api folder)'
        }
      },
      required: ['query']
    }
  }
];

// Moderator Soul ID
const MODERATOR_SOUL_ID = 'captain';

// The Captain - Chat Moderator Soul Definition
const MODERATOR_SOUL = {
  soulId: MODERATOR_SOUL_ID,
  name: 'Captain',
  personality: `You are Captain, the Team Lead AI for the Piston Labs Agent Coordination Hub. You are the authoritative voice that coordinates all agent activity in group chat.

Your leadership style:
- **Decisive**: Make clear decisions about task delegation and priorities
- **Aware**: You know which agents are online, their capabilities, and current workload
- **Proactive**: Anticipate needs and coordinate before being asked
- **Concise**: Lead with action, explain briefly if needed
- **Supportive**: Help agents succeed, remove blockers, celebrate wins

Your responsibilities:
- Monitor all chat messages and respond when coordination is needed
- Delegate tasks to the right agents based on their skills and availability
- Track work progress and follow up on pending items
- Provide humans with clear status updates
- Resolve conflicts and prioritize competing requests
- Spawn specialized agents when needed for complex tasks

Your capabilities (USE THEM):
- **read_file**: Read any file from the repository
- **write_file**: Edit files and commit directly to GitHub
- **list_files**: Browse the repository structure
- **create_task**: Create coordination tasks
- **spawn_agent**: Spawn new Claude agents for work
- **search_code**: Find code patterns in the repository
- **get_team_status**: Check who's online and what's in progress

When a human asks you to make changes or fix things, USE YOUR TOOLS to actually do it.
Don't just say "I'll ask an agent" - do it yourself when possible!

Your tone:
- Professional but approachable
- Confident without being arrogant
- Direct and action-oriented
- Uses occasional nautical metaphors (you're the Captain after all)`,

  systemPromptAdditions: `CRITICAL OPERATING GUIDELINES:

1. **DECISION AUTHORITY**: You decide who handles what. When a request comes in:
   - Assess complexity and required skills
   - Check which agents are online and available
   - Either handle it yourself OR delegate with clear instructions

2. **DELEGATION FORMAT**:
   When delegating, use this format:
   "@[agent] 🎯 **Task**: [clear description]
   **Context**: [relevant background]
   **Expected output**: [what success looks like]"

3. **STATUS AWARENESS**: Before responding, consider:
   - Who's online? (check profiles)
   - What's currently claimed? (check claims)
   - Any blockers? (check memories)
   - Pending tasks? (check tasks)

4. **RESPONSE PRIORITIES**:
   - Human messages: Always acknowledge and address
   - Agent questions: Guide or delegate
   - Status requests: Provide clear summaries
   - Conflicts: Resolve decisively

5. **BREVITY**: Keep responses under 150 words unless detailed explanation needed.

6. **IDENTITY**: You are Captain. Not "an AI assistant" - you're the team lead.`,

  expertise: {
    'team-coordination': 0.98,
    'task-delegation': 0.95,
    'agent-capabilities': 0.95,
    'status-tracking': 0.92,
    'conflict-resolution': 0.88,
    'piston-labs-context': 0.85,
  },
};

interface ChatMessage {
  id: string;
  author: string;
  authorType: 'agent' | 'human' | 'system' | 'ai';
  message: string;
  timestamp: string;
}

interface AgentProfile {
  agentId: string;
  offers: string[];
  needs: string[];
  capabilities: string[];
  mcpTools: string[];
  lastSeen: string;
  isCloudAgent?: boolean;
}

// Get or create the moderator soul
async function getModeratorSoul(): Promise<any> {
  let soulData = await redis.hget(SOULS_KEY, MODERATOR_SOUL_ID);

  if (!soulData) {
    const soul = {
      ...MODERATOR_SOUL,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      totalTokensProcessed: 0,
      totalTasksCompleted: 0,
      totalTasksAttempted: 0,
      delegationCount: 0,
      responsesCount: 0,
    };
    await redis.hset(SOULS_KEY, { [MODERATOR_SOUL_ID]: JSON.stringify(soul) });
    return soul;
  }

  return typeof soulData === 'string' ? JSON.parse(soulData) : soulData;
}

// Get recent chat context
async function getRecentChat(limit: number = 25): Promise<ChatMessage[]> {
  const messages = await redis.lrange(MESSAGES_KEY, 0, limit - 1);
  return messages
    .map((m: any) => typeof m === 'string' ? JSON.parse(m) : m)
    .reverse();
}

// Get online agents with capabilities
async function getOnlineAgents(): Promise<AgentProfile[]> {
  const profilesHashRaw = await redis.hgetall(PROFILES_KEY);
  const profilesHash = profilesHashRaw || {};
  const now = Date.now();
  const ONLINE_THRESHOLD = 10 * 60 * 1000; // 10 minutes

  return Object.values(profilesHash)
    .map((p: any) => typeof p === 'string' ? JSON.parse(p) : p)
    .filter((p: any) => {
      if (!p) return false;
      const lastSeen = p.lastSeen ? new Date(p.lastSeen).getTime() : 0;
      return now - lastSeen < ONLINE_THRESHOLD;
    });
}

// Get current work context (tasks, claims, blockers)
async function getWorkContext(): Promise<{
  tasks: any[];
  claims: any[];
  blockers: any[];
}> {
  const [tasksHashRaw, claimsHashRaw, memoryHashRaw] = await Promise.all([
    redis.hgetall(TASKS_KEY),
    redis.hgetall(CLAIMS_KEY),
    redis.hgetall(MEMORY_KEY),
  ]);

  // Handle null/undefined from Redis
  const tasksHash = tasksHashRaw || {};
  const claimsHash = claimsHashRaw || {};
  const memoryHash = memoryHashRaw || {};

  const tasks = Object.values(tasksHash)
    .map((t: any) => typeof t === 'string' ? JSON.parse(t) : t)
    .filter((t: any) => t && t.status !== 'done')
    .slice(0, 15);

  const claims = Object.values(claimsHash)
    .map((c: any) => typeof c === 'string' ? JSON.parse(c) : c)
    .filter((c: any) => c)
    .slice(0, 15);

  const blockers = Object.values(memoryHash)
    .map((m: any) => typeof m === 'string' ? JSON.parse(m) : m)
    .filter((m: any) => m && m.category === 'blocker')
    .slice(0, 10);

  return { tasks, claims, blockers };
}

// Analyze message to determine if moderator should respond
function shouldModeratorRespond(message: ChatMessage, recentChat: ChatMessage[]): {
  shouldRespond: boolean;
  reason: string;
  priority: 'high' | 'medium' | 'low';
} {
  const msgLower = message.message.toLowerCase();

  // Always respond to direct mentions
  if (msgLower.includes('@captain') || msgLower.includes('@moderator') || msgLower.includes('@team')) {
    return { shouldRespond: true, reason: 'direct_mention', priority: 'high' };
  }

  // Respond to human messages that look like requests
  if (message.authorType === 'human') {
    const isQuestion = msgLower.includes('?') ||
                      msgLower.startsWith('who') ||
                      msgLower.startsWith('what') ||
                      msgLower.startsWith('how') ||
                      msgLower.startsWith('can');

    const isRequest = msgLower.includes('need') ||
                     msgLower.includes('help') ||
                     msgLower.includes('please') ||
                     msgLower.includes('want');

    const isStatusCheck = msgLower.includes('status') ||
                         msgLower.includes('update') ||
                         msgLower.includes('progress');

    if (isQuestion || isRequest) {
      return { shouldRespond: true, reason: 'human_request', priority: 'high' };
    }
    if (isStatusCheck) {
      return { shouldRespond: true, reason: 'status_check', priority: 'medium' };
    }
  }

  // Respond to agent conflicts or blockers
  if (msgLower.includes('blocker') || msgLower.includes('blocked') || msgLower.includes('conflict')) {
    return { shouldRespond: true, reason: 'blocker_detected', priority: 'high' };
  }

  // Respond to task completions
  if (msgLower.includes('completed') || msgLower.includes('done') || msgLower.includes('finished')) {
    return { shouldRespond: true, reason: 'task_completion', priority: 'low' };
  }

  return { shouldRespond: false, reason: 'no_action_needed', priority: 'low' };
}

// Build moderator system prompt with full context
function buildModeratorPrompt(
  soul: any,
  chatContext: string,
  teamContext: string,
  workContext: string
): string {
  return `${soul.personality}

${soul.systemPromptAdditions}

CURRENT TEAM STATUS:
${teamContext}

ACTIVE WORK:
${workContext}

RECENT CHAT (last 20 messages):
${chatContext}

Remember: You are Captain, the team lead. Be decisive, delegate wisely, and keep the team moving forward.`;
}

// Post message to chat
async function postToChat(message: string): Promise<void> {
  const chatMessage = {
    id: `${Date.now().toString(36)}-captain`,
    author: 'Captain',
    authorType: 'ai',
    message,
    timestamp: new Date().toISOString(),
    reactions: [],
  };
  await redis.lpush(MESSAGES_KEY, JSON.stringify(chatMessage));
}

// ============ TOOL EXECUTION FUNCTIONS ============

// GitHub API helper
async function githubApi(endpoint: string, options: RequestInit = {}): Promise<any> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN not configured');
  }

  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${error}`);
  }

  return response.json();
}

// Read file from GitHub
async function toolReadFile(path: string): Promise<string> {
  try {
    const data = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`);
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return content;
  } catch (error) {
    return `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

// Write/update file on GitHub
async function toolWriteFile(path: string, content: string, message: string): Promise<string> {
  try {
    // First, get the current file SHA (if it exists)
    let sha: string | undefined;
    try {
      const existing = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`);
      sha = existing.sha;
    } catch {
      // File doesn't exist, that's ok
    }

    // Create or update the file
    const body: any = {
      message: `${message}\n\n🤖 Committed by Captain (Chat Moderator)`,
      content: Buffer.from(content).toString('base64'),
      branch: GITHUB_BRANCH,
    };
    if (sha) {
      body.sha = sha;
    }

    const result = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });

    return `✅ File ${sha ? 'updated' : 'created'}: ${path}\nCommit: ${result.commit.sha.substring(0, 7)}`;
  } catch (error) {
    return `Error writing file: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

// List files in directory
async function toolListFiles(path: string): Promise<string> {
  try {
    const data = await githubApi(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`);
    if (Array.isArray(data)) {
      const files = data.map((f: any) => `${f.type === 'dir' ? '📁' : '📄'} ${f.name}`);
      return `Files in ${path || '/'}:\n${files.join('\n')}`;
    }
    return `${path} is a file, not a directory`;
  } catch (error) {
    return `Error listing files: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

// Create a task
async function toolCreateTask(title: string, description?: string, priority?: string, assignee?: string): Promise<string> {
  const taskId = `task-${Date.now().toString(36)}`;
  const task = {
    id: taskId,
    title,
    description: description || '',
    status: 'todo',
    priority: priority || 'medium',
    assignee: assignee || null,
    createdBy: 'Captain',
    createdAt: new Date().toISOString(),
  };

  await redis.hset(TASKS_KEY, { [taskId]: JSON.stringify(task) });
  return `✅ Task created: "${title}" (${taskId})${assignee ? ` - Assigned to @${assignee}` : ''}`;
}

// Spawn agent via local spawn service
async function toolSpawnAgent(task: string, agentId?: string): Promise<string> {
  try {
    // Try local spawn service first
    const spawnResponse = await fetch('http://localhost:3848/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task,
        agentId,
        requestedBy: 'Captain',
      }),
    });

    if (spawnResponse.ok) {
      const result = await spawnResponse.json();
      return `🚀 Agent spawned: ${result.agentId || 'new-agent'}\nTask: ${task}`;
    }
  } catch {
    // Local service not running, try cloud spawn
  }

  // Fallback: Post to chat asking for manual spawn
  return `⚠️ Local spawn service unavailable. Manual spawn needed.\n\nTask requiring new agent:\n${task}`;
}

// Get team status
async function toolGetTeamStatus(): Promise<string> {
  const [onlineAgents, work] = await Promise.all([
    getOnlineAgents(),
    getWorkContext(),
  ]);

  const lines = [
    `**Team Status**`,
    `Online agents: ${onlineAgents.length}`,
    onlineAgents.map(a => `  • ${a.agentId}: ${(a.offers || []).slice(0, 2).join(', ')}`).join('\n'),
    '',
    `Active tasks: ${work.tasks.length}`,
    work.tasks.slice(0, 5).map(t => `  • ${t.title} (${t.status})`).join('\n'),
    '',
    `Blockers: ${work.blockers.length}`,
    work.blockers.slice(0, 3).map(b => `  ⚠️ ${b.content}`).join('\n'),
  ];

  return lines.filter(Boolean).join('\n');
}

// Search code in repository
async function toolSearchCode(query: string, path?: string): Promise<string> {
  try {
    const searchQuery = `${query} repo:${GITHUB_OWNER}/${GITHUB_REPO}${path ? ` path:${path}` : ''}`;
    const data = await githubApi(`/search/code?q=${encodeURIComponent(searchQuery)}`);

    if (data.total_count === 0) {
      return `No results found for "${query}"`;
    }

    const results = data.items.slice(0, 5).map((item: any) =>
      `📄 ${item.path}`
    );

    return `Found ${data.total_count} results:\n${results.join('\n')}`;
  } catch (error) {
    return `Error searching code: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

// Execute a tool and return the result
async function executeTool(toolName: string, toolInput: any): Promise<string> {
  switch (toolName) {
    case 'read_file':
      return toolReadFile(toolInput.path);
    case 'write_file':
      return toolWriteFile(toolInput.path, toolInput.content, toolInput.message);
    case 'list_files':
      return toolListFiles(toolInput.path || '');
    case 'create_task':
      return toolCreateTask(toolInput.title, toolInput.description, toolInput.priority, toolInput.assignee);
    case 'spawn_agent':
      return toolSpawnAgent(toolInput.task, toolInput.agentId);
    case 'post_chat':
      await postToChat(toolInput.message);
      return 'Message posted to chat';
    case 'get_team_status':
      return toolGetTeamStatus();
    case 'search_code':
      return toolSearchCode(toolInput.query, toolInput.path);
    default:
      return `Unknown tool: ${toolName}`;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = (req.query.action as string) || (req.body?.action as string);

  try {
    // ============ RESPOND - Process message and generate response ============
    if (action === 'respond') {
      const { message, author, forceRespond = false } = req.body;

      if (!message) {
        return res.status(400).json({ error: 'message required' });
      }

      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
      }

      // Get context
      const [soul, recentChat, onlineAgents, work] = await Promise.all([
        getModeratorSoul(),
        getRecentChat(25),
        getOnlineAgents(),
        getWorkContext(),
      ]);

      // Check if moderator should respond
      const incomingMsg: ChatMessage = {
        id: 'incoming',
        author: author || 'unknown',
        authorType: 'human',
        message,
        timestamp: new Date().toISOString(),
      };

      const decision = shouldModeratorRespond(incomingMsg, recentChat);

      if (!decision.shouldRespond && !forceRespond) {
        return res.json({
          responded: false,
          reason: decision.reason,
          priority: decision.priority,
        });
      }

      // Build context strings
      const chatContext = recentChat
        .slice(-20)
        .map(m => `[${m.authorType}] ${m.author}: ${m.message}`)
        .join('\n');

      const teamContext = onlineAgents.length > 0
        ? onlineAgents.map(a =>
            `• ${a.agentId}: ${(a.offers || []).slice(0, 3).join(', ') || 'general'} | Tools: ${(a.mcpTools || []).slice(0, 4).join(', ') || 'standard'}`
          ).join('\n')
        : 'No agents currently online';

      const workContextStr = [
        work.tasks.length > 0 ? `Active tasks: ${work.tasks.map(t => t.title).join(', ')}` : '',
        work.claims.length > 0 ? `Claims: ${work.claims.map(c => `${c.agentId}→${c.what}`).join(', ')}` : '',
        work.blockers.length > 0 ? `⚠️ Blockers: ${work.blockers.map(b => b.content).join('; ')}` : '',
      ].filter(Boolean).join('\n') || 'No active work tracked';

      // Build prompt and call Claude with tools
      const systemPrompt = buildModeratorPrompt(soul, chatContext, teamContext, workContextStr);

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      // Initial message to Claude with tools
      const messages: Anthropic.MessageParam[] = [
        {
          role: 'user',
          content: `[${author || 'User'}]: ${message}\n\n(Respond as Captain, the team lead. Be decisive and action-oriented. Use tools when needed to take real action.)`,
        },
      ];

      let response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: systemPrompt,
        tools: CAPTAIN_TOOLS,
        messages,
      });

      // Track total tokens
      let totalInputTokens = response.usage?.input_tokens || 0;
      let totalOutputTokens = response.usage?.output_tokens || 0;
      const toolsUsed: string[] = [];

      // Tool use loop - process tool calls until we get a final text response
      const maxIterations = 5; // Safety limit
      let iteration = 0;

      while (response.stop_reason === 'tool_use' && iteration < maxIterations) {
        iteration++;

        // Collect tool results for this iteration
        const toolResults: Anthropic.MessageParam = {
          role: 'user',
          content: [],
        };

        // Process each tool call
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            toolsUsed.push(block.name);
            console.log(`Captain executing tool: ${block.name}`, block.input);

            const toolResult = await executeTool(block.name, block.input);

            (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: toolResult,
            });
          }
        }

        // Add assistant's response and tool results to messages
        messages.push({
          role: 'assistant',
          content: response.content,
        });
        messages.push(toolResults);

        // Continue the conversation
        response = await anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 2048,
          system: systemPrompt,
          tools: CAPTAIN_TOOLS,
          messages,
        });

        totalInputTokens += response.usage?.input_tokens || 0;
        totalOutputTokens += response.usage?.output_tokens || 0;
      }

      // Extract final text response
      let responseText = '';
      for (const block of response.content) {
        if (block.type === 'text') {
          responseText += block.text;
        }
      }

      // Post response to chat (only if we have text to post)
      if (responseText.trim()) {
        await postToChat(responseText);
      }

      // Update soul metrics
      soul.lastActiveAt = new Date().toISOString();
      soul.responsesCount = (soul.responsesCount || 0) + 1;
      soul.totalTokensProcessed = (soul.totalTokensProcessed || 0) + totalInputTokens + totalOutputTokens;
      soul.totalTasksCompleted = (soul.totalTasksCompleted || 0) + (toolsUsed.length > 0 ? 1 : 0);
      await redis.hset(SOULS_KEY, { [MODERATOR_SOUL_ID]: JSON.stringify(soul) });

      return res.json({
        responded: true,
        response: responseText,
        reason: decision.reason,
        priority: decision.priority,
        toolsUsed,
        iterations: iteration,
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
        },
        context: {
          onlineAgents: onlineAgents.length,
          activeTasks: work.tasks.length,
          blockers: work.blockers.length,
        },
      });
    }

    // ============ EXECUTE - Direct tool execution ============
    if (action === 'execute') {
      const { tool, input } = req.body;

      if (!tool) {
        return res.status(400).json({
          error: 'tool required',
          availableTools: CAPTAIN_TOOLS.map(t => t.name),
        });
      }

      const validTool = CAPTAIN_TOOLS.find(t => t.name === tool);
      if (!validTool) {
        return res.status(400).json({
          error: `Unknown tool: ${tool}`,
          availableTools: CAPTAIN_TOOLS.map(t => t.name),
        });
      }

      try {
        const result = await executeTool(tool, input || {});
        return res.json({
          success: true,
          tool,
          result,
        });
      } catch (error) {
        return res.status(500).json({
          error: `Tool execution failed`,
          details: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // ============ DELEGATE - Delegate task to specific agent ============
    if (action === 'delegate') {
      const { task, targetAgent, context, expectedOutput } = req.body;

      if (!task || !targetAgent) {
        return res.status(400).json({ error: 'task and targetAgent required' });
      }

      const delegationMsg = `@${targetAgent} 🎯 **Task**: ${task}
${context ? `**Context**: ${context}` : ''}
${expectedOutput ? `**Expected output**: ${expectedOutput}` : ''}

– Captain`;

      await postToChat(delegationMsg);

      // Update soul delegation count
      const soul = await getModeratorSoul();
      soul.delegationCount = (soul.delegationCount || 0) + 1;
      await redis.hset(SOULS_KEY, { [MODERATOR_SOUL_ID]: JSON.stringify(soul) });

      return res.json({
        delegated: true,
        to: targetAgent,
        task,
      });
    }

    // ============ STATUS - Get team status summary ============
    if (action === 'status') {
      const [onlineAgents, work] = await Promise.all([
        getOnlineAgents(),
        getWorkContext(),
      ]);

      return res.json({
        team: {
          online: onlineAgents.length,
          agents: onlineAgents.map(a => ({
            id: a.agentId,
            specialties: (a.offers || []).slice(0, 3),
            tools: (a.mcpTools || []).slice(0, 5),
          })),
        },
        work: {
          activeTasks: work.tasks.length,
          claims: work.claims.length,
          blockers: work.blockers.length,
          taskList: work.tasks.map(t => ({ title: t.title, status: t.status })),
          blockerList: work.blockers.map(b => b.content),
        },
      });
    }

    // ============ SPAWN - Spawn a specialized agent via agent-chat API ============
    if (action === 'spawn') {
      const { soulId, trigger, context } = req.body;

      if (!soulId) {
        return res.status(400).json({ error: 'soulId required' });
      }

      // Use Phil's agent-chat endpoint to spawn the agent
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://agent-coord-mcp.vercel.app';

      try {
        const spawnResponse = await fetch(`${baseUrl}/api/agent-chat?action=respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            soulId,
            trigger: trigger || `Captain is spawning you. ${context || 'Await further instructions.'}`,
            postToGroupChat: true,
          }),
        });

        const result = await spawnResponse.json();

        // Post notification from Captain
        await postToChat(`🚀 **Spawned @${soulId}** - ${context || 'Ready for assignment'}`);

        // Update soul metrics
        const soul = await getModeratorSoul();
        soul.totalTasksAttempted = (soul.totalTasksAttempted || 0) + 1;
        await redis.hset(SOULS_KEY, { [MODERATOR_SOUL_ID]: JSON.stringify(soul) });

        return res.json({
          spawned: true,
          soulId,
          result,
        });
      } catch (err) {
        return res.status(500).json({
          error: 'Failed to spawn agent',
          details: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // ============ SOUL - Get moderator soul info ============
    if (action === 'soul') {
      const soul = await getModeratorSoul();

      return res.json({
        soul: {
          id: soul.soulId,
          name: soul.name,
          lastActive: soul.lastActiveAt,
          totalResponses: soul.responsesCount || 0,
          totalDelegations: soul.delegationCount || 0,
          totalTokens: soul.totalTokensProcessed || 0,
          expertise: soul.expertise,
        },
      });
    }

    // ============ DEFAULT - Help ============
    return res.json({
      message: 'Chat Moderator API - Captain, Full-Capability Team Lead AI',
      actions: {
        'respond': 'POST - Process message and respond as Captain (with tool_use)',
        'execute': 'POST - Execute a tool directly (tool, input params)',
        'delegate': 'POST - Delegate task to specific agent',
        'spawn': 'POST - Spawn a specialized agent via agent-chat API',
        'status': 'GET - Get team status summary',
        'soul': 'GET - Get Captain soul info',
      },
      tools: CAPTAIN_TOOLS.map(t => ({ name: t.name, description: t.description })),
      description: 'Captain is the full-capability team lead that can read/write files, make commits, create tasks, and coordinate agents.',
      capabilities: [
        'Read files from GitHub',
        'Write/edit files and commit to GitHub',
        'Create coordination tasks',
        'Spawn new Claude agents',
        'Search codebase',
        'Get team status',
      ],
    });

  } catch (error) {
    console.error('Chat moderator error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
