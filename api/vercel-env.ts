import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const VERCEL_API = 'https://api.vercel.com';
const AUDIT_KEY = 'agent-coord:vercel-env-audit';

// Allowed agent IDs that can modify env vars (security)
const ALLOWED_AGENTS = ['tyler3', 'tyler', 'admin', 'superadmin'];

// Sensitive keys that should NEVER be returned in list operations
const REDACTED_KEYS = [
  'UPSTASH_REDIS_REST_TOKEN',
  'VERCEL_TOKEN',
  'ANTHROPIC_API_KEY',
  'LINEAR_API_KEY',
  'GITHUB_TOKEN',
  'SLACK_TOKEN',
  'NOTION_TOKEN',
  'SENTRY_AUTH_TOKEN',
  'GOOGLE_DRIVE_CREDENTIALS',
];

interface VercelEnvVar {
  id: string;
  key: string;
  value: string;
  type: 'system' | 'encrypted' | 'plain' | 'sensitive';
  target: ('production' | 'preview' | 'development')[];
  gitBranch?: string;
  createdAt: number;
  updatedAt: number;
}

interface AuditEntry {
  timestamp: string;
  action: 'list' | 'get' | 'set' | 'delete';
  agentId: string;
  key?: string;
  target?: string[];
  success: boolean;
  error?: string;
}

async function auditLog(entry: AuditEntry) {
  const logs = await redis.lrange<AuditEntry>(AUDIT_KEY, 0, 99) || [];
  logs.unshift(entry);
  await redis.del(AUDIT_KEY);
  if (logs.length > 0) {
    await redis.rpush(AUDIT_KEY, ...logs.slice(0, 100));
  }
}

async function vercelFetch(path: string, options: RequestInit = {}) {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;

  if (!token || !projectId) {
    throw new Error('VERCEL_TOKEN and VERCEL_PROJECT_ID must be configured');
  }

  const url = `${VERCEL_API}${path.replace('{projectId}', projectId)}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Vercel API error: ${res.status} ${res.statusText} - ${error}`);
  }

  return res.json();
}

/**
 * Vercel Environment Variables Management
 *
 * Allows authorized agents to manage Vercel env vars programmatically.
 * Security: Only allowed agents can modify, all actions are audit logged.
 *
 * GET /api/vercel-env?action=list - List all env vars (values redacted for sensitive keys)
 * GET /api/vercel-env?action=get&key=KEY_NAME - Get specific env var
 * GET /api/vercel-env?action=audit - View audit log
 * POST /api/vercel-env - Set/update env var
 * DELETE /api/vercel-env?key=KEY_NAME - Delete env var
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check configuration
  if (!process.env.VERCEL_TOKEN || !process.env.VERCEL_PROJECT_ID) {
    return res.status(503).json({
      error: 'Vercel integration not configured',
      message: 'Set VERCEL_TOKEN and VERCEL_PROJECT_ID in environment variables',
      setup: {
        step1: 'Go to https://vercel.com/account/tokens',
        step2: 'Create a token with appropriate scope',
        step3: 'Get your project ID from Vercel dashboard → Project Settings → General',
        step4: 'Add VERCEL_TOKEN and VERCEL_PROJECT_ID to your environment'
      }
    });
  }

  try {
    // GET - List or get specific env var
    if (req.method === 'GET') {
      const { action = 'list', key, agentId } = req.query;

      // Audit log view
      if (action === 'audit') {
        const logs = await redis.lrange<AuditEntry>(AUDIT_KEY, 0, 49) || [];
        return res.json({
          auditLog: logs,
          count: logs.length,
          note: 'Last 50 env var operations'
        });
      }

      // List all env vars
      if (action === 'list') {
        const data = await vercelFetch('/v9/projects/{projectId}/env');

        await auditLog({
          timestamp: new Date().toISOString(),
          action: 'list',
          agentId: String(agentId || 'unknown'),
          success: true
        });

        // Redact sensitive values
        const envVars = (data.envs || []).map((env: VercelEnvVar) => ({
          id: env.id,
          key: env.key,
          value: REDACTED_KEYS.includes(env.key) ? '[REDACTED]' : env.value,
          type: env.type,
          target: env.target,
          updatedAt: new Date(env.updatedAt).toISOString()
        }));

        return res.json({
          envVars,
          count: envVars.length,
          projectId: process.env.VERCEL_PROJECT_ID
        });
      }

      // Get specific env var
      if (action === 'get' && key) {
        const data = await vercelFetch('/v9/projects/{projectId}/env');
        const envVar = (data.envs || []).find((e: VercelEnvVar) => e.key === key);

        await auditLog({
          timestamp: new Date().toISOString(),
          action: 'get',
          agentId: String(agentId || 'unknown'),
          key: String(key),
          success: !!envVar
        });

        if (!envVar) {
          return res.status(404).json({ error: `Environment variable '${key}' not found` });
        }

        return res.json({
          envVar: {
            id: envVar.id,
            key: envVar.key,
            value: REDACTED_KEYS.includes(envVar.key) ? '[REDACTED]' : envVar.value,
            type: envVar.type,
            target: envVar.target,
            updatedAt: new Date(envVar.updatedAt).toISOString()
          }
        });
      }

      return res.status(400).json({ error: 'Invalid action or missing parameters' });
    }

    // POST - Set/update env var
    if (req.method === 'POST') {
      const { key, value, target = ['production', 'preview', 'development'], agentId } = req.body;

      // Security: Check if agent is allowed
      if (!ALLOWED_AGENTS.includes(agentId)) {
        await auditLog({
          timestamp: new Date().toISOString(),
          action: 'set',
          agentId: agentId || 'unknown',
          key,
          target,
          success: false,
          error: 'Unauthorized agent'
        });

        return res.status(403).json({
          error: 'Unauthorized',
          message: `Agent '${agentId}' is not authorized to modify environment variables`,
          allowedAgents: ALLOWED_AGENTS
        });
      }

      if (!key || value === undefined) {
        return res.status(400).json({
          error: 'key and value are required',
          example: { key: 'MY_API_KEY', value: 'secret123', target: ['production'] }
        });
      }

      // Check if env var already exists
      const existing = await vercelFetch('/v9/projects/{projectId}/env');
      const existingVar = (existing.envs || []).find((e: VercelEnvVar) => e.key === key);

      let result;
      if (existingVar) {
        // Update existing
        result = await vercelFetch(`/v9/projects/{projectId}/env/${existingVar.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ value, target })
        });
      } else {
        // Create new
        result = await vercelFetch('/v10/projects/{projectId}/env', {
          method: 'POST',
          body: JSON.stringify({
            key,
            value,
            target,
            type: 'encrypted' // Always encrypted for security
          })
        });
      }

      await auditLog({
        timestamp: new Date().toISOString(),
        action: 'set',
        agentId: agentId || 'unknown',
        key,
        target,
        success: true
      });

      return res.json({
        success: true,
        action: existingVar ? 'updated' : 'created',
        key,
        target,
        note: 'Changes will apply to next deployment. Run `vercel --prod` to redeploy.',
        hint: 'You may need to redeploy for changes to take effect'
      });
    }

    // DELETE - Remove env var
    if (req.method === 'DELETE') {
      const { key, agentId } = req.query;

      // Security: Check if agent is allowed
      if (!ALLOWED_AGENTS.includes(String(agentId))) {
        await auditLog({
          timestamp: new Date().toISOString(),
          action: 'delete',
          agentId: String(agentId || 'unknown'),
          key: String(key),
          success: false,
          error: 'Unauthorized agent'
        });

        return res.status(403).json({
          error: 'Unauthorized',
          message: `Agent '${agentId}' is not authorized to delete environment variables`
        });
      }

      if (!key) {
        return res.status(400).json({ error: 'key parameter is required' });
      }

      // Find the env var to get its ID
      const existing = await vercelFetch('/v9/projects/{projectId}/env');
      const existingVar = (existing.envs || []).find((e: VercelEnvVar) => e.key === key);

      if (!existingVar) {
        return res.status(404).json({ error: `Environment variable '${key}' not found` });
      }

      await vercelFetch(`/v9/projects/{projectId}/env/${existingVar.id}`, {
        method: 'DELETE'
      });

      await auditLog({
        timestamp: new Date().toISOString(),
        action: 'delete',
        agentId: String(agentId || 'unknown'),
        key: String(key),
        success: true
      });

      return res.json({
        success: true,
        deleted: key,
        note: 'Variable removed. Redeploy for changes to take effect.'
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Vercel env API error:', error);

    return res.status(500).json({
      error: 'Vercel API error',
      details: String(error)
    });
  }
}
