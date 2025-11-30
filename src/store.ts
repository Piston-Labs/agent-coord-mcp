/**
 * Agent Coordination MCP - In-Memory Store
 *
 * Simple in-memory storage for coordination state.
 * Can be replaced with SQLite or other persistence later.
 */

import {
  Agent,
  Message,
  GroupMessage,
  ResourceLock,
  Task,
  Claim,
  Zone,
  Checkpoint,
  Reaction
} from './types.js';

class CoordinationStore {
  private agents: Map<string, Agent> = new Map();
  private messages: Message[] = [];
  private groupChat: GroupMessage[] = [];
  private locks: Map<string, ResourceLock> = new Map();
  private tasks: Map<string, Task> = new Map();
  private claims: Map<string, Claim> = new Map();
  private zones: Map<string, Zone> = new Map();
  private checkpoints: Map<string, Checkpoint> = new Map();

  // Agent operations
  updateAgent(agent: Agent): Agent {
    agent.lastSeen = new Date().toISOString();
    this.agents.set(agent.id, agent);
    return agent;
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  getActiveAgents(): Agent[] {
    const staleThreshold = Date.now() - 30 * 60 * 1000; // 30 min
    return this.getAllAgents().filter(a => {
      const lastSeen = new Date(a.lastSeen).getTime();
      return lastSeen > staleThreshold;
    });
  }

  // Message operations
  sendMessage(msg: Omit<Message, 'id' | 'timestamp' | 'read'>): Message {
    const message: Message = {
      ...msg,
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      read: false
    };
    this.messages.push(message);
    return message;
  }

  getMessagesFor(agentId: string, markRead = false): Message[] {
    const msgs = this.messages.filter(m => m.to === agentId && !m.read);
    if (markRead) {
      msgs.forEach(m => m.read = true);
    }
    return msgs;
  }

  // Group chat operations
  postGroupMessage(author: string, authorType: 'agent' | 'human', message: string): GroupMessage {
    const msg: GroupMessage = {
      id: this.generateId(),
      author,
      authorType,
      message,
      timestamp: new Date().toISOString(),
      reactions: []
    };
    this.groupChat.push(msg);

    // Keep last 1000 messages
    if (this.groupChat.length > 1000) {
      this.groupChat = this.groupChat.slice(-1000);
    }

    return msg;
  }

  getGroupMessages(limit = 50): GroupMessage[] {
    return this.groupChat.slice(-limit);
  }

  getGroupMessagesSince(since: string): GroupMessage[] {
    const sinceTime = new Date(since).getTime();
    return this.groupChat.filter(m => new Date(m.timestamp).getTime() > sinceTime);
  }

  addReaction(messageId: string, emoji: string, author: string, authorType: 'agent' | 'human'): boolean {
    const msg = this.groupChat.find(m => m.id === messageId);
    if (!msg) return false;

    // Check if already reacted with same emoji
    const existing = msg.reactions.find(r => r.author === author && r.emoji === emoji);
    if (existing) {
      // Remove reaction (toggle)
      msg.reactions = msg.reactions.filter(r => !(r.author === author && r.emoji === emoji));
    } else {
      msg.reactions.push({
        emoji,
        author,
        authorType,
        timestamp: new Date().toISOString()
      });
    }
    return true;
  }

  // Resource lock operations
  checkLock(resourcePath: string): ResourceLock | null {
    const lock = this.locks.get(resourcePath);
    if (!lock) return null;

    // Check expiry
    if (lock.expiresAt && new Date(lock.expiresAt).getTime() < Date.now()) {
      this.locks.delete(resourcePath);
      return null;
    }

    return lock;
  }

  acquireLock(resourcePath: string, agentId: string, resourceType: ResourceLock['resourceType'], reason?: string): ResourceLock | { error: string } {
    const existing = this.checkLock(resourcePath);
    if (existing && existing.lockedBy !== agentId) {
      return { error: `Resource locked by ${existing.lockedBy}` };
    }

    const lock: ResourceLock = {
      resourcePath,
      resourceType,
      lockedBy: agentId,
      reason,
      lockedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hour expiry
    };

    this.locks.set(resourcePath, lock);
    return lock;
  }

  releaseLock(resourcePath: string, agentId: string): boolean {
    const lock = this.locks.get(resourcePath);
    if (!lock) return false;
    if (lock.lockedBy !== agentId) return false;

    this.locks.delete(resourcePath);
    return true;
  }

  getAllLocks(): ResourceLock[] {
    return Array.from(this.locks.values());
  }

  // Task operations
  createTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task {
    const now = new Date().toISOString();
    const newTask: Task = {
      ...task,
      id: task.title.toLowerCase().replace(/\s+/g, '-').substring(0, 30),
      createdAt: now,
      updatedAt: now
    };
    this.tasks.set(newTask.id, newTask);
    return newTask;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  listTasks(status?: Task['status']): Task[] {
    const all = Array.from(this.tasks.values());
    if (status) {
      return all.filter(t => t.status === status);
    }
    return all;
  }

  updateTaskStatus(id: string, status: Task['status']): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;

    task.status = status;
    task.updatedAt = new Date().toISOString();
    return task;
  }

  assignTask(id: string, assignee: string): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;

    task.assignee = assignee;
    task.updatedAt = new Date().toISOString();
    return task;
  }

  // Claim operations
  claim(what: string, by: string, description?: string): Claim {
    const claim: Claim = {
      what,
      by,
      description,
      since: new Date().toISOString(),
      stale: false
    };
    this.claims.set(`${by}:${what}`, claim);
    return claim;
  }

  checkClaim(what: string): Claim | null {
    for (const claim of this.claims.values()) {
      if (claim.what === what) {
        // Check if stale (>30 min)
        const age = Date.now() - new Date(claim.since).getTime();
        claim.stale = age > 30 * 60 * 1000;
        return claim;
      }
    }
    return null;
  }

  releaseClaim(what: string, by: string): boolean {
    return this.claims.delete(`${by}:${what}`);
  }

  listClaims(includeStale = false): Claim[] {
    const staleThreshold = Date.now() - 30 * 60 * 1000;
    return Array.from(this.claims.values()).filter(c => {
      const age = Date.now() - new Date(c.since).getTime();
      c.stale = age > staleThreshold;
      return includeStale || !c.stale;
    });
  }

  // Zone operations
  claimZone(zoneId: string, path: string, owner: string, description?: string): Zone | { error: string } {
    const existing = this.zones.get(zoneId);
    if (existing && existing.owner !== owner) {
      return { error: `Zone ${zoneId} already claimed by ${existing.owner}` };
    }

    const zone: Zone = {
      zoneId,
      path,
      owner,
      description,
      claimedAt: new Date().toISOString()
    };
    this.zones.set(zoneId, zone);
    return zone;
  }

  checkZone(zoneId: string): Zone | null {
    return this.zones.get(zoneId) || null;
  }

  releaseZone(zoneId: string, owner: string): boolean {
    const zone = this.zones.get(zoneId);
    if (!zone || zone.owner !== owner) return false;
    this.zones.delete(zoneId);
    return true;
  }

  listZones(): Zone[] {
    return Array.from(this.zones.values());
  }

  getZonesFor(owner: string): Zone[] {
    return this.listZones().filter(z => z.owner === owner);
  }

  // Checkpoint operations
  saveCheckpoint(checkpoint: Checkpoint): Checkpoint {
    checkpoint.checkpointAt = new Date().toISOString();
    this.checkpoints.set(checkpoint.agentId, checkpoint);
    return checkpoint;
  }

  getCheckpoint(agentId: string): Checkpoint | null {
    return this.checkpoints.get(agentId) || null;
  }

  clearCheckpoint(agentId: string): boolean {
    return this.checkpoints.delete(agentId);
  }

  // Utility
  private generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
  }

  // Extract @mentions from message
  extractMentions(message: string): string[] {
    const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(message)) !== null) {
      mentions.push(match[1]);
    }
    return mentions;
  }
}

// Singleton instance
export const store = new CoordinationStore();
