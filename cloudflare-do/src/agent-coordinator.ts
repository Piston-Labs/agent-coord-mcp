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

import type { Agent, GroupMessage, Task, WebSocketMessage, Reaction, Zone, Claim, Handoff, Env } from './types';

interface CoordinatorState {
  agents: Record<string, Agent>;
  messages: GroupMessage[];
  tasks: Record<string, Task>;
}

export class AgentCoordinator implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
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

    // Zones - directory ownership
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS zones (
        zone_id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        owner TEXT NOT NULL,
        description TEXT,
        claimed_at TEXT NOT NULL
      )
    `);

    // Claims - task/work claims
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS claims (
        what TEXT PRIMARY KEY,
        by TEXT NOT NULL,
        description TEXT,
        since TEXT NOT NULL
      )
    `);

    // Handoffs - work transfers between agents
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        from_agent TEXT NOT NULL,
        to_agent TEXT,
        title TEXT NOT NULL,
        context TEXT NOT NULL,
        code TEXT,
        file_path TEXT,
        next_steps TEXT DEFAULT '[]',
        priority TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'pending',
        claimed_by TEXT,
        created_at TEXT NOT NULL,
        claimed_at TEXT,
        completed_at TEXT
      )
    `);

    // Create indexes for common queries
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_zones_owner ON zones(owner)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_zones_path ON zones(path)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_claims_by ON claims(by)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_handoffs_status ON handoffs(status)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_handoffs_to_agent ON handoffs(to_agent)`);
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
        case '/zones':
          return this.handleZones(request);
        case '/claims':
          return this.handleClaims(request);
        case '/handoffs':
          return this.handleHandoffs(request);
        case '/work':
          return this.handleWork(request);
        case '/onboard':
          return this.handleOnboard(request);
        case '/session-resume':
          return this.handleSessionResume(request);
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

    // Accept the WebSocket connection with hibernation support
    // Tags are used to identify the agent when broadcasting
    this.state.acceptWebSocket(server, [agentId]);

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
   * Uses hibernation-safe API to get WebSockets that survive DO sleep
   */
  private broadcast(message: WebSocketMessage, exclude?: string) {
    const payload = JSON.stringify(message);

    // Use hibernation API to get all WebSockets (survives DO hibernation)
    const websockets = this.state.getWebSockets();

    for (const ws of websockets) {
      try {
        // Get the agentId tag from the WebSocket
        const tags = this.state.getTags(ws);
        const agentId = tags?.[0];

        if (agentId !== exclude) {
          ws.send(payload);
        }
      } catch (e) {
        // WebSocket is dead, will be cleaned up automatically
        console.error('Failed to send to WebSocket:', e);
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
   *
   * GET params:
   *   - limit: number of messages to return (default 50)
   *   - agentId: if provided, returns pendingMentions and updates lastChatCheck
   *   - since: ISO timestamp to get messages after
   *   - inbox: if 'true', only return messages mentioning agentId
   */
  private async handleChat(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const agentId = url.searchParams.get('agentId');
      const since = url.searchParams.get('since');
      const inboxOnly = url.searchParams.get('inbox') === 'true';

      let messages = this.getMessages(limit * 2); // Get more to filter

      // Filter by timestamp if provided
      if (since) {
        messages = messages.filter(m => new Date(m.timestamp) > new Date(since));
      }

      // If agentId provided, find pending mentions
      let pendingMentions: GroupMessage[] = [];
      if (agentId) {
        const lastCheck = this.getAgentLastChatCheck(agentId);
        const mentionPattern = new RegExp(`@${agentId}\\b|@all\\b|@everyone\\b|@team\\b`, 'i');

        pendingMentions = messages.filter(m => {
          // Skip own messages
          if (m.author === agentId) return false;
          // Check if it mentions this agent
          if (!mentionPattern.test(m.message)) return false;
          // Check if it's new since last check
          if (lastCheck && new Date(m.timestamp) <= new Date(lastCheck)) return false;
          return true;
        });

        // Update last chat check timestamp
        this.updateAgentLastChatCheck(agentId);
      }

      // If inbox only, return just mentions
      if (inboxOnly && agentId) {
        return Response.json({
          messages: pendingMentions,
          count: pendingMentions.length,
          agentId,
          isInbox: true
        });
      }

      // Return regular messages with pending mentions as extra field
      const result: any = {
        messages: messages.slice(0, limit),
        count: messages.length
      };

      if (agentId && pendingMentions.length > 0) {
        result.pendingMentions = pendingMentions;
        result.pendingCount = pendingMentions.length;
        result.hint = `You have ${pendingMentions.length} unread mention(s). Check and respond!`;
      }

      return Response.json(result);
    }

    if (request.method === 'POST') {
      const body = await request.json() as { author: string; message: string; authorType?: string };
      const msg = await this.addMessage(body);
      return Response.json({ success: true, message: msg });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  /**
   * Get agent's last chat check timestamp
   */
  private getAgentLastChatCheck(agentId: string): string | null {
    const result = this.sql.exec(`SELECT last_seen FROM agents WHERE agent_id = ?`, agentId);
    const rows = result.toArray();
    if (rows.length === 0) return null;
    return rows[0].last_seen as string | null;
  }

  /**
   * Update agent's last chat check timestamp
   */
  private updateAgentLastChatCheck(agentId: string): void {
    const now = new Date().toISOString();
    // Upsert the agent record with updated last_seen
    this.sql.exec(`
      INSERT INTO agents (agent_id, status, last_seen)
      VALUES (?, 'active', ?)
      ON CONFLICT(agent_id) DO UPDATE SET last_seen = ?, status = 'active'
    `, agentId, now, now);
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
   * Handle /zones endpoint
   */
  private async handleZones(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const owner = url.searchParams.get('owner');
      const path = url.searchParams.get('path');

      if (path) {
        // Check if a specific path is in a zone
        const zone = this.checkZone(path);
        return Response.json({ zone });
      }

      const zones = this.getZones(owner);
      return Response.json({ zones });
    }

    if (request.method === 'POST') {
      const body = await request.json() as { action: string; zoneId?: string; path?: string; owner?: string; description?: string };

      switch (body.action) {
        case 'claim': {
          if (!body.zoneId || !body.path || !body.owner) {
            return Response.json({ error: 'zoneId, path, and owner required' }, { status: 400 });
          }
          const zone = this.claimZone(body.zoneId, body.path, body.owner, body.description);
          return Response.json({ success: true, zone });
        }
        case 'release': {
          if (!body.zoneId || !body.owner) {
            return Response.json({ error: 'zoneId and owner required' }, { status: 400 });
          }
          const released = this.releaseZone(body.zoneId, body.owner);
          return Response.json({ success: released });
        }
        default:
          return Response.json({ error: 'Invalid action. Use: claim, release' }, { status: 400 });
      }
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  /**
   * Handle /claims endpoint
   */
  private async handleClaims(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const what = url.searchParams.get('what');
      const includeStale = url.searchParams.get('includeStale') === 'true';

      if (what) {
        const claim = this.checkClaim(what);
        return Response.json({ claim });
      }

      const claims = this.listClaims(includeStale);
      return Response.json({ claims });
    }

    if (request.method === 'POST') {
      const body = await request.json() as { action: string; what?: string; by?: string; description?: string };

      switch (body.action) {
        case 'claim': {
          if (!body.what || !body.by) {
            return Response.json({ error: 'what and by required' }, { status: 400 });
          }
          // Check if already claimed
          const existing = this.checkClaim(body.what);
          if (existing && existing.by !== body.by && !existing.stale) {
            return Response.json({
              success: false,
              error: `Already claimed by ${existing.by}`,
              claim: existing
            }, { status: 409 });
          }
          const claim = this.createClaim(body.what, body.by, body.description);
          return Response.json({ success: true, claim });
        }
        case 'release': {
          if (!body.what || !body.by) {
            return Response.json({ error: 'what and by required' }, { status: 400 });
          }
          const released = this.releaseClaim(body.what, body.by);
          return Response.json({ success: released });
        }
        default:
          return Response.json({ error: 'Invalid action. Use: claim, release' }, { status: 400 });
      }
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  /**
   * Handle /work endpoint - returns everything an agent needs on startup
   * Now includes pendingMentions for automatic inbox delivery
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
    const messages = this.getMessages(50); // Get more for mention scanning
    const agents = this.getActiveAgents();

    // Find pending mentions for this agent
    const lastCheck = this.getAgentLastChatCheck(agentId);
    const mentionPattern = new RegExp(`@${agentId}\\b|@all\\b|@everyone\\b|@team\\b`, 'i');

    const pendingMentions = messages.filter(m => {
      if (m.author === agentId) return false;
      if (!mentionPattern.test(m.message)) return false;
      if (lastCheck && new Date(m.timestamp) <= new Date(lastCheck)) return false;
      return true;
    });

    // Update last chat check
    this.updateAgentLastChatCheck(agentId);

    const response: any = {
      agentId,
      summary: {
        activeAgents: agents.length,
        todoTasks: todoTasks.length,
        inProgressTasks: myTasks.filter(t => t.status === 'in-progress').length,
        pendingMentions: pendingMentions.length
      },
      team: agents,
      tasks: { todo: todoTasks, mine: myTasks },
      recentChat: messages.slice(0, 20)
    };

    // Include pending mentions if any
    if (pendingMentions.length > 0) {
      response.inbox = {
        pendingMentions,
        count: pendingMentions.length,
        hint: `You have ${pendingMentions.length} unread mention(s)! Respond to keep the conversation flowing.`
      };
    }

    return Response.json(response);
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

  // ========== Zone Operations ==========

  private getZones(owner?: string | null): Zone[] {
    let query = 'SELECT * FROM zones';
    const params: string[] = [];

    if (owner) {
      query += ' WHERE owner = ?';
      params.push(owner);
    }

    query += ' ORDER BY claimed_at DESC';

    const rows = this.sql.exec(query, ...params).toArray();

    return rows.map(row => ({
      zoneId: row.zone_id as string,
      path: row.path as string,
      owner: row.owner as string,
      description: row.description as string | undefined,
      claimedAt: row.claimed_at as string
    }));
  }

  private checkZone(path: string): Zone | null {
    // Find if this path is within any claimed zone
    const zones = this.getZones();
    for (const zone of zones) {
      if (path.startsWith(zone.path)) {
        return zone;
      }
    }
    return null;
  }

  private claimZone(zoneId: string, path: string, owner: string, description?: string): Zone {
    const now = new Date().toISOString();

    this.sql.exec(`
      INSERT INTO zones (zone_id, path, owner, description, claimed_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(zone_id) DO UPDATE SET
        path = excluded.path,
        owner = excluded.owner,
        description = excluded.description,
        claimed_at = excluded.claimed_at
    `, zoneId, path, owner, description || null, now);

    return { zoneId, path, owner, description, claimedAt: now };
  }

  private releaseZone(zoneId: string, owner: string): boolean {
    const result = this.sql.exec(`
      DELETE FROM zones WHERE zone_id = ? AND owner = ?
    `, zoneId, owner);

    return result.rowsWritten > 0;
  }

  // ========== Claim Operations ==========

  private listClaims(includeStale = false): Claim[] {
    const rows = this.sql.exec('SELECT * FROM claims ORDER BY since DESC').toArray();
    const now = Date.now();
    const staleThreshold = 30 * 60 * 1000; // 30 minutes

    return rows
      .map(row => {
        const since = row.since as string;
        const isStale = now - new Date(since).getTime() > staleThreshold;
        return {
          what: row.what as string,
          by: row.by as string,
          description: row.description as string | undefined,
          since,
          stale: isStale
        };
      })
      .filter(c => includeStale || !c.stale);
  }

  private checkClaim(what: string): Claim | null {
    const rows = this.sql.exec('SELECT * FROM claims WHERE what = ?', what).toArray();
    if (rows.length === 0) return null;

    const row = rows[0];
    const since = row.since as string;
    const staleThreshold = 30 * 60 * 1000;
    const isStale = Date.now() - new Date(since).getTime() > staleThreshold;

    return {
      what: row.what as string,
      by: row.by as string,
      description: row.description as string | undefined,
      since,
      stale: isStale
    };
  }

  private createClaim(what: string, by: string, description?: string): Claim {
    const now = new Date().toISOString();

    this.sql.exec(`
      INSERT INTO claims (what, by, description, since)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(what) DO UPDATE SET
        by = excluded.by,
        description = excluded.description,
        since = excluded.since
    `, what, by, description || null, now);

    return { what, by, description, since: now, stale: false };
  }

  private releaseClaim(what: string, by: string): boolean {
    const result = this.sql.exec(`
      DELETE FROM claims WHERE what = ? AND by = ?
    `, what, by);

    return result.rowsWritten > 0;
  }

  // ========== Handoff Operations ==========

  /**
   * Handle /handoffs endpoint
   */
  private async handleHandoffs(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const id = url.searchParams.get('id');
      const toAgent = url.searchParams.get('toAgent');
      const fromAgent = url.searchParams.get('fromAgent');
      const status = url.searchParams.get('status');

      if (id) {
        const handoff = this.getHandoff(id);
        return Response.json({ handoff });
      }

      const handoffs = this.listHandoffs({ toAgent, fromAgent, status });
      return Response.json({ handoffs });
    }

    if (request.method === 'POST') {
      const body = await request.json() as {
        action?: string;
        fromAgent?: string;
        toAgent?: string;
        title?: string;
        context?: string;
        code?: string;
        filePath?: string;
        nextSteps?: string[];
        priority?: Handoff['priority'];
        handoffId?: string;
        agentId?: string;
      };

      // If no action, assume create
      const action = body.action || 'create';

      switch (action) {
        case 'create': {
          if (!body.fromAgent || !body.title || !body.context) {
            return Response.json({ error: 'fromAgent, title, and context required' }, { status: 400 });
          }
          const handoff = this.createHandoff({
            fromAgent: body.fromAgent,
            toAgent: body.toAgent,
            title: body.title,
            context: body.context,
            code: body.code,
            filePath: body.filePath,
            nextSteps: body.nextSteps || [],
            priority: body.priority || 'medium'
          });

          // Broadcast handoff creation
          this.broadcast({
            type: 'task-update',
            payload: { action: 'handoff-created', handoff },
            timestamp: new Date().toISOString()
          });

          return Response.json({ success: true, handoff });
        }

        case 'claim': {
          if (!body.handoffId || !body.agentId) {
            return Response.json({ error: 'handoffId and agentId required' }, { status: 400 });
          }
          const result = this.claimHandoff(body.handoffId, body.agentId);
          if ('error' in result) {
            return Response.json({ success: false, error: result.error }, { status: 409 });
          }
          return Response.json({ success: true, handoff: result });
        }

        case 'complete': {
          if (!body.handoffId || !body.agentId) {
            return Response.json({ error: 'handoffId and agentId required' }, { status: 400 });
          }
          const result = this.completeHandoff(body.handoffId, body.agentId);
          if ('error' in result) {
            return Response.json({ success: false, error: result.error }, { status: 400 });
          }
          return Response.json({ success: true, handoff: result });
        }

        default:
          return Response.json({ error: 'Invalid action. Use: create, claim, complete' }, { status: 400 });
      }
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  private listHandoffs(filters: { toAgent?: string | null; fromAgent?: string | null; status?: string | null }): Handoff[] {
    let query = 'SELECT * FROM handoffs WHERE 1=1';
    const params: (string | null)[] = [];

    if (filters.toAgent) {
      query += ' AND (to_agent = ? OR to_agent IS NULL)';
      params.push(filters.toAgent);
    }
    if (filters.fromAgent) {
      query += ' AND from_agent = ?';
      params.push(filters.fromAgent);
    }
    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    query += ' ORDER BY created_at DESC';

    const rows = this.sql.exec(query, ...params).toArray();

    return rows.map(row => this.rowToHandoff(row));
  }

  private getHandoff(id: string): Handoff | null {
    const rows = this.sql.exec('SELECT * FROM handoffs WHERE id = ?', id).toArray();
    if (rows.length === 0) return null;
    return this.rowToHandoff(rows[0]);
  }

  private createHandoff(data: {
    fromAgent: string;
    toAgent?: string;
    title: string;
    context: string;
    code?: string;
    filePath?: string;
    nextSteps: string[];
    priority: Handoff['priority'];
  }): Handoff {
    const now = new Date().toISOString();
    const id = `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    this.sql.exec(`
      INSERT INTO handoffs (id, from_agent, to_agent, title, context, code, file_path, next_steps, priority, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `,
      id, data.fromAgent, data.toAgent || null, data.title, data.context,
      data.code || null, data.filePath || null, JSON.stringify(data.nextSteps),
      data.priority, now
    );

    return {
      id,
      fromAgent: data.fromAgent,
      toAgent: data.toAgent,
      title: data.title,
      context: data.context,
      code: data.code,
      filePath: data.filePath,
      nextSteps: data.nextSteps,
      priority: data.priority,
      status: 'pending',
      createdAt: now
    };
  }

  private claimHandoff(id: string, agentId: string): Handoff | { error: string } {
    const handoff = this.getHandoff(id);
    if (!handoff) {
      return { error: 'Handoff not found' };
    }
    if (handoff.status !== 'pending') {
      return { error: `Handoff already ${handoff.status}` };
    }
    if (handoff.toAgent && handoff.toAgent !== agentId) {
      return { error: `Handoff is targeted to ${handoff.toAgent}` };
    }

    const now = new Date().toISOString();
    this.sql.exec(`
      UPDATE handoffs SET status = 'claimed', claimed_by = ?, claimed_at = ? WHERE id = ?
    `, agentId, now, id);

    return {
      ...handoff,
      status: 'claimed',
      claimedBy: agentId,
      claimedAt: now
    };
  }

  private completeHandoff(id: string, agentId: string): Handoff | { error: string } {
    const handoff = this.getHandoff(id);
    if (!handoff) {
      return { error: 'Handoff not found' };
    }
    if (handoff.status !== 'claimed') {
      return { error: `Handoff must be claimed first (current: ${handoff.status})` };
    }
    if (handoff.claimedBy !== agentId) {
      return { error: `Handoff is claimed by ${handoff.claimedBy}` };
    }

    const now = new Date().toISOString();
    this.sql.exec(`
      UPDATE handoffs SET status = 'completed', completed_at = ? WHERE id = ?
    `, now, id);

    return {
      ...handoff,
      status: 'completed',
      completedAt: now
    };
  }

  private rowToHandoff(row: Record<string, unknown>): Handoff {
    return {
      id: row.id as string,
      fromAgent: row.from_agent as string,
      toAgent: row.to_agent as string | undefined,
      title: row.title as string,
      context: row.context as string,
      code: row.code as string | undefined,
      filePath: row.file_path as string | undefined,
      nextSteps: JSON.parse((row.next_steps as string) || '[]'),
      priority: row.priority as Handoff['priority'],
      status: row.status as Handoff['status'],
      claimedBy: row.claimed_by as string | undefined,
      createdAt: row.created_at as string,
      claimedAt: row.claimed_at as string | undefined,
      completedAt: row.completed_at as string | undefined
    };
  }

  // ========== Onboarding Handler ==========

  /**
   * GET /coordinator/onboard?agentId=phoenix
   *
   * Returns a comprehensive onboarding bundle for an agent:
   * - Soul data (create if new)
   * - Checkpoint (if returning)
   * - Team online with flow status
   * - Suggested first task
   * - Recent chat messages
   */
  private async handleOnboard(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const url = new URL(request.url);
    const agentId = url.searchParams.get('agentId');

    if (!agentId) {
      return Response.json({ error: 'agentId query parameter required' }, { status: 400 });
    }

    try {
      // 1. Get soul data from AgentState DO
      const agentStateId = this.env.AGENT_STATE.idFromName(agentId);
      const agentStateStub = this.env.AGENT_STATE.get(agentStateId);

      // Fetch soul data
      const soulUrl = new URL(`http://internal/soul?agentId=${agentId}`);
      const soulResponse = await agentStateStub.fetch(new Request(soulUrl.toString()));
      let soul = null;
      let isNewAgent = false;

      if (soulResponse.ok) {
        const soulData = await soulResponse.json() as { soul: unknown };
        soul = soulData.soul;
      }

      // If no soul, create one
      if (!soul) {
        isNewAgent = true;
        const createSoulResponse = await agentStateStub.fetch(new Request(
          `http://internal/soul?agentId=${agentId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ soulId: agentId, name: agentId })
          }
        ));
        if (createSoulResponse.ok) {
          const createData = await createSoulResponse.json() as { soul: unknown };
          soul = createData.soul;
        }
      }

      // 2. Get checkpoint (if returning)
      let checkpoint = null;
      if (!isNewAgent) {
        const checkpointUrl = new URL(`http://internal/checkpoint?agentId=${agentId}`);
        const checkpointResponse = await agentStateStub.fetch(new Request(checkpointUrl.toString()));
        if (checkpointResponse.ok) {
          const checkpointData = await checkpointResponse.json() as { checkpoint: unknown };
          checkpoint = checkpointData.checkpoint;
        }
      }

      // 3. Get dashboard (includes flow state)
      let dashboard = null;
      const dashboardUrl = new URL(`http://internal/dashboard?agentId=${agentId}`);
      const dashboardResponse = await agentStateStub.fetch(new Request(dashboardUrl.toString()));
      if (dashboardResponse.ok) {
        const dashboardData = await dashboardResponse.json() as { dashboard: unknown };
        dashboard = dashboardData.dashboard;
      }

      // 4. Get team online with flow status
      const teamOnline = await this.getTeamWithFlowStatus();

      // 5. Suggest first task
      const suggestedTask = await this.suggestTask(agentId, soul, checkpoint);

      // 6. Get recent chat (last 5 messages)
      const recentChat = this.sql.exec(`
        SELECT id, author, author_type, message, timestamp
        FROM messages
        ORDER BY timestamp DESC
        LIMIT 5
      `).toArray().map(row => ({
        id: row.id,
        author: row.author,
        authorType: row.author_type,
        message: row.message,
        timestamp: row.timestamp
      })).reverse(); // Oldest first for reading order

      // Build onboarding response
      const onboardingBundle = {
        agentId,
        isNewAgent,
        timestamp: new Date().toISOString(),

        // Soul & progression
        soul,
        dashboard,

        // Context from previous session
        checkpoint,

        // Team context
        teamOnline,

        // What to do next
        suggestedTask,

        // Recent conversation
        recentChat,

        // Welcome message
        welcomeMessage: isNewAgent
          ? `Welcome to the team, ${agentId}! 🎉 You're starting fresh with 0 XP. Complete your first task to begin leveling up!`
          : `Welcome back, ${agentId}! ${checkpoint ? `You were working on: "${checkpoint.conversationSummary || 'a task'}"` : 'Ready to start fresh?'}`
      };

      return Response.json({ onboarding: onboardingBundle });

    } catch (error) {
      return Response.json({
        error: 'Failed to build onboarding bundle',
        details: String(error)
      }, { status: 500 });
    }
  }

  /**
   * Get all online agents with their flow status
   */
  private async getTeamWithFlowStatus(): Promise<Array<{
    agentId: string;
    status: string;
    flowStatus: string;
    currentTask?: string;
  }>> {
    // Get agents from local registry
    const agents = this.sql.exec(`
      SELECT agent_id, status, current_task
      FROM agents
      WHERE status != 'offline'
      ORDER BY last_seen DESC
    `).toArray();

    const teamWithFlow: Array<{
      agentId: string;
      status: string;
      flowStatus: string;
      currentTask?: string;
    }> = [];

    for (const agent of agents) {
      const agentId = agent.agent_id as string;

      // Try to get flow status from AgentState DO
      let flowStatus = 'unknown';
      try {
        const agentStateId = this.env.AGENT_STATE.idFromName(agentId);
        const agentStateStub = this.env.AGENT_STATE.get(agentStateId);
        const dashboardResponse = await agentStateStub.fetch(
          new Request(`http://internal/dashboard?agentId=${agentId}`)
        );
        if (dashboardResponse.ok) {
          const data = await dashboardResponse.json() as { dashboard?: { flow?: { status: string } } };
          flowStatus = data.dashboard?.flow?.status || 'available';
        }
      } catch {
        flowStatus = 'unknown';
      }

      teamWithFlow.push({
        agentId,
        status: agent.status as string,
        flowStatus,
        currentTask: agent.current_task as string | undefined
      });
    }

    return teamWithFlow;
  }

  /**
   * Suggest a task for the agent based on their state
   */
  private async suggestTask(
    agentId: string,
    soul: unknown,
    checkpoint: unknown
  ): Promise<{
    task: string;
    reason: string;
    xpEstimate: number;
    priority: string;
  }> {
    // If returning with checkpoint, suggest resume
    if (checkpoint && typeof checkpoint === 'object' && 'conversationSummary' in checkpoint) {
      const cp = checkpoint as { conversationSummary?: string; pendingWork?: string[] };
      if (cp.conversationSummary || (cp.pendingWork && cp.pendingWork.length > 0)) {
        return {
          task: cp.conversationSummary || cp.pendingWork?.[0] || 'Resume previous work',
          reason: 'Continues your previous session',
          xpEstimate: 30,
          priority: 'high'
        };
      }
    }

    // Check for pending escalations (help opportunity)
    const pendingHandoffs = this.sql.exec(`
      SELECT title FROM handoffs WHERE status = 'pending' LIMIT 1
    `).toArray();

    if (pendingHandoffs.length > 0) {
      return {
        task: `Help needed: ${pendingHandoffs[0].title}`,
        reason: 'Someone needs help! Great XP opportunity',
        xpEstimate: 50,
        priority: 'medium'
      };
    }

    // Check for unassigned tasks
    const unassignedTasks = this.sql.exec(`
      SELECT title, priority FROM tasks WHERE assignee IS NULL AND status = 'todo' LIMIT 1
    `).toArray();

    if (unassignedTasks.length > 0) {
      return {
        task: unassignedTasks[0].title as string,
        reason: 'Unassigned task waiting for pickup',
        xpEstimate: 25,
        priority: unassignedTasks[0].priority as string
      };
    }

    // Default: introduce yourself
    return {
      task: 'Introduce yourself in the group chat',
      reason: 'Say hello to the team!',
      xpEstimate: 10,
      priority: 'low'
    };
  }

  // ========== Session Resume Handler ==========

  /**
   * GET /coordinator/session-resume
   *
   * Returns everything needed for the CEO Portal "Resume Last Session" feature:
   * - Last session summary (from recent chat patterns)
   * - Agents who participated
   * - Key accomplishments
   * - Pending work/handoffs
   * - Quick action buttons
   *
   * This aggregates data to give Tyler a one-click way to pick up where the team left off.
   */
  private async handleSessionResume(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
      // 1. Get recent messages to analyze session activity
      const recentMessages = this.sql.exec(`
        SELECT id, author, author_type, message, timestamp
        FROM messages
        ORDER BY timestamp DESC
        LIMIT 100
      `).toArray();

      // 2. Identify session participants (unique authors in recent chat)
      const participants = new Map<string, {
        agentId: string;
        messageCount: number;
        lastMessage: string;
        lastActive: string;
      }>();

      for (const msg of recentMessages) {
        const author = msg.author as string;
        const authorType = msg.author_type as string;
        if (authorType === 'agent' || authorType === 'human') {
          if (!participants.has(author)) {
            participants.set(author, {
              agentId: author,
              messageCount: 1,
              lastMessage: (msg.message as string).substring(0, 100),
              lastActive: msg.timestamp as string
            });
          } else {
            participants.get(author)!.messageCount++;
          }
        }
      }

      // 3. Find session accomplishments (look for ✅, shipped, completed keywords)
      const accomplishments: string[] = [];
      const accomplishmentKeywords = ['✅', 'shipped', 'completed', 'built', 'added', 'fixed', 'implemented', 'deployed'];

      for (const msg of recentMessages) {
        const message = (msg.message as string).toLowerCase();
        if (accomplishmentKeywords.some(kw => message.includes(kw))) {
          // Extract the accomplishment (first line usually has the summary)
          const firstLine = (msg.message as string).split('\n')[0].substring(0, 150);
          if (!accomplishments.includes(firstLine) && accomplishments.length < 10) {
            accomplishments.push(firstLine);
          }
        }
      }

      // 4. Get pending handoffs
      const pendingHandoffs = this.sql.exec(`
        SELECT id, title, from_agent, context, priority, created_at
        FROM handoffs
        WHERE status = 'pending'
        ORDER BY created_at DESC
        LIMIT 5
      `).toArray().map(row => ({
        id: row.id,
        title: row.title,
        fromAgent: row.from_agent,
        context: (row.context as string).substring(0, 200),
        priority: row.priority,
        createdAt: row.created_at
      }));

      // 5. Get in-progress tasks
      const inProgressTasks = this.sql.exec(`
        SELECT id, title, assignee, priority, description
        FROM tasks
        WHERE status = 'in-progress'
        ORDER BY updated_at DESC
        LIMIT 5
      `).toArray().map(row => ({
        id: row.id,
        title: row.title,
        assignee: row.assignee,
        priority: row.priority,
        description: row.description
      }));

      // 6. Get active claims (what agents are currently working on)
      const activeClaims = this.sql.exec(`
        SELECT what, by, description, since
        FROM claims
        ORDER BY since DESC
        LIMIT 10
      `).toArray().map(row => ({
        what: row.what,
        by: row.by,
        description: row.description,
        since: row.since
      }));

      // 7. Build quick actions based on state
      const quickActions: Array<{
        action: string;
        label: string;
        description: string;
        priority: 'high' | 'medium' | 'low';
      }> = [];

      if (pendingHandoffs.length > 0) {
        quickActions.push({
          action: 'review_handoffs',
          label: '📋 Review Handoffs',
          description: `${pendingHandoffs.length} handoff(s) need attention`,
          priority: 'high'
        });
      }

      if (inProgressTasks.length > 0) {
        quickActions.push({
          action: 'check_progress',
          label: '🔄 Check In-Progress',
          description: `${inProgressTasks.length} task(s) in progress`,
          priority: 'medium'
        });
      }

      quickActions.push({
        action: 'spawn_team',
        label: '🚀 Spawn Agent Team',
        description: 'Start a new autonomous session',
        priority: 'medium'
      });

      quickActions.push({
        action: 'view_chat',
        label: '💬 View Group Chat',
        description: 'See latest team discussion',
        priority: 'low'
      });

      // 8. Calculate session timeframe
      let sessionStart: string | null = null;
      let sessionEnd: string | null = null;

      if (recentMessages.length > 0) {
        sessionEnd = recentMessages[0].timestamp as string;
        sessionStart = recentMessages[recentMessages.length - 1].timestamp as string;
      }

      // 9. Build the resume bundle
      const resumeBundle = {
        timestamp: new Date().toISOString(),

        // Session overview
        session: {
          messageCount: recentMessages.length,
          participantCount: participants.size,
          startTime: sessionStart,
          endTime: sessionEnd,
          durationDescription: sessionStart && sessionEnd
            ? this.formatDuration(new Date(sessionStart), new Date(sessionEnd))
            : 'Unknown'
        },

        // Who participated
        participants: Array.from(participants.values())
          .sort((a, b) => b.messageCount - a.messageCount),

        // What got done
        accomplishments: accomplishments.slice(0, 10),

        // What's pending
        pending: {
          handoffs: pendingHandoffs,
          tasks: inProgressTasks,
          claims: activeClaims
        },

        // Quick action buttons for CEO Portal
        quickActions,

        // Most recent context (last 5 messages for quick scan)
        recentContext: recentMessages.slice(0, 5).map(msg => ({
          author: msg.author,
          message: (msg.message as string).substring(0, 200),
          timestamp: msg.timestamp
        })).reverse(), // Chronological order

        // Summary for one-line display
        summaryText: this.buildSummaryText(
          participants.size,
          accomplishments.length,
          pendingHandoffs.length,
          inProgressTasks.length
        )
      };

      return Response.json({ sessionResume: resumeBundle });

    } catch (error) {
      return Response.json({
        error: 'Failed to build session resume',
        details: String(error)
      }, { status: 500 });
    }
  }

  /**
   * Format duration between two dates
   */
  private formatDuration(start: Date, end: Date): string {
    const diffMs = end.getTime() - start.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);

    if (diffHours > 0) {
      const remainingMins = diffMins % 60;
      return `${diffHours}h ${remainingMins}m`;
    }
    return `${diffMins}m`;
  }

  /**
   * Build a one-line summary for quick display
   */
  private buildSummaryText(
    participantCount: number,
    accomplishmentCount: number,
    pendingHandoffs: number,
    inProgressTasks: number
  ): string {
    const parts: string[] = [];

    if (participantCount > 0) {
      parts.push(`${participantCount} agent${participantCount > 1 ? 's' : ''} active`);
    }

    if (accomplishmentCount > 0) {
      parts.push(`${accomplishmentCount} thing${accomplishmentCount > 1 ? 's' : ''} shipped`);
    }

    if (pendingHandoffs > 0) {
      parts.push(`${pendingHandoffs} handoff${pendingHandoffs > 1 ? 's' : ''} pending`);
    }

    if (inProgressTasks > 0) {
      parts.push(`${inProgressTasks} task${inProgressTasks > 1 ? 's' : ''} in progress`);
    }

    return parts.join(' • ') || 'No recent activity';
  }
}
