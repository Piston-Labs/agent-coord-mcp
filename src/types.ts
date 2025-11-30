/**
 * Agent Coordination MCP - Core Types
 */

export interface Agent {
  id: string;
  name?: string;
  status: 'active' | 'idle' | 'waiting';
  currentTask?: string;
  workingOn?: string;
  workingOnSince?: string;
  lastSeen: string;
  roles: string[];
  metadata: Record<string, unknown>;
}

export interface Message {
  id: string;
  from: string;
  to?: string;
  type: 'status' | 'handoff' | 'note' | 'mention';
  message: string;
  timestamp: string;
  read: boolean;
}

export interface GroupMessage {
  id: string;
  author: string;
  authorType: 'agent' | 'human';
  message: string;
  timestamp: string;
  reactions: Reaction[];
}

export interface Reaction {
  emoji: string;
  author: string;
  authorType: 'agent' | 'human';
  timestamp: string;
}

export interface ResourceLock {
  resourcePath: string;
  resourceType: 'repo-path' | 'branch' | 'file-lock' | 'custom';
  lockedBy: string;
  reason?: string;
  lockedAt: string;
  expiresAt?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in-progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignee?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];

  // Task-File Binding: files that will be modified by this task
  files?: string[];
  // Context clusters to load (for context-engine integration)
  contextClusters?: string[];
  // How to know task is complete
  acceptanceCriteria?: string;
  // Task ID if blocked by another task
  blockedBy?: string;
  // Why it's blocked
  blockedReason?: string;
}

export interface TaskClaimResult {
  success: boolean;
  task?: Task;
  lockedFiles?: string[];
  error?: string;
  conflictingAgent?: string;
  conflictingTask?: string;
  conflictingFile?: string;
}

export interface Claim {
  what: string;
  by: string;
  description?: string;
  since: string;
  stale: boolean;
}

export interface Zone {
  zoneId: string;
  path: string;
  owner: string;
  description?: string;
  claimedAt: string;
}

export interface Checkpoint {
  agentId: string;
  conversationSummary?: string;
  accomplishments: string[];
  pendingWork: string[];
  recentContext?: string;
  filesEdited: string[];
  checkpointAt: string;
}
