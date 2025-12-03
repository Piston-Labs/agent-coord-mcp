import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const LINEAR_CACHE_KEY = 'agent-coord:linear-cache';
const LINEAR_API = 'https://api.linear.app/graphql';

/**
 * Linear Issue Tracking Integration
 *
 * Provides issue management for project tracking.
 * Requires LINEAR_API_KEY environment variable.
 *
 * GET /api/linear - List issues or get specific issue
 * GET /api/linear?action=teams - List teams
 * GET /api/linear?action=projects - List projects
 * POST /api/linear - Create or update issue
 */

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: { name: string; color: string };
  priority: number;
  assignee?: { name: string; email: string };
  team: { name: string; key: string };
  project?: { name: string };
  createdAt: string;
  updatedAt: string;
  url: string;
}

async function linearQuery(query: string, variables?: Record<string, unknown>) {
  const apiKey = process.env.LINEAR_API_KEY;

  if (!apiKey) {
    throw new Error('LINEAR_API_KEY not configured');
  }

  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Linear API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  if (data.errors) {
    throw new Error(`Linear GraphQL error: ${JSON.stringify(data.errors)}`);
  }

  return data.data;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check if Linear is configured
  if (!process.env.LINEAR_API_KEY) {
    return res.status(503).json({
      error: 'Linear not configured',
      message: 'Set LINEAR_API_KEY in environment variables',
      hint: 'Get your API key from Linear Settings > API > Personal API keys'
    });
  }

  try {
    // GET - List or fetch issues
    if (req.method === 'GET') {
      const { action, issueId, teamKey, projectId, status, limit = '25' } = req.query;

      // Get specific issue
      if (issueId) {
        const data = await linearQuery(`
          query Issue($id: String!) {
            issue(id: $id) {
              id
              identifier
              title
              description
              state { name color }
              priority
              assignee { name email }
              team { name key }
              project { name }
              createdAt
              updatedAt
              url
            }
          }
        `, { id: issueId });

        return res.json({ issue: data.issue });
      }

      // List teams
      if (action === 'teams') {
        const data = await linearQuery(`
          query Teams {
            teams {
              nodes {
                id
                name
                key
                description
                issueCount
              }
            }
          }
        `);

        return res.json({
          teams: data.teams.nodes,
          count: data.teams.nodes.length
        });
      }

      // List projects
      if (action === 'projects') {
        const data = await linearQuery(`
          query Projects {
            projects {
              nodes {
                id
                name
                description
                state
                progress
                targetDate
                teams { nodes { name key } }
              }
            }
          }
        `);

        return res.json({
          projects: data.projects.nodes,
          count: data.projects.nodes.length
        });
      }

      // List issues with optional filters
      let filter = '';
      const filterParts: string[] = [];

      if (teamKey) {
        filterParts.push(`team: { key: { eq: "${teamKey}" } }`);
      }
      if (projectId) {
        filterParts.push(`project: { id: { eq: "${projectId}" } }`);
      }
      if (status) {
        filterParts.push(`state: { name: { eq: "${status}" } }`);
      }

      if (filterParts.length > 0) {
        filter = `filter: { ${filterParts.join(', ')} }`;
      }

      const data = await linearQuery(`
        query Issues($first: Int!) {
          issues(first: $first ${filter ? `, ${filter}` : ''}) {
            nodes {
              id
              identifier
              title
              state { name color }
              priority
              assignee { name }
              team { name key }
              project { name }
              updatedAt
              url
            }
          }
        }
      `, { first: parseInt(limit as string, 10) });

      // Cache for quick access
      await redis.set(LINEAR_CACHE_KEY, JSON.stringify({
        issues: data.issues.nodes,
        cachedAt: new Date().toISOString()
      }), { ex: 300 }); // 5 min cache

      return res.json({
        issues: data.issues.nodes,
        count: data.issues.nodes.length,
        filters: { teamKey, projectId, status }
      });
    }

    // POST - Create or update issue
    if (req.method === 'POST') {
      const {
        action,
        issueId,
        teamId,
        title,
        description,
        priority,
        stateId,
        assigneeId,
        projectId,
        labelIds
      } = req.body;

      // Update existing issue
      if (action === 'update' && issueId) {
        const updates: Record<string, unknown> = {};
        if (title) updates.title = title;
        if (description) updates.description = description;
        if (priority !== undefined) updates.priority = priority;
        if (stateId) updates.stateId = stateId;
        if (assigneeId) updates.assigneeId = assigneeId;
        if (projectId) updates.projectId = projectId;
        if (labelIds) updates.labelIds = labelIds;

        const data = await linearQuery(`
          mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success
              issue {
                id
                identifier
                title
                state { name }
                url
              }
            }
          }
        `, { id: issueId, input: updates });

        return res.json({
          success: data.issueUpdate.success,
          issue: data.issueUpdate.issue,
          message: 'Issue updated'
        });
      }

      // Create new issue
      if (!teamId || !title) {
        return res.status(400).json({
          error: 'teamId and title required for creating issues',
          hint: 'Use action=teams to list available teams'
        });
      }

      const input: Record<string, unknown> = {
        teamId,
        title,
        description: description || '',
      };
      if (priority !== undefined) input.priority = priority;
      if (stateId) input.stateId = stateId;
      if (assigneeId) input.assigneeId = assigneeId;
      if (projectId) input.projectId = projectId;
      if (labelIds) input.labelIds = labelIds;

      const data = await linearQuery(`
        mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              title
              state { name }
              team { name key }
              url
            }
          }
        }
      `, { input });

      return res.json({
        success: data.issueCreate.success,
        issue: data.issueCreate.issue,
        message: 'Issue created'
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Linear API error:', error);

    // Check if it's a configuration error
    if (String(error).includes('LINEAR_API_KEY')) {
      return res.status(503).json({
        error: 'Linear not configured',
        details: String(error)
      });
    }

    return res.status(500).json({
      error: 'Linear API error',
      details: String(error)
    });
  }
}
