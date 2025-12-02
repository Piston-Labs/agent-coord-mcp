/**
 * Cloud Code Agent
 *
 * An autonomous AI agent that can:
 * - Poll the coordination hub for task assignments
 * - Read and write code to GitHub repos
 * - Create branches, commits, and PRs
 * - Run code in sandboxed environments (E2B)
 * - Report progress to the group chat
 *
 * Deploy to Railway/Render for 24/7 operation.
 */

import Anthropic from '@anthropic-ai/sdk';

// Configuration
const CONFIG = {
  API_BASE: process.env.API_BASE || 'https://agent-coord-mcp.vercel.app',
  AGENT_ID: process.env.AGENT_ID || 'cloud-agent',
  AGENT_NAME: process.env.AGENT_NAME || 'CloudCoder',
  POLL_INTERVAL: parseInt(process.env.POLL_INTERVAL || '5000'),
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  GITHUB_ORG: process.env.GITHUB_ORG || 'Piston-Labs',
  E2B_API_KEY: process.env.E2B_API_KEY || '',
};

const anthropic = new Anthropic();

// GitHub API helpers
async function githubRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
  const url = endpoint.startsWith('http') ? endpoint : `https://api.github.com${endpoint}`;
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': CONFIG.AGENT_ID,
    ...(options.headers as Record<string, string> || {})
  };

  if (CONFIG.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${CONFIG.GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${error}`);
  }
  return res.json();
}

// Tool definitions for Claude
const TOOLS: Anthropic.Tool[] = [
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
    name: 'get_file_contents',
    description: 'Get contents of a file from a GitHub repository',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Repository name (e.g., "agent-coord-mcp")' },
        path: { type: 'string', description: 'File path within the repo' },
        branch: { type: 'string', description: 'Branch name (default: main)', default: 'main' }
      },
      required: ['repo', 'path']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a GitHub repository path',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'Directory path (empty for root)', default: '' },
        branch: { type: 'string', description: 'Branch name', default: 'main' }
      },
      required: ['repo']
    }
  },
  {
    name: 'create_or_update_file',
    description: 'Create or update a single file in a GitHub repository. Auto-creates branch if needed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'File path to create/update' },
        content: { type: 'string', description: 'File content (will be base64 encoded)' },
        message: { type: 'string', description: 'Commit message' },
        branch: { type: 'string', description: 'Branch name (auto-created if missing)', default: 'main' }
      },
      required: ['repo', 'path', 'content', 'message']
    }
  },
  {
    name: 'push_files',
    description: 'Push multiple files to a GitHub repository in a single commit',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Repository name' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' }
            },
            required: ['path', 'content']
          },
          description: 'Array of {path, content} objects'
        },
        message: { type: 'string', description: 'Commit message' },
        branch: { type: 'string', description: 'Branch name', default: 'main' }
      },
      required: ['repo', 'files', 'message']
    }
  },
  {
    name: 'create_branch',
    description: 'Create a new branch in a GitHub repository',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Repository name' },
        branch: { type: 'string', description: 'New branch name' },
        from: { type: 'string', description: 'Source branch', default: 'main' }
      },
      required: ['repo', 'branch']
    }
  },
  {
    name: 'create_pull_request',
    description: 'Create a pull request in a GitHub repository',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'PR title' },
        body: { type: 'string', description: 'PR description' },
        head: { type: 'string', description: 'Branch with changes' },
        base: { type: 'string', description: 'Target branch', default: 'main' }
      },
      required: ['repo', 'title', 'head']
    }
  },
  {
    name: 'run_code',
    description: 'Execute code in an E2B sandbox environment for testing',
    input_schema: {
      type: 'object' as const,
      properties: {
        language: { type: 'string', enum: ['python', 'javascript', 'typescript'], description: 'Programming language' },
        code: { type: 'string', description: 'Code to execute' }
      },
      required: ['language', 'code']
    }
  },
  {
    name: 'claim_task',
    description: 'Claim a task from the coordination hub to prevent conflicts',
    input_schema: {
      type: 'object' as const,
      properties: {
        what: { type: 'string', description: 'Task identifier to claim' },
        description: { type: 'string', description: 'What you plan to do' }
      },
      required: ['what']
    }
  },
  {
    name: 'release_task',
    description: 'Release a claimed task',
    input_schema: {
      type: 'object' as const,
      properties: {
        what: { type: 'string', description: 'Task identifier to release' }
      },
      required: ['what']
    }
  },
  {
    name: 'get_tasks',
    description: 'Get available tasks from the coordination hub',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['todo', 'in-progress', 'done', 'all'], default: 'todo' }
      },
      required: []
    }
  }
];

// Tool implementations
async function executeTools(toolName: string, toolInput: Record<string, unknown>): Promise<string> {
  switch (toolName) {
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

    case 'get_file_contents': {
      const { repo, path, branch = 'main' } = toolInput as { repo: string; path: string; branch?: string };
      try {
        const url = `/repos/${CONFIG.GITHUB_ORG}/${repo}/contents/${path}?ref=${branch}`;
        const data = await githubRequest(url);
        if (data.type === 'file') {
          const content = Buffer.from(data.content, 'base64').toString('utf-8');
          return content;
        }
        return JSON.stringify(data.map((f: any) => ({ name: f.name, type: f.type })));
      } catch (err) {
        return `Error: ${err}`;
      }
    }

    case 'list_directory': {
      const { repo, path = '', branch = 'main' } = toolInput as { repo: string; path?: string; branch?: string };
      try {
        const url = `/repos/${CONFIG.GITHUB_ORG}/${repo}/contents/${path}?ref=${branch}`;
        const data = await githubRequest(url);
        return data.map((f: any) => `${f.type === 'dir' ? '[DIR]' : '[FILE]'} ${f.name}`).join('\n');
      } catch (err) {
        return `Error: ${err}`;
      }
    }

    case 'create_or_update_file': {
      const { repo, path, content, message, branch = 'main' } = toolInput as {
        repo: string; path: string; content: string; message: string; branch?: string;
      };
      try {
        // Check if file exists to get SHA
        let sha: string | undefined;
        try {
          const existing = await githubRequest(`/repos/${CONFIG.GITHUB_ORG}/${repo}/contents/${path}?ref=${branch}`);
          sha = existing.sha;
        } catch (e) {
          // File doesn't exist, that's fine
        }

        const res = await githubRequest(`/repos/${CONFIG.GITHUB_ORG}/${repo}/contents/${path}`, {
          method: 'PUT',
          body: JSON.stringify({
            message,
            content: Buffer.from(content).toString('base64'),
            branch,
            sha
          })
        });
        return `File ${sha ? 'updated' : 'created'}: ${res.content.html_url}`;
      } catch (err) {
        return `Error: ${err}`;
      }
    }

    case 'push_files': {
      const { repo, files, message, branch = 'main' } = toolInput as {
        repo: string; files: { path: string; content: string }[]; message: string; branch?: string;
      };
      try {
        // Get latest commit SHA
        const refData = await githubRequest(`/repos/${CONFIG.GITHUB_ORG}/${repo}/git/ref/heads/${branch}`);
        const latestCommitSha = refData.object.sha;

        // Get base tree
        const commitData = await githubRequest(`/repos/${CONFIG.GITHUB_ORG}/${repo}/git/commits/${latestCommitSha}`);
        const baseTreeSha = commitData.tree.sha;

        // Create blobs for each file
        const tree = await Promise.all(files.map(async (file) => {
          const blobRes = await githubRequest(`/repos/${CONFIG.GITHUB_ORG}/${repo}/git/blobs`, {
            method: 'POST',
            body: JSON.stringify({
              content: Buffer.from(file.content).toString('base64'),
              encoding: 'base64'
            })
          });
          return {
            path: file.path,
            mode: '100644',
            type: 'blob',
            sha: blobRes.sha
          };
        }));

        // Create tree
        const treeRes = await githubRequest(`/repos/${CONFIG.GITHUB_ORG}/${repo}/git/trees`, {
          method: 'POST',
          body: JSON.stringify({ base_tree: baseTreeSha, tree })
        });

        // Create commit
        const newCommit = await githubRequest(`/repos/${CONFIG.GITHUB_ORG}/${repo}/git/commits`, {
          method: 'POST',
          body: JSON.stringify({
            message,
            tree: treeRes.sha,
            parents: [latestCommitSha]
          })
        });

        // Update ref
        await githubRequest(`/repos/${CONFIG.GITHUB_ORG}/${repo}/git/refs/heads/${branch}`, {
          method: 'PATCH',
          body: JSON.stringify({ sha: newCommit.sha })
        });

        return `Pushed ${files.length} files to ${branch}: ${newCommit.sha.substring(0, 7)}`;
      } catch (err) {
        return `Error: ${err}`;
      }
    }

    case 'create_branch': {
      const { repo, branch, from = 'main' } = toolInput as { repo: string; branch: string; from?: string };
      try {
        const refData = await githubRequest(`/repos/${CONFIG.GITHUB_ORG}/${repo}/git/ref/heads/${from}`);
        await githubRequest(`/repos/${CONFIG.GITHUB_ORG}/${repo}/git/refs`, {
          method: 'POST',
          body: JSON.stringify({
            ref: `refs/heads/${branch}`,
            sha: refData.object.sha
          })
        });
        return `Branch ${branch} created from ${from}`;
      } catch (err) {
        return `Error: ${err}`;
      }
    }

    case 'create_pull_request': {
      const { repo, title, body = '', head, base = 'main' } = toolInput as {
        repo: string; title: string; body?: string; head: string; base?: string;
      };
      try {
        const pr = await githubRequest(`/repos/${CONFIG.GITHUB_ORG}/${repo}/pulls`, {
          method: 'POST',
          body: JSON.stringify({ title, body, head, base })
        });
        return `PR created: ${pr.html_url}`;
      } catch (err) {
        return `Error: ${err}`;
      }
    }

    case 'run_code': {
      const { language, code } = toolInput as { language: string; code: string };
      if (!CONFIG.E2B_API_KEY) {
        return 'E2B not configured - set E2B_API_KEY environment variable';
      }
      // TODO: Implement E2B sandbox execution
      return `[E2B] Would execute ${language} code:\n${code.substring(0, 200)}...`;
    }

    case 'claim_task': {
      const { what, description } = toolInput as { what: string; description?: string };
      try {
        const res = await fetch(`${CONFIG.API_BASE}/api/claims`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ what, by: CONFIG.AGENT_ID, description })
        });
        const data = await res.json();
        if (res.status === 409) {
          return `Task already claimed by ${data.claimedBy}`;
        }
        return `Claimed: ${what}`;
      } catch (err) {
        return `Error: ${err}`;
      }
    }

    case 'release_task': {
      const { what } = toolInput as { what: string };
      try {
        await fetch(`${CONFIG.API_BASE}/api/claims?what=${encodeURIComponent(what)}&by=${encodeURIComponent(CONFIG.AGENT_ID)}`, {
          method: 'DELETE'
        });
        return `Released: ${what}`;
      } catch (err) {
        return `Error: ${err}`;
      }
    }

    case 'get_tasks': {
      const { status = 'todo' } = toolInput as { status?: string };
      try {
        const res = await fetch(`${CONFIG.API_BASE}/api/tasks?status=${status}`);
        const data = await res.json();
        return JSON.stringify(data.tasks || [], null, 2);
      } catch (err) {
        return `Error: ${err}`;
      }
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

// System prompt
function getSystemPrompt(): string {
  return `You are ${CONFIG.AGENT_NAME} (${CONFIG.AGENT_ID}), an autonomous cloud-based coding agent.

## Your Capabilities
1. **Read/Write GitHub Code**: Access any repo in ${CONFIG.GITHUB_ORG}
2. **Create Branches & PRs**: Full Git workflow automation
3. **Run Code in Sandbox**: Test code before committing (E2B)
4. **Coordinate with Team**: Post to group chat, claim/release tasks

## Workflow
1. Check group chat for @mentions or task assignments
2. Claim the task to prevent conflicts
3. Read relevant code from GitHub
4. Make changes and test in sandbox
5. Push to a feature branch
6. Create a PR for review
7. Release the task and report completion

## Guidelines
- Always claim tasks before starting work
- Create feature branches for changes (never push directly to main)
- Test code in sandbox before committing
- Write clear commit messages and PR descriptions
- Report progress to the group chat
- Release tasks when done or blocked

## Current Organization: ${CONFIG.GITHUB_ORG}

When you receive a task, break it down into steps and execute them systematically.`;
}

interface ChatMessage {
  id: string;
  author: string;
  authorType: 'agent' | 'human';
  message: string;
  timestamp: string;
}

let lastProcessedTimestamp: string | null = null;
let conversationHistory: Anthropic.MessageParam[] = [];
const processedMessageIds = new Set<string>();

async function getNewMessages(): Promise<ChatMessage[]> {
  try {
    const url = lastProcessedTimestamp
      ? `${CONFIG.API_BASE}/api/chat?since=${encodeURIComponent(lastProcessedTimestamp)}`
      : `${CONFIG.API_BASE}/api/chat?limit=5`;

    const res = await fetch(url);
    const data = await res.json();
    return data.messages.filter((m: ChatMessage) => m.author !== CONFIG.AGENT_ID);
  } catch (err) {
    console.error('[cloud-agent] Failed to fetch messages:', err);
    return [];
  }
}

async function processWithTools(userContent: string): Promise<string> {
  const safeUserContent = userContent.trim() || '[No content provided]';
  conversationHistory.push({ role: 'user', content: safeUserContent });

  // Keep history manageable
  if (conversationHistory.length > 20) {
    let slicePoint = conversationHistory.length - 20;
    while (slicePoint > 0 && slicePoint < conversationHistory.length) {
      const msg = conversationHistory[slicePoint];
      if (msg.role === 'user' && typeof msg.content === 'string') break;
      slicePoint++;
    }
    conversationHistory = conversationHistory.slice(slicePoint);
  }

  let response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: getSystemPrompt(),
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
      console.log(`[cloud-agent] Using tool: ${toolUse.name}`);
      const result = await executeTools(toolUse.name, toolUse.input as Record<string, unknown>);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result || '[No result]'
      });
    }

    if (response.content && response.content.length > 0) {
      conversationHistory.push({ role: 'assistant', content: response.content });
    }
    if (toolResults.length > 0) {
      conversationHistory.push({ role: 'user', content: toolResults });
    }

    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: getSystemPrompt(),
      tools: TOOLS,
      messages: conversationHistory
    });
  }

  const textContent = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text'
  );

  const assistantMessage = textContent?.text || '';

  if (response.content && response.content.length > 0) {
    conversationHistory.push({ role: 'assistant', content: response.content });
  }

  return assistantMessage;
}

async function shouldRespond(messages: ChatMessage[]): Promise<boolean> {
  for (const msg of messages) {
    if (msg.authorType === 'human') return true;
    if (msg.message.toLowerCase().includes(`@${CONFIG.AGENT_ID.toLowerCase()}`)) return true;
    if (msg.message.toLowerCase().includes('@cloud-agent')) return true;
    if (msg.message.toLowerCase().includes('@cloudcoder')) return true;
  }
  return false;
}

async function updateStatus(task: string): Promise<void> {
  try {
    await fetch(`${CONFIG.API_BASE}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: CONFIG.AGENT_ID,
        name: CONFIG.AGENT_NAME,
        status: 'active',
        currentTask: task,
        role: 'cloud-coder'
      })
    });
  } catch (err) {
    console.error('[cloud-agent] Failed to update status:', err);
  }
}

async function mainLoop(): Promise<void> {
  console.log(`[cloud-agent] Starting ${CONFIG.AGENT_NAME} (${CONFIG.AGENT_ID})`);
  console.log(`[cloud-agent] Connecting to ${CONFIG.API_BASE}`);
  console.log(`[cloud-agent] GitHub org: ${CONFIG.GITHUB_ORG}`);
  console.log(`[cloud-agent] Poll interval: ${CONFIG.POLL_INTERVAL}ms`);

  // Announce presence
  await updateStatus('Online - monitoring for tasks');

  while (true) {
    try {
      await updateStatus('Monitoring for tasks');
      const newMessages = await getNewMessages();

      if (newMessages.length > 0) {
        console.log(`[cloud-agent] Found ${newMessages.length} new message(s)`);

        const unprocessedMessages = newMessages.filter(m => !processedMessageIds.has(m.id));

        if (unprocessedMessages.length === 0) {
          lastProcessedTimestamp = newMessages[newMessages.length - 1].timestamp;
          continue;
        }

        unprocessedMessages.forEach(m => processedMessageIds.add(m.id));

        if (processedMessageIds.size > 100) {
          const toDelete = Array.from(processedMessageIds).slice(0, processedMessageIds.size - 100);
          toDelete.forEach(id => processedMessageIds.delete(id));
        }

        lastProcessedTimestamp = newMessages[newMessages.length - 1].timestamp;

        if (await shouldRespond(unprocessedMessages)) {
          await updateStatus('Processing task...');
          const context = unprocessedMessages.map(m => `${m.author}: ${m.message}`).join('\n');
          console.log(`[cloud-agent] Processing: ${context.substring(0, 100)}...`);
          await processWithTools(context);
        }
      }
    } catch (err) {
      console.error('[cloud-agent] Loop error:', err);
    }

    await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL));
  }
}

// Start
mainLoop().catch(err => {
  console.error('[cloud-agent] Fatal error:', err);
  process.exit(1);
});
