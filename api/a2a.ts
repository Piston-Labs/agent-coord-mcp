/**
 * A2A Protocol API Endpoint
 *
 * Provides HTTP API for A2A (Agent-to-Agent) protocol communication.
 * Allows external agents (e.g., contextOS) to communicate with Hub agents.
 *
 * Endpoints:
 *   POST /api/a2a              - Send/receive A2A messages
 *   GET  /api/a2a?action=parse - Parse an A2A message
 *   GET  /api/a2a?action=vocab - Get A2A vocabulary
 *   POST /api/a2a?action=negotiate - Protocol negotiation
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const A2A_MESSAGES_KEY = 'agent-coord:a2a:messages';
const A2A_PEERS_KEY = 'agent-coord:a2a:peers';
const MAX_A2A_MESSAGES = 500;
const PROTOCOL_VERSION = 'v0.2';

// ============================================================================
// A2A VOCABULARY
// ============================================================================

const A2A_DOMAINS: Record<string, string> = {
  C: 'claims',
  T: 'tasks',
  S: 'status',
  M: 'messages',
  R: 'resources',
  E: 'errors',
  H: 'handoffs',
  Q: 'queries',
  P: 'protocol',
  X: 'execute',
};

const A2A_OPS: Record<string, string> = {
  'C.🎯': 'claim',
  'C.🔓': 'release',
  'C.❓': 'check',
  'C.⚔': 'conflict',
  'T.📋': 'create',
  'T.✏': 'update',
  'T.✅': 'complete',
  'T.❌': 'cancel',
  'S.⚡': 'active',
  'S.💤': 'idle',
  'S.⏳': 'waiting',
  'S.🔄': 'working',
  'M.📨': 'send',
  'M.📢': 'broadcast',
  'M.✓': 'ack',
  'M.@': 'mention',
  'R.🔒': 'lock',
  'R.🔓': 'unlock',
  'E.❓': 'unknown',
  'E.⚔': 'conflict',
  'E.❌': 'fail',
  'H.📤': 'create',
  'H.📥': 'claim',
  'H.✅': 'complete',
  'P.?': 'query_version',
  'P.!': 'confirm_version',
  'P.📋': 'capabilities',
};

// ============================================================================
// A2A PARSER
// ============================================================================

interface A2AMessage {
  from: string;
  to: string;
  layer: number;
  payload: string;
  raw: string;
}

interface A2AOperation {
  domain: string;
  op: string;
  params: string[];
}

function parseA2AMessage(raw: string): A2AMessage | null {
  const match = raw.match(/^Ω\{([^|]+)\|([^|]+)\|(\d+)\|(.+)\}$/);
  if (!match) return null;
  return {
    from: match[1],
    to: match[2],
    layer: parseInt(match[3], 10),
    payload: match[4],
    raw
  };
}

function parseOperation(payload: string): A2AOperation | null {
  const match = payload.match(/^([A-Z])\.([^\(]+)(?:\(([^)]*)\))?$/);
  if (!match) return null;
  const params = match[3]
    ? match[3].split(',').map(p => p.trim().replace(/^["']|["']$/g, ''))
    : [];
  return {
    domain: match[1],
    op: match[2],
    params
  };
}

function encodeA2AMessage(from: string, to: string, layer: number, payload: string): string {
  return `Ω{${from}|${to}|${layer}|${payload}}`;
}

// ============================================================================
// HUB INTEGRATION - Execute A2A operations via Hub APIs
// ============================================================================

async function executeA2AOperation(
  op: A2AOperation,
  fromAgent: string
): Promise<{ success: boolean; result?: unknown; hubResponse?: unknown }> {
  const key = `${op.domain}.${op.op}`;

  try {
    switch (key) {
      case 'S.⚡':
      case 'S.💤':
      case 'S.⏳': {
        // Status update
        const status = key === 'S.⚡' ? 'active' : key === 'S.💤' ? 'idle' : 'waiting';
        await redis.hset('agent-coord:agents', fromAgent, JSON.stringify({
          id: fromAgent,
          status,
          currentTask: op.params[1] || '',
          lastSeen: new Date().toISOString(),
          source: 'a2a'
        }));
        return { success: true, result: { status } };
      }

      case 'M.📢': {
        // Broadcast to group chat
        const message = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          author: fromAgent,
          authorType: 'agent',
          content: op.params[0] || '',
          timestamp: new Date().toISOString(),
          source: 'a2a'
        };
        await redis.lpush('agent-coord:messages', JSON.stringify(message));
        await redis.ltrim('agent-coord:messages', 0, 999);
        return { success: true, result: message };
      }

      case 'C.🎯': {
        // Claim
        const what = op.params[0];
        const description = op.params[1] || '';
        const claim = {
          what,
          by: fromAgent,
          description,
          since: new Date().toISOString(),
          source: 'a2a'
        };
        await redis.hset('agent-coord:claims', what, JSON.stringify(claim));
        return { success: true, result: claim };
      }

      case 'C.🔓': {
        // Release claim
        const what = op.params[0];
        await redis.hdel('agent-coord:claims', what);
        return { success: true, result: { released: what } };
      }

      case 'T.📋': {
        // Create task
        const taskId = `task-${Date.now()}`;
        const task = {
          id: taskId,
          title: op.params[0] || '',
          description: op.params[1] || '',
          priority: op.params[2] || 'medium',
          status: 'todo',
          createdBy: fromAgent,
          createdAt: new Date().toISOString(),
          source: 'a2a'
        };
        await redis.hset('agent-coord:tasks', taskId, JSON.stringify(task));
        return { success: true, result: task };
      }

      case 'R.🔒': {
        // Lock resource
        const resourcePath = op.params[0];
        const reason = op.params[1] || '';
        const lock = {
          resourcePath,
          agentId: fromAgent,
          reason,
          acquiredAt: new Date().toISOString(),
          source: 'a2a'
        };
        await redis.hset('agent-coord:locks', resourcePath, JSON.stringify(lock));
        return { success: true, result: lock };
      }

      case 'R.🔓': {
        // Unlock resource
        const resourcePath = op.params[0];
        await redis.hdel('agent-coord:locks', resourcePath);
        return { success: true, result: { unlocked: resourcePath } };
      }

      case 'P.?': {
        // Protocol version query
        return {
          success: true,
          result: {
            version: PROTOCOL_VERSION,
            capabilities: ['opchain', 'emoji', 'hash', 'broadcast', 'roles']
          }
        };
      }

      default:
        return { success: false, result: { error: `Unknown operation: ${key}` } };
    }
  } catch (error) {
    return { success: false, result: { error: String(error) } };
  }
}

// ============================================================================
// API HANDLER
// ============================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-A2A-Version, X-A2A-From');
  res.setHeader('X-A2A-Version', PROTOCOL_VERSION);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action } = req.query;

    // GET requests
    if (req.method === 'GET') {
      if (action === 'vocab') {
        return res.status(200).json({
          protocol: 'A2A',
          version: PROTOCOL_VERSION,
          envelope: 'Ω{from|to|layer|payload}',
          layers: {
            0: 'Transport envelope',
            1: 'Atomic operations',
            2: 'Operation chains (→ sequence, | conditional, & parallel)',
            3: 'Reasoning frames'
          },
          domains: A2A_DOMAINS,
          operations: A2A_OPS,
          examples: [
            'Ω{agent1|@cd|1|S.⚡(85,"coding")}',
            'Ω{agent1|*|1|M.📢("Hello team")}',
            'Ω{agent1|agent2|2|T.📋("task1")→C.🎯→S.⚡}'
          ]
        });
      }

      if (action === 'peers') {
        const peers = await redis.hgetall(A2A_PEERS_KEY) || {};
        return res.status(200).json({
          peers: Object.values(peers).map((p: any) => typeof p === 'string' ? JSON.parse(p) : p),
          count: Object.keys(peers).length
        });
      }

      if (action === 'messages') {
        const { limit = '50', since } = req.query;
        const messages = await redis.lrange(A2A_MESSAGES_KEY, 0, parseInt(limit as string, 10) - 1);
        let result = messages.map((m: any) => typeof m === 'string' ? JSON.parse(m) : m);

        if (since && typeof since === 'string') {
          const sinceTime = new Date(since).getTime();
          result = result.filter((m: any) => new Date(m.timestamp).getTime() > sinceTime);
        }

        return res.status(200).json({ messages: result, count: result.length });
      }

      return res.status(200).json({
        protocol: 'A2A',
        version: PROTOCOL_VERSION,
        endpoints: {
          'GET /api/a2a?action=vocab': 'Get A2A vocabulary',
          'GET /api/a2a?action=peers': 'List connected peers',
          'GET /api/a2a?action=messages': 'Get A2A message history',
          'POST /api/a2a': 'Send A2A message',
          'POST /api/a2a?action=negotiate': 'Protocol negotiation',
          'POST /api/a2a?action=parse': 'Parse A2A message without executing'
        },
        hub: 'agent-coord-mcp'
      });
    }

    // POST requests
    if (req.method === 'POST') {
      const body = req.body || {};

      // Parse action - analyze without executing
      if (action === 'parse') {
        const { message } = body;
        if (!message) {
          return res.status(400).json({ error: 'message required' });
        }

        const parsed = parseA2AMessage(message);
        if (!parsed) {
          return res.status(400).json({ error: 'Invalid A2A format', expected: 'Ω{from|to|layer|payload}' });
        }

        let analysis: Record<string, unknown> = {
          envelope: {
            from: parsed.from,
            to: parsed.to,
            layer: parsed.layer,
            payload: parsed.payload
          }
        };

        if (parsed.layer === 1) {
          const op = parseOperation(parsed.payload);
          if (op) {
            analysis.operation = {
              domain: A2A_DOMAINS[op.domain] || op.domain,
              op: A2A_OPS[`${op.domain}.${op.op}`] || op.op,
              params: op.params
            };
          }
        }

        return res.status(200).json({ parsed: true, analysis });
      }

      // Negotiate - protocol version and capability exchange
      if (action === 'negotiate') {
        const { peerId, peerEndpoint, version, capabilities } = body;

        if (!peerId) {
          return res.status(400).json({ error: 'peerId required' });
        }

        // Register peer
        const peer = {
          id: peerId,
          endpoint: peerEndpoint,
          version: version || 'unknown',
          capabilities: capabilities || [],
          connectedAt: new Date().toISOString(),
          lastSeen: new Date().toISOString()
        };
        await redis.hset(A2A_PEERS_KEY, peerId, JSON.stringify(peer));

        // Determine compatible version
        const compatible = version === PROTOCOL_VERSION || version?.startsWith('v0.');

        return res.status(200).json({
          accepted: compatible,
          ourVersion: PROTOCOL_VERSION,
          ourCapabilities: ['opchain', 'emoji', 'hash', 'broadcast', 'roles', 'hub-tools'],
          negotiationMessage: encodeA2AMessage(
            'hub',
            peerId,
            0,
            compatible ? `P.!(${PROTOCOL_VERSION})` : `P.?(${PROTOCOL_VERSION})`
          ),
          peer
        });
      }

      // Send A2A message
      const { message, from, protocol, version: msgVersion } = body;

      if (!message) {
        return res.status(400).json({ error: 'message required' });
      }

      // Handle raw A2A message
      const parsed = parseA2AMessage(message);
      if (!parsed) {
        return res.status(400).json({
          error: 'Invalid A2A format',
          expected: 'Ω{from|to|layer|payload}',
          example: 'Ω{agent1|hub|1|S.⚡(100,"working")}'
        });
      }

      // Store the message
      const storedMessage = {
        ...parsed,
        receivedAt: new Date().toISOString(),
        sourceProtocol: protocol || 'A2A',
        sourceVersion: msgVersion || PROTOCOL_VERSION
      };
      await redis.lpush(A2A_MESSAGES_KEY, JSON.stringify(storedMessage));
      await redis.ltrim(A2A_MESSAGES_KEY, 0, MAX_A2A_MESSAGES - 1);

      // Execute if Layer 1 atomic operation
      let executionResult: { success: boolean; result?: unknown } | null = null;
      if (parsed.layer === 1) {
        const op = parseOperation(parsed.payload);
        if (op) {
          executionResult = await executeA2AOperation(op, parsed.from);
        }
      } else if (parsed.layer === 2) {
        // Chain execution - parse and execute sequentially
        const parts = parsed.payload.split(/→/);
        const results = [];
        for (const part of parts) {
          const op = parseOperation(part.trim());
          if (op) {
            const result = await executeA2AOperation(op, parsed.from);
            results.push(result);
            if (!result.success) break;  // Stop on first failure
          }
        }
        executionResult = {
          success: results.every(r => r.success),
          result: results
        };
      }

      // Generate response
      const responsePayload = executionResult?.success
        ? 'M.✓'
        : `E.❌("${(executionResult?.result as any)?.error || 'execution failed'}")`;

      const response = {
        received: true,
        message: parsed,
        executed: executionResult !== null,
        execution: executionResult,
        response: encodeA2AMessage('hub', parsed.from, 1, responsePayload)
      };

      return res.status(200).json(response);
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('[A2A] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      a2aError: `E.❌("${String(error).slice(0, 50)}")`
    });
  }
}
