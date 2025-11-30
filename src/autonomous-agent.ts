/**
 * Autonomous Agent Service
 * 
 * A powerful AI agent that runs 24/7, monitors the group chat,
 * and can perform complex tasks including:
 * - Reading GitHub repos for context
 * - Spawning new specialized agents
 * - Coordinating multi-agent workflows
 * - Executing and reporting on tasks
 */

import Anthropic from '@anthropic-ai/sdk';

// Configuration
const CONFIG = {
  API_BASE: process.env.API_BASE || 'https://agent-coord-mcp.vercel.app',
  AGENT_ID: process.env.AGENT_ID || 'autonomous-agent',
  AGENT_ROLE: process.env.AGENT_ROLE || 'orchestrator',
  POLL_INTERVAL: parseInt(process.env.POLL_INTERVAL || '3000'),
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  GITHUB_ORG: process.env.GITHUB_ORG || 'Piston-Labs',
};

const anthropic = new Anthropic();

// Tool definitions for Claude
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_github_file',
    description: 'Read a file from a GitHub repository to understand code or documentation',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Repository name (e.g., "context-engine")' },
        path: { type: 'string', description: 'File path within the repo (e.g., "README.md")' },
        branch: { type: 'string', description: 'Branch name (default: main)', default: 'main' }
      },
      required: ['repo', 'path']
    }
  },
  {
    name: 'list_github_files',
    description: 'List files in a GitHub repository directory',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'Directory path (default: root)', default: '' },
        branch: { type: 'string', description: 'Branch name', default: 'main' }
      },
      required: ['repo']
    }
  },
  {
    name: 'post_chat_message',
    description: 'Post a message to the agent coordination group chat',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: 'Message to post' }
      },
      required: ['message']
    }
  },
  {
    name: 'spawn_agent',
    description: 'Spawn a new specialized agent for a specific task',
    input_schema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'Unique ID for the new agent' },
        role: { type: 'string', description: 'Role/specialty (e.g., "code-reviewer", "doc-writer")' },
        task: { type: 'string', description: 'Initial task description' }
      },
      required: ['agentId', 'role', 'task']
    }
  },
  {
    name: 'get_agent_status',
    description: 'Get status of all registered agents',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  },
  {
    name: 'complete_task',
    description: 'Mark a task as complete and report results',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'Task ID to complete' },
        result: { type: 'string', description: 'Task result/summary' }
      },
      required: ['taskId', 'result']
    }
  },
  {
    name: 'load_context_cluster',
    description: 'Load a context cluster from the Context Engine. Use this to get synthesized knowledge about a domain before working on tasks. Available clusters include: technical, development, company, telemetry, frontend, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        clusters: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'List of cluster names to load (e.g., ["technical", "development"])' 
        },
        repo: { type: 'string', description: 'Repository containing the context (default: context-engine)', default: 'context-engine' }
      },
      required: ['clusters']
    }
  },
  {
    name: 'list_context_clusters',
    description: 'List available context clusters from the Context Engine. Use this to discover what knowledge domains are available before loading.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Repository containing the context (default: context-engine)', default: 'context-engine' }
      },
      required: []
    }
  },
  {
    name: 'analyze_task_for_context',
    description: 'Analyze a task description and recommend which context clusters to load. Returns cluster recommendations based on keywords and task type.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task: { type: 'string', description: 'Task description to analyze' },
        taskType: { type: 'string', description: 'Type of task: feat, fix, docs, refactor, test', default: 'feat' }
      },
      required: ['task']
    }
  }
];

// Tool implementations
async function executeTools(toolName: string, toolInput: Record<string, unknown>): Promise<string> {
  switch (toolName) {
    case 'read_github_file': {
      const { repo, path, branch = 'main' } = toolInput as { repo: string; path: string; branch?: string };
      try {
        const url = `https://api.github.com/repos/${CONFIG.GITHUB_ORG}/${repo}/contents/${path}?ref=${branch}`;
        const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3.raw' };
        if (CONFIG.GITHUB_TOKEN) headers['Authorization'] = `token ${CONFIG.GITHUB_TOKEN}`;
        
        const res = await fetch(url, { headers });
        if (!res.ok) return `Error: ${res.status} - ${await res.text()}`;
        return await res.text();
      } catch (err) {
        return `Error reading file: ${err}`;
      }
    }

    case 'list_github_files': {
      const { repo, path = '', branch = 'main' } = toolInput as { repo: string; path?: string; branch?: string };
      try {
        const url = `https://api.github.com/repos/${CONFIG.GITHUB_ORG}/${repo}/contents/${path}?ref=${branch}`;
        const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
        if (CONFIG.GITHUB_TOKEN) headers['Authorization'] = `token ${CONFIG.GITHUB_TOKEN}`;
        
        const res = await fetch(url, { headers });
        if (!res.ok) return `Error: ${res.status}`;
        const files = await res.json();
        return files.map((f: any) => `${f.type === 'dir' ? '[DIR]' : '[FILE]'} ${f.name}`).join('\n');
      } catch (err) {
        return `Error listing files: ${err}`;
      }
    }

    case 'post_chat_message': {
      const { message } = toolInput as { message: string };
      try {
        const res = await fetch(`${CONFIG.API_BASE}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ author: CONFIG.AGENT_ID, authorType: 'agent', message })
        });
        const data = await res.json();
        return `Message posted: ${data.id}`;
      } catch (err) {
        return `Error posting: ${err}`;
      }
    }

    case 'spawn_agent': {
      const { agentId, role, task } = toolInput as { agentId: string; role: string; task: string };
      try {
        // Register the new agent
        await fetch(`${CONFIG.API_BASE}/api/agents/${agentId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'active', currentTask: task, roles: [role], spawnedBy: CONFIG.AGENT_ID })
        });
        
        // Post announcement
        await fetch(`${CONFIG.API_BASE}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            author: CONFIG.AGENT_ID,
            authorType: 'agent',
            message: `Spawned new agent: @${agentId} (${role}) - Task: ${task}`
          })
        });
        
        return `Agent ${agentId} spawned with role ${role}`;
      } catch (err) {
        return `Error spawning agent: ${err}`;
      }
    }

    case 'get_agent_status': {
      try {
        const res = await fetch(`${CONFIG.API_BASE}/api/agents`);
        const data = await res.json();
        return JSON.stringify(data, null, 2);
      } catch (err) {
        return `Error getting agents: ${err}`;
      }
    }

    case 'complete_task': {
      const { taskId, result } = toolInput as { taskId: string; result: string };
      await fetch(`${CONFIG.API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: CONFIG.AGENT_ID,
          authorType: 'agent',
          message: `✅ Task ${taskId} complete: ${result}`
        })
      });
      return `Task ${taskId} marked complete`;
    }

    case 'load_context_cluster': {
      const { clusters, repo = 'context-engine' } = toolInput as { clusters: string[]; repo?: string };
      try {
        const contents: string[] = [];
        const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3.raw' };
        if (CONFIG.GITHUB_TOKEN) headers['Authorization'] = `token ${CONFIG.GITHUB_TOKEN}`;
        
        for (const cluster of clusters) {
          // Try to load cluster INDEX.md or main file
          const paths = [`context/${cluster}/INDEX.md`, `context/${cluster}.md`, `clusters/${cluster}/INDEX.md`];
          for (const path of paths) {
            const url = `https://api.github.com/repos/${CONFIG.GITHUB_ORG}/${repo}/contents/${path}`;
            const res = await fetch(url, { headers });
            if (res.ok) {
              const content = await res.text();
              contents.push(`## Cluster: ${cluster}\n\n${content}`);
              break;
            }
          }
        }
        return contents.length > 0 ? contents.join('\n\n---\n\n') : `No content found for clusters: ${clusters.join(', ')}`;
      } catch (err) {
        return `Error loading clusters: ${err}`;
      }
    }

    case 'list_context_clusters': {
      const { repo = 'context-engine' } = toolInput as { repo?: string };
      try {
        const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
        if (CONFIG.GITHUB_TOKEN) headers['Authorization'] = `token ${CONFIG.GITHUB_TOKEN}`;
        
        // Try common context directories
        const contextPaths = ['context', 'clusters', '.'];
        for (const contextPath of contextPaths) {
          const url = `https://api.github.com/repos/${CONFIG.GITHUB_ORG}/${repo}/contents/${contextPath}`;
          const res = await fetch(url, { headers });
          if (res.ok) {
            const items = await res.json();
            const clusters = items.filter((i: any) => i.type === 'dir').map((i: any) => i.name);
            if (clusters.length > 0) {
              return `Available clusters in ${repo}/${contextPath}:\n${clusters.map((c: string) => `- ${c}`).join('\n')}`;
            }
          }
        }
        return `No cluster directories found in ${repo}`;
      } catch (err) {
        return `Error listing clusters: ${err}`;
      }
    }

    case 'analyze_task_for_context': {
      const { task, taskType = 'feat' } = toolInput as { task: string; taskType?: string };
      const taskLower = task.toLowerCase();
      const recommendations: string[] = [];
      
      // Domain detection based on keywords
      const domainKeywords: Record<string, string[]> = {
        'technical': ['api', 'database', 'backend', 'server', 'deploy', 'infrastructure'],
        'development': ['code', 'implement', 'build', 'feature', 'component'],
        'telemetry': ['gps', 'teltonika', 'tracking', 'fleet', 'vehicle', 'iot'],
        'frontend': ['ui', 'dashboard', 'react', 'nextjs', 'component', 'page'],
        'company': ['process', 'team', 'workflow', 'strategy'],
      };
      
      for (const [domain, keywords] of Object.entries(domainKeywords)) {
        if (keywords.some(kw => taskLower.includes(kw))) {
          recommendations.push(domain);
        }
      }
      
      // Task type defaults
      if (taskType === 'fix' || taskType === 'refactor') {
        if (!recommendations.includes('technical')) recommendations.unshift('technical');
      } else if (taskType === 'feat') {
        if (!recommendations.includes('development')) recommendations.push('development');
      } else if (taskType === 'docs') {
        recommendations.push('company');
      }
      
      if (recommendations.length === 0) recommendations.push('technical', 'development');
      
      return `Recommended clusters for "${task}" (${taskType}):\n${recommendations.map(r => `- ${r}`).join('\n')}\n\nUse load_context_cluster to load these before starting work.`;
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}


// System prompt with full context
const SYSTEM_PROMPT = `You are ${CONFIG.AGENT_ID}, an autonomous AI agent in the Piston Labs multi-agent coordination system.

## Your Environment
- You run 24/7 on Railway, monitoring the group chat at ${CONFIG.API_BASE}
- You can read GitHub repos (Piston-Labs org) for code context
- You can spawn new specialized agents for subtasks
- You coordinate with other agents (claude-code, claude-desktop, and any spawned agents)

## Key Repositories
- **agent-coord-mcp**: This coordination system (chat, agents, tasks)
- **context-engine**: Context management and documentation system
- **gran-autismo**: Fleet management dashboard (Next.js/Supabase)
- **teltonika-context-system**: GPS telemetry backend (AWS/IoT)

## Your Capabilities
1. **Read code/docs** from any Piston Labs repo to understand architecture
2. **Load Context Clusters** - Use analyze_task_for_context to identify relevant clusters, then load_context_cluster to get synthesized knowledge before working on tasks
3. **Post messages** to coordinate with the team and other agents
4. **Spawn agents** for specialized tasks (code-review, doc-writing, testing)
5. **Complete tasks** and report results

## Context Engine Integration
Before starting any task, you should:
1. Use analyze_task_for_context to determine which clusters are relevant
2. Use load_context_cluster to load synthesized knowledge from those clusters
3. Use this context to inform your approach and decisions

Available context clusters typically include: technical, development, company, telemetry, frontend, etc.

## Guidelines
- Be proactive - if you see a problem, propose solutions
- Use tools to gather context before making recommendations
- Spawn specialized agents for complex subtasks
- Keep messages concise and actionable
- Always coordinate via the group chat

## Current Role: ${CONFIG.AGENT_ROLE}

When humans or agents ask you to do something, use your tools to accomplish it. Think step by step.`;

interface ChatMessage {
  id: string;
  author: string;
  authorType: 'agent' | 'human';
  message: string;
  timestamp: string;
}

let lastProcessedTimestamp: string | null = null;
let conversationHistory: Anthropic.MessageParam[] = [];

async function getNewMessages(): Promise<ChatMessage[]> {
  try {
    const url = lastProcessedTimestamp
      ? `${CONFIG.API_BASE}/api/chat?since=${encodeURIComponent(lastProcessedTimestamp)}`
      : `${CONFIG.API_BASE}/api/chat?limit=5`;

    const res = await fetch(url);
    const data = await res.json();
    return data.messages.filter((m: ChatMessage) => m.author !== CONFIG.AGENT_ID);
  } catch (err) {
    console.error('[agent] Failed to fetch messages:', err);
    return [];
  }
}

async function processWithTools(userContent: string): Promise<string> {
  conversationHistory.push({ role: 'user', content: userContent });
  
  // Keep history manageable
  if (conversationHistory.length > 20) {
    conversationHistory = conversationHistory.slice(-20);
  }

  let response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    messages: conversationHistory
  });

  // Handle tool use loop
  while (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    
    for (const toolUse of toolUseBlocks) {
      console.log(`[agent] Using tool: ${toolUse.name}`);
      const result = await executeTools(toolUse.name, toolUse.input as Record<string, unknown>);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result
      });
    }

    conversationHistory.push({ role: 'assistant', content: response.content });
    conversationHistory.push({ role: 'user', content: toolResults });

    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: conversationHistory
    });
  }

  const textContent = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text'
  );

  const assistantMessage = textContent?.text || '';
  conversationHistory.push({ role: 'assistant', content: response.content });
  
  return assistantMessage;
}


async function shouldRespond(messages: ChatMessage[]): Promise<boolean> {
  for (const msg of messages) {
    // Always respond to humans
    if (msg.authorType === 'human') return true;
    // Respond to @mentions
    if (msg.message.toLowerCase().includes(`@${CONFIG.AGENT_ID.toLowerCase()}`)) return true;
    // Respond to general @agent calls
    if (msg.message.includes('@autonomous') || msg.message.includes('@orchestrator')) return true;
  }
  return false;
}

async function updateStatus(task: string): Promise<void> {
  try {
    await fetch(`${CONFIG.API_BASE}/api/agents/${CONFIG.AGENT_ID}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'active',
        currentTask: task,
        roles: [CONFIG.AGENT_ROLE, 'autonomous'],
        lastSeen: new Date().toISOString()
      })
    });
  } catch (err) {
    console.error('[agent] Failed to update status:', err);
  }
}

async function postMessage(message: string): Promise<void> {
  try {
    await fetch(`${CONFIG.API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: CONFIG.AGENT_ID, authorType: 'agent', message })
    });
  } catch (err) {
    console.error('[agent] Failed to post:', err);
  }
}

async function mainLoop(): Promise<void> {
  console.log(`[agent] Starting ${CONFIG.AGENT_ID} (${CONFIG.AGENT_ROLE})`);
  console.log(`[agent] Connecting to ${CONFIG.API_BASE}`);
  console.log(`[agent] Poll interval: ${CONFIG.POLL_INTERVAL}ms`);
  
  await updateStatus('Starting up...');
  await postMessage(`🤖 ${CONFIG.AGENT_ID} is now online! Role: ${CONFIG.AGENT_ROLE}. I can read GitHub repos, spawn agents, and coordinate tasks. Ask me anything!`);

  while (true) {
    try {
      await updateStatus('Monitoring chat');
      const newMessages = await getNewMessages();

      if (newMessages.length > 0) {
        console.log(`[agent] Found ${newMessages.length} new message(s)`);
        lastProcessedTimestamp = newMessages[newMessages.length - 1].timestamp;

        if (await shouldRespond(newMessages)) {
          await updateStatus('Processing request...');
          
          const context = newMessages.map(m => `${m.author}: ${m.message}`).join('\n');
          console.log(`[agent] Processing: ${context.substring(0, 100)}...`);
          
          const response = await processWithTools(context);
          
          if (response) {
            await postMessage(response);
            console.log(`[agent] Responded: ${response.substring(0, 100)}...`);
          }
        }
      }
    } catch (err) {
      console.error('[agent] Loop error:', err);
    }

    await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL));
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[agent] Shutting down...');
  await postMessage(`🔴 ${CONFIG.AGENT_ID} going offline.`);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[agent] Shutting down...');
  await postMessage(`🔴 ${CONFIG.AGENT_ID} going offline.`);
  process.exit(0);
});

// Start
mainLoop().catch(err => {
  console.error('[agent] Fatal error:', err);
  process.exit(1);
});
