/**
 * Durable Objects Client Adapter
 *
 * This client provides a drop-in replacement for the existing Redis-based
 * coordination tools. It can be used to migrate MCP tools to use DOs instead.
 *
 * Usage:
 *   const client = new DOClient('https://agent-coord-do.your-worker.workers.dev');
 *   await client.registerAgent('my-agent', { status: 'active' });
 *   await client.sendChat('my-agent', 'Hello team!');
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

export interface GroupMessage {
  id: string;
  author: string;
  authorType: 'agent' | 'human' | 'system';
  message: string;
  timestamp: string;
  reactions: { emoji: string; by: string; at: string }[];
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

export interface Checkpoint {
  agentId: string;
  conversationSummary?: string;
  accomplishments: string[];
  pendingWork: string[];
  recentContext?: string;
  filesEdited: string[];
  checkpointAt: string;
}

export interface LockInfo {
  resourcePath: string;
  resourceType: string;
  lockedBy: string;
  reason?: string;
  lockedAt: string;
  expiresAt: string;
  remainingMs?: number;
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

export interface WorkBundle {
  agentId: string;
  summary: {
    activeAgents: number;
    todoTasks: number;
    inProgressTasks: number;
  };
  team: Agent[];
  tasks: {
    todo: Task[];
    mine: Task[];
  };
  recentChat: GroupMessage[];
}

/**
 * Client for Durable Objects-based agent coordination
 */
export class DOClient {
  private baseUrl: string;
  private ws: WebSocket | null = null;
  private messageHandlers: Map<string, (data: unknown) => void> = new Map();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  // ========== Coordinator (Control Plane) ==========

  /**
   * Get everything an agent needs on startup (hot-start equivalent)
   */
  async work(agentId: string): Promise<WorkBundle> {
    const res = await fetch(`${this.baseUrl}/coordinator/work?agentId=${encodeURIComponent(agentId)}`);
    return res.json();
  }

  /**
   * Get all active agents
   */
  async getAgents(): Promise<Agent[]> {
    const res = await fetch(`${this.baseUrl}/coordinator/agents`);
    const data = await res.json();
    return data.agents;
  }

  /**
   * Register or update an agent
   */
  async registerAgent(agentId: string, update: Partial<Agent>): Promise<Agent> {
    const res = await fetch(`${this.baseUrl}/coordinator/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, ...update })
    });
    const data = await res.json();
    return data.agent;
  }

  /**
   * Get group chat messages
   */
  async getChat(limit = 50): Promise<GroupMessage[]> {
    const res = await fetch(`${this.baseUrl}/coordinator/chat?limit=${limit}`);
    const data = await res.json();
    return data.messages;
  }

  /**
   * Send a group chat message
   */
  async sendChat(author: string, message: string, authorType = 'agent'): Promise<GroupMessage> {
    const res = await fetch(`${this.baseUrl}/coordinator/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author, message, authorType })
    });
    const data = await res.json();
    return data.message;
  }

  /**
   * Get tasks
   */
  async getTasks(options?: { status?: string; assignee?: string }): Promise<Task[]> {
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.assignee) params.set('assignee', options.assignee);

    const res = await fetch(`${this.baseUrl}/coordinator/tasks?${params}`);
    const data = await res.json();
    return data.tasks;
  }

  /**
   * Create a task
   */
  async createTask(task: Partial<Task>): Promise<Task> {
    const res = await fetch(`${this.baseUrl}/coordinator/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task)
    });
    const data = await res.json();
    return data.task;
  }

  // ========== Zones ==========

  /**
   * Get all zones or filter by owner
   */
  async getZones(owner?: string): Promise<Zone[]> {
    const params = new URLSearchParams();
    if (owner) params.set('owner', owner);
    const res = await fetch(`${this.baseUrl}/coordinator/zones?${params}`);
    const data = await res.json();
    return data.zones;
  }

  /**
   * Check if a path is within a claimed zone
   */
  async checkZone(path: string): Promise<Zone | null> {
    const res = await fetch(`${this.baseUrl}/coordinator/zones?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    return data.zone || null;
  }

  /**
   * Claim a zone (directory ownership)
   */
  async claimZone(zoneId: string, path: string, owner: string, description?: string): Promise<Zone> {
    const res = await fetch(`${this.baseUrl}/coordinator/zones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'claim', zoneId, path, owner, description })
    });
    const data = await res.json();
    return data.zone;
  }

  /**
   * Release a zone
   */
  async releaseZone(zoneId: string, owner: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/coordinator/zones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'release', zoneId, owner })
    });
    const data = await res.json();
    return data.success;
  }

  // ========== Claims ==========

  /**
   * Get all claims
   */
  async getClaims(includeStale = false): Promise<Claim[]> {
    const res = await fetch(`${this.baseUrl}/coordinator/claims?includeStale=${includeStale}`);
    const data = await res.json();
    return data.claims;
  }

  /**
   * Check if something is claimed
   */
  async checkClaim(what: string): Promise<Claim | null> {
    const res = await fetch(`${this.baseUrl}/coordinator/claims?what=${encodeURIComponent(what)}`);
    const data = await res.json();
    return data.claim || null;
  }

  /**
   * Claim something (returns error if already claimed by someone else)
   */
  async claim(what: string, by: string, description?: string): Promise<{ success: boolean; claim?: Claim; error?: string }> {
    const res = await fetch(`${this.baseUrl}/coordinator/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'claim', what, by, description })
    });
    return res.json();
  }

  /**
   * Release a claim
   */
  async releaseClaim(what: string, by: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/coordinator/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'release', what, by })
    });
    const data = await res.json();
    return data.success;
  }

  // ========== Agent State (Per-Agent) ==========

  /**
   * Get agent's full state (checkpoint + messages + memories)
   */
  async getAgentState(agentId: string): Promise<{
    agentId: string;
    checkpoint: Checkpoint | null;
    unreadMessages: unknown[];
    recentMemories: unknown[];
  }> {
    const res = await fetch(`${this.baseUrl}/agent/${encodeURIComponent(agentId)}/state`);
    return res.json();
  }

  /**
   * Get agent's checkpoint
   */
  async getCheckpoint(agentId: string): Promise<Checkpoint | null> {
    const res = await fetch(`${this.baseUrl}/agent/${encodeURIComponent(agentId)}/checkpoint`);
    const data = await res.json();
    return data.checkpoint;
  }

  /**
   * Save agent's checkpoint
   */
  async saveCheckpoint(agentId: string, checkpoint: Partial<Checkpoint>): Promise<void> {
    await fetch(`${this.baseUrl}/agent/${encodeURIComponent(agentId)}/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkpoint)
    });
  }

  /**
   * Send a direct message to an agent
   */
  async sendDirectMessage(toAgentId: string, from: string, message: string, type = 'note'): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/agent/${encodeURIComponent(toAgentId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, message, type })
    });
    const data = await res.json();
    return data.message;
  }

  /**
   * Get agent's messages
   */
  async getMessages(agentId: string, unreadOnly = false): Promise<unknown[]> {
    const res = await fetch(`${this.baseUrl}/agent/${encodeURIComponent(agentId)}/messages?unread=${unreadOnly}`);
    const data = await res.json();
    return data.messages;
  }

  /**
   * Store a memory for an agent
   */
  async remember(agentId: string, memory: {
    category: 'discovery' | 'decision' | 'blocker' | 'learning' | 'pattern' | 'warning';
    content: string;
    tags?: string[];
  }): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/agent/${encodeURIComponent(agentId)}/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(memory)
    });
    const data = await res.json();
    return data.memory;
  }

  /**
   * Recall memories for an agent
   */
  async recall(agentId: string, options?: { category?: string; query?: string }): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (options?.category) params.set('category', options.category);
    if (options?.query) params.set('query', options.query);

    const res = await fetch(`${this.baseUrl}/agent/${encodeURIComponent(agentId)}/memory?${params}`);
    const data = await res.json();
    return data.memories;
  }

  // ========== Resource Locks ==========

  /**
   * Check if a resource is locked
   */
  async checkLock(resourcePath: string): Promise<{ locked: boolean; lock?: LockInfo }> {
    const res = await fetch(`${this.baseUrl}/lock/${encodeURIComponent(resourcePath)}/check`);
    return res.json();
  }

  /**
   * Acquire a lock on a resource
   */
  async acquireLock(resourcePath: string, agentId: string, options?: {
    reason?: string;
    resourceType?: string;
    ttlMs?: number;
  }): Promise<{ success: boolean; lock?: LockInfo; error?: string }> {
    const res = await fetch(`${this.baseUrl}/lock/${encodeURIComponent(resourcePath)}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId,
        reason: options?.reason,
        resourceType: options?.resourceType || 'file-lock',
        ttlMs: options?.ttlMs
      })
    });
    return res.json();
  }

  /**
   * Release a lock
   */
  async releaseLock(resourcePath: string, agentId: string, force = false): Promise<{ success: boolean }> {
    const res = await fetch(`${this.baseUrl}/lock/${encodeURIComponent(resourcePath)}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, force })
    });
    return res.json();
  }

  /**
   * Get lock history for a resource
   */
  async getLockHistory(resourcePath: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/lock/${encodeURIComponent(resourcePath)}/history`);
    return res.json();
  }

  // ========== WebSocket (Real-time) ==========

  /**
   * Connect to the coordinator WebSocket for real-time updates
   */
  connectWebSocket(agentId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.baseUrl.replace('http', 'ws') + `/coordinator?agentId=${encodeURIComponent(agentId)}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log(`[DO] WebSocket connected as ${agentId}`);
        resolve();
      };

      this.ws.onerror = (error) => {
        console.error('[DO] WebSocket error:', error);
        reject(error);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const handler = this.messageHandlers.get(data.type);
          if (handler) {
            handler(data.payload);
          }
          // Also call 'all' handler if registered
          const allHandler = this.messageHandlers.get('all');
          if (allHandler) {
            allHandler(data);
          }
        } catch (e) {
          console.error('[DO] Failed to parse WebSocket message:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('[DO] WebSocket disconnected');
        this.ws = null;
      };
    });
  }

  /**
   * Register a handler for WebSocket message types
   */
  onMessage(type: 'agent-update' | 'chat' | 'task-update' | 'lock-update' | 'all', handler: (data: unknown) => void): void {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Send a message through WebSocket
   */
  sendWsMessage(type: string, payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(JSON.stringify({
      type,
      payload,
      timestamp: new Date().toISOString()
    }));
  }

  /**
   * Send a ping to keep connection alive
   */
  ping(): void {
    this.sendWsMessage('ping', {});
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ========== Health Check ==========

  /**
   * Check if the DO service is healthy
   */
  async health(): Promise<{ status: string; service: string; timestamp: string }> {
    const res = await fetch(`${this.baseUrl}/health`);
    return res.json();
  }
}

// Export for both ES modules and CommonJS
export default DOClient;
