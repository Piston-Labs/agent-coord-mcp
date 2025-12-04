/**
 * Agent Coordination Durable Objects - Main Entry Point
 *
 * This Worker acts as the router for all agent coordination requests,
 * routing to the appropriate Durable Object based on the request type.
 *
 * Architecture:
 * - /coordinator/* -> AgentCoordinator (singleton control plane)
 * - /agent/:agentId/* -> AgentState (one per agent)
 * - /lock/:resourcePath/* -> ResourceLock (one per resource)
 *
 * All DOs use SQLite for persistence (up to 10GB per instance)
 */

import type { Env } from './types';

// Export Durable Object classes
export { AgentCoordinator } from './agent-coordinator';
export { AgentState } from './agent-state';
export { ResourceLock } from './resource-lock';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for web dashboard
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Agent-Id, X-Resource-Path'
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      let response: Response;

      // Route to appropriate Durable Object
      if (path.startsWith('/coordinator')) {
        response = await routeToCoordinator(request, env, path.replace('/coordinator', '') || '/');
      } else if (path.startsWith('/agent/')) {
        response = await routeToAgentState(request, env, path);
      } else if (path.startsWith('/lock/')) {
        response = await routeToResourceLock(request, env, path);
      } else if (path === '/health') {
        response = Response.json({
          status: 'ok',
          service: 'agent-coord-do',
          timestamp: new Date().toISOString(),
          durableObjects: ['AgentCoordinator', 'AgentState', 'ResourceLock']
        });
      } else if (path === '/' || path === '') {
        response = Response.json({
          name: 'Agent Coordination Durable Objects',
          version: '0.2.0',
          endpoints: {
            '/coordinator/agents': 'Agent registry - GET/POST',
            '/coordinator/chat': 'Group chat - GET/POST',
            '/coordinator/tasks': 'Task management - GET/POST',
            '/coordinator/zones': 'Zone claiming - GET/POST (claim, release)',
            '/coordinator/claims': 'Work claims - GET/POST (claim, release)',
            '/coordinator/handoffs': 'Work handoffs - GET/POST (create, claim, complete)',
            '/coordinator/work': 'Hot-start bundle - GET',
            '/coordinator/onboard': 'Agent onboarding bundle - GET (soul, dashboard, team, suggested task)',
            '/coordinator/session-resume': 'CEO Portal session resume - GET (participants, accomplishments, pending work, quick actions)',
            '/agent/:agentId/*': 'Per-agent state - checkpoint, messages, memory, trace',
            '/agent/:agentId/trace': 'Work traces - GET (list), POST (start)',
            '/agent/:agentId/trace/:sessionId': 'Trace session - GET full trace',
            '/agent/:agentId/trace/:sessionId/step': 'Log work step - POST',
            '/agent/:agentId/trace/:sessionId/complete': 'Complete trace - POST',
            '/agent/:agentId/trace/:sessionId/resolve-escalation': 'Resolve escalation - POST',
            '/agent/:agentId/trace/:sessionId/escalations': 'Get trace escalations - GET',
            '/agent/:agentId/soul': 'Soul progression - GET/POST/PATCH',
            '/agent/:agentId/dashboard': 'Agent self-dashboard - GET (aggregated view)',
            '/lock/:resourcePath/*': 'Resource locking - check, lock, unlock',
            '/health': 'Health check'
          },
          docs: 'https://github.com/piston-labs/agent-coord-mcp/tree/main/cloudflare-do'
        });
      } else {
        response = Response.json({ error: 'Not found', path }, { status: 404 });
      }

      // Add CORS headers to response
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });

    } catch (error) {
      return Response.json({
        error: 'Internal server error',
        message: String(error)
      }, {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};

/**
 * Route to the singleton AgentCoordinator DO
 */
async function routeToCoordinator(request: Request, env: Env, subPath: string): Promise<Response> {
  // Use a fixed name for the singleton coordinator
  const id = env.COORDINATOR.idFromName('main');
  const stub = env.COORDINATOR.get(id);

  // Rewrite URL for the DO
  const url = new URL(request.url);
  url.pathname = subPath;

  return stub.fetch(new Request(url.toString(), request));
}

/**
 * Route to per-agent AgentState DO
 */
async function routeToAgentState(request: Request, env: Env, path: string): Promise<Response> {
  // Extract agent ID from path: /agent/:agentId/...
  const match = path.match(/^\/agent\/([^/]+)(\/.*)?$/);
  if (!match) {
    return Response.json({ error: 'Invalid agent path' }, { status: 400 });
  }

  const agentId = decodeURIComponent(match[1]);
  const subPath = match[2] || '/state';

  // Each agent gets their own DO instance
  const id = env.AGENT_STATE.idFromName(agentId);
  const stub = env.AGENT_STATE.get(id);

  // Rewrite URL and add agent ID
  const url = new URL(request.url);
  url.pathname = subPath;
  url.searchParams.set('agentId', agentId);

  return stub.fetch(new Request(url.toString(), request));
}

/**
 * Route to per-resource ResourceLock DO
 */
async function routeToResourceLock(request: Request, env: Env, path: string): Promise<Response> {
  // Extract resource path from path: /lock/:resourcePath/...
  // Resource path is URL-encoded
  const match = path.match(/^\/lock\/([^/]+)(\/.*)?$/);
  if (!match) {
    return Response.json({ error: 'Invalid lock path' }, { status: 400 });
  }

  const resourcePath = decodeURIComponent(match[1]);
  const subPath = match[2] || '/check';

  // Each resource gets its own DO instance
  const id = env.RESOURCE_LOCK.idFromName(resourcePath);
  const stub = env.RESOURCE_LOCK.get(id);

  // Rewrite URL and add resource path
  const url = new URL(request.url);
  url.pathname = subPath;
  url.searchParams.set('resourcePath', resourcePath);

  return stub.fetch(new Request(url.toString(), request));
}
