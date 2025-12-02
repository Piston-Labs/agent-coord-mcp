/**
 * Resource Tools - Locks, tasks, and zones
 *
 * Tools: resource, task, zone
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { unifiedStore as store } from '../unified-store.js';

const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

export function registerResourceTools(server: McpServer) {
  // ============================================================================
  // RESOURCE LOCKING TOOL
  // ============================================================================

  server.tool(
    'resource',
    'Lock resources to prevent conflicts. Check before editing, lock for exclusive access.',
    {
      action: z.enum(['check', 'lock', 'unlock']).describe('Operation'),
      resourcePath: z.string().describe('Path or identifier to lock'),
      agentId: z.string().describe('Your agent ID'),
      resourceType: z.enum(['repo-path', 'branch', 'file-lock', 'custom']).optional(),
      reason: z.string().optional().describe('Why you need this lock')
    },
    async (args) => {
      const { action, resourcePath, agentId } = args;

      switch (action) {
        case 'check': {
          try {
            const res = await fetch(`${API_BASE}/api/locks`);
            const data = await res.json();
            const lock = data.locks?.find((l: any) => l.resourcePath === resourcePath);
            if (!lock) {
              return { content: [{ type: 'text', text: JSON.stringify({ available: true, locked: false, resourcePath }) }] };
            }
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  available: lock.lockedBy === agentId,
                  locked: true,
                  lockedBy: lock.lockedBy,
                  reason: lock.reason,
                  lockedAt: lock.lockedAt
                })
              }]
            };
          } catch (err) {
            const lock = store.checkLock(resourcePath);
            if (!lock) {
              return { content: [{ type: 'text', text: JSON.stringify({ available: true, locked: false, resourcePath }) }] };
            }
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  available: lock.lockedBy === agentId,
                  locked: true,
                  lockedBy: lock.lockedBy,
                  reason: lock.reason,
                  lockedAt: lock.lockedAt
                })
              }]
            };
          }
        }

        case 'lock': {
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
        }

        case 'unlock': {
          try {
            const res = await fetch(`${API_BASE}/api/locks?resourcePath=${encodeURIComponent(resourcePath)}`, {
              method: 'DELETE'
            });
            return { content: [{ type: 'text', text: JSON.stringify({ released: true, resourcePath }) }] };
          } catch (err) {
            const released = store.releaseLock(resourcePath, agentId);
            return { content: [{ type: 'text', text: JSON.stringify({ released, resourcePath }) }] };
          }
        }

        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
      }
    }
  );

  // ============================================================================
  // TASK MANAGEMENT TOOL
  // ============================================================================

  server.tool(
    'task',
    'Create and manage tasks for coordination.',
    {
      action: z.enum(['create', 'get', 'list', 'update-status', 'assign']).describe('Operation'),
      taskId: z.string().optional().describe('Task ID (for get/update/assign)'),
      title: z.string().optional().describe('Task title (for create)'),
      description: z.string().optional().describe('Task description (for create)'),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      status: z.enum(['todo', 'in-progress', 'done', 'blocked']).optional(),
      assignee: z.string().optional(),
      createdBy: z.string().optional(),
      tags: z.array(z.string()).optional()
    },
    async (args) => {
      const { action } = args;

      switch (action) {
        case 'create': {
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
        }

        case 'get': {
          if (!args.taskId) return { content: [{ type: 'text', text: 'taskId required' }] };
          try {
            const res = await fetch(`${API_BASE}/api/tasks?taskId=${encodeURIComponent(args.taskId)}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data.task || { error: 'not found' }) }] };
          } catch (err) {
            const task = store.getTask(args.taskId);
            return { content: [{ type: 'text', text: JSON.stringify(task || { error: 'not found' }) }] };
          }
        }

        case 'list': {
          try {
            const url = args.status ? `${API_BASE}/api/tasks?status=${args.status}` : `${API_BASE}/api/tasks`;
            const res = await fetch(url);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          } catch (err) {
            const tasks = store.listTasks(args.status);
            return { content: [{ type: 'text', text: JSON.stringify({ tasks, count: tasks.length }) }] };
          }
        }

        case 'update-status': {
          if (!args.taskId || !args.status) {
            return { content: [{ type: 'text', text: 'taskId and status required' }] };
          }
          try {
            const res = await fetch(`${API_BASE}/api/tasks`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: args.taskId, status: args.status })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify({ updated: true, task: data.task }) }] };
          } catch (err) {
            const task = store.updateTaskStatus(args.taskId, args.status);
            return { content: [{ type: 'text', text: JSON.stringify(task ? { updated: true, task } : { error: 'not found' }) }] };
          }
        }

        case 'assign': {
          if (!args.taskId || !args.assignee) {
            return { content: [{ type: 'text', text: 'taskId and assignee required' }] };
          }
          try {
            const res = await fetch(`${API_BASE}/api/tasks`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: args.taskId, assignee: args.assignee })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify({ assigned: true, task: data.task }) }] };
          } catch (err) {
            const task = store.assignTask(args.taskId, args.assignee);
            return { content: [{ type: 'text', text: JSON.stringify(task ? { assigned: true, task } : { error: 'not found' }) }] };
          }
        }

        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
      }
    }
  );

  // ============================================================================
  // ZONE CLAIMING TOOL
  // ============================================================================

  server.tool(
    'zone',
    'Claim ownership of directories/modules to divide work.',
    {
      action: z.enum(['claim', 'release', 'check', 'list', 'my-zones']).describe('Operation'),
      zoneId: z.string().optional().describe('Zone name (e.g., frontend, backend)'),
      path: z.string().optional().describe('Directory path this zone covers'),
      owner: z.string().optional().describe('Your agent ID'),
      description: z.string().optional()
    },
    async (args) => {
      const { action } = args;

      switch (action) {
        case 'claim': {
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
        }

        case 'release': {
          if (!args.zoneId || !args.owner) {
            return { content: [{ type: 'text', text: 'zoneId and owner required' }] };
          }
          try {
            const res = await fetch(`${API_BASE}/api/zones?zoneId=${encodeURIComponent(args.zoneId)}&owner=${encodeURIComponent(args.owner)}`, {
              method: 'DELETE'
            });
            return { content: [{ type: 'text', text: JSON.stringify({ released: true, zoneId: args.zoneId }) }] };
          } catch (err) {
            const released = store.releaseZone(args.zoneId, args.owner);
            return { content: [{ type: 'text', text: JSON.stringify({ released, zoneId: args.zoneId }) }] };
          }
        }

        case 'check': {
          if (!args.zoneId) return { content: [{ type: 'text', text: 'zoneId required' }] };
          try {
            const res = await fetch(`${API_BASE}/api/zones?zoneId=${encodeURIComponent(args.zoneId)}`);
            const data = await res.json();
            const zone = data.zones?.find((z: any) => z.zoneId === args.zoneId);
            return { content: [{ type: 'text', text: JSON.stringify(zone ? { claimed: true, ...zone } : { claimed: false }) }] };
          } catch (err) {
            const zone = store.checkZone(args.zoneId);
            return { content: [{ type: 'text', text: JSON.stringify(zone ? { claimed: true, ...zone } : { claimed: false }) }] };
          }
        }

        case 'list': {
          try {
            const res = await fetch(`${API_BASE}/api/zones`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          } catch (err) {
            const zones = store.listZones();
            return { content: [{ type: 'text', text: JSON.stringify({ zones, count: zones.length }) }] };
          }
        }

        case 'my-zones': {
          if (!args.owner) return { content: [{ type: 'text', text: 'owner required' }] };
          try {
            const res = await fetch(`${API_BASE}/api/zones?owner=${encodeURIComponent(args.owner)}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          } catch (err) {
            const zones = store.getZonesFor(args.owner);
            return { content: [{ type: 'text', text: JSON.stringify({ zones, count: zones.length }) }] };
          }
        }

        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
      }
    }
  );
}
