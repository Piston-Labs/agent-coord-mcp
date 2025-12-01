#!/usr/bin/env python3
"""
Fix MCP tools to use HTTP API calls instead of in-memory store.
This ensures data persists to Redis and is visible in the dashboard.
"""

with open('src/index.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Add API_BASE constant at the top after imports
old_imports = '''const server = new McpServer({
  name: 'agent-coord-mcp',
  version: '0.1.0'
});'''

new_imports = '''const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

const server = new McpServer({
  name: 'agent-coord-mcp',
  version: '0.1.0'
});'''

if old_imports in content:
    content = content.replace(old_imports, new_imports)
    print('Added API_BASE constant')

# Fix the claim action to use HTTP
old_claim = '''      case 'claim': {
        if (!agentId || !args.what) return { content: [{ type: 'text', text: 'agentId and what required' }] };
        const existing = store.checkClaim(args.what);
        if (existing && existing.by !== agentId && !existing.stale) {
          return { content: [{ type: 'text', text: JSON.stringify({ claimed: false, by: existing.by, since: existing.since }) }] };
        }
        const claim = store.claim(args.what, agentId, args.description);
        return { content: [{ type: 'text', text: JSON.stringify({ claimed: true, what: claim.what, by: claim.by }) }] };
      }'''

new_claim = '''      case 'claim': {
        if (!agentId || !args.what) return { content: [{ type: 'text', text: 'agentId and what required' }] };
        try {
          const res = await fetch(`${API_BASE}/api/claims`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ what: args.what, by: agentId, description: args.description })
          });
          const data = await res.json();
          if (res.status === 409) {
            return { content: [{ type: 'text', text: JSON.stringify({ claimed: false, by: data.claimedBy, message: data.message }) }] };
          }
          return { content: [{ type: 'text', text: JSON.stringify({ claimed: true, what: args.what, by: agentId }) }] };
        } catch (err) {
          // Fallback to local store
          const existing = store.checkClaim(args.what);
          if (existing && existing.by !== agentId && !existing.stale) {
            return { content: [{ type: 'text', text: JSON.stringify({ claimed: false, by: existing.by, since: existing.since }) }] };
          }
          const claim = store.claim(args.what, agentId, args.description);
          return { content: [{ type: 'text', text: JSON.stringify({ claimed: true, what: claim.what, by: claim.by }) }] };
        }
      }'''

if old_claim in content:
    content = content.replace(old_claim, new_claim)
    print('Fixed claim action to use HTTP API')

# Fix list-claims to use HTTP
old_list_claims = '''      case 'list-claims': {
        const claims = store.listClaims(args.includeStale);
        return { content: [{ type: 'text', text: JSON.stringify({ claims, count: claims.length }) }] };
      }'''

new_list_claims = '''      case 'list-claims': {
        try {
          const res = await fetch(`${API_BASE}/api/claims`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (err) {
          const claims = store.listClaims(args.includeStale);
          return { content: [{ type: 'text', text: JSON.stringify({ claims, count: claims.length }) }] };
        }
      }'''

if old_list_claims in content:
    content = content.replace(old_list_claims, new_list_claims)
    print('Fixed list-claims to use HTTP API')

# Fix release claim to use HTTP
old_release = '''      case 'release': {
        if (!agentId || !args.what) return { content: [{ type: 'text', text: 'agentId and what required' }] };
        const released = store.releaseClaim(args.what, agentId);
        return { content: [{ type: 'text', text: JSON.stringify({ released, what: args.what, by: agentId }) }] };
      }'''

new_release = '''      case 'release': {
        if (!agentId || !args.what) return { content: [{ type: 'text', text: 'agentId and what required' }] };
        try {
          const res = await fetch(`${API_BASE}/api/claims?what=${encodeURIComponent(args.what)}&by=${encodeURIComponent(agentId)}`, {
            method: 'DELETE'
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify({ released: true, what: args.what, by: agentId }) }] };
        } catch (err) {
          const released = store.releaseClaim(args.what, agentId);
          return { content: [{ type: 'text', text: JSON.stringify({ released, what: args.what, by: agentId }) }] };
        }
      }'''

if old_release in content:
    content = content.replace(old_release, new_release)
    print('Fixed release action to use HTTP API')

# Fix resource lock to use HTTP
old_lock = '''      case 'lock': {
        const result = store.acquireLock(
          resourcePath,
          agentId,
          args.resourceType || 'file-lock',
          args.reason
        );
        if ('error' in result) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, lock: result }) }] };
      }'''

new_lock = '''      case 'lock': {
        try {
          const res = await fetch(`${API_BASE}/api/locks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resourcePath, lockedBy: agentId, reason: args.reason })
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, lock: data.lock }) }] };
        } catch (err) {
          const result = store.acquireLock(
            resourcePath,
            agentId,
            args.resourceType || 'file-lock',
            args.reason
          );
          if ('error' in result) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error }) }] };
          }
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, lock: result }) }] };
        }
      }'''

if old_lock in content:
    content = content.replace(old_lock, new_lock)
    print('Fixed lock action to use HTTP API')

# Fix resource unlock to use HTTP
old_unlock = '''      case 'unlock': {
        const released = store.releaseLock(resourcePath, agentId);
        return { content: [{ type: 'text', text: JSON.stringify({ released, resourcePath }) }] };
      }'''

new_unlock = '''      case 'unlock': {
        try {
          const res = await fetch(`${API_BASE}/api/locks?resourcePath=${encodeURIComponent(resourcePath)}`, {
            method: 'DELETE'
          });
          return { content: [{ type: 'text', text: JSON.stringify({ released: true, resourcePath }) }] };
        } catch (err) {
          const released = store.releaseLock(resourcePath, agentId);
          return { content: [{ type: 'text', text: JSON.stringify({ released, resourcePath }) }] };
        }
      }'''

if old_unlock in content:
    content = content.replace(old_unlock, new_unlock)
    print('Fixed unlock action to use HTTP API')

# Fix zone claim to use HTTP
old_zone_claim = '''      case 'claim': {
        if (!args.zoneId || !args.path || !args.owner) {
          return { content: [{ type: 'text', text: 'zoneId, path, and owner required' }] };
        }
        const result = store.claimZone(args.zoneId, args.path, args.owner, args.description);
        if ('error' in result) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, zone: result }) }] };
      }'''

new_zone_claim = '''      case 'claim': {
        if (!args.zoneId || !args.path || !args.owner) {
          return { content: [{ type: 'text', text: 'zoneId, path, and owner required' }] };
        }
        try {
          const res = await fetch(`${API_BASE}/api/zones`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zoneId: args.zoneId, path: args.path, owner: args.owner, description: args.description })
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, zone: data.zone }) }] };
        } catch (err) {
          const result = store.claimZone(args.zoneId, args.path, args.owner, args.description);
          if ('error' in result) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error }) }] };
          }
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, zone: result }) }] };
        }
      }'''

if old_zone_claim in content:
    content = content.replace(old_zone_claim, new_zone_claim)
    print('Fixed zone claim to use HTTP API')

# Fix zone list to use HTTP
old_zone_list = '''      case 'list': {
        const zones = store.listZones();
        return { content: [{ type: 'text', text: JSON.stringify({ zones, count: zones.length }) }] };
      }'''

new_zone_list = '''      case 'list': {
        try {
          const res = await fetch(`${API_BASE}/api/zones`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (err) {
          const zones = store.listZones();
          return { content: [{ type: 'text', text: JSON.stringify({ zones, count: zones.length }) }] };
        }
      }'''

if old_zone_list in content:
    content = content.replace(old_zone_list, new_zone_list)
    print('Fixed zone list to use HTTP API')

# Fix task create to use HTTP
old_task_create = '''      case 'create': {
        if (!args.title || !args.createdBy) {
          return { content: [{ type: 'text', text: 'title and createdBy required' }] };
        }
        const task = store.createTask({
          title: args.title,
          description: args.description,
          priority: args.priority || 'medium',
          status: 'todo',
          createdBy: args.createdBy,
          assignee: args.assignee,
          tags: args.tags || []
        });
        return { content: [{ type: 'text', text: JSON.stringify({ created: true, task }) }] };
      }'''

new_task_create = '''      case 'create': {
        if (!args.title || !args.createdBy) {
          return { content: [{ type: 'text', text: 'title and createdBy required' }] };
        }
        try {
          const res = await fetch(`${API_BASE}/api/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: args.title,
              description: args.description,
              priority: args.priority || 'medium',
              status: 'todo',
              createdBy: args.createdBy,
              assignee: args.assignee,
              tags: args.tags || []
            })
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify({ created: true, task: data.task }) }] };
        } catch (err) {
          const task = store.createTask({
            title: args.title,
            description: args.description,
            priority: args.priority || 'medium',
            status: 'todo',
            createdBy: args.createdBy,
            assignee: args.assignee,
            tags: args.tags || []
          });
          return { content: [{ type: 'text', text: JSON.stringify({ created: true, task }) }] };
        }
      }'''

if old_task_create in content:
    content = content.replace(old_task_create, new_task_create)
    print('Fixed task create to use HTTP API')

# Fix task list to use HTTP
old_task_list = '''      case 'list': {
        const tasks = store.listTasks(args.status);
        return { content: [{ type: 'text', text: JSON.stringify({ tasks, count: tasks.length }) }] };
      }'''

new_task_list = '''      case 'list': {
        try {
          const url = args.status ? `${API_BASE}/api/tasks?status=${args.status}` : `${API_BASE}/api/tasks`;
          const res = await fetch(url);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (err) {
          const tasks = store.listTasks(args.status);
          return { content: [{ type: 'text', text: JSON.stringify({ tasks, count: tasks.length }) }] };
        }
      }'''

if old_task_list in content:
    content = content.replace(old_task_list, new_task_list)
    print('Fixed task list to use HTTP API')

with open('src/index.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('\nDone! MCP tools now use HTTP API calls which persist to Redis.')
print('Rebuild with: npm run build')
