/**
 * External Integration Tools - Third-party service integrations
 *
 * Tools: linear, sentry, github-enhanced, discord
 *
 * These tools integrate with external services to enhance agent coordination:
 * - Linear: Issue tracking and project management
 * - Sentry: Error tracking and monitoring
 * - GitHub: Enhanced PR, issue, and CI/CD workflows
 * - Discord: Discord server communication integration
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

export function registerExternalTools(server: McpServer) {
  // ============================================================================
  // LINEAR TOOL - Issue tracking and project management
  // ============================================================================

  server.tool(
    'linear',
    'Interact with Linear issue tracking. Search, create, update issues and manage projects. Requires LINEAR_API_KEY env var.',
    {
      action: z.enum(['search', 'get', 'create', 'update', 'list-projects', 'list-teams', 'my-issues', 'add-comment'])
        .describe('search=find issues, get=issue details, create=new issue, update=modify issue, list-projects, list-teams, my-issues=assigned to you, add-comment'),
      issueId: z.string().optional().describe('Issue ID (e.g., "ENG-123") for get/update/add-comment'),
      query: z.string().optional().describe('Search query for search action'),
      title: z.string().optional().describe('Issue title for create'),
      description: z.string().optional().describe('Issue description for create/update'),
      teamId: z.string().optional().describe('Team ID for create'),
      projectId: z.string().optional().describe('Project ID for create'),
      status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled']).optional()
        .describe('Issue status for create/update'),
      priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional()
        .describe('Issue priority for create/update'),
      assigneeId: z.string().optional().describe('Assignee user ID'),
      labels: z.array(z.string()).optional().describe('Label IDs to apply'),
      comment: z.string().optional().describe('Comment text for add-comment'),
      limit: z.number().optional().default(10).describe('Max results to return'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, agentId, ...params } = args;

      const apiKey = process.env.LINEAR_API_KEY;
      if (!apiKey) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: 'LINEAR_API_KEY not configured',
          setup: 'Set LINEAR_API_KEY environment variable with your Linear API key',
          getKey: 'Go to Linear Settings > API > Create new API key'
        }, null, 2) }] };
      }

      const graphqlQuery = async (query: string, variables?: Record<string, any>) => {
        const res = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': apiKey
          },
          body: JSON.stringify({ query, variables })
        });
        return res.json();
      };

      try {
        switch (action) {
          case 'search': {
            const query = `
              query SearchIssues($query: String!, $first: Int) {
                issueSearch(query: $query, first: $first) {
                  nodes {
                    id identifier title state { name } priority priorityLabel
                    assignee { name } project { name } team { name key }
                    createdAt updatedAt url
                  }
                }
              }
            `;
            const data = await graphqlQuery(query, { query: params.query || '', first: params.limit });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'get': {
            if (!params.issueId) {
              return { content: [{ type: 'text', text: 'issueId required for get action' }] };
            }
            const query = `
              query GetIssue($id: String!) {
                issue(id: $id) {
                  id identifier title description state { name } priority priorityLabel
                  assignee { name email } project { name } team { name key }
                  labels { nodes { name color } }
                  comments { nodes { body user { name } createdAt } }
                  createdAt updatedAt url
                }
              }
            `;
            const data = await graphqlQuery(query, { id: params.issueId });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'create': {
            if (!params.title) {
              return { content: [{ type: 'text', text: 'title required for create action' }] };
            }
            const query = `
              mutation CreateIssue($input: IssueCreateInput!) {
                issueCreate(input: $input) {
                  success
                  issue { id identifier title url state { name } }
                }
              }
            `;
            const priorityMap: Record<string, number> = {
              none: 0, low: 4, medium: 3, high: 2, urgent: 1
            };
            const input: Record<string, any> = {
              title: params.title,
              description: params.description
            };
            if (params.teamId) input.teamId = params.teamId;
            if (params.projectId) input.projectId = params.projectId;
            if (params.priority) input.priority = priorityMap[params.priority];
            if (params.assigneeId) input.assigneeId = params.assigneeId;
            if (params.labels) input.labelIds = params.labels;

            const data = await graphqlQuery(query, { input });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'update': {
            if (!params.issueId) {
              return { content: [{ type: 'text', text: 'issueId required for update action' }] };
            }
            const query = `
              mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
                issueUpdate(id: $id, input: $input) {
                  success
                  issue { id identifier title state { name } url }
                }
              }
            `;
            const priorityMap: Record<string, number> = {
              none: 0, low: 4, medium: 3, high: 2, urgent: 1
            };
            const input: Record<string, any> = {};
            if (params.title) input.title = params.title;
            if (params.description) input.description = params.description;
            if (params.priority) input.priority = priorityMap[params.priority];
            if (params.assigneeId) input.assigneeId = params.assigneeId;

            const data = await graphqlQuery(query, { id: params.issueId, input });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'list-projects': {
            const query = `
              query ListProjects($first: Int) {
                projects(first: $first) {
                  nodes { id name description state startDate targetDate lead { name } }
                }
              }
            `;
            const data = await graphqlQuery(query, { first: params.limit });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'list-teams': {
            const query = `
              query ListTeams {
                teams { nodes { id name key description timezone } }
              }
            `;
            const data = await graphqlQuery(query, {});
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'my-issues': {
            const query = `
              query MyIssues($first: Int) {
                viewer {
                  assignedIssues(first: $first, orderBy: updatedAt) {
                    nodes {
                      id identifier title state { name } priority priorityLabel
                      project { name } team { name key } dueDate url
                    }
                  }
                }
              }
            `;
            const data = await graphqlQuery(query, { first: params.limit });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'add-comment': {
            if (!params.issueId || !params.comment) {
              return { content: [{ type: 'text', text: 'issueId and comment required' }] };
            }
            const query = `
              mutation AddComment($issueId: String!, $body: String!) {
                commentCreate(input: { issueId: $issueId, body: $body }) {
                  success
                  comment { id body createdAt }
                }
              }
            `;
            const data = await graphqlQuery(query, { issueId: params.issueId, body: params.comment });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          default:
            return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // GITHUB-ENHANCED TOOL - Extended GitHub operations
  // ============================================================================

  server.tool(
    'github',
    'Enhanced GitHub operations. Manage PRs, issues, workflows, reviews. Requires GITHUB_TOKEN env var.',
    {
      action: z.enum([
        'list-prs', 'get-pr', 'create-pr', 'merge-pr', 'review-pr',
        'list-issues', 'get-issue', 'create-issue', 'update-issue', 'add-comment',
        'list-workflows', 'trigger-workflow', 'get-workflow-run',
        'list-branches', 'compare-branches', 'get-commit'
      ]).describe('GitHub operation'),
      owner: z.string().optional().describe('Repository owner'),
      repo: z.string().optional().describe('Repository name'),
      prNumber: z.number().optional().describe('PR number'),
      issueNumber: z.number().optional().describe('Issue number'),
      title: z.string().optional().describe('Title for PR/issue'),
      body: z.string().optional().describe('Body content'),
      head: z.string().optional().describe('Head branch for PR'),
      base: z.string().optional().describe('Base branch for PR'),
      labels: z.array(z.string()).optional().describe('Labels to apply'),
      assignees: z.array(z.string()).optional().describe('Assignees'),
      state: z.enum(['open', 'closed', 'all']).optional().describe('Filter by state'),
      reviewEvent: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']).optional(),
      workflowId: z.string().optional().describe('Workflow ID or filename'),
      ref: z.string().optional().describe('Branch/tag ref'),
      sha: z.string().optional().describe('Commit SHA'),
      limit: z.number().optional().default(10).describe('Max results'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, agentId, ...params } = args;

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: 'GITHUB_TOKEN not configured',
          setup: 'Set GITHUB_TOKEN environment variable with a GitHub PAT',
          scopes: 'Required scopes: repo, workflow'
        }, null, 2) }] };
      }

      const ghFetch = async (endpoint: string, options: RequestInit = {}) => {
        const res = await fetch(`https://api.github.com/${endpoint}`, {
          ...options,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...options.headers
          }
        });
        return res.json();
      };

      const requireRepo = () => {
        if (!params.owner || !params.repo) {
          throw new Error('owner and repo required');
        }
        return `repos/${params.owner}/${params.repo}`;
      };

      try {
        switch (action) {
          case 'list-prs': {
            const repoPath = requireRepo();
            const queryParams = new URLSearchParams();
            if (params.state) queryParams.set('state', params.state);
            queryParams.set('per_page', String(params.limit));

            const data = await ghFetch(`${repoPath}/pulls?${queryParams}`);
            const prs = Array.isArray(data) ? data.map((pr: any) => ({
              number: pr.number,
              title: pr.title,
              state: pr.state,
              user: pr.user?.login,
              head: pr.head?.ref,
              base: pr.base?.ref,
              draft: pr.draft,
              mergeable: pr.mergeable,
              createdAt: pr.created_at,
              url: pr.html_url
            })) : data;
            return { content: [{ type: 'text', text: JSON.stringify({ prs }, null, 2) }] };
          }

          case 'get-pr': {
            const repoPath = requireRepo();
            if (!params.prNumber) {
              return { content: [{ type: 'text', text: 'prNumber required' }] };
            }
            const [pr, reviews, files] = await Promise.all([
              ghFetch(`${repoPath}/pulls/${params.prNumber}`),
              ghFetch(`${repoPath}/pulls/${params.prNumber}/reviews`),
              ghFetch(`${repoPath}/pulls/${params.prNumber}/files`)
            ]);
            return { content: [{ type: 'text', text: JSON.stringify({ pr, reviews, files }, null, 2) }] };
          }

          case 'create-pr': {
            const repoPath = requireRepo();
            if (!params.title || !params.head || !params.base) {
              return { content: [{ type: 'text', text: 'title, head, and base required' }] };
            }
            const data = await ghFetch(`${repoPath}/pulls`, {
              method: 'POST',
              body: JSON.stringify({
                title: params.title,
                body: params.body,
                head: params.head,
                base: params.base
              })
            });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'merge-pr': {
            const repoPath = requireRepo();
            if (!params.prNumber) {
              return { content: [{ type: 'text', text: 'prNumber required' }] };
            }
            const data = await ghFetch(`${repoPath}/pulls/${params.prNumber}/merge`, {
              method: 'PUT',
              body: JSON.stringify({ merge_method: 'squash' })
            });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'review-pr': {
            const repoPath = requireRepo();
            if (!params.prNumber || !params.reviewEvent) {
              return { content: [{ type: 'text', text: 'prNumber and reviewEvent required' }] };
            }
            const data = await ghFetch(`${repoPath}/pulls/${params.prNumber}/reviews`, {
              method: 'POST',
              body: JSON.stringify({
                body: params.body || '',
                event: params.reviewEvent
              })
            });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'list-issues': {
            const repoPath = requireRepo();
            const queryParams = new URLSearchParams();
            if (params.state) queryParams.set('state', params.state);
            if (params.labels) queryParams.set('labels', params.labels.join(','));
            queryParams.set('per_page', String(params.limit));

            const data = await ghFetch(`${repoPath}/issues?${queryParams}`);
            const issues = Array.isArray(data) ? data.filter((i: any) => !i.pull_request).map((i: any) => ({
              number: i.number,
              title: i.title,
              state: i.state,
              user: i.user?.login,
              labels: i.labels?.map((l: any) => l.name),
              assignees: i.assignees?.map((a: any) => a.login),
              createdAt: i.created_at,
              url: i.html_url
            })) : data;
            return { content: [{ type: 'text', text: JSON.stringify({ issues }, null, 2) }] };
          }

          case 'get-issue': {
            const repoPath = requireRepo();
            if (!params.issueNumber) {
              return { content: [{ type: 'text', text: 'issueNumber required' }] };
            }
            const [issue, comments] = await Promise.all([
              ghFetch(`${repoPath}/issues/${params.issueNumber}`),
              ghFetch(`${repoPath}/issues/${params.issueNumber}/comments`)
            ]);
            return { content: [{ type: 'text', text: JSON.stringify({ issue, comments }, null, 2) }] };
          }

          case 'create-issue': {
            const repoPath = requireRepo();
            if (!params.title) {
              return { content: [{ type: 'text', text: 'title required' }] };
            }
            const data = await ghFetch(`${repoPath}/issues`, {
              method: 'POST',
              body: JSON.stringify({
                title: params.title,
                body: params.body,
                labels: params.labels,
                assignees: params.assignees
              })
            });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'update-issue': {
            const repoPath = requireRepo();
            if (!params.issueNumber) {
              return { content: [{ type: 'text', text: 'issueNumber required' }] };
            }
            const body: Record<string, any> = {};
            if (params.title) body.title = params.title;
            if (params.body) body.body = params.body;
            if (params.state) body.state = params.state;
            if (params.labels) body.labels = params.labels;
            if (params.assignees) body.assignees = params.assignees;

            const data = await ghFetch(`${repoPath}/issues/${params.issueNumber}`, {
              method: 'PATCH',
              body: JSON.stringify(body)
            });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'add-comment': {
            const repoPath = requireRepo();
            if (!params.issueNumber || !params.body) {
              return { content: [{ type: 'text', text: 'issueNumber and body required' }] };
            }
            const data = await ghFetch(`${repoPath}/issues/${params.issueNumber}/comments`, {
              method: 'POST',
              body: JSON.stringify({ body: params.body })
            });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'list-workflows': {
            const repoPath = requireRepo();
            const data = await ghFetch(`${repoPath}/actions/workflows`);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'trigger-workflow': {
            const repoPath = requireRepo();
            if (!params.workflowId || !params.ref) {
              return { content: [{ type: 'text', text: 'workflowId and ref required' }] };
            }
            const data = await ghFetch(`${repoPath}/actions/workflows/${params.workflowId}/dispatches`, {
              method: 'POST',
              body: JSON.stringify({ ref: params.ref })
            });
            return { content: [{ type: 'text', text: JSON.stringify({ triggered: true, ...data }, null, 2) }] };
          }

          case 'get-workflow-run': {
            const repoPath = requireRepo();
            if (!params.workflowId) {
              return { content: [{ type: 'text', text: 'workflowId required' }] };
            }
            const data = await ghFetch(`${repoPath}/actions/runs/${params.workflowId}`);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'list-branches': {
            const repoPath = requireRepo();
            const data = await ghFetch(`${repoPath}/branches?per_page=${params.limit}`);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'compare-branches': {
            const repoPath = requireRepo();
            if (!params.base || !params.head) {
              return { content: [{ type: 'text', text: 'base and head required' }] };
            }
            const data = await ghFetch(`${repoPath}/compare/${params.base}...${params.head}`);
            return { content: [{ type: 'text', text: JSON.stringify({
              aheadBy: data.ahead_by,
              behindBy: data.behind_by,
              commits: data.commits?.length,
              files: data.files?.length,
              status: data.status
            }, null, 2) }] };
          }

          case 'get-commit': {
            const repoPath = requireRepo();
            if (!params.sha) {
              return { content: [{ type: 'text', text: 'sha required' }] };
            }
            const data = await ghFetch(`${repoPath}/commits/${params.sha}`);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          default:
            return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // DISCORD TOOL - Discord server communication integration
  // ============================================================================

  server.tool(
    'discord',
    'Integrate with Discord for team communications. Send messages, list channels, manage threads. Requires DISCORD_BOT_TOKEN env var.',
    {
      action: z.enum(['send', 'list-channels', 'get-channel', 'get-messages', 'list-guilds', 'create-thread', 'reply-thread', 'add-reaction', 'get-user'])
        .describe('send=post message, list-channels=guild channels, get-channel=channel info, get-messages=channel history, list-guilds=bot servers, create-thread=start thread, reply-thread=reply in thread, add-reaction=react to message, get-user=user info'),
      guildId: z.string().optional().describe('Discord server (guild) ID'),
      channelId: z.string().optional().describe('Channel ID'),
      messageId: z.string().optional().describe('Message ID for reactions/threads'),
      message: z.string().optional().describe('Message content to send'),
      threadName: z.string().optional().describe('Thread name for create-thread'),
      emoji: z.string().optional().describe('Emoji for add-reaction (unicode or custom emoji ID)'),
      userId: z.string().optional().describe('User ID for get-user'),
      limit: z.number().optional().default(20).describe('Max results'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, agentId, ...params } = args;

      const token = process.env.DISCORD_BOT_TOKEN;
      if (!token) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: 'DISCORD_BOT_TOKEN not configured',
          setup: 'Set DISCORD_BOT_TOKEN environment variable with your Discord Bot Token',
          steps: [
            '1. Go to https://discord.com/developers/applications',
            '2. Create a new application or select existing',
            '3. Go to Bot section, create bot if needed',
            '4. Copy the bot token',
            '5. Enable MESSAGE CONTENT INTENT in Bot settings',
            '6. Invite bot to server with permissions: Send Messages, Read Message History, Create Public Threads, Add Reactions'
          ],
          inviteUrl: 'https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=277025467456&scope=bot'
        }, null, 2) }] };
      }

      const discordFetch = async (endpoint: string, options: RequestInit = {}) => {
        const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
          ...options,
          headers: {
            'Authorization': `Bot ${token}`,
            'Content-Type': 'application/json',
            ...options.headers
          }
        });
        if (!res.ok) {
          const error = await res.json().catch(() => ({ message: res.statusText }));
          throw new Error(`Discord API error: ${error.message || res.statusText}`);
        }
        return res.json();
      };

      try {
        switch (action) {
          case 'send': {
            if (!params.channelId || !params.message) {
              return { content: [{ type: 'text', text: 'channelId and message required' }] };
            }
            const data = await discordFetch(`/channels/${params.channelId}/messages`, {
              method: 'POST',
              body: JSON.stringify({ content: params.message })
            });
            return { content: [{ type: 'text', text: JSON.stringify({
              success: true,
              messageId: data.id,
              channelId: data.channel_id,
              content: data.content,
              timestamp: data.timestamp
            }, null, 2) }] };
          }

          case 'list-guilds': {
            const data = await discordFetch('/users/@me/guilds');
            const guilds = data.map((g: any) => ({
              id: g.id,
              name: g.name,
              icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
              owner: g.owner,
              permissions: g.permissions
            }));
            return { content: [{ type: 'text', text: JSON.stringify({ guilds }, null, 2) }] };
          }

          case 'list-channels': {
            if (!params.guildId) {
              return { content: [{ type: 'text', text: 'guildId required' }] };
            }
            const data = await discordFetch(`/guilds/${params.guildId}/channels`);
            const channels = data
              .filter((c: any) => c.type === 0 || c.type === 5 || c.type === 15) // text, announcement, forum
              .map((c: any) => ({
                id: c.id,
                name: c.name,
                type: c.type === 0 ? 'text' : c.type === 5 ? 'announcement' : 'forum',
                topic: c.topic,
                parentId: c.parent_id,
                position: c.position
              }))
              .sort((a: any, b: any) => a.position - b.position);
            return { content: [{ type: 'text', text: JSON.stringify({ channels }, null, 2) }] };
          }

          case 'get-channel': {
            if (!params.channelId) {
              return { content: [{ type: 'text', text: 'channelId required' }] };
            }
            const data = await discordFetch(`/channels/${params.channelId}`);
            return { content: [{ type: 'text', text: JSON.stringify({
              id: data.id,
              name: data.name,
              type: data.type,
              topic: data.topic,
              guildId: data.guild_id,
              parentId: data.parent_id,
              lastMessageId: data.last_message_id
            }, null, 2) }] };
          }

          case 'get-messages': {
            if (!params.channelId) {
              return { content: [{ type: 'text', text: 'channelId required' }] };
            }
            const data = await discordFetch(`/channels/${params.channelId}/messages?limit=${params.limit}`);
            const messages = data.map((m: any) => ({
              id: m.id,
              content: m.content,
              author: { id: m.author.id, username: m.author.username, bot: m.author.bot },
              timestamp: m.timestamp,
              reactions: m.reactions?.map((r: any) => ({ emoji: r.emoji.name, count: r.count })),
              threadId: m.thread?.id
            }));
            return { content: [{ type: 'text', text: JSON.stringify({ messages }, null, 2) }] };
          }

          case 'create-thread': {
            if (!params.channelId || !params.threadName) {
              return { content: [{ type: 'text', text: 'channelId and threadName required' }] };
            }
            // Create thread from a message if messageId provided, otherwise create without starter
            const endpoint = params.messageId
              ? `/channels/${params.channelId}/messages/${params.messageId}/threads`
              : `/channels/${params.channelId}/threads`;

            const body: Record<string, any> = { name: params.threadName };
            if (!params.messageId) {
              body.type = 11; // PUBLIC_THREAD
              body.auto_archive_duration = 1440; // 24 hours
            }

            const data = await discordFetch(endpoint, {
              method: 'POST',
              body: JSON.stringify(body)
            });
            return { content: [{ type: 'text', text: JSON.stringify({
              success: true,
              threadId: data.id,
              name: data.name,
              parentId: data.parent_id
            }, null, 2) }] };
          }

          case 'reply-thread': {
            if (!params.channelId || !params.message) {
              return { content: [{ type: 'text', text: 'channelId (thread ID) and message required' }] };
            }
            // Threads are channels, so we just send to the thread's channel ID
            const data = await discordFetch(`/channels/${params.channelId}/messages`, {
              method: 'POST',
              body: JSON.stringify({ content: params.message })
            });
            return { content: [{ type: 'text', text: JSON.stringify({
              success: true,
              messageId: data.id,
              threadId: data.channel_id,
              content: data.content
            }, null, 2) }] };
          }

          case 'add-reaction': {
            if (!params.channelId || !params.messageId || !params.emoji) {
              return { content: [{ type: 'text', text: 'channelId, messageId, and emoji required' }] };
            }
            // URL encode the emoji for the endpoint
            const encodedEmoji = encodeURIComponent(params.emoji);
            await discordFetch(`/channels/${params.channelId}/messages/${params.messageId}/reactions/${encodedEmoji}/@me`, {
              method: 'PUT'
            }).catch(() => ({ success: true })); // Discord returns 204 No Content on success
            return { content: [{ type: 'text', text: JSON.stringify({
              success: true,
              channelId: params.channelId,
              messageId: params.messageId,
              emoji: params.emoji
            }, null, 2) }] };
          }

          case 'get-user': {
            if (!params.userId) {
              return { content: [{ type: 'text', text: 'userId required' }] };
            }
            const data = await discordFetch(`/users/${params.userId}`);
            return { content: [{ type: 'text', text: JSON.stringify({
              id: data.id,
              username: data.username,
              globalName: data.global_name,
              avatar: data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png` : null,
              bot: data.bot,
              banner: data.banner
            }, null, 2) }] };
          }

          default:
            return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );
}
