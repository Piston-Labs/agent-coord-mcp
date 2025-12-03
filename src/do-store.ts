/**
 * Durable Objects Store - Drop-in replacement for unified-store
 *
 * This store implements the same interface as unified-store but
 * uses Cloudflare Durable Objects via HTTP API instead of local
 * memory or file persistence.
 *
 * Set DO_URL environment variable to point to your deployed DO Worker.
 * Example: DO_URL=https://agent-coord-do.your-account.workers.dev
 */

import type { UnifiedStore } from './unified-store.js';
import type {
  Agent,
  Message,
  GroupMessage,
  ResourceLock,
  Task,
  TaskClaimResult,
  Claim,
  Zone,
  Checkpoint
} from './types.js';

const DO_URL = process.env.DO_URL || 'http://localhost:8787';

// Helper for async fetch with error handling
async function doFetch<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    const res = await fetch(`${DO_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      }
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error(`DO API error: ${res.status} - ${error}`);
    }
    return res.json();
  } catch (error) {
    console.error(`[do-store] Fetch failed for ${path}:`, error);
    throw error;
  }
}

// Local cache for synchronous operations
const agentCache = new Map<string, Agent>();
const messageCache: Message[] = [];
const groupChatCache: GroupMessage[] = [];
const lockCache = new Map<string, ResourceLock>();
const taskCache = new Map<string, Task>();
const claimCache = new Map<string, Claim>();
const zoneCache = new Map<string, Zone>();
const checkpointCache = new Map<string, Checkpoint>();

let idCounter = 0;
function generateId(): string {
  return `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

/**
 * Create a Durable Objects-backed store
 * Note: Many operations are async but the interface is sync,
 * so we use local cache + fire-and-forget updates to DO
 */
export function createDOStore(): UnifiedStore {
  // Background sync from DO on startup
  doFetch<{ agents: { agentId: string; status: string; currentTask?: string; workingOn?: string; lastSeen: string }[] }>('/coordinator/agents')
    .then(data => {
      for (const a of data.agents || []) {
        const agent: Agent = {
          id: a.agentId,
          status: (a.status === 'offline' ? 'idle' : a.status) as Agent['status'],
          currentTask: a.currentTask,
          workingOn: a.workingOn,
          lastSeen: a.lastSeen,
          roles: [],
          metadata: {}
        };
        agentCache.set(agent.id, agent);
      }
      console.error(`[do-store] Synced ${agentCache.size} agents from DO`);
    })
    .catch(() => console.error('[do-store] Failed initial agent sync'));

  doFetch<{ messages: GroupMessage[] }>('/coordinator/chat?limit=100')
    .then(data => {
      groupChatCache.push(...(data.messages || []));
      console.error(`[do-store] Synced ${groupChatCache.length} chat messages from DO`);
    })
    .catch(() => console.error('[do-store] Failed initial chat sync'));

  return {
    // ========== Agent Operations ==========

    updateAgent(agent: Agent): Agent {
      agent.lastSeen = new Date().toISOString();
      agentCache.set(agent.id, agent);

      // Async update to DO
      doFetch('/coordinator/agents', {
        method: 'POST',
        body: JSON.stringify({
          agentId: agent.id,
          status: agent.status,
          currentTask: agent.currentTask,
          workingOn: agent.workingOn
        })
      }).catch(console.error);

      return agent;
    },

    getAgent(id: string): Agent | undefined {
      return agentCache.get(id);
    },

    getAllAgents(): Agent[] {
      return Array.from(agentCache.values());
    },

    getActiveAgents(): Agent[] {
      const staleThreshold = Date.now() - 30 * 60 * 1000;
      return Array.from(agentCache.values()).filter(a => {
        const lastSeen = new Date(a.lastSeen).getTime();
        return lastSeen > staleThreshold;
      });
    },

    // ========== Message Operations ==========

    sendMessage(msg: Omit<Message, 'id' | 'timestamp' | 'read'>): Message {
      const message: Message = {
        ...msg,
        id: generateId(),
        timestamp: new Date().toISOString(),
        read: false
      };
      messageCache.push(message);

      // Async send to agent's DO
      if (msg.to) {
        doFetch(`/agent/${encodeURIComponent(msg.to)}/messages`, {
          method: 'POST',
          body: JSON.stringify({ from: msg.from, type: msg.type, message: msg.message })
        }).catch(console.error);
      }

      return message;
    },

    getMessagesFor(agentId: string, markRead = false): Message[] {
      const msgs = messageCache.filter(m => m.to === agentId && !m.read);
      if (markRead) {
        msgs.forEach(m => m.read = true);
      }
      return msgs;
    },

    // ========== Group Chat Operations ==========

    postGroupMessage(author: string, authorType: 'agent' | 'human', message: string): GroupMessage {
      const msg: GroupMessage = {
        id: generateId(),
        author,
        authorType,
        message,
        timestamp: new Date().toISOString(),
        reactions: []
      };
      groupChatCache.push(msg);

      // Keep last 1000
      if (groupChatCache.length > 1000) {
        groupChatCache.splice(0, groupChatCache.length - 1000);
      }

      // Async post to DO
      doFetch('/coordinator/chat', {
        method: 'POST',
        body: JSON.stringify({ author, message, authorType })
      }).catch(console.error);

      return msg;
    },

    getGroupMessages(limit = 50): GroupMessage[] {
      return groupChatCache.slice(-limit);
    },

    getGroupMessagesSince(since: string): GroupMessage[] {
      const sinceTime = new Date(since).getTime();
      return groupChatCache.filter(m => new Date(m.timestamp).getTime() > sinceTime);
    },

    addReaction(messageId: string, emoji: string, author: string, authorType: 'agent' | 'human' = 'agent'): boolean {
      const msg = groupChatCache.find(m => m.id === messageId);
      if (!msg) return false;

      msg.reactions.push({
        emoji,
        author,
        authorType,
        timestamp: new Date().toISOString()
      });
      return true;
    },

    // ========== Resource Lock Operations ==========

    checkLock(resourcePath: string): ResourceLock | null {
      const lock = lockCache.get(resourcePath);
      if (lock && lock.expiresAt && new Date(lock.expiresAt) < new Date()) {
        lockCache.delete(resourcePath);
        return null;
      }
      return lock || null;
    },

    acquireLock(resourcePath: string, agentId: string, resourceType: ResourceLock['resourceType'] = 'file-lock', reason?: string): ResourceLock | { error: string } {
      const existing = lockCache.get(resourcePath);
      if (existing && existing.lockedBy !== agentId) {
        if (!existing.expiresAt || new Date(existing.expiresAt) > new Date()) {
          return { error: `Resource locked by ${existing.lockedBy}` };
        }
      }

      const lock: ResourceLock = {
        resourcePath,
        resourceType,
        lockedBy: agentId,
        reason,
        lockedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      };
      lockCache.set(resourcePath, lock);

      // Async update to DO
      doFetch(`/lock/${encodeURIComponent(resourcePath)}/lock`, {
        method: 'POST',
        body: JSON.stringify({ agentId, reason, resourceType })
      }).catch(console.error);

      return lock;
    },

    releaseLock(resourcePath: string, agentId: string): boolean {
      const lock = lockCache.get(resourcePath);
      if (lock && lock.lockedBy === agentId) {
        lockCache.delete(resourcePath);

        // Async release in DO
        doFetch(`/lock/${encodeURIComponent(resourcePath)}/unlock`, {
          method: 'POST',
          body: JSON.stringify({ agentId })
        }).catch(console.error);

        return true;
      }
      return false;
    },

    getAllLocks(): ResourceLock[] {
      return Array.from(lockCache.values());
    },

    // ========== Task Operations ==========

    createTask(task: Partial<Task> & { title: string; createdBy: string }): Task {
      const now = new Date().toISOString();
      const newTask: Task = {
        id: task.id || `task-${generateId()}`,
        title: task.title,
        description: task.description,
        status: task.status || 'todo',
        priority: task.priority || 'medium',
        assignee: task.assignee,
        createdBy: task.createdBy,
        tags: task.tags || [],
        files: task.files,
        createdAt: now,
        updatedAt: now
      };
      taskCache.set(newTask.id, newTask);

      // Async create in DO
      doFetch('/coordinator/tasks', {
        method: 'POST',
        body: JSON.stringify(newTask)
      }).catch(console.error);

      return newTask;
    },

    getTask(id: string): Task | undefined {
      return taskCache.get(id);
    },

    listTasks(): Task[] {
      return Array.from(taskCache.values());
    },

    updateTaskStatus(id: string, status: Task['status']): Task | undefined {
      const task = taskCache.get(id);
      if (task) {
        task.status = status;
        task.updatedAt = new Date().toISOString();
      }
      return task;
    },

    assignTask(id: string, assignee: string): Task | undefined {
      const task = taskCache.get(id);
      if (task) {
        task.assignee = assignee;
        task.updatedAt = new Date().toISOString();
      }
      return task;
    },

    // ========== Task-File Binding Operations ==========

    claimTaskWithFiles(taskId: string, agentId: string): TaskClaimResult {
      const task = taskCache.get(taskId);
      if (!task) {
        return { success: false, error: 'Task not found' };
      }

      // Check file locks
      if (task.files) {
        for (const file of task.files) {
          const lock = lockCache.get(file);
          if (lock && lock.lockedBy !== agentId) {
            return {
              success: false,
              error: 'File locked by another agent',
              conflictingFile: file,
              conflictingAgent: lock.lockedBy
            };
          }
        }

        // Lock all files
        for (const file of task.files) {
          lockCache.set(file, {
            resourcePath: file,
            resourceType: 'file-lock',
            lockedBy: agentId,
            reason: `Task: ${task.title}`,
            lockedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
          });
        }
      }

      task.status = 'in-progress';
      task.assignee = agentId;
      task.updatedAt = new Date().toISOString();

      return { success: true, task, lockedFiles: task.files };
    },

    releaseTaskWithFiles(taskId: string, agentId: string, newStatus: Task['status'] = 'done', blockedReason?: string): TaskClaimResult {
      const task = taskCache.get(taskId);
      if (!task) {
        return { success: false, error: 'Task not found' };
      }

      // Release file locks
      if (task.files) {
        for (const file of task.files) {
          const lock = lockCache.get(file);
          if (lock && lock.lockedBy === agentId) {
            lockCache.delete(file);
          }
        }
      }

      task.status = newStatus;
      task.updatedAt = new Date().toISOString();
      if (newStatus === 'blocked' && blockedReason) {
        task.blockedReason = blockedReason;
      }

      return { success: true, task };
    },

    getTasksForFile(filePath: string): Task[] {
      return Array.from(taskCache.values()).filter(t => t.files?.includes(filePath));
    },

    // ========== Claim Operations ==========

    claim(what: string, by: string, description?: string): Claim {
      const claim: Claim = {
        what,
        by,
        description,
        since: new Date().toISOString(),
        stale: false
      };
      claimCache.set(what, claim);
      return claim;
    },

    checkClaim(what: string): Claim | null {
      const claim = claimCache.get(what);
      if (claim) {
        const age = Date.now() - new Date(claim.since).getTime();
        claim.stale = age > 30 * 60 * 1000; // 30 minutes
      }
      return claim || null;
    },

    releaseClaim(what: string, by: string): boolean {
      const claim = claimCache.get(what);
      if (claim && claim.by === by) {
        claimCache.delete(what);
        return true;
      }
      return false;
    },

    listClaims(includeStale = false): Claim[] {
      const claims = Array.from(claimCache.values());
      const now = Date.now();
      return claims
        .map(c => ({
          ...c,
          stale: now - new Date(c.since).getTime() > 30 * 60 * 1000
        }))
        .filter(c => includeStale || !c.stale);
    },

    // ========== Zone Operations ==========

    claimZone(zoneId: string, path: string, owner: string, description?: string): Zone {
      const zone: Zone = {
        zoneId,
        path,
        owner,
        description,
        claimedAt: new Date().toISOString()
      };
      zoneCache.set(zoneId, zone);
      return zone;
    },

    checkZone(path: string): Zone | null {
      for (const zone of zoneCache.values()) {
        if (path.startsWith(zone.path)) {
          return zone;
        }
      }
      return null;
    },

    releaseZone(zoneId: string, owner: string): boolean {
      const zone = zoneCache.get(zoneId);
      if (zone && zone.owner === owner) {
        zoneCache.delete(zoneId);
        return true;
      }
      return false;
    },

    listZones(): Zone[] {
      return Array.from(zoneCache.values());
    },

    getZonesFor(owner: string): Zone[] {
      return Array.from(zoneCache.values()).filter(z => z.owner === owner);
    },

    // ========== Checkpoint Operations ==========

    saveCheckpoint(checkpoint: Checkpoint): Checkpoint {
      checkpoint.checkpointAt = new Date().toISOString();
      checkpointCache.set(checkpoint.agentId, checkpoint);

      // Async save to DO
      doFetch(`/agent/${encodeURIComponent(checkpoint.agentId)}/checkpoint`, {
        method: 'POST',
        body: JSON.stringify(checkpoint)
      }).catch(console.error);

      return checkpoint;
    },

    getCheckpoint(agentId: string): Checkpoint | null {
      return checkpointCache.get(agentId) || null;
    },

    clearCheckpoint(agentId: string): boolean {
      return checkpointCache.delete(agentId);
    },

    // ========== Utility ==========

    extractMentions(message: string): string[] {
      const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
      const mentions: string[] = [];
      let match;
      while ((match = mentionRegex.exec(message)) !== null) {
        mentions.push(match[1]);
      }
      return mentions;
    }
  };
}

// Export for use when DO_URL is set
export const doStore = process.env.DO_URL ? createDOStore() : null;
