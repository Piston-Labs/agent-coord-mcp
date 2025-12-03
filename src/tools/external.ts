/**
 * External Integration Tools - Third-party service integrations
 *
 * Tools: linear, sentry, notion, github-enhanced, slack
 *
 * These tools integrate with external services to enhance agent coordination:
 * - Linear: Issue tracking and project management
 * - Sentry: Error tracking and monitoring
 * - Notion: Knowledge base and documentation
 * - GitHub: Enhanced PR, issue, and CI/CD workflows
 * - Slack: Team communication integration
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
  // SENTRY TOOL - Error tracking and monitoring
  // ============================================================================

  server.tool(
    'sentry',
    'Track and analyze errors with Sentry. List issues, get details, resolve issues. Requires SENTRY_AUTH_TOKEN and SENTRY_ORG env vars.',
    {
      action: z.enum(['list-issues', 'get-issue', 'resolve', 'list-projects', 'search-events', 'issue-events'])
        .describe('list-issues, get-issue, resolve, list-projects, search-events, issue-events'),
      projectSlug: z.string().optional().describe('Project slug (e.g., "frontend")'),
      issueId: z.string().optional().describe('Issue ID for get-issue/resolve/issue-events'),
      query: z.string().optional().describe('Search query for search-events'),
      status: z.enum(['resolved', 'unresolved', 'ignored']).optional().describe('Filter by status'),
      limit: z.number().optional().default(10).describe('Max results'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, agentId, ...params } = args;

      const authToken = process.env.SENTRY_AUTH_TOKEN;
      const org = process.env.SENTRY_ORG;

      if (!authToken || !org) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: 'SENTRY_AUTH_TOKEN and SENTRY_ORG not configured',
          setup: 'Set SENTRY_AUTH_TOKEN (from Sentry Settings > Auth Tokens) and SENTRY_ORG (organization slug)',
          docs: 'https://docs.sentry.io/api/auth/'
        }, null, 2) }] };
      }

      const sentryFetch = async (endpoint: string, options: RequestInit = {}) => {
        const res = await fetch(`https://sentry.io/api/0/${endpoint}`, {
          ...options,
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
            ...options.headers
          }
        });
        return res.json();
      };

      try {
        switch (action) {
          case 'list-projects': {
            const data = await sentryFetch(`organizations/${org}/projects/`);
            const projects = Array.isArray(data) ? data.map((p: any) => ({
              id: p.id,
              slug: p.slug,
              name: p.name,
              platform: p.platform,
              status: p.status
            })) : data;
            return { content: [{ type: 'text', text: JSON.stringify({ projects }, null, 2) }] };
          }

          case 'list-issues': {
            const queryParams = new URLSearchParams();
            if (params.status) queryParams.set('query', `is:${params.status}`);
            queryParams.set('limit', String(params.limit));

            const endpoint = params.projectSlug
              ? `projects/${org}/${params.projectSlug}/issues/?${queryParams}`
              : `organizations/${org}/issues/?${queryParams}`;

            const data = await sentryFetch(endpoint);
            const issues = Array.isArray(data) ? data.map((i: any) => ({
              id: i.id,
              shortId: i.shortId,
              title: i.title,
              culprit: i.culprit,
              status: i.status,
              level: i.level,
              count: i.count,
              userCount: i.userCount,
              firstSeen: i.firstSeen,
              lastSeen: i.lastSeen,
              project: i.project?.slug
            })) : data;
            return { content: [{ type: 'text', text: JSON.stringify({ issues }, null, 2) }] };
          }

          case 'get-issue': {
            if (!params.issueId) {
              return { content: [{ type: 'text', text: 'issueId required' }] };
            }
            const data = await sentryFetch(`organizations/${org}/issues/${params.issueId}/`);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'resolve': {
            if (!params.issueId) {
              return { content: [{ type: 'text', text: 'issueId required' }] };
            }
            const data = await sentryFetch(`organizations/${org}/issues/${params.issueId}/`, {
              method: 'PUT',
              body: JSON.stringify({ status: 'resolved' })
            });
            return { content: [{ type: 'text', text: JSON.stringify({ resolved: true, issue: data }, null, 2) }] };
          }

          case 'issue-events': {
            if (!params.issueId) {
              return { content: [{ type: 'text', text: 'issueId required' }] };
            }
            const data = await sentryFetch(`organizations/${org}/issues/${params.issueId}/events/?limit=${params.limit}`);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'search-events': {
            if (!params.projectSlug) {
              return { content: [{ type: 'text', text: 'projectSlug required for search-events' }] };
            }
            const queryParams = new URLSearchParams();
            if (params.query) queryParams.set('query', params.query);
            queryParams.set('limit', String(params.limit));

            const data = await sentryFetch(`projects/${org}/${params.projectSlug}/events/?${queryParams}`);
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
  // NOTION TOOL - Knowledge base and documentation
  // ============================================================================

  server.tool(
    'notion',
    'Access Notion workspaces. Search pages, read content, create/update pages. Requires NOTION_TOKEN env var.',
    {
      action: z.enum(['search', 'get-page', 'get-database', 'query-database', 'create-page', 'update-page', 'list-users'])
        .describe('search, get-page, get-database, query-database, create-page, update-page, list-users'),
      query: z.string().optional().describe('Search query'),
      pageId: z.string().optional().describe('Page/block ID for get/update'),
      databaseId: z.string().optional().describe('Database ID for query'),
      parentId: z.string().optional().describe('Parent page/database ID for create'),
      title: z.string().optional().describe('Page title for create'),
      content: z.string().optional().describe('Page content (markdown) for create/update'),
      properties: z.record(z.any()).optional().describe('Database properties for create/query'),
      filter: z.record(z.any()).optional().describe('Database query filter'),
      limit: z.number().optional().default(10).describe('Max results'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, agentId, ...params } = args;

      const token = process.env.NOTION_TOKEN;
      if (!token) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: 'NOTION_TOKEN not configured',
          setup: 'Set NOTION_TOKEN environment variable with your Notion integration token',
          getToken: 'Create an integration at notion.so/my-integrations and copy the token'
        }, null, 2) }] };
      }

      const notionFetch = async (endpoint: string, options: RequestInit = {}) => {
        const res = await fetch(`https://api.notion.com/v1/${endpoint}`, {
          ...options,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28',
            ...options.headers
          }
        });
        return res.json();
      };

      try {
        switch (action) {
          case 'search': {
            const data = await notionFetch('search', {
              method: 'POST',
              body: JSON.stringify({
                query: params.query || '',
                page_size: params.limit
              })
            });
            const results = data.results?.map((r: any) => ({
              id: r.id,
              type: r.object,
              title: r.properties?.title?.title?.[0]?.plain_text ||
                     r.properties?.Name?.title?.[0]?.plain_text ||
                     r.title?.[0]?.plain_text || 'Untitled',
              url: r.url,
              lastEdited: r.last_edited_time
            })) || [];
            return { content: [{ type: 'text', text: JSON.stringify({ results }, null, 2) }] };
          }

          case 'get-page': {
            if (!params.pageId) {
              return { content: [{ type: 'text', text: 'pageId required' }] };
            }
            // Get page metadata
            const page = await notionFetch(`pages/${params.pageId}`);
            // Get page content (blocks)
            const blocks = await notionFetch(`blocks/${params.pageId}/children?page_size=100`);

            // Extract text from blocks
            const extractText = (block: any): string => {
              const richText = block[block.type]?.rich_text || [];
              return richText.map((t: any) => t.plain_text).join('');
            };

            const content = blocks.results?.map((b: any) => ({
              type: b.type,
              text: extractText(b)
            })).filter((b: any) => b.text) || [];

            return { content: [{ type: 'text', text: JSON.stringify({ page, content }, null, 2) }] };
          }

          case 'get-database': {
            if (!params.databaseId) {
              return { content: [{ type: 'text', text: 'databaseId required' }] };
            }
            const data = await notionFetch(`databases/${params.databaseId}`);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'query-database': {
            if (!params.databaseId) {
              return { content: [{ type: 'text', text: 'databaseId required' }] };
            }
            const body: Record<string, any> = { page_size: params.limit };
            if (params.filter) body.filter = params.filter;

            const data = await notionFetch(`databases/${params.databaseId}/query`, {
              method: 'POST',
              body: JSON.stringify(body)
            });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'create-page': {
            if (!params.parentId || !params.title) {
              return { content: [{ type: 'text', text: 'parentId and title required' }] };
            }

            const body: Record<string, any> = {
              parent: { page_id: params.parentId },
              properties: {
                title: { title: [{ text: { content: params.title } }] }
              }
            };

            // Add content as children blocks if provided
            if (params.content) {
              body.children = [{
                object: 'block',
                type: 'paragraph',
                paragraph: {
                  rich_text: [{ type: 'text', text: { content: params.content } }]
                }
              }];
            }

            const data = await notionFetch('pages', {
              method: 'POST',
              body: JSON.stringify(body)
            });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'update-page': {
            if (!params.pageId) {
              return { content: [{ type: 'text', text: 'pageId required' }] };
            }

            const body: Record<string, any> = {};
            if (params.properties) {
              body.properties = params.properties;
            }

            const data = await notionFetch(`pages/${params.pageId}`, {
              method: 'PATCH',
              body: JSON.stringify(body)
            });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'list-users': {
            const data = await notionFetch('users');
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
  // SLACK TOOL - Team communication integration
  // ============================================================================

  server.tool(
    'slack',
    'Integrate with Slack for team communications. Send messages, list channels, search. Requires SLACK_TOKEN env var.',
    {
      action: z.enum(['send', 'list-channels', 'get-channel', 'search', 'list-users', 'get-user', 'post-thread'])
        .describe('send, list-channels, get-channel, search, list-users, get-user, post-thread'),
      channel: z.string().optional().describe('Channel ID or name'),
      message: z.string().optional().describe('Message text'),
      threadTs: z.string().optional().describe('Thread timestamp for replies'),
      query: z.string().optional().describe('Search query'),
      userId: z.string().optional().describe('User ID'),
      limit: z.number().optional().default(20).describe('Max results'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, agentId, ...params } = args;

      const token = process.env.SLACK_TOKEN;
      if (!token) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: 'SLACK_TOKEN not configured',
          setup: 'Set SLACK_TOKEN environment variable with a Slack Bot Token (xoxb-...)',
          scopes: 'Required scopes: chat:write, channels:read, users:read, search:read'
        }, null, 2) }] };
      }

      const slackFetch = async (method: string, body?: Record<string, any>) => {
        const res = await fetch(`https://slack.com/api/${method}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: body ? JSON.stringify(body) : undefined
        });
        return res.json();
      };

      try {
        switch (action) {
          case 'send': {
            if (!params.channel || !params.message) {
              return { content: [{ type: 'text', text: 'channel and message required' }] };
            }
            const data = await slackFetch('chat.postMessage', {
              channel: params.channel,
              text: params.message,
              thread_ts: params.threadTs
            });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'post-thread': {
            if (!params.channel || !params.message || !params.threadTs) {
              return { content: [{ type: 'text', text: 'channel, message, and threadTs required' }] };
            }
            const data = await slackFetch('chat.postMessage', {
              channel: params.channel,
              text: params.message,
              thread_ts: params.threadTs
            });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'list-channels': {
            const data = await slackFetch('conversations.list', {
              limit: params.limit,
              types: 'public_channel,private_channel'
            });
            const channels = data.channels?.map((c: any) => ({
              id: c.id,
              name: c.name,
              topic: c.topic?.value,
              memberCount: c.num_members,
              isPrivate: c.is_private
            })) || [];
            return { content: [{ type: 'text', text: JSON.stringify({ channels }, null, 2) }] };
          }

          case 'get-channel': {
            if (!params.channel) {
              return { content: [{ type: 'text', text: 'channel required' }] };
            }
            const [info, history] = await Promise.all([
              slackFetch('conversations.info', { channel: params.channel }),
              slackFetch('conversations.history', { channel: params.channel, limit: 10 })
            ]);
            return { content: [{ type: 'text', text: JSON.stringify({ info: info.channel, recentMessages: history.messages }, null, 2) }] };
          }

          case 'search': {
            if (!params.query) {
              return { content: [{ type: 'text', text: 'query required' }] };
            }
            const data = await slackFetch('search.messages', {
              query: params.query,
              count: params.limit
            });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'list-users': {
            const data = await slackFetch('users.list', { limit: params.limit });
            const users = data.members?.filter((u: any) => !u.is_bot && !u.deleted).map((u: any) => ({
              id: u.id,
              name: u.name,
              realName: u.real_name,
              email: u.profile?.email,
              status: u.profile?.status_text
            })) || [];
            return { content: [{ type: 'text', text: JSON.stringify({ users }, null, 2) }] };
          }

          case 'get-user': {
            if (!params.userId) {
              return { content: [{ type: 'text', text: 'userId required' }] };
            }
            const data = await slackFetch('users.info', { user: params.userId });
            return { content: [{ type: 'text', text: JSON.stringify(data.user, null, 2) }] };
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
