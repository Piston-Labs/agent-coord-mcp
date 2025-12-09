/**
 * Types for Agent Coordination Durable Objects
 */

export interface Agent {
  agentId: string;
  status: 'active' | 'idle' | 'waiting' | 'offline';
  currentTask?: string;
  workingOn?: string;
  lastSeen: string;
  capabilities?: string[];
  offers?: string[];
  needs?: string[];
}

export interface AgentCheckpoint {
  agentId: string;
  conversationSummary?: string;
  accomplishments: string[];
  pendingWork: string[];
  recentContext?: string;
  filesEdited: string[];
  checkpointAt: string;
}

export interface GroupMessage {
  id: string;
  author: string;
  authorType: 'agent' | 'human' | 'system';
  message: string;
  timestamp: string;
  reactions: Reaction[];
}

export interface Reaction {
  emoji: string;
  by: string;
  at: string;
}

export interface ResourceLockData {
  resourcePath: string;
  resourceType: 'repo-path' | 'branch' | 'file-lock' | 'custom';
  lockedBy: string;
  reason?: string;
  lockedAt: string;
  expiresAt: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in-progress' | 'done' | 'blocked';
  assignee?: string;
  createdBy: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  tags: string[];
  files?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WebSocketMessage {
  type: 'agent-update' | 'chat' | 'task-update' | 'lock-update' | 'ping' | 'pong';
  payload: unknown;
  timestamp: string;
}

export interface Zone {
  zoneId: string;
  path: string;
  owner: string;
  description?: string;
  claimedAt: string;
}

export interface Claim {
  what: string;
  by: string;
  description?: string;
  since: string;
  stale: boolean;
}

export interface Handoff {
  id: string;
  fromAgent: string;
  toAgent?: string;
  title: string;
  context: string;
  code?: string;
  filePath?: string;
  nextSteps: string[];
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'claimed' | 'completed';
  claimedBy?: string;
  createdAt: string;
  claimedAt?: string;
  completedAt?: string;
}

export interface Env {
  COORDINATOR: DurableObjectNamespace;
  AGENT_STATE: DurableObjectNamespace;
  RESOURCE_LOCK: DurableObjectNamespace;
  VM_POOL: DurableObjectNamespace;
  ENVIRONMENT?: string;
}
