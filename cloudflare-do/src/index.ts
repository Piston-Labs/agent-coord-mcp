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
export { VMPool } from './vm-pool';
export { GitTree } from './git-tree';

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
      } else if (path.startsWith('/vmpool')) {
        response = await routeToVMPool(request, env, path.replace('/vmpool', '') || '/');
      } else if (path.startsWith('/gittree/')) {
        response = await routeToGitTree(request, env, path);
      } else if (path === '/dashboard' || path === '/dashboard/gittree') {
        response = serveGitTreeDashboard();
      } else if (path === '/health') {
        response = Response.json({
          status: 'ok',
          service: 'agent-coord-do',
          timestamp: new Date().toISOString(),
          durableObjects: ['AgentCoordinator', 'AgentState', 'ResourceLock', 'VMPool', 'GitTree']
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
            '/agent/:agentId/credentials': 'Soul credentials - GET (list/get/bundle), POST (set), DELETE',
            '/agent/:agentId/dashboard': 'Agent self-dashboard - GET (aggregated view)',
            '/lock/:resourcePath/*': 'Resource locking - check, lock, unlock',
            '/vmpool/status': 'VM pool status - GET',
            '/vmpool/vms': 'List all VMs - GET',
            '/vmpool/spawn': 'Assign agent to VM - POST',
            '/vmpool/provision': 'Register new VM - POST',
            '/vmpool/terminate': 'Terminate VM - POST',
            '/vmpool/release': 'Release agent from VM - POST',
            '/vmpool/scale': 'Scale recommendations - POST',
            '/vmpool/vm/:vmId': 'VM details - GET',
            '/vmpool/vm/:vmId/ready': 'Mark VM ready - POST',
            '/vmpool/vm/:vmId/agents': 'VM agent list - GET',
            '/vmpool/vm/:vmId/health': 'VM health history - GET',
            '/gittree/:repoId/status': 'Git tree status - GET',
            '/gittree/:repoId/tree': 'List/cache tree - GET (list), POST (cache)',
            '/gittree/:repoId/file': 'Get file info - GET',
            '/gittree/:repoId/commits': 'List/track commits - GET (list), POST (track)',
            '/gittree/:repoId/branches': 'List branches - GET',
            '/gittree/:repoId/compare': 'Compare branches - GET',
            '/gittree/:repoId/search': 'Search files - GET',
            '/gittree/:repoId/webhook': 'Webhook updates - POST',
            '/health': 'Health check'
          },
          docs: 'https://github.com/piston-labs/agent-coord-mcp/tree/main/cloudflare-do'
        });
      } else {
        response = Response.json({ error: 'Not found', path }, { status: 404 });
      }

      // WebSocket responses must be returned directly (status 101 can't be re-wrapped)
      if (response.webSocket) {
        return response;
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

/**
 * Route to the singleton VMPool DO
 */
async function routeToVMPool(request: Request, env: Env, subPath: string): Promise<Response> {
  // Use a fixed name for the singleton VM pool
  const id = env.VM_POOL.idFromName('main');
  const stub = env.VM_POOL.get(id);

  // Rewrite URL for the DO
  const url = new URL(request.url);
  url.pathname = subPath;

  return stub.fetch(new Request(url.toString(), request));
}

/**
 * Route to per-repo GitTree DO
 */
async function routeToGitTree(request: Request, env: Env, path: string): Promise<Response> {
  // Extract repo ID from path: /gittree/:repoId/...
  const match = path.match(/^\/gittree\/([^/]+)(\/.*)?$/);
  if (!match) {
    return Response.json({ error: 'Invalid gittree path' }, { status: 400 });
  }

  const repoId = decodeURIComponent(match[1]);
  const subPath = match[2] || '/status';

  // Each repo gets its own DO instance
  const id = env.GIT_TREE.idFromName(repoId);
  const stub = env.GIT_TREE.get(id);

  // Rewrite URL and add repo ID
  const url = new URL(request.url);
  url.pathname = subPath;
  url.searchParams.set('repoId', repoId);

  return stub.fetch(new Request(url.toString(), request));
}

/**
 * Serve GitTree Dashboard HTML - Multi-Repo Version
 */
function serveGitTreeDashboard(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitTree Multi-Repo Dashboard</title>
  <style>
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --border-color: #30363d;
      --text-primary: #c9d1d9;
      --text-secondary: #8b949e;
      --text-muted: #6e7681;
      --accent-green: #3fb950;
      --accent-blue: #58a6ff;
      --accent-purple: #a371f7;
      --accent-red: #f85149;
      --accent-orange: #d29922;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      padding: 20px;
    }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border-color); }
    .header h1 { font-size: 20px; }
    .presets { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
    .preset { background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; padding: 8px 14px; font-size: 13px; cursor: pointer; color: var(--text-primary); transition: all 0.2s; }
    .preset:hover { border-color: var(--accent-blue); }
    .preset.connected { border-color: var(--accent-green); background: rgba(63,185,80,0.15); }
    .preset .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; background: var(--text-muted); }
    .preset.connected .dot { background: var(--accent-green); box-shadow: 0 0 6px var(--accent-green); }
    .repo-input { display: flex; gap: 10px; margin-bottom: 20px; }
    .repo-input input { flex: 1; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px 14px; color: var(--text-primary); font-size: 14px; }
    .repo-input input:focus { outline: none; border-color: var(--accent-blue); }
    .repo-input button { background: var(--accent-green); color: #fff; border: none; border-radius: 6px; padding: 10px 16px; font-weight: 600; cursor: pointer; }
    .repo-input button:hover { opacity: 0.9; }
    .repo-input button.disconnect { background: var(--accent-red); }
    .connections { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
    .conn-badge { display: flex; align-items: center; gap: 6px; background: var(--bg-secondary); border: 1px solid var(--accent-green); border-radius: 20px; padding: 6px 12px; font-size: 12px; }
    .conn-badge .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent-green); box-shadow: 0 0 6px var(--accent-green); }
    .conn-badge .close { cursor: pointer; margin-left: 4px; opacity: 0.7; }
    .conn-badge .close:hover { opacity: 1; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
    @media (max-width: 600px) { .stats { grid-template-columns: 1fr; } }
    .stat { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; color: var(--accent-blue); }
    .stat-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; margin-top: 4px; }
    .panel { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; }
    .panel-header { padding: 12px 16px; border-bottom: 1px solid var(--border-color); font-weight: 600; font-size: 14px; background: var(--bg-tertiary); }
    .panel-content { padding: 16px; }
    .feed { max-height: 500px; overflow-y: auto; }
    .event { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-color); animation: fadeIn 0.3s; }
    .event:last-child { border-bottom: none; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    .event-icon { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
    .event-content { flex: 1; min-width: 0; }
    .event-title { font-size: 13px; }
    .event-repo { font-size: 11px; color: var(--accent-purple); margin-bottom: 2px; }
    .event-time { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
    code { background: var(--bg-tertiary); padding: 2px 6px; border-radius: 4px; font-size: 12px; }
    .empty { text-align: center; padding: 40px; color: var(--text-muted); }
    .repo-mcp { --repo-color: var(--accent-blue); }
    .repo-cf { --repo-color: var(--accent-orange); }
    .repo-other { --repo-color: var(--accent-purple); }
  </style>
</head>
<body>
  <div class="header">
    <h1>🌳 GitTree Multi-Repo Dashboard</h1>
    <div id="connCount" style="font-size:14px;color:var(--text-muted);">0 connected</div>
  </div>

  <div class="presets">
    <button class="preset" data-repo="Piston-Labs--agent-coord-mcp" onclick="toggleRepo(this)">
      <span class="dot"></span>agent-coord-mcp
    </button>
    <button class="preset" data-repo="Piston-Labs--agent-coord-cloudflare" onclick="toggleRepo(this)">
      <span class="dot"></span>agent-coord-cloudflare
    </button>
  </div>

  <div class="repo-input">
    <input type="text" id="customRepo" placeholder="owner--repo (e.g., anthropics--claude-code)">
    <button onclick="addCustomRepo()">+ Add Repo</button>
  </div>

  <div class="connections" id="connections"></div>

  <div class="stats">
    <div class="stat"><div class="stat-value" id="totalRepos">0</div><div class="stat-label">Connected Repos</div></div>
    <div class="stat"><div class="stat-value" id="totalFiles">0</div><div class="stat-label">Total Files Cached</div></div>
    <div class="stat"><div class="stat-value" id="totalEvents">0</div><div class="stat-label">Events Today</div></div>
  </div>

  <div class="panel">
    <div class="panel-header">Live Activity Feed (All Repos)</div>
    <div class="panel-content">
      <div class="feed" id="feed"><div class="empty">Click a repo above to connect and see live events</div></div>
    </div>
  </div>

  <script>
    const repos = new Map(); // repoId -> { ws, stats, color }
    const colors = ['var(--accent-blue)', 'var(--accent-orange)', 'var(--accent-purple)', 'var(--accent-green)'];
    let colorIdx = 0;
    let eventCount = 0;
    const icons = { 'tree:cached': '📦', 'tree:hit': '✅', 'tree:miss': '🔄', 'commit:tracked': '📝', 'webhook:push': '🚀', 'search:query': '🔍', 'file:access': '📄', 'viewer:join': '👋', 'viewer:leave': '👋', 'connected': '🔗' };

    function toggleRepo(btn) {
      const repoId = btn.dataset.repo;
      if (repos.has(repoId)) {
        disconnectRepo(repoId);
        btn.classList.remove('connected');
      } else {
        connectRepo(repoId);
        btn.classList.add('connected');
      }
    }

    function addCustomRepo() {
      const input = document.getElementById('customRepo');
      const repoId = input.value.trim();
      if (repoId && !repos.has(repoId)) {
        connectRepo(repoId);
        input.value = '';
      }
    }

    function connectRepo(repoId) {
      if (repos.has(repoId)) return;
      const color = colors[colorIdx++ % colors.length];
      const ws = new WebSocket('wss://' + location.host + '/gittree/' + encodeURIComponent(repoId) + '/ws');

      ws.onopen = () => {
        repos.set(repoId, { ws, stats: {}, color });
        updateUI();
        addEvent({ type: 'connected', repoId, timestamp: new Date().toISOString() });
        ws.send(JSON.stringify({ type: 'get-stats' }));
      };

      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          d.repoId = repoId;
          if (d.stats) repos.get(repoId).stats = d.stats;
          addEvent(d);
          updateUI();
        } catch {}
      };

      ws.onclose = () => {
        repos.delete(repoId);
        updateUI();
        document.querySelectorAll('.preset').forEach(p => {
          if (p.dataset.repo === repoId) p.classList.remove('connected');
        });
      };

      ws.onerror = () => ws.close();
    }

    function disconnectRepo(repoId) {
      const r = repos.get(repoId);
      if (r) { r.ws.close(); repos.delete(repoId); updateUI(); }
    }

    function updateUI() {
      // Connection badges
      const conns = document.getElementById('connections');
      conns.innerHTML = Array.from(repos.entries()).map(([id, r]) =>
        '<div class="conn-badge" style="border-color:' + r.color + '"><span class="dot" style="background:' + r.color + ';box-shadow:0 0 6px ' + r.color + '"></span>' + id.split('--')[1] + '<span class="close" onclick="disconnectRepo(\\'' + id + '\\')">&times;</span></div>'
      ).join('');

      // Stats
      document.getElementById('connCount').textContent = repos.size + ' connected';
      document.getElementById('totalRepos').textContent = repos.size;
      let totalFiles = 0;
      repos.forEach(r => totalFiles += (r.stats.cachedFiles || 0));
      document.getElementById('totalFiles').textContent = totalFiles;
      document.getElementById('totalEvents').textContent = eventCount;
    }

    function addEvent(d) {
      eventCount++;
      const feed = document.getElementById('feed');
      if (feed.querySelector('.empty')) feed.innerHTML = '';

      const r = repos.get(d.repoId);
      const color = r ? r.color : 'var(--text-muted)';
      const repoName = d.repoId ? d.repoId.split('--')[1] : 'unknown';

      let desc = d.type;
      const data = d.data || d;
      if (d.type === 'tree:cached') desc = 'Cached <code>' + (data.branch||'master') + '</code> (' + (data.fileCount||0) + ' files)';
      else if (d.type === 'tree:hit') desc = 'Cache hit <code>' + (data.branch||'') + '</code>';
      else if (d.type === 'tree:miss') desc = 'Cache miss';
      else if (d.type === 'search:query') desc = 'Search: <code>' + (data.query||'') + '</code>';
      else if (d.type === 'file:access') desc = 'File: <code>' + (data.path||'') + '</code>';
      else if (d.type === 'connected') desc = 'Connected to ' + repoName;

      const time = new Date(d.timestamp || Date.now()).toLocaleTimeString();
      const el = document.createElement('div');
      el.className = 'event';
      el.innerHTML = '<div class="event-icon" style="background:' + color + '22">' + (icons[d.type] || '📌') + '</div><div class="event-content"><div class="event-repo" style="color:' + color + '">' + repoName + '</div><div class="event-title">' + desc + '</div></div><div class="event-time">' + time + '</div>';
      feed.insertBefore(el, feed.firstChild);
      if (feed.children.length > 50) feed.removeChild(feed.lastChild);
      updateUI();
    }

    // Keepalive
    setInterval(() => repos.forEach(r => { if (r.ws.readyState === 1) r.ws.send(JSON.stringify({ type: 'ping' })); }), 30000);

    // Auto-connect from URL
    const p = new URLSearchParams(location.search).get('repo');
    if (p) setTimeout(() => connectRepo(p), 300);
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
