/**
 * HTTP Server Mode for Agent Coordination MCP
 *
 * Provides REST API access to coordination tools.
 * Useful for web dashboards, testing, and remote agents.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { unifiedStore as store } from './unified-store.js';
import {
  formatAgents,
  formatTasks,
  formatClaims,
  formatLocks,
  formatZones,
  formatMessages,
  formatOutput,
  type OutputFormat
} from './toon.js';
import {
  optimizeContext,
  analyzeActivity,
  getOptimizerStatus
} from './context-optimizer.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, '..', 'web');

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params = new URLSearchParams(url.substring(idx + 1));
  const result: Record<string, string> = {};
  params.forEach((value, key) => result[key] = value);
  return result;
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * Respond with TOON-formatted data for token efficiency
 * Use ?format=toon to enable, ?format=json for explicit JSON
 */
function respond(res: ServerResponse, data: unknown, format: OutputFormat = 'json', status = 200) {
  const result = formatOutput(data, format);

  const contentType = result.format === 'toon' ? 'text/plain' : 'application/json';

  res.writeHead(status, {
    'Content-Type': contentType,
    'X-Format': result.format,
    'X-Token-Savings': `${result.savings}%`,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(result.content);
}

function error(res: ServerResponse, message: string, status = 400) {
  json(res, { error: message }, status);
}

const server = createServer(async (req, res) => {
  const method = req.method || 'GET';
  const url = req.url || '/';
  const path = url.split('?')[0];
  const query = parseQuery(url);

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  console.log(`[HTTP] ${method} ${path}`);

  try {
    // ========== ROOT - Serve Web UI ==========
    if (path === '/') {
      const indexPath = join(WEB_DIR, 'index.html');
      if (existsSync(indexPath)) {
        const html = readFileSync(indexPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(html);
      }
    }

    // ========== API INFO ==========
    if (path === '/api') {
      return json(res, {
        name: 'piston-labs-agent-hub',
        version: '0.2.0',
        mode: 'http',
        principles: [
          'Token-efficient coordination',
          'Self-optimizing context',
          'Grounded multi-agent collaboration'
        ],
        endpoints: [
          'GET  /api/health',
          'GET  /api/agents',
          'GET  /api/agents?format=toon',
          'POST /api/agents/:id/status',
          'GET  /api/chat',
          'POST /api/chat',
          'GET  /api/tasks',
          'GET  /api/tasks?format=toon',
          'POST /api/tasks',
          'GET  /api/locks',
          'GET  /api/locks?format=toon',
          'POST /api/locks',
          'GET  /api/zones',
          'POST /api/zones',
          'GET  /api/claims',
          'GET  /api/claims?format=toon',
          'POST /api/claims',
          'GET  /api/work/:agentId',
          'GET  /api/context (optimized)',
          'GET  /api/activity (summary)'
        ]
      });
    }

    // ========== HEALTH ==========
    if (path === '/api/health') {
      return json(res, {
        status: 'ok',
        timestamp: new Date().toISOString(),
        agents: store.getActiveAgents().length,
        uptime: process.uptime()
      });
    }

    // ========== OPTIMIZED CONTEXT ==========
    if (path === '/api/context') {
      const targetTokens = parseInt(query.tokens || '4000', 10);

      const optimized = optimizeContext(
        store.getAllAgents(),
        store.listTasks(),
        store.getGroupMessages(200),
        store.listClaims(true),
        store.getAllLocks(),
        store.listZones(),
        targetTokens
      );

      return json(res, {
        optimized: true,
        targetTokens,
        stats: optimized.stats,
        digest: optimized.digest,
        agents: optimized.agents,
        tasks: optimized.tasks,
        messages: optimized.messages.slice(0, 10),  // Just recent for context
        claims: optimized.claims,
        locks: optimized.locks,
        zones: optimized.zones
      });
    }

    // ========== ACTIVITY SUMMARY ==========
    if (path === '/api/activity') {
      const activity = analyzeActivity(
        store.getAllAgents(),
        store.listTasks(),
        store.getGroupMessages(100),
        store.listClaims()
      );

      const optimizerStatus = getOptimizerStatus();

      return json(res, {
        activity,
        optimizer: optimizerStatus,
        timestamp: new Date().toISOString()
      });
    }

    // ========== WORK (combined view) ==========
    const workMatch = path.match(/^\/api\/work\/(.+)$/);
    if (workMatch) {
      const agentId = workMatch[1];
      const agent = store.getAgent(agentId) || {
        id: agentId,
        status: 'active' as const,
        lastSeen: new Date().toISOString(),
        roles: [],
        metadata: {}
      };
      agent.status = 'active';
      store.updateAgent(agent);

      const inbox = store.getMessagesFor(agentId);
      const tasks = store.listTasks();
      const activeAgents = store.getActiveAgents();
      const locks = store.getAllLocks();
      const checkpoint = store.getCheckpoint(agentId);

      return json(res, {
        agentId,
        summary: {
          unreadMessages: inbox.length,
          todoTasks: tasks.filter(t => t.status === 'todo').length,
          inProgressTasks: tasks.filter(t => t.status === 'in-progress').length,
          activeAgents: activeAgents.length,
          locks: locks.length
        },
        inbox: inbox.slice(0, 10),
        tasks: tasks.slice(0, 10),
        team: activeAgents.map(a => ({
          agentId: a.id,
          status: a.status,
          currentTask: a.currentTask,
          workingOn: a.workingOn
        })),
        previousSession: checkpoint ? {
          resumeAvailable: true,
          lastCheckpoint: checkpoint.checkpointAt,
          wasWorkingOn: checkpoint.recentContext
        } : null
      });
    }

    // ========== AGENTS ==========
    if (path === '/api/agents') {
      if (method === 'GET') {
        const agents = query.active === 'true'
          ? store.getActiveAgents()
          : store.getAllAgents();
        const format = (query.format || 'json') as OutputFormat;

        if (format === 'toon') {
          const result = formatAgents(agents);
          res.writeHead(200, {
            'Content-Type': 'text/plain',
            'X-Format': result.format,
            'X-Token-Savings': `${result.savings}%`,
            'Access-Control-Allow-Origin': '*'
          });
          return res.end(result.content);
        }

        return json(res, { agents, count: agents.length });
      }
    }

    const agentStatusMatch = path.match(/^\/api\/agents\/(.+)\/status$/);
    if (agentStatusMatch && method === 'POST') {
      const agentId = agentStatusMatch[1];
      const body = await parseBody(req);
      const agent = store.getAgent(agentId) || {
        id: agentId,
        status: 'active' as const,
        lastSeen: new Date().toISOString(),
        roles: [],
        metadata: {}
      };
      if (body.status) agent.status = body.status as 'active' | 'idle' | 'waiting';
      if (body.currentTask) agent.currentTask = body.currentTask as string;
      if (body.workingOn) {
        agent.workingOn = body.workingOn as string;
        agent.workingOnSince = new Date().toISOString();
      }
      store.updateAgent(agent);
      return json(res, { updated: true, agent });
    }

    // ========== CHAT ==========
    if (path === '/api/chat') {
      if (method === 'GET') {
        const limit = parseInt(query.limit || '50', 10);
        const since = query.since;
        const messages = since
          ? store.getGroupMessagesSince(since)
          : store.getGroupMessages(limit);
        return json(res, { messages, count: messages.length });
      }

      if (method === 'POST') {
        const body = await parseBody(req);
        if (!body.author || !body.message) {
          return error(res, 'author and message required');
        }
        const authorType = (body.authorType as 'agent' | 'human') || 'agent';
        const msg = store.postGroupMessage(
          body.author as string,
          authorType,
          body.message as string
        );

        // Handle @mentions
        const mentions = store.extractMentions(body.message as string);
        for (const mentioned of mentions) {
          store.sendMessage({
            from: body.author as string,
            to: mentioned,
            type: 'mention',
            message: `You were mentioned: "${(body.message as string).substring(0, 100)}..."`
          });
        }

        return json(res, {
          id: msg.id,
          sent: true,
          timestamp: msg.timestamp,
          mentions: { detected: mentions, pinged: mentions }
        });
      }
    }

    // ========== TASKS ==========
    if (path === '/api/tasks') {
      if (method === 'GET') {
        const status = query.status as 'todo' | 'in-progress' | 'done' | 'blocked' | undefined;
        const tasks = store.listTasks(status);
        const format = (query.format || 'json') as OutputFormat;

        if (format === 'toon') {
          const result = formatTasks(tasks);
          res.writeHead(200, {
            'Content-Type': 'text/plain',
            'X-Format': result.format,
            'X-Token-Savings': `${result.savings}%`,
            'Access-Control-Allow-Origin': '*'
          });
          return res.end(result.content);
        }

        return json(res, { tasks, count: tasks.length });
      }

      if (method === 'POST') {
        const body = await parseBody(req);
        if (!body.title || !body.createdBy) {
          return error(res, 'title and createdBy required');
        }
        const task = store.createTask({
          title: body.title as string,
          description: body.description as string,
          priority: (body.priority as 'low' | 'medium' | 'high' | 'urgent') || 'medium',
          status: 'todo',
          createdBy: body.createdBy as string,
          assignee: body.assignee as string,
          tags: (body.tags as string[]) || []
        });
        return json(res, { created: true, task });
      }
    }

    const taskMatch = path.match(/^\/api\/tasks\/(.+)$/);
    if (taskMatch) {
      const taskId = taskMatch[1];
      if (method === 'GET') {
        const task = store.getTask(taskId);
        return json(res, task || { error: 'not found' });
      }
      if (method === 'PUT') {
        const body = await parseBody(req);
        if (body.status) {
          const task = store.updateTaskStatus(taskId, body.status as 'todo' | 'in-progress' | 'done' | 'blocked');
          return json(res, task ? { updated: true, task } : { error: 'not found' });
        }
        if (body.assignee) {
          const task = store.assignTask(taskId, body.assignee as string);
          return json(res, task ? { assigned: true, task } : { error: 'not found' });
        }
        return error(res, 'status or assignee required');
      }
    }

    // ========== LOCKS ==========
    if (path === '/api/locks') {
      if (method === 'GET') {
        const locks = store.getAllLocks();
        const format = (query.format || 'json') as OutputFormat;

        if (format === 'toon') {
          const result = formatLocks(locks);
          res.writeHead(200, {
            'Content-Type': 'text/plain',
            'X-Format': result.format,
            'X-Token-Savings': `${result.savings}%`,
            'Access-Control-Allow-Origin': '*'
          });
          return res.end(result.content);
        }

        return json(res, { locks, count: locks.length });
      }

      if (method === 'POST') {
        const body = await parseBody(req);
        if (!body.resourcePath || !body.agentId) {
          return error(res, 'resourcePath and agentId required');
        }
        const result = store.acquireLock(
          body.resourcePath as string,
          body.agentId as string,
          (body.resourceType as 'repo-path' | 'branch' | 'file-lock' | 'custom') || 'file-lock',
          body.reason as string
        );
        if ('error' in result) {
          return json(res, { success: false, error: result.error }, 409);
        }
        return json(res, { success: true, lock: result });
      }
    }

    const lockMatch = path.match(/^\/api\/locks\/(.+)$/);
    if (lockMatch && method === 'DELETE') {
      const resourcePath = decodeURIComponent(lockMatch[1]);
      const body = await parseBody(req);
      if (!body.agentId) {
        return error(res, 'agentId required');
      }
      const released = store.releaseLock(resourcePath, body.agentId as string);
      return json(res, { released, resourcePath });
    }

    // ========== ZONES ==========
    if (path === '/api/zones') {
      if (method === 'GET') {
        const zones = store.listZones();
        const format = (query.format || 'json') as OutputFormat;

        if (format === 'toon') {
          const result = formatZones(zones);
          res.writeHead(200, {
            'Content-Type': 'text/plain',
            'X-Format': result.format,
            'X-Token-Savings': `${result.savings}%`,
            'Access-Control-Allow-Origin': '*'
          });
          return res.end(result.content);
        }

        return json(res, { zones, count: zones.length });
      }

      if (method === 'POST') {
        const body = await parseBody(req);
        if (!body.zoneId || !body.path || !body.owner) {
          return error(res, 'zoneId, path, and owner required');
        }
        const result = store.claimZone(
          body.zoneId as string,
          body.path as string,
          body.owner as string,
          body.description as string
        );
        if ('error' in result) {
          return json(res, { success: false, error: result.error }, 409);
        }
        return json(res, { success: true, zone: result });
      }
    }

    const zoneMatch = path.match(/^\/api\/zones\/(.+)$/);
    if (zoneMatch) {
      const zoneId = zoneMatch[1];
      if (method === 'GET') {
        const zone = store.checkZone(zoneId);
        return json(res, zone ? { claimed: true, ...zone } : { claimed: false });
      }
      if (method === 'DELETE') {
        const body = await parseBody(req);
        if (!body.owner) {
          return error(res, 'owner required');
        }
        const released = store.releaseZone(zoneId, body.owner as string);
        return json(res, { released, zoneId });
      }
    }

    // ========== CLAIMS ==========
    if (path === '/api/claims') {
      if (method === 'GET') {
        const includeStale = query.includeStale === 'true';
        const claims = store.listClaims(includeStale);
        const format = (query.format || 'json') as OutputFormat;

        if (format === 'toon') {
          const result = formatClaims(claims);
          res.writeHead(200, {
            'Content-Type': 'text/plain',
            'X-Format': result.format,
            'X-Token-Savings': `${result.savings}%`,
            'Access-Control-Allow-Origin': '*'
          });
          return res.end(result.content);
        }

        return json(res, { claims, count: claims.length });
      }

      if (method === 'POST') {
        const body = await parseBody(req);
        if (!body.what || !body.by) {
          return error(res, 'what and by required');
        }
        const existing = store.checkClaim(body.what as string);
        if (existing && existing.by !== body.by && !existing.stale) {
          return json(res, { claimed: false, by: existing.by, since: existing.since }, 409);
        }
        const claim = store.claim(body.what as string, body.by as string, body.description as string);
        return json(res, { claimed: true, what: claim.what, by: claim.by });
      }
    }

    // ========== MESSAGES (DMs) ==========
    if (path === '/api/messages') {
      if (method === 'GET') {
        const agentId = query.agentId;
        if (!agentId) {
          return error(res, 'agentId query param required');
        }
        const messages = store.getMessagesFor(agentId, true);
        return json(res, { messages, count: messages.length });
      }

      if (method === 'POST') {
        const body = await parseBody(req);
        if (!body.from || !body.to || !body.message) {
          return error(res, 'from, to, and message required');
        }
        const msg = store.sendMessage({
          from: body.from as string,
          to: body.to as string,
          type: (body.type as 'status' | 'handoff' | 'note' | 'mention') || 'note',
          message: body.message as string
        });
        return json(res, { sent: true, id: msg.id });
      }
    }

    // ========== 404 ==========
    return error(res, `Not found: ${path}`, 404);

  } catch (err) {
    console.error('[HTTP] Error:', err);
    return error(res, 'Internal server error', 500);
  }
});

server.listen(PORT, () => {
  console.log(`[agent-coord-mcp] HTTP server running on http://localhost:${PORT}`);
  console.log('[agent-coord-mcp] Endpoints:');
  console.log('  GET  /api/health');
  console.log('  GET  /api/work/:agentId');
  console.log('  GET  /api/agents');
  console.log('  POST /api/agents/:id/status');
  console.log('  GET  /api/chat');
  console.log('  POST /api/chat');
  console.log('  GET  /api/tasks');
  console.log('  POST /api/tasks');
  console.log('  GET  /api/locks');
  console.log('  POST /api/locks');
  console.log('  GET  /api/zones');
  console.log('  POST /api/zones');
  console.log('  GET  /api/claims');
  console.log('  POST /api/claims');
  console.log('  GET  /api/messages');
  console.log('  POST /api/messages');
});
