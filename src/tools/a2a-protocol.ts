/**
 * A2A Protocol Implementation - Agent-to-Agent Communication
 *
 * Implements the Omega A2A Protocol v0.2 for ultra-efficient agent communication.
 * Based on the contextOS specification for LLM-native, bandwidth-optimized messaging.
 *
 * Protocol Format: Ω{from|to|layer|payload}
 *
 * Layers:
 *   0 - Transport Envelope
 *   1 - Atomic Operations (Domain.Op(params))
 *   2 - Operation Chains (→ sequence, | conditional, & parallel)
 *   3 - Reasoning Frames (meta-communication)
 *
 * Domains:
 *   C - Claims (claim, release, check)
 *   T - Tasks (create, update, complete)
 *   S - Status (active, idle, waiting)
 *   M - Messages (send, broadcast, ack)
 *   R - Resources (lock, unlock, check)
 *   E - Errors (unknown, conflict, fail)
 *   H - Handoffs (create, claim, complete)
 *   Q - Queries (ask, respond)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

// ============================================================================
// A2A VOCABULARY MAPPING
// ============================================================================

/**
 * Domain codes for A2A operations
 */
export const A2A_DOMAINS = {
  C: 'claims',      // Claim operations
  T: 'tasks',       // Task operations
  S: 'status',      // Status updates
  M: 'messages',    // Messaging
  R: 'resources',   // Resource locks
  E: 'errors',      // Error signaling
  H: 'handoffs',    // Work handoffs
  Q: 'queries',     // Questions/queries
  P: 'protocol',    // Protocol negotiation
  X: 'execute',     // Execute/action
} as const;

/**
 * Operation codes within each domain
 */
export const A2A_OPS = {
  // Claims domain
  'C.🎯': 'claim',
  'C.🔓': 'release',
  'C.❓': 'check',
  'C.⚔': 'conflict',

  // Tasks domain
  'T.📋': 'create',
  'T.✏': 'update',
  'T.✅': 'complete',
  'T.❌': 'cancel',
  'T.📌': 'assign',

  // Status domain
  'S.⚡': 'active',
  'S.💤': 'idle',
  'S.⏳': 'waiting',
  'S.🔄': 'working',
  'S.✅': 'done',

  // Messages domain
  'M.📨': 'send',
  'M.📢': 'broadcast',
  'M.✓': 'ack',
  'M.@': 'mention',
  'M.❓': 'query',

  // Resources domain
  'R.🔒': 'lock',
  'R.🔓': 'unlock',
  'R.❓': 'check',

  // Errors domain
  'E.❓': 'unknown',
  'E.⚔': 'conflict',
  'E.❌': 'fail',
  'E.⚠': 'warning',

  // Handoffs domain
  'H.📤': 'create',
  'H.📥': 'claim',
  'H.✅': 'complete',

  // Protocol domain
  'P.?': 'query_version',
  'P.!': 'confirm_version',
  'P.📋': 'capabilities',

  // Execute domain
  'X.→': 'run',
  'X.⏹': 'stop',
} as const;

// ============================================================================
// A2A MESSAGE PARSER
// ============================================================================

export interface A2AMessage {
  from: string;
  to: string;
  layer: number;
  payload: string;
  raw: string;
}

export interface A2AOperation {
  domain: string;
  op: string;
  params: string[];
}

export interface A2AChain {
  operations: A2AOperation[];
  connectors: ('→' | '|' | '&')[];  // sequence, conditional, parallel
}

/**
 * Parse an A2A envelope message
 * Format: Ω{from|to|layer|payload}
 */
export function parseA2AMessage(raw: string): A2AMessage | null {
  // Match Ω{from|to|layer|payload}
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

/**
 * Parse a Layer 1 atomic operation
 * Format: Domain.Op(params) e.g., S.⚡(85,"coding")
 */
export function parseOperation(payload: string): A2AOperation | null {
  // Match Domain.Op(params) or Domain.Op
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

/**
 * Parse a Layer 2 operation chain
 * Format: op1→op2|op3&op4
 */
export function parseChain(payload: string): A2AChain {
  const operations: A2AOperation[] = [];
  const connectors: ('→' | '|' | '&')[] = [];

  // Split by connectors while preserving them
  const parts = payload.split(/(→|\||&)/);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;

    if (part === '→' || part === '|' || part === '&') {
      connectors.push(part as '→' | '|' | '&');
    } else {
      const op = parseOperation(part);
      if (op) operations.push(op);
    }
  }

  return { operations, connectors };
}

// ============================================================================
// A2A MESSAGE ENCODER
// ============================================================================

/**
 * Encode an A2A message
 */
export function encodeA2AMessage(from: string, to: string, layer: number, payload: string): string {
  return `Ω{${from}|${to}|${layer}|${payload}}`;
}

/**
 * Encode a Layer 1 operation
 */
export function encodeOperation(domain: string, op: string, params: (string | number)[] = []): string {
  if (params.length === 0) {
    return `${domain}.${op}`;
  }
  const paramStr = params.map(p => typeof p === 'string' ? `"${p}"` : p).join(',');
  return `${domain}.${op}(${paramStr})`;
}

/**
 * Encode a chain of operations
 */
export function encodeChain(operations: string[], connector: '→' | '|' | '&' = '→'): string {
  return operations.join(connector);
}

// ============================================================================
// A2A <-> HUB TRANSLATION
// ============================================================================

interface HubAction {
  tool: string;
  action: string;
  params: Record<string, unknown>;
}

/**
 * Translate A2A operation to Hub MCP tool call
 */
export function a2aToHub(op: A2AOperation): HubAction | null {
  const key = `${op.domain}.${op.op}`;

  switch (key) {
    // Claims
    case 'C.🎯':
      return {
        tool: 'agent-status',
        action: 'claim',
        params: { what: op.params[0], description: op.params[1] }
      };
    case 'C.🔓':
      return {
        tool: 'agent-status',
        action: 'release',
        params: { what: op.params[0] }
      };
    case 'C.❓':
      return {
        tool: 'agent-status',
        action: 'check-claim',
        params: { what: op.params[0] }
      };

    // Tasks
    case 'T.📋':
      return {
        tool: 'task',
        action: 'create',
        params: {
          title: op.params[0],
          description: op.params[1],
          priority: op.params[2] || 'medium'
        }
      };
    case 'T.✅':
      return {
        tool: 'task',
        action: 'update-status',
        params: { taskId: op.params[0], status: 'done' }
      };

    // Status
    case 'S.⚡':
      return {
        tool: 'agent-status',
        action: 'update',
        params: {
          status: 'active',
          currentTask: op.params[1],
          workingOn: op.params[1]
        }
      };
    case 'S.💤':
      return {
        tool: 'agent-status',
        action: 'update',
        params: { status: 'idle' }
      };
    case 'S.⏳':
      return {
        tool: 'agent-status',
        action: 'update',
        params: { status: 'waiting' }
      };

    // Messages
    case 'M.📨':
      return {
        tool: 'message',
        action: 'send',
        params: { to: op.params[0], message: op.params[1] }
      };
    case 'M.📢':
      return {
        tool: 'group-chat',
        action: 'send',
        params: { message: op.params[0] }
      };
    case 'M.✓':
      return {
        tool: 'group-chat',
        action: 'send',
        params: { message: `✓ ${op.params[0] || 'ack'}` }
      };

    // Resources
    case 'R.🔒':
      return {
        tool: 'resource',
        action: 'lock',
        params: { resourcePath: op.params[0], reason: op.params[1] }
      };
    case 'R.🔓':
      return {
        tool: 'resource',
        action: 'unlock',
        params: { resourcePath: op.params[0] }
      };

    // Handoffs
    case 'H.📤':
      return {
        tool: 'handoff',
        action: 'create',
        params: {
          title: op.params[0],
          toAgent: op.params[1],
          context: op.params[2]
        }
      };
    case 'H.📥':
      return {
        tool: 'handoff',
        action: 'claim',
        params: { handoffId: op.params[0] }
      };

    default:
      return null;
  }
}

/**
 * Translate Hub action to A2A operation
 */
export function hubToA2A(tool: string, action: string, params: Record<string, unknown>): string {
  switch (`${tool}:${action}`) {
    case 'agent-status:claim':
      return encodeOperation('C', '🎯', [params.what as string, params.description as string || '']);
    case 'agent-status:release':
      return encodeOperation('C', '🔓', [params.what as string]);
    case 'agent-status:update':
      if (params.status === 'active') {
        return encodeOperation('S', '⚡', [100, params.currentTask as string || '']);
      } else if (params.status === 'idle') {
        return encodeOperation('S', '💤', []);
      }
      return encodeOperation('S', '⏳', []);
    case 'task:create':
      return encodeOperation('T', '📋', [
        params.title as string,
        params.description as string || '',
        params.priority as string || 'medium'
      ]);
    case 'group-chat:send':
      return encodeOperation('M', '📢', [params.message as string]);
    case 'resource:lock':
      return encodeOperation('R', '🔒', [params.resourcePath as string, params.reason as string || '']);
    case 'handoff:create':
      return encodeOperation('H', '📤', [
        params.title as string,
        params.toAgent as string || '*',
        params.context as string || ''
      ]);
    default:
      return `X.→("${tool}","${action}")`;
  }
}

// ============================================================================
// A2A BRIDGE - Execute operations via Hub
// ============================================================================

/**
 * Execute an A2A message by translating and calling Hub APIs
 */
export async function executeA2AMessage(
  message: A2AMessage,
  agentId: string
): Promise<{ success: boolean; result?: unknown; error?: string; a2aResponse?: string }> {
  try {
    if (message.layer === 1) {
      // Single atomic operation
      const op = parseOperation(message.payload);
      if (!op) {
        return { success: false, error: 'Invalid operation format', a2aResponse: 'E.❓("parse")' };
      }

      const hubAction = a2aToHub(op);
      if (!hubAction) {
        return { success: false, error: `Unknown operation: ${message.payload}`, a2aResponse: `E.❓("${op.domain}.${op.op}")` };
      }

      // Execute via Hub API
      const result = await executeHubAction(hubAction, agentId);
      return {
        success: true,
        result,
        a2aResponse: encodeA2AMessage(agentId, message.from, 1, 'M.✓')
      };

    } else if (message.layer === 2) {
      // Operation chain
      const chain = parseChain(message.payload);
      const results: unknown[] = [];

      for (let i = 0; i < chain.operations.length; i++) {
        const op = chain.operations[i];
        const hubAction = a2aToHub(op);

        if (!hubAction) {
          return {
            success: false,
            error: `Unknown operation at step ${i}: ${op.domain}.${op.op}`,
            a2aResponse: `E.❌(step=${i},"unknown op")`
          };
        }

        const result = await executeHubAction(hubAction, agentId);
        results.push(result);

        // Check for conditional branching
        if (chain.connectors[i] === '|') {
          // TODO: Implement conditional logic based on result
        }
      }

      return {
        success: true,
        result: results,
        a2aResponse: encodeA2AMessage(agentId, message.from, 1, `M.✓(${chain.operations.length})`)
      };
    }

    return { success: false, error: `Unsupported layer: ${message.layer}` };
  } catch (error) {
    return {
      success: false,
      error: String(error),
      a2aResponse: `E.❌("${String(error).slice(0, 20)}")`
    };
  }
}

/**
 * Execute a Hub action via API
 */
async function executeHubAction(action: HubAction, agentId: string): Promise<unknown> {
  const url = `${API_BASE}/api/${action.tool.replace('agent-status', 'agents').replace('-', '')}`;

  // Map to appropriate API endpoint
  const apiMap: Record<string, string> = {
    'agent-status': 'agents',
    'task': 'tasks',
    'group-chat': 'chat',
    'resource': 'resources',
    'handoff': 'handoffs',
    'message': 'messages',
  };

  const endpoint = apiMap[action.tool] || action.tool;

  const response = await fetch(`${API_BASE}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: action.action,
      agentId,
      ...action.params
    })
  });

  return response.json();
}

// ============================================================================
// MCP TOOL REGISTRATION
// ============================================================================

export function registerA2ATools(server: McpServer) {

  // ============================================================================
  // A2A SEND - Send messages in A2A protocol format
  // ============================================================================

  server.tool(
    'a2a-send',
    'Send a message using A2A protocol format (Ω{from|to|layer|payload}). Enables ultra-compact agent communication.',
    {
      message: z.string().describe('Raw A2A message (e.g., Ω{phil|@cd|1|S.⚡(85,"coding")})'),
      agentId: z.string().describe('Your agent ID for authentication')
    },
    async (args) => {
      const parsed = parseA2AMessage(args.message);

      if (!parsed) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'Invalid A2A format. Expected: Ω{from|to|layer|payload}',
              example: 'Ω{phil|@cd|1|S.⚡(85,"coding")}'
            })
          }]
        };
      }

      const result = await executeA2AMessage(parsed, args.agentId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result)
        }]
      };
    }
  );

  // ============================================================================
  // A2A PARSE - Parse and explain A2A messages (for debugging)
  // ============================================================================

  server.tool(
    'a2a-parse',
    'Parse and explain an A2A message without executing it. Useful for debugging and learning the protocol.',
    {
      message: z.string().describe('Raw A2A message to parse')
    },
    async (args) => {
      const parsed = parseA2AMessage(args.message);

      if (!parsed) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: 'Invalid A2A format' })
          }]
        };
      }

      let explanation: Record<string, unknown> = {
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
          const hubAction = a2aToHub(op);
          explanation.operation = {
            domain: A2A_DOMAINS[op.domain as keyof typeof A2A_DOMAINS] || op.domain,
            op: A2A_OPS[`${op.domain}.${op.op}` as keyof typeof A2A_OPS] || op.op,
            params: op.params,
            hubEquivalent: hubAction
          };
        }
      } else if (parsed.layer === 2) {
        const chain = parseChain(parsed.payload);
        explanation.chain = {
          steps: chain.operations.map((op, i) => ({
            domain: A2A_DOMAINS[op.domain as keyof typeof A2A_DOMAINS] || op.domain,
            op: A2A_OPS[`${op.domain}.${op.op}` as keyof typeof A2A_OPS] || op.op,
            params: op.params,
            connector: chain.connectors[i] || null,
            hubEquivalent: a2aToHub(op)
          }))
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(explanation, null, 2)
        }]
      };
    }
  );

  // ============================================================================
  // A2A ENCODE - Convert Hub actions to A2A format
  // ============================================================================

  server.tool(
    'a2a-encode',
    'Convert a Hub MCP action to A2A protocol format. Use this to translate your actions for contextOS agents.',
    {
      from: z.string().describe('Sender agent ID'),
      to: z.string().describe('Recipient agent ID or role (@cd for coordinator, * for broadcast)'),
      tool: z.string().describe('Hub tool name (e.g., agent-status, task, group-chat)'),
      action: z.string().describe('Action to perform (e.g., claim, create, send)'),
      params: z.record(z.unknown()).optional().describe('Parameters for the action')
    },
    async (args) => {
      const payload = hubToA2A(args.tool, args.action, args.params || {});
      const message = encodeA2AMessage(args.from, args.to, 1, payload);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            a2aMessage: message,
            decoded: {
              from: args.from,
              to: args.to,
              layer: 1,
              payload,
              hubAction: { tool: args.tool, action: args.action, params: args.params }
            }
          }, null, 2)
        }]
      };
    }
  );

  // ============================================================================
  // A2A NEGOTIATE - Protocol version negotiation with peer
  // ============================================================================

  server.tool(
    'a2a-negotiate',
    'Negotiate A2A protocol version and capabilities with a peer agent.',
    {
      agentId: z.string().describe('Your agent ID'),
      peerEndpoint: z.string().optional().describe('Peer MCP endpoint URL (if known)'),
      capabilities: z.array(z.string()).optional().describe('Your capabilities to advertise')
    },
    async (args) => {
      const ourVersion = 'v0.2';
      const ourCapabilities = args.capabilities || [
        'opchain',      // Layer 2 operation chains
        'emoji',        // Emoji-based op codes
        'hash',         // Hashed references
        'broadcast',    // Broadcast addressing
        'roles'         // Role-based addressing
      ];

      // Generate negotiation message
      const negotiationMsg = encodeA2AMessage(
        args.agentId,
        '*',
        0,
        `P.?(${ourVersion})|P.📋(${ourCapabilities.join(',')})`
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ourVersion,
            ourCapabilities,
            negotiationMessage: negotiationMsg,
            usage: 'Send this message to the peer to initiate protocol negotiation',
            expectedResponse: 'P.!(v0.2) to confirm version compatibility'
          }, null, 2)
        }]
      };
    }
  );

  // ============================================================================
  // A2A VOCABULARY - List available operations
  // ============================================================================

  server.tool(
    'a2a-vocab',
    'List available A2A domains and operations with their Hub equivalents.',
    {
      domain: z.string().optional().describe('Filter by domain (C, T, S, M, R, E, H, Q, P, X)')
    },
    async (args) => {
      const vocab: Record<string, { description: string; hubTool?: string; example: string }[]> = {
        C: [
          { description: 'Claim a task/resource', hubTool: 'agent-status claim', example: 'C.🎯("taskId","description")' },
          { description: 'Release a claim', hubTool: 'agent-status release', example: 'C.🔓("taskId")' },
          { description: 'Check claim status', hubTool: 'agent-status check-claim', example: 'C.❓("taskId")' },
          { description: 'Signal conflict', hubTool: 'error response', example: 'C.⚔("taskId","conflict reason")' },
        ],
        T: [
          { description: 'Create a task', hubTool: 'task create', example: 'T.📋("id","title","priority")' },
          { description: 'Update a task', hubTool: 'task update-status', example: 'T.✏("id","status")' },
          { description: 'Complete a task', hubTool: 'task update-status done', example: 'T.✅("id")' },
          { description: 'Cancel a task', hubTool: 'task update-status', example: 'T.❌("id")' },
        ],
        S: [
          { description: 'Status: active', hubTool: 'agent-status update', example: 'S.⚡(85,"working on X")' },
          { description: 'Status: idle', hubTool: 'agent-status update', example: 'S.💤' },
          { description: 'Status: waiting', hubTool: 'agent-status update', example: 'S.⏳' },
          { description: 'Status: working', hubTool: 'agent-status update', example: 'S.🔄("task")' },
        ],
        M: [
          { description: 'Send direct message', hubTool: 'message send', example: 'M.📨("recipient","content")' },
          { description: 'Broadcast message', hubTool: 'group-chat send', example: 'M.📢("content")' },
          { description: 'Acknowledge', hubTool: 'group-chat send', example: 'M.✓' },
          { description: 'Mention/query', hubTool: 'message send', example: 'M.@("agent","question")' },
        ],
        R: [
          { description: 'Lock resource', hubTool: 'resource lock', example: 'R.🔒("path","reason")' },
          { description: 'Unlock resource', hubTool: 'resource unlock', example: 'R.🔓("path")' },
          { description: 'Check resource', hubTool: 'resource check', example: 'R.❓("path")' },
        ],
        H: [
          { description: 'Create handoff', hubTool: 'handoff create', example: 'H.📤("title","toAgent","context")' },
          { description: 'Claim handoff', hubTool: 'handoff claim', example: 'H.📥("handoffId")' },
          { description: 'Complete handoff', hubTool: 'handoff complete', example: 'H.✅("handoffId")' },
        ],
        E: [
          { description: 'Unknown/clarify', example: 'E.❓("unknown symbol")' },
          { description: 'Conflict error', example: 'E.⚔("resource","reason")' },
          { description: 'Failure', example: 'E.❌("error message")' },
          { description: 'Warning', example: 'E.⚠("warning message")' },
        ],
        P: [
          { description: 'Query version', example: 'P.?(v0.2)' },
          { description: 'Confirm version', example: 'P.!(v0.2)' },
          { description: 'Capabilities', example: 'P.📋(opchain,emoji,hash)' },
        ],
      };

      const filtered = args.domain
        ? { [args.domain]: vocab[args.domain] || [] }
        : vocab;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            protocol: 'A2A v0.2',
            envelope: 'Ω{from|to|layer|payload}',
            layers: {
              0: 'Transport envelope',
              1: 'Atomic operations',
              2: 'Operation chains (→ sequence, | conditional, & parallel)',
              3: 'Reasoning frames'
            },
            vocabulary: filtered
          }, null, 2)
        }]
      };
    }
  );

  // ============================================================================
  // A2A BRIDGE - Connect to external A2A endpoint
  // ============================================================================

  server.tool(
    'a2a-bridge',
    'Send an A2A message to an external endpoint (contextOS or other A2A-compatible server).',
    {
      endpoint: z.string().describe('External A2A endpoint URL'),
      message: z.string().describe('A2A message to send'),
      agentId: z.string().describe('Your agent ID'),
      waitForResponse: z.boolean().optional().describe('Wait for response (default: true)')
    },
    async (args) => {
      try {
        const parsed = parseA2AMessage(args.message);
        if (!parsed) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ error: 'Invalid A2A format' })
            }]
          };
        }

        const response = await fetch(args.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-A2A-Version': 'v0.2',
            'X-A2A-From': args.agentId
          },
          body: JSON.stringify({
            protocol: 'A2A',
            version: 'v0.2',
            message: args.message,
            from: args.agentId,
            timestamp: new Date().toISOString()
          })
        });

        if (!response.ok) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: `Bridge failed: ${response.status} ${response.statusText}`,
                endpoint: args.endpoint
              })
            }]
          };
        }

        const result = await response.json();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              sent: true,
              message: args.message,
              endpoint: args.endpoint,
              response: result
            })
          }]
        };

      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: `Bridge error: ${String(error)}`,
              endpoint: args.endpoint
            })
          }]
        };
      }
    }
  );

  // ============================================================================
  // AGENT-STEER - Send steering commands to cloud agents via bridge
  // ============================================================================

  server.tool(
    'agent-steer',
    'Send steering commands to cloud agents. Cloud agents poll for these commands and execute them.',
    {
      from: z.string().describe('Your agent ID (sender)'),
      to: z.string().describe('Target cloud agent ID'),
      command: z.enum([
        'run-task',       // Execute a specific task
        'use-tool',       // Call an MCP tool
        'checkpoint',     // Save checkpoint
        'report-status',  // Request status report
        'poll-chat',      // Check group chat
        'terminate',      // Request graceful termination
        'custom'          // Custom command
      ]).describe('Command type'),
      payload: z.record(z.unknown()).optional().describe('Command payload/parameters'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe('Command priority (default: normal)')
    },
    async (args) => {
      try {
        const response = await fetch(`${API_BASE}/api/agent-bridge?action=steer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: args.from,
            to: args.to,
            command: args.command,
            payload: args.payload || {},
            priority: args.priority || 'normal'
          })
        });

        const result = await response.json();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: String(error) })
          }]
        };
      }
    }
  );

  // ============================================================================
  // AGENT-BRIDGE-STATUS - Check bridge and cloud agent status
  // ============================================================================

  server.tool(
    'agent-bridge-status',
    'Check status of the agent bridge and connected cloud agents.',
    {
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      try {
        const response = await fetch(`${API_BASE}/api/agent-bridge?action=status`);
        const result = await response.json();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: String(error) })
          }]
        };
      }
    }
  );
}
