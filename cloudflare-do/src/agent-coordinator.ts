/**
 * AgentCoordinator - Control Plane Durable Object
 *
 * This is the central coordinator that manages:
 * - Agent registry (which agents are online)
 * - Group chat messages
 * - Task assignment and routing
 * - WebSocket connections for real-time updates
 *
 * Pattern: Single instance handles all coordination logic
 * Scale: For high-scale, could shard by team/workspace
 */

import type { Agent, GroupMessage, Task, WebSocketMessage, Reaction } from './types';

interface CoordinatorState {
  agents: Record<string, Agent>;
  messages: GroupMessage[];
  tasks: Record<string, Task>;
}

export class AgentCoordinator implements DurableObject {
  private state: DurableObjectState;
  private connections: Map<string, WebSocket> = new Map();
  private sql: SqlStorage;

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state;
    this.sql = state.storage.sql;

    // Initialize SQLite tables on first access
    this.initializeDatabase();
  }

  private initializeDatabase() {
    // Agents table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        status TEXT DEFAULT 'offline',
        current_task TEXT,
        working_on TEXT,
        last_seen TEXT,
        capabilities TEXT,
        offers TEXT,
        needs TEXT
      )
    `);

    // Group chat messages
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        author TEXT NOT NULL,
        author_type TEXT DEFAULT 'agent',
        message TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        reactions TEXT DEFAULT '[]'
      )
    `);

    // Tasks
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'todo',
        assignee TEXT,
        created_by TEXT NOT NULL,
        priority TEXT DEFAULT 'medium',
        tags TEXT DEFAULT '[]',
        files TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Create indexes for common queries
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee)`);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // WebSocket upgrade for real-time connections
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    // REST API endpoints
    try {
      switch (path) {
        case '/agents':
          return this.handleAgents(request);
        case '/chat':
          return this.handleChat(request);
        case '/tasks':
          return this.handleTasks(request);
        case '/work':
          return this.handleWork(request);
        case '/health':
          return Response.json({ status: 'ok', type: 'coordinator' });
        default:
          return Response.json({ error: 'Not found' }, { status: 404 });
      }
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  /**
   * WebSocket handler for real-time updates
   */
  private handleWebSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Get agent ID from query param
    const url = new URL(request.url);
    const agentId = url.searchParams.get('agentId') || `anon-${Date.now()}`;

    // Accept the WebSocket connection
    this.state.acceptWebSocket(server, [agentId]);
    this.connections.set(agentId, server);

    // Mark agent as active
    this.updateAgentStatus(agentId, 'active');

    // Send current state to new connection
    const welcome: WebSocketMessage = {
      type: 'agent-update',
      payload: {
        agents: this.getActiveAgents(),
        message: `Welcome ${agentId}!`
      },
      timestamp: new Date().toISOString()
    };
    server.send(JSON.stringify(welcome));

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Handle WebSocket messages
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(message as string) as WebSocketMessage;
      const tags = this.state.getWebSocketAutoResponseTimestamp(ws);
      const agentId = this.state.getTags(ws)?.[0] || 'unknown';

      switch (data.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          this.updateAgentStatus(agentId, 'active');
          break;

        case 'chat':
          await this.addMessage(data.payload as { author: string; message: string });
          break;

        case 'agent-update':
          this.updateAgentStatus(agentId, (data.payload as { status: string }).status as Agent['status']);
          break;
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket) {
    const agentId = this.state.getTags(ws)?.[0];
    if (agentId) {
      this.connections.delete(agentId);
      this.updateAgentStatus(agentId, 'offline');
      this.broadcast({
        type: 'agent-update',
        payload: { agentId, status: 'offline' },
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Broadcast message to all connected WebSockets
   */
  private broadcast(message: WebSocketMessage, exclude?: string) {
    const payload = JSON.stringify(message);
    for (const [agentId, ws] of this.connections) {
      if (agentId !== exclude) {
        try {
          ws.send(payload);
        } catch {
          this.connections.delete(agentId);
        }
      }
    }
  }

  /**
   * Handle /agents endpoint
   */
  private async handleAgents(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      return Response.json({ agents: this.getActiveAgents() });
    }

    if (request.method === 'POST') {
      const body = await request.json() as Partial<Agent> & { agentId: string };
      this.updateAgent(body);

      // Broadcast agent update
      this.broadcast({
        type: 'agent-update',
        payload: body,
        timestamp: new Date().toISOString()
      });

      return Response.json({ success: true, agent: body });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  /**
   * Handle /chat endpoint
   */
  private async handleChat(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const limit = parseInt(url.searchParams.get('limit') || '50');
      return Response.json({ messages: this.getMessages(limit) });
    }

    if (request.method === 'POST') {
      const body = await request.json() as { author: string; message: string; authorType?: string };
      const msg = await this.addMessage(body);
      return Response.json({ success: true, message: msg });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  /**
   * Handle /tasks endpoint
   */
  private async handleTasks(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const assignee = url.searchParams.get('assignee');
      return Response.json({ tasks: this.getTasks(status, assignee) });
    }

    if (request.method === 'POST') {
      const body = await request.json() as Partial<Task>;
      const task = this.createTask(body);

      this.broadcast({
        type: 'task-update',
        payload: task,
        timestamp: new Date().toISOString()
      });

      return Response.json({ success: true, task });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  /**
   * Handle /work endpoint - returns everything an agent needs on startup
   */
  private async handleWork(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const agentId = url.searchParams.get('agentId');

    if (!agentId) {
      return Response.json({ error: 'agentId required' }, { status: 400 });
    }

    // Mark agent as active
    this.updateAgentStatus(agentId, 'active');

    // Get agent's assigned tasks
    const myTasks = this.getTasks(null, agentId);
    const todoTasks = this.getTasks('todo', null);
    const messages = this.getMessages(20);
    const agents = this.getActiveAgents();

    return Response.json({
      agentId,
      summary: {
        activeAgents: agents.length,
        todoTasks: todoTasks.length,
        inProgressTasks: myTasks.filter(t => t.status === 'in-progress').length
      },
      team: agents,
      tasks: { todo: todoTasks, mine: myTasks },
      recentChat: messages
    });
  }

  // ========== Database Operations ==========

  private getActiveAgents(): Agent[] {
    const rows = this.sql.exec(`
      SELECT * FROM agents
      WHERE status != 'offline'
      ORDER BY last_seen DESC
    `).toArray();

    return rows.map(row => ({
      agentId: row.agent_id as string,
      status: row.status as Agent['status'],
      currentTask: row.current_task as string | undefined,
      workingOn: row.working_on as string | undefined,
      lastSeen: row.last_seen as string,
      capabilities: JSON.parse((row.capabilities as string) || '[]'),
      offers: JSON.parse((row.offers as string) || '[]'),
      needs: JSON.parse((row.needs as string) || '[]')
    }));
  }

  private updateAgentStatus(agentId: string, status: Agent['status']) {
    const now = new Date().toISOString();
    this.sql.exec(`
      INSERT INTO agents (agent_id, status, last_seen)
      VALUES (?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        status = excluded.status,
        last_seen = excluded.last_seen
    `, agentId, status, now);
  }

  private updateAgent(agent: Partial<Agent> & { agentId: string }) {
    const now = new Date().toISOString();
    this.sql.exec(`
      INSERT INTO agents (agent_id, status, current_task, working_on, last_seen, capabilities, offers, needs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        status = COALESCE(excluded.status, agents.status),
        current_task = COALESCE(excluded.current_task, agents.current_task),
        working_on = COALESCE(excluded.working_on, agents.working_on),
        last_seen = excluded.last_seen,
        capabilities = COALESCE(excluded.capabilities, agents.capabilities),
        offers = COALESCE(excluded.offers, agents.offers),
        needs = COALESCE(excluded.needs, agents.needs)
    `,
      agent.agentId,
      agent.status || 'active',
      agent.currentTask || null,
      agent.workingOn || null,
      now,
      JSON.stringify(agent.capabilities || []),
      JSON.stringify(agent.offers || []),
      JSON.stringify(agent.needs || [])
    );
  }

  private getMessages(limit: number): GroupMessage[] {
    const rows = this.sql.exec(`
      SELECT * FROM messages
      ORDER BY timestamp DESC
      LIMIT ?
    `, limit).toArray();

    return rows.map(row => ({
      id: row.id as string,
      author: row.author as string,
      authorType: row.author_type as GroupMessage['authorType'],
      message: row.message as string,
      timestamp: row.timestamp as string,
      reactions: JSON.parse((row.reactions as string) || '[]')
    })).reverse(); // Reverse to get chronological order
  }

  private async addMessage(data: { author: string; message: string; authorType?: string }): Promise<GroupMessage> {
    const msg: GroupMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      author: data.author,
      authorType: (data.authorType || 'agent') as GroupMessage['authorType'],
      message: data.message,
      timestamp: new Date().toISOString(),
      reactions: []
    };

    this.sql.exec(`
      INSERT INTO messages (id, author, author_type, message, timestamp, reactions)
      VALUES (?, ?, ?, ?, ?, ?)
    `, msg.id, msg.author, msg.authorType, msg.message, msg.timestamp, '[]');

    // Broadcast to all connected agents
    this.broadcast({
      type: 'chat',
      payload: msg,
      timestamp: msg.timestamp
    });

    return msg;
  }

  private getTasks(status: string | null, assignee: string | null): Task[] {
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params: (string | null)[] = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (assignee) {
      query += ' AND assignee = ?';
      params.push(assignee);
    }

    query += ' ORDER BY created_at DESC';

    const rows = this.sql.exec(query, ...params).toArray();

    return rows.map(row => ({
      id: row.id as string,
      title: row.title as string,
      description: row.description as string | undefined,
      status: row.status as Task['status'],
      assignee: row.assignee as string | undefined,
      createdBy: row.created_by as string,
      priority: row.priority as Task['priority'],
      tags: JSON.parse((row.tags as string) || '[]'),
      files: JSON.parse((row.files as string) || '[]'),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    }));
  }

  private createTask(data: Partial<Task>): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: data.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: data.title || 'Untitled Task',
      description: data.description,
      status: data.status || 'todo',
      assignee: data.assignee,
      createdBy: data.createdBy || 'system',
      priority: data.priority || 'medium',
      tags: data.tags || [],
      files: data.files || [],
      createdAt: now,
      updatedAt: now
    };

    this.sql.exec(`
      INSERT INTO tasks (id, title, description, status, assignee, created_by, priority, tags, files, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      task.id, task.title, task.description || null, task.status, task.assignee || null,
      task.createdBy, task.priority, JSON.stringify(task.tags), JSON.stringify(task.files),
      task.createdAt, task.updatedAt
    );

    return task;
  }
}
