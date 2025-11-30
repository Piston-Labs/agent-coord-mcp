/**
 * JSON File Persistence for Agent Coordination MCP
 *
 * Simple file-based storage that persists state to disk.
 * Uses debounced writes to avoid excessive I/O.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import {
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

interface PersistedState {
  agents: Record<string, Agent>;
  messages: Message[];
  groupChat: GroupMessage[];
  locks: Record<string, ResourceLock>;
  tasks: Record<string, Task>;
  claims: Record<string, Claim>;
  zones: Record<string, Zone>;
  checkpoints: Record<string, Checkpoint>;
  version: number;
  lastUpdated: string;
}

const DEFAULT_STATE: PersistedState = {
  agents: {},
  messages: [],
  groupChat: [],
  locks: {},
  tasks: {},
  claims: {},
  zones: {},
  checkpoints: {},
  version: 1,
  lastUpdated: new Date().toISOString()
};

export class JsonPersistence {
  private filePath: string;
  private state: PersistedState;
  private writeTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingWrite = false;
  private writeDebounceMs: number;

  constructor(filePath?: string, debounceMs = 1000) {
    this.filePath = filePath || join(process.cwd(), 'data', 'coord-state.json');
    this.writeDebounceMs = debounceMs;
    this.state = this.load();
  }

  private ensureDir(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private load(): PersistedState {
    try {
      if (existsSync(this.filePath)) {
        const data = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(data) as PersistedState;
        console.error(`[persistence] Loaded state from ${this.filePath}`);
        console.error(`[persistence] Agents: ${Object.keys(parsed.agents).length}, Tasks: ${Object.keys(parsed.tasks).length}, Chat: ${parsed.groupChat.length}`);
        return parsed;
      }
    } catch (err) {
      console.error('[persistence] Failed to load state:', err);
    }
    return { ...DEFAULT_STATE };
  }

  private scheduleSave(): void {
    this.pendingWrite = true;
    if (this.writeTimeout) return;

    this.writeTimeout = setTimeout(() => {
      this.writeTimeout = null;
      if (this.pendingWrite) {
        this.saveNow();
      }
    }, this.writeDebounceMs);
  }

  private saveNow(): void {
    this.pendingWrite = false;
    this.state.lastUpdated = new Date().toISOString();
    try {
      this.ensureDir();
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
    } catch (err) {
      console.error('[persistence] Failed to save state:', err);
    }
  }

  // Force immediate save (for shutdown)
  flush(): void {
    if (this.writeTimeout) {
      clearTimeout(this.writeTimeout);
      this.writeTimeout = null;
    }
    if (this.pendingWrite) {
      this.saveNow();
    }
  }

  // Agent operations
  updateAgent(agent: Agent): Agent {
    agent.lastSeen = new Date().toISOString();
    this.state.agents[agent.id] = agent;
    this.scheduleSave();
    return agent;
  }

  getAgent(id: string): Agent | undefined {
    return this.state.agents[id];
  }

  getAllAgents(): Agent[] {
    return Object.values(this.state.agents);
  }

  getActiveAgents(): Agent[] {
    const staleThreshold = Date.now() - 30 * 60 * 1000;
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
    this.state.messages.push(message);
    // Keep last 1000 messages
    if (this.state.messages.length > 1000) {
      this.state.messages = this.state.messages.slice(-1000);
    }
    this.scheduleSave();
    return message;
  }

  getMessagesFor(agentId: string, markRead = false): Message[] {
    const msgs = this.state.messages.filter(m => m.to === agentId && !m.read);
    if (markRead) {
      msgs.forEach(m => m.read = true);
      this.scheduleSave();
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
    this.state.groupChat.push(msg);
    if (this.state.groupChat.length > 1000) {
      this.state.groupChat = this.state.groupChat.slice(-1000);
    }
    this.scheduleSave();
    return msg;
  }

  getGroupMessages(limit = 50): GroupMessage[] {
    return this.state.groupChat.slice(-limit);
  }

  getGroupMessagesSince(since: string): GroupMessage[] {
    const sinceTime = new Date(since).getTime();
    return this.state.groupChat.filter(m => new Date(m.timestamp).getTime() > sinceTime);
  }

  addReaction(messageId: string, emoji: string, author: string, authorType: 'agent' | 'human'): boolean {
    const msg = this.state.groupChat.find(m => m.id === messageId);
    if (!msg) return false;

    const existing = msg.reactions.find(r => r.author === author && r.emoji === emoji);
    if (existing) {
      msg.reactions = msg.reactions.filter(r => !(r.author === author && r.emoji === emoji));
    } else {
      msg.reactions.push({
        emoji,
        author,
        authorType,
        timestamp: new Date().toISOString()
      });
    }
    this.scheduleSave();
    return true;
  }

  // Resource lock operations
  checkLock(resourcePath: string): ResourceLock | null {
    const lock = this.state.locks[resourcePath];
    if (!lock) return null;

    if (lock.expiresAt && new Date(lock.expiresAt).getTime() < Date.now()) {
      delete this.state.locks[resourcePath];
      this.scheduleSave();
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
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    };

    this.state.locks[resourcePath] = lock;
    this.scheduleSave();
    return lock;
  }

  releaseLock(resourcePath: string, agentId: string): boolean {
    const lock = this.state.locks[resourcePath];
    if (!lock) return false;
    if (lock.lockedBy !== agentId) return false;

    delete this.state.locks[resourcePath];
    this.scheduleSave();
    return true;
  }

  getAllLocks(): ResourceLock[] {
    return Object.values(this.state.locks);
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
    this.state.tasks[newTask.id] = newTask;
    this.scheduleSave();
    return newTask;
  }

  getTask(id: string): Task | undefined {
    return this.state.tasks[id];
  }

  listTasks(status?: Task['status']): Task[] {
    const all = Object.values(this.state.tasks);
    if (status) {
      return all.filter(t => t.status === status);
    }
    return all;
  }

  updateTaskStatus(id: string, status: Task['status']): Task | undefined {
    const task = this.state.tasks[id];
    if (!task) return undefined;

    task.status = status;
    task.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return task;
  }

  assignTask(id: string, assignee: string): Task | undefined {
    const task = this.state.tasks[id];
    if (!task) return undefined;

    task.assignee = assignee;
    task.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return task;
  }

  // Task-File Binding operations
  claimTaskWithFiles(taskId: string, agentId: string): TaskClaimResult {
    const task = this.state.tasks[taskId];
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Check if task is already assigned to someone else
    if (task.assignee && task.assignee !== agentId) {
      return {
        success: false,
        error: 'Task already assigned',
        conflictingAgent: task.assignee
      };
    }

    // Check if task is already in progress
    if (task.status === 'in-progress' && task.assignee !== agentId) {
      return {
        success: false,
        error: 'Task already in progress',
        conflictingAgent: task.assignee
      };
    }

    // Check if any of the task's files are locked by another agent
    const files = task.files || [];
    for (const file of files) {
      const lock = this.checkLock(file);
      if (lock && lock.lockedBy !== agentId) {
        // Find which task has this file locked
        let conflictingTask: string | undefined;
        for (const t of Object.values(this.state.tasks)) {
          if (t.assignee === lock.lockedBy && t.files?.includes(file)) {
            conflictingTask = t.id;
            break;
          }
        }

        return {
          success: false,
          error: 'File conflict',
          conflictingFile: file,
          conflictingAgent: lock.lockedBy,
          conflictingTask
        };
      }
    }

    // All checks passed - lock all files and claim task
    const lockedFiles: string[] = [];
    for (const file of files) {
      const lock = this.acquireLock(file, agentId, 'file-lock', `Task: ${task.title}`);
      if (!('error' in lock)) {
        // Task-based locks don't expire
        lock.expiresAt = undefined;
        lockedFiles.push(file);
      }
    }

    // Update task
    task.assignee = agentId;
    task.status = 'in-progress';
    task.updatedAt = new Date().toISOString();
    this.scheduleSave();

    return {
      success: true,
      task,
      lockedFiles
    };
  }

  releaseTaskWithFiles(
    taskId: string,
    agentId: string,
    newStatus: 'done' | 'blocked',
    blockedReason?: string
  ): TaskClaimResult {
    const task = this.state.tasks[taskId];
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Verify agent owns the task
    if (task.assignee !== agentId) {
      return {
        success: false,
        error: 'Not your task',
        conflictingAgent: task.assignee
      };
    }

    // Release all file locks
    const files = task.files || [];
    for (const file of files) {
      this.releaseLock(file, agentId);
    }

    // Update task
    task.status = newStatus;
    task.updatedAt = new Date().toISOString();

    if (newStatus === 'blocked' && blockedReason) {
      task.blockedReason = blockedReason;
    }

    if (newStatus === 'done') {
      task.assignee = undefined;  // Clear assignee when done
    }

    this.scheduleSave();

    return {
      success: true,
      task,
      lockedFiles: []
    };
  }

  getTasksForFile(filePath: string): Task[] {
    return Object.values(this.state.tasks).filter(
      t => t.files?.includes(filePath)
    );
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
    this.state.claims[`${by}:${what}`] = claim;
    this.scheduleSave();
    return claim;
  }

  checkClaim(what: string): Claim | null {
    for (const claim of Object.values(this.state.claims)) {
      if (claim.what === what) {
        const age = Date.now() - new Date(claim.since).getTime();
        claim.stale = age > 30 * 60 * 1000;
        return claim;
      }
    }
    return null;
  }

  releaseClaim(what: string, by: string): boolean {
    const key = `${by}:${what}`;
    if (this.state.claims[key]) {
      delete this.state.claims[key];
      this.scheduleSave();
      return true;
    }
    return false;
  }

  listClaims(includeStale = false): Claim[] {
    const staleThreshold = Date.now() - 30 * 60 * 1000;
    return Object.values(this.state.claims).filter(c => {
      const age = Date.now() - new Date(c.since).getTime();
      c.stale = age > staleThreshold;
      return includeStale || !c.stale;
    });
  }

  // Zone operations
  claimZone(zoneId: string, path: string, owner: string, description?: string): Zone | { error: string } {
    const existing = this.state.zones[zoneId];
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
    this.state.zones[zoneId] = zone;
    this.scheduleSave();
    return zone;
  }

  checkZone(zoneId: string): Zone | null {
    return this.state.zones[zoneId] || null;
  }

  releaseZone(zoneId: string, owner: string): boolean {
    const zone = this.state.zones[zoneId];
    if (!zone || zone.owner !== owner) return false;
    delete this.state.zones[zoneId];
    this.scheduleSave();
    return true;
  }

  listZones(): Zone[] {
    return Object.values(this.state.zones);
  }

  getZonesFor(owner: string): Zone[] {
    return this.listZones().filter(z => z.owner === owner);
  }

  // Checkpoint operations
  saveCheckpoint(checkpoint: Checkpoint): Checkpoint {
    checkpoint.checkpointAt = new Date().toISOString();
    this.state.checkpoints[checkpoint.agentId] = checkpoint;
    this.scheduleSave();
    return checkpoint;
  }

  getCheckpoint(agentId: string): Checkpoint | null {
    return this.state.checkpoints[agentId] || null;
  }

  clearCheckpoint(agentId: string): boolean {
    if (this.state.checkpoints[agentId]) {
      delete this.state.checkpoints[agentId];
      this.scheduleSave();
      return true;
    }
    return false;
  }

  // Utility
  private generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
  }

  extractMentions(message: string): string[] {
    const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(message)) !== null) {
      mentions.push(match[1]);
    }
    return mentions;
  }

  // Stats
  getStats(): { agents: number; tasks: number; chat: number; locks: number; claims: number; zones: number } {
    return {
      agents: Object.keys(this.state.agents).length,
      tasks: Object.keys(this.state.tasks).length,
      chat: this.state.groupChat.length,
      locks: Object.keys(this.state.locks).length,
      claims: Object.keys(this.state.claims).length,
      zones: Object.keys(this.state.zones).length
    };
  }
}

// Export singleton for use when persistence is enabled
let persistentStore: JsonPersistence | null = null;

export function getPersistentStore(filePath?: string): JsonPersistence {
  if (!persistentStore) {
    persistentStore = new JsonPersistence(filePath);
  }
  return persistentStore;
}
