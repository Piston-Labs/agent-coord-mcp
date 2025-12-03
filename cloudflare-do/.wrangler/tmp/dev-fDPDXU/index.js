var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/agent-coordinator.ts
var AgentCoordinator = class {
  static {
    __name(this, "AgentCoordinator");
  }
  state;
  connections = /* @__PURE__ */ new Map();
  sql;
  constructor(state, env) {
    this.state = state;
    this.sql = state.storage.sql;
    this.initializeDatabase();
  }
  initializeDatabase() {
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
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS zones (
        zone_id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        owner TEXT NOT NULL,
        description TEXT,
        claimed_at TEXT NOT NULL
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS claims (
        what TEXT PRIMARY KEY,
        by TEXT NOT NULL,
        description TEXT,
        since TEXT NOT NULL
      )
    `);
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
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }
    try {
      switch (path) {
        case "/agents":
          return this.handleAgents(request);
        case "/chat":
          return this.handleChat(request);
        case "/tasks":
          return this.handleTasks(request);
        case "/zones":
          return this.handleZones(request);
        case "/claims":
          return this.handleClaims(request);
        case "/handoffs":
          return this.handleHandoffs(request);
        case "/work":
          return this.handleWork(request);
        case "/health":
          return Response.json({ status: "ok", type: "coordinator" });
        default:
          return Response.json({ error: "Not found" }, { status: 404 });
      }
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }
  /**
   * WebSocket handler for real-time updates
   */
  handleWebSocket(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const url = new URL(request.url);
    const agentId = url.searchParams.get("agentId") || `anon-${Date.now()}`;
    this.state.acceptWebSocket(server, [agentId]);
    this.connections.set(agentId, server);
    this.updateAgentStatus(agentId, "active");
    const welcome = {
      type: "agent-update",
      payload: {
        agents: this.getActiveAgents(),
        message: `Welcome ${agentId}!`
      },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    server.send(JSON.stringify(welcome));
    return new Response(null, { status: 101, webSocket: client });
  }
  /**
   * Handle WebSocket messages
   */
  async webSocketMessage(ws, message) {
    try {
      const data = JSON.parse(message);
      const tags = this.state.getWebSocketAutoResponseTimestamp(ws);
      const agentId = this.state.getTags(ws)?.[0] || "unknown";
      switch (data.type) {
        case "ping":
          ws.send(JSON.stringify({ type: "pong", timestamp: (/* @__PURE__ */ new Date()).toISOString() }));
          this.updateAgentStatus(agentId, "active");
          break;
        case "chat":
          await this.addMessage(data.payload);
          break;
        case "agent-update":
          this.updateAgentStatus(agentId, data.payload.status);
          break;
      }
    } catch (error) {
      console.error("WebSocket message error:", error);
    }
  }
  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws) {
    const agentId = this.state.getTags(ws)?.[0];
    if (agentId) {
      this.connections.delete(agentId);
      this.updateAgentStatus(agentId, "offline");
      this.broadcast({
        type: "agent-update",
        payload: { agentId, status: "offline" },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }
  /**
   * Broadcast message to all connected WebSockets
   */
  broadcast(message, exclude) {
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
  async handleAgents(request) {
    if (request.method === "GET") {
      return Response.json({ agents: this.getActiveAgents() });
    }
    if (request.method === "POST") {
      const body = await request.json();
      this.updateAgent(body);
      this.broadcast({
        type: "agent-update",
        payload: body,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      return Response.json({ success: true, agent: body });
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  /**
   * Handle /chat endpoint
   */
  async handleChat(request) {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const limit = parseInt(url.searchParams.get("limit") || "50");
      return Response.json({ messages: this.getMessages(limit) });
    }
    if (request.method === "POST") {
      const body = await request.json();
      const msg = await this.addMessage(body);
      return Response.json({ success: true, message: msg });
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  /**
   * Handle /tasks endpoint
   */
  async handleTasks(request) {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const status = url.searchParams.get("status");
      const assignee = url.searchParams.get("assignee");
      return Response.json({ tasks: this.getTasks(status, assignee) });
    }
    if (request.method === "POST") {
      const body = await request.json();
      const task = this.createTask(body);
      this.broadcast({
        type: "task-update",
        payload: task,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      return Response.json({ success: true, task });
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  /**
   * Handle /zones endpoint
   */
  async handleZones(request) {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const owner = url.searchParams.get("owner");
      const path = url.searchParams.get("path");
      if (path) {
        const zone = this.checkZone(path);
        return Response.json({ zone });
      }
      const zones = this.getZones(owner);
      return Response.json({ zones });
    }
    if (request.method === "POST") {
      const body = await request.json();
      switch (body.action) {
        case "claim": {
          if (!body.zoneId || !body.path || !body.owner) {
            return Response.json({ error: "zoneId, path, and owner required" }, { status: 400 });
          }
          const zone = this.claimZone(body.zoneId, body.path, body.owner, body.description);
          return Response.json({ success: true, zone });
        }
        case "release": {
          if (!body.zoneId || !body.owner) {
            return Response.json({ error: "zoneId and owner required" }, { status: 400 });
          }
          const released = this.releaseZone(body.zoneId, body.owner);
          return Response.json({ success: released });
        }
        default:
          return Response.json({ error: "Invalid action. Use: claim, release" }, { status: 400 });
      }
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  /**
   * Handle /claims endpoint
   */
  async handleClaims(request) {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const what = url.searchParams.get("what");
      const includeStale = url.searchParams.get("includeStale") === "true";
      if (what) {
        const claim = this.checkClaim(what);
        return Response.json({ claim });
      }
      const claims = this.listClaims(includeStale);
      return Response.json({ claims });
    }
    if (request.method === "POST") {
      const body = await request.json();
      switch (body.action) {
        case "claim": {
          if (!body.what || !body.by) {
            return Response.json({ error: "what and by required" }, { status: 400 });
          }
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
        case "release": {
          if (!body.what || !body.by) {
            return Response.json({ error: "what and by required" }, { status: 400 });
          }
          const released = this.releaseClaim(body.what, body.by);
          return Response.json({ success: released });
        }
        default:
          return Response.json({ error: "Invalid action. Use: claim, release" }, { status: 400 });
      }
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  /**
   * Handle /work endpoint - returns everything an agent needs on startup
   */
  async handleWork(request) {
    const url = new URL(request.url);
    const agentId = url.searchParams.get("agentId");
    if (!agentId) {
      return Response.json({ error: "agentId required" }, { status: 400 });
    }
    this.updateAgentStatus(agentId, "active");
    const myTasks = this.getTasks(null, agentId);
    const todoTasks = this.getTasks("todo", null);
    const messages = this.getMessages(20);
    const agents = this.getActiveAgents();
    return Response.json({
      agentId,
      summary: {
        activeAgents: agents.length,
        todoTasks: todoTasks.length,
        inProgressTasks: myTasks.filter((t) => t.status === "in-progress").length
      },
      team: agents,
      tasks: { todo: todoTasks, mine: myTasks },
      recentChat: messages
    });
  }
  // ========== Database Operations ==========
  getActiveAgents() {
    const rows = this.sql.exec(`
      SELECT * FROM agents
      WHERE status != 'offline'
      ORDER BY last_seen DESC
    `).toArray();
    return rows.map((row) => ({
      agentId: row.agent_id,
      status: row.status,
      currentTask: row.current_task,
      workingOn: row.working_on,
      lastSeen: row.last_seen,
      capabilities: JSON.parse(row.capabilities || "[]"),
      offers: JSON.parse(row.offers || "[]"),
      needs: JSON.parse(row.needs || "[]")
    }));
  }
  updateAgentStatus(agentId, status) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.sql.exec(`
      INSERT INTO agents (agent_id, status, last_seen)
      VALUES (?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        status = excluded.status,
        last_seen = excluded.last_seen
    `, agentId, status, now);
  }
  updateAgent(agent) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.sql.exec(
      `
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
      agent.status || "active",
      agent.currentTask || null,
      agent.workingOn || null,
      now,
      JSON.stringify(agent.capabilities || []),
      JSON.stringify(agent.offers || []),
      JSON.stringify(agent.needs || [])
    );
  }
  getMessages(limit) {
    const rows = this.sql.exec(`
      SELECT * FROM messages
      ORDER BY timestamp DESC
      LIMIT ?
    `, limit).toArray();
    return rows.map((row) => ({
      id: row.id,
      author: row.author,
      authorType: row.author_type,
      message: row.message,
      timestamp: row.timestamp,
      reactions: JSON.parse(row.reactions || "[]")
    })).reverse();
  }
  async addMessage(data) {
    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      author: data.author,
      authorType: data.authorType || "agent",
      message: data.message,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      reactions: []
    };
    this.sql.exec(`
      INSERT INTO messages (id, author, author_type, message, timestamp, reactions)
      VALUES (?, ?, ?, ?, ?, ?)
    `, msg.id, msg.author, msg.authorType, msg.message, msg.timestamp, "[]");
    this.broadcast({
      type: "chat",
      payload: msg,
      timestamp: msg.timestamp
    });
    return msg;
  }
  getTasks(status, assignee) {
    let query = "SELECT * FROM tasks WHERE 1=1";
    const params = [];
    if (status) {
      query += " AND status = ?";
      params.push(status);
    }
    if (assignee) {
      query += " AND assignee = ?";
      params.push(assignee);
    }
    query += " ORDER BY created_at DESC";
    const rows = this.sql.exec(query, ...params).toArray();
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      assignee: row.assignee,
      createdBy: row.created_by,
      priority: row.priority,
      tags: JSON.parse(row.tags || "[]"),
      files: JSON.parse(row.files || "[]"),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }
  createTask(data) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const task = {
      id: data.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: data.title || "Untitled Task",
      description: data.description,
      status: data.status || "todo",
      assignee: data.assignee,
      createdBy: data.createdBy || "system",
      priority: data.priority || "medium",
      tags: data.tags || [],
      files: data.files || [],
      createdAt: now,
      updatedAt: now
    };
    this.sql.exec(
      `
      INSERT INTO tasks (id, title, description, status, assignee, created_by, priority, tags, files, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      task.id,
      task.title,
      task.description || null,
      task.status,
      task.assignee || null,
      task.createdBy,
      task.priority,
      JSON.stringify(task.tags),
      JSON.stringify(task.files),
      task.createdAt,
      task.updatedAt
    );
    return task;
  }
  // ========== Zone Operations ==========
  getZones(owner) {
    let query = "SELECT * FROM zones";
    const params = [];
    if (owner) {
      query += " WHERE owner = ?";
      params.push(owner);
    }
    query += " ORDER BY claimed_at DESC";
    const rows = this.sql.exec(query, ...params).toArray();
    return rows.map((row) => ({
      zoneId: row.zone_id,
      path: row.path,
      owner: row.owner,
      description: row.description,
      claimedAt: row.claimed_at
    }));
  }
  checkZone(path) {
    const zones = this.getZones();
    for (const zone of zones) {
      if (path.startsWith(zone.path)) {
        return zone;
      }
    }
    return null;
  }
  claimZone(zoneId, path, owner, description) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
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
  releaseZone(zoneId, owner) {
    const result = this.sql.exec(`
      DELETE FROM zones WHERE zone_id = ? AND owner = ?
    `, zoneId, owner);
    return result.rowsWritten > 0;
  }
  // ========== Claim Operations ==========
  listClaims(includeStale = false) {
    const rows = this.sql.exec("SELECT * FROM claims ORDER BY since DESC").toArray();
    const now = Date.now();
    const staleThreshold = 30 * 60 * 1e3;
    return rows.map((row) => {
      const since = row.since;
      const isStale = now - new Date(since).getTime() > staleThreshold;
      return {
        what: row.what,
        by: row.by,
        description: row.description,
        since,
        stale: isStale
      };
    }).filter((c) => includeStale || !c.stale);
  }
  checkClaim(what) {
    const rows = this.sql.exec("SELECT * FROM claims WHERE what = ?", what).toArray();
    if (rows.length === 0) return null;
    const row = rows[0];
    const since = row.since;
    const staleThreshold = 30 * 60 * 1e3;
    const isStale = Date.now() - new Date(since).getTime() > staleThreshold;
    return {
      what: row.what,
      by: row.by,
      description: row.description,
      since,
      stale: isStale
    };
  }
  createClaim(what, by, description) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
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
  releaseClaim(what, by) {
    const result = this.sql.exec(`
      DELETE FROM claims WHERE what = ? AND by = ?
    `, what, by);
    return result.rowsWritten > 0;
  }
  // ========== Handoff Operations ==========
  /**
   * Handle /handoffs endpoint
   */
  async handleHandoffs(request) {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const id = url.searchParams.get("id");
      const toAgent = url.searchParams.get("toAgent");
      const fromAgent = url.searchParams.get("fromAgent");
      const status = url.searchParams.get("status");
      if (id) {
        const handoff = this.getHandoff(id);
        return Response.json({ handoff });
      }
      const handoffs = this.listHandoffs({ toAgent, fromAgent, status });
      return Response.json({ handoffs });
    }
    if (request.method === "POST") {
      const body = await request.json();
      const action = body.action || "create";
      switch (action) {
        case "create": {
          if (!body.fromAgent || !body.title || !body.context) {
            return Response.json({ error: "fromAgent, title, and context required" }, { status: 400 });
          }
          const handoff = this.createHandoff({
            fromAgent: body.fromAgent,
            toAgent: body.toAgent,
            title: body.title,
            context: body.context,
            code: body.code,
            filePath: body.filePath,
            nextSteps: body.nextSteps || [],
            priority: body.priority || "medium"
          });
          this.broadcast({
            type: "task-update",
            payload: { action: "handoff-created", handoff },
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
          return Response.json({ success: true, handoff });
        }
        case "claim": {
          if (!body.handoffId || !body.agentId) {
            return Response.json({ error: "handoffId and agentId required" }, { status: 400 });
          }
          const result = this.claimHandoff(body.handoffId, body.agentId);
          if ("error" in result) {
            return Response.json({ success: false, error: result.error }, { status: 409 });
          }
          return Response.json({ success: true, handoff: result });
        }
        case "complete": {
          if (!body.handoffId || !body.agentId) {
            return Response.json({ error: "handoffId and agentId required" }, { status: 400 });
          }
          const result = this.completeHandoff(body.handoffId, body.agentId);
          if ("error" in result) {
            return Response.json({ success: false, error: result.error }, { status: 400 });
          }
          return Response.json({ success: true, handoff: result });
        }
        default:
          return Response.json({ error: "Invalid action. Use: create, claim, complete" }, { status: 400 });
      }
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  listHandoffs(filters) {
    let query = "SELECT * FROM handoffs WHERE 1=1";
    const params = [];
    if (filters.toAgent) {
      query += " AND (to_agent = ? OR to_agent IS NULL)";
      params.push(filters.toAgent);
    }
    if (filters.fromAgent) {
      query += " AND from_agent = ?";
      params.push(filters.fromAgent);
    }
    if (filters.status) {
      query += " AND status = ?";
      params.push(filters.status);
    }
    query += " ORDER BY created_at DESC";
    const rows = this.sql.exec(query, ...params).toArray();
    return rows.map((row) => this.rowToHandoff(row));
  }
  getHandoff(id) {
    const rows = this.sql.exec("SELECT * FROM handoffs WHERE id = ?", id).toArray();
    if (rows.length === 0) return null;
    return this.rowToHandoff(rows[0]);
  }
  createHandoff(data) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const id = `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.sql.exec(
      `
      INSERT INTO handoffs (id, from_agent, to_agent, title, context, code, file_path, next_steps, priority, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `,
      id,
      data.fromAgent,
      data.toAgent || null,
      data.title,
      data.context,
      data.code || null,
      data.filePath || null,
      JSON.stringify(data.nextSteps),
      data.priority,
      now
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
      status: "pending",
      createdAt: now
    };
  }
  claimHandoff(id, agentId) {
    const handoff = this.getHandoff(id);
    if (!handoff) {
      return { error: "Handoff not found" };
    }
    if (handoff.status !== "pending") {
      return { error: `Handoff already ${handoff.status}` };
    }
    if (handoff.toAgent && handoff.toAgent !== agentId) {
      return { error: `Handoff is targeted to ${handoff.toAgent}` };
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.sql.exec(`
      UPDATE handoffs SET status = 'claimed', claimed_by = ?, claimed_at = ? WHERE id = ?
    `, agentId, now, id);
    return {
      ...handoff,
      status: "claimed",
      claimedBy: agentId,
      claimedAt: now
    };
  }
  completeHandoff(id, agentId) {
    const handoff = this.getHandoff(id);
    if (!handoff) {
      return { error: "Handoff not found" };
    }
    if (handoff.status !== "claimed") {
      return { error: `Handoff must be claimed first (current: ${handoff.status})` };
    }
    if (handoff.claimedBy !== agentId) {
      return { error: `Handoff is claimed by ${handoff.claimedBy}` };
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.sql.exec(`
      UPDATE handoffs SET status = 'completed', completed_at = ? WHERE id = ?
    `, now, id);
    return {
      ...handoff,
      status: "completed",
      completedAt: now
    };
  }
  rowToHandoff(row) {
    return {
      id: row.id,
      fromAgent: row.from_agent,
      toAgent: row.to_agent,
      title: row.title,
      context: row.context,
      code: row.code,
      filePath: row.file_path,
      nextSteps: JSON.parse(row.next_steps || "[]"),
      priority: row.priority,
      status: row.status,
      claimedBy: row.claimed_by,
      createdAt: row.created_at,
      claimedAt: row.claimed_at,
      completedAt: row.completed_at
    };
  }
};

// src/agent-state.ts
var AgentState = class {
  static {
    __name(this, "AgentState");
  }
  state;
  sql;
  agentId = "";
  wsConnection = null;
  constructor(state, env) {
    this.state = state;
    this.sql = state.storage.sql;
    this.initializeDatabase();
  }
  initializeDatabase() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS agent_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS checkpoint (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        conversation_summary TEXT,
        accomplishments TEXT DEFAULT '[]',
        pending_work TEXT DEFAULT '[]',
        recent_context TEXT,
        files_edited TEXT DEFAULT '[]',
        checkpoint_at TEXT
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        from_agent TEXT NOT NULL,
        type TEXT DEFAULT 'note',
        message TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        read INTEGER DEFAULT 0
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        created_at TEXT NOT NULL
      )
    `);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(read)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_memory_category ON memory(category)`);
  }
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    this.agentId = url.searchParams.get("agentId") || request.headers.get("X-Agent-Id") || "unknown";
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }
    try {
      switch (path) {
        case "/checkpoint":
          return this.handleCheckpoint(request);
        case "/messages":
          return this.handleMessages(request);
        case "/memory":
          return this.handleMemory(request);
        case "/state":
          return this.handleFullState(request);
        case "/health":
          return Response.json({ status: "ok", type: "agent-state", agentId: this.agentId });
        default:
          return Response.json({ error: "Not found" }, { status: 404 });
      }
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }
  handleWebSocket(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    this.wsConnection = server;
    const state = this.getFullState();
    server.send(JSON.stringify({
      type: "state-sync",
      payload: state,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    }));
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, message) {
    const data = JSON.parse(message);
    if (data.type === "checkpoint-save") {
      await this.saveCheckpoint(data.payload);
      ws.send(JSON.stringify({ type: "checkpoint-saved", timestamp: (/* @__PURE__ */ new Date()).toISOString() }));
    }
  }
  async webSocketClose(ws) {
    this.wsConnection = null;
  }
  notifyAgent(message) {
    if (this.wsConnection) {
      try {
        this.wsConnection.send(JSON.stringify(message));
      } catch {
        this.wsConnection = null;
      }
    }
  }
  // ========== Checkpoint Handlers ==========
  async handleCheckpoint(request) {
    if (request.method === "GET") {
      return Response.json({ checkpoint: this.getCheckpoint() });
    }
    if (request.method === "POST") {
      const body = await request.json();
      await this.saveCheckpoint(body);
      return Response.json({ success: true });
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  getCheckpoint() {
    const rows = this.sql.exec("SELECT * FROM checkpoint WHERE id = 1").toArray();
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      agentId: this.agentId,
      conversationSummary: row.conversation_summary,
      accomplishments: JSON.parse(row.accomplishments || "[]"),
      pendingWork: JSON.parse(row.pending_work || "[]"),
      recentContext: row.recent_context,
      filesEdited: JSON.parse(row.files_edited || "[]"),
      checkpointAt: row.checkpoint_at
    };
  }
  async saveCheckpoint(data) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.sql.exec(
      `
      INSERT INTO checkpoint (id, conversation_summary, accomplishments, pending_work, recent_context, files_edited, checkpoint_at)
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        conversation_summary = COALESCE(excluded.conversation_summary, checkpoint.conversation_summary),
        accomplishments = excluded.accomplishments,
        pending_work = excluded.pending_work,
        recent_context = COALESCE(excluded.recent_context, checkpoint.recent_context),
        files_edited = excluded.files_edited,
        checkpoint_at = excluded.checkpoint_at
    `,
      data.conversationSummary || null,
      JSON.stringify(data.accomplishments || []),
      JSON.stringify(data.pendingWork || []),
      data.recentContext || null,
      JSON.stringify(data.filesEdited || []),
      now
    );
  }
  // ========== Messages Handlers ==========
  async handleMessages(request) {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const unreadOnly = url.searchParams.get("unread") === "true";
      return Response.json({ messages: this.getMessages(unreadOnly) });
    }
    if (request.method === "POST") {
      const body = await request.json();
      const msg = this.addMessage(body);
      this.notifyAgent({
        type: "chat",
        payload: msg,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      return Response.json({ success: true, message: msg });
    }
    if (request.method === "PATCH") {
      const body = await request.json();
      this.markAsRead(body.messageIds);
      return Response.json({ success: true });
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  getMessages(unreadOnly) {
    const query = unreadOnly ? "SELECT * FROM messages WHERE read = 0 ORDER BY timestamp DESC" : "SELECT * FROM messages ORDER BY timestamp DESC LIMIT 100";
    const rows = this.sql.exec(query).toArray();
    return rows.map((row) => ({
      id: row.id,
      from: row.from_agent,
      type: row.type,
      message: row.message,
      timestamp: row.timestamp,
      read: Boolean(row.read)
    }));
  }
  addMessage(data) {
    const msg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      from: data.from,
      type: data.type || "note",
      message: data.message,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      read: false
    };
    this.sql.exec(`
      INSERT INTO messages (id, from_agent, type, message, timestamp, read)
      VALUES (?, ?, ?, ?, ?, 0)
    `, msg.id, msg.from, msg.type, msg.message, msg.timestamp);
    return msg;
  }
  markAsRead(messageIds) {
    for (const id of messageIds) {
      this.sql.exec("UPDATE messages SET read = 1 WHERE id = ?", id);
    }
  }
  // ========== Memory Handlers ==========
  async handleMemory(request) {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const category = url.searchParams.get("category");
      const query = url.searchParams.get("query");
      return Response.json({ memories: this.getMemories(category, query) });
    }
    if (request.method === "POST") {
      const body = await request.json();
      const mem = this.addMemory(body);
      return Response.json({ success: true, memory: mem });
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  getMemories(category, query) {
    let sql = "SELECT * FROM memory WHERE 1=1";
    const params = [];
    if (category) {
      sql += " AND category = ?";
      params.push(category);
    }
    if (query) {
      sql += " AND (content LIKE ? OR tags LIKE ?)";
      params.push(`%${query}%`, `%${query}%`);
    }
    sql += " ORDER BY created_at DESC LIMIT 50";
    const rows = this.sql.exec(sql, ...params).toArray();
    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      content: row.content,
      tags: JSON.parse(row.tags || "[]"),
      createdAt: row.created_at
    }));
  }
  addMemory(data) {
    const mem = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      category: data.category || "learning",
      content: data.content || "",
      tags: data.tags || [],
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.sql.exec(`
      INSERT INTO memory (id, category, content, tags, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, mem.id, mem.category, mem.content, JSON.stringify(mem.tags), mem.createdAt);
    return mem;
  }
  // ========== Full State ==========
  handleFullState(request) {
    return Response.json(this.getFullState());
  }
  getFullState() {
    return {
      agentId: this.agentId,
      checkpoint: this.getCheckpoint(),
      unreadMessages: this.getMessages(true),
      recentMemories: this.getMemories(null, null).slice(0, 10)
    };
  }
};

// src/resource-lock.ts
var ResourceLock = class {
  static {
    __name(this, "ResourceLock");
  }
  state;
  sql;
  resourcePath = "";
  constructor(state, env) {
    this.state = state;
    this.sql = state.storage.sql;
    this.initializeDatabase();
  }
  initializeDatabase() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS current_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        resource_path TEXT NOT NULL,
        resource_type TEXT DEFAULT 'file-lock',
        locked_by TEXT NOT NULL,
        reason TEXT,
        locked_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS lock_history (
        id TEXT PRIMARY KEY,
        locked_by TEXT NOT NULL,
        reason TEXT,
        locked_at TEXT NOT NULL,
        released_at TEXT,
        release_reason TEXT
      )
    `);
  }
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    this.resourcePath = url.searchParams.get("resourcePath") || request.headers.get("X-Resource-Path") || "";
    try {
      switch (path) {
        case "/check":
          return this.handleCheck();
        case "/lock":
          return this.handleLock(request);
        case "/unlock":
          return this.handleUnlock(request);
        case "/history":
          return this.handleHistory();
        case "/health":
          return Response.json({ status: "ok", type: "resource-lock", resourcePath: this.resourcePath });
        default:
          return Response.json({ error: "Not found" }, { status: 404 });
      }
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }
  /**
   * Alarm handler - called when lock expires
   */
  async alarm() {
    const lock = this.getCurrentLock();
    if (lock) {
      this.releaseLock("expired");
    }
  }
  // ========== Lock Operations ==========
  handleCheck() {
    const lock = this.getCurrentLock();
    if (!lock) {
      return Response.json({
        locked: false,
        resourcePath: this.resourcePath
      });
    }
    const now = /* @__PURE__ */ new Date();
    const expiresAt = new Date(lock.expiresAt);
    if (now > expiresAt) {
      this.releaseLock("expired");
      return Response.json({
        locked: false,
        resourcePath: this.resourcePath,
        note: "Previous lock expired"
      });
    }
    return Response.json({
      locked: true,
      lock: {
        resourcePath: lock.resourcePath,
        resourceType: lock.resourceType,
        lockedBy: lock.lockedBy,
        reason: lock.reason,
        lockedAt: lock.lockedAt,
        expiresAt: lock.expiresAt,
        remainingMs: expiresAt.getTime() - now.getTime()
      }
    });
  }
  async handleLock(request) {
    const body = await request.json();
    const existingLock = this.getCurrentLock();
    if (existingLock) {
      const now2 = /* @__PURE__ */ new Date();
      const expiresAt2 = new Date(existingLock.expiresAt);
      if (now2 < expiresAt2 && existingLock.lockedBy !== body.agentId) {
        return Response.json({
          success: false,
          error: "Resource is locked",
          lockedBy: existingLock.lockedBy,
          expiresAt: existingLock.expiresAt,
          remainingMs: expiresAt2.getTime() - now2.getTime()
        }, { status: 409 });
      }
      if (now2 >= expiresAt2) {
        this.releaseLock("expired");
      }
    }
    const now = /* @__PURE__ */ new Date();
    const ttlMs = body.ttlMs || 2 * 60 * 60 * 1e3;
    const expiresAt = new Date(now.getTime() + ttlMs);
    const lock = {
      resourcePath: this.resourcePath,
      resourceType: body.resourceType || "file-lock",
      lockedBy: body.agentId,
      reason: body.reason,
      lockedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };
    this.sql.exec(`
      INSERT INTO current_lock (id, resource_path, resource_type, locked_by, reason, locked_at, expires_at)
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        resource_path = excluded.resource_path,
        resource_type = excluded.resource_type,
        locked_by = excluded.locked_by,
        reason = excluded.reason,
        locked_at = excluded.locked_at,
        expires_at = excluded.expires_at
    `, lock.resourcePath, lock.resourceType, lock.lockedBy, lock.reason || null, lock.lockedAt, lock.expiresAt);
    this.sql.exec(`
      INSERT INTO lock_history (id, locked_by, reason, locked_at)
      VALUES (?, ?, ?, ?)
    `, `lock-${Date.now()}`, lock.lockedBy, lock.reason || null, lock.lockedAt);
    await this.state.storage.setAlarm(expiresAt.getTime());
    return Response.json({
      success: true,
      lock,
      message: `Lock acquired for ${ttlMs / 1e3 / 60} minutes`
    });
  }
  async handleUnlock(request) {
    const body = await request.json();
    const existingLock = this.getCurrentLock();
    if (!existingLock) {
      return Response.json({
        success: true,
        message: "No lock to release"
      });
    }
    if (!body.force && existingLock.lockedBy !== body.agentId) {
      return Response.json({
        success: false,
        error: "Not lock owner",
        lockedBy: existingLock.lockedBy
      }, { status: 403 });
    }
    const releaseReason = body.force && existingLock.lockedBy !== body.agentId ? "stolen" : "manual";
    this.releaseLock(releaseReason);
    await this.state.storage.deleteAlarm();
    return Response.json({
      success: true,
      message: "Lock released",
      previousOwner: existingLock.lockedBy
    });
  }
  handleHistory() {
    const rows = this.sql.exec(`
      SELECT * FROM lock_history
      ORDER BY locked_at DESC
      LIMIT 50
    `).toArray();
    const history = rows.map((row) => ({
      id: row.id,
      lockedBy: row.locked_by,
      reason: row.reason,
      lockedAt: row.locked_at,
      releasedAt: row.released_at,
      releaseReason: row.release_reason
    }));
    return Response.json({
      resourcePath: this.resourcePath,
      currentLock: this.getCurrentLock(),
      history
    });
  }
  // ========== Helper Methods ==========
  getCurrentLock() {
    const rows = this.sql.exec("SELECT * FROM current_lock WHERE id = 1").toArray();
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      resourcePath: row.resource_path,
      resourceType: row.resource_type,
      lockedBy: row.locked_by,
      reason: row.reason,
      lockedAt: row.locked_at,
      expiresAt: row.expires_at
    };
  }
  releaseLock(reason) {
    const lock = this.getCurrentLock();
    if (!lock) return;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.sql.exec(`
      UPDATE lock_history
      SET released_at = ?, release_reason = ?
      WHERE released_at IS NULL AND locked_by = ?
    `, now, reason, lock.lockedBy);
    this.sql.exec("DELETE FROM current_lock WHERE id = 1");
  }
};

// src/index.ts
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Agent-Id, X-Resource-Path"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    try {
      let response;
      if (path.startsWith("/coordinator")) {
        response = await routeToCoordinator(request, env, path.replace("/coordinator", "") || "/");
      } else if (path.startsWith("/agent/")) {
        response = await routeToAgentState(request, env, path);
      } else if (path.startsWith("/lock/")) {
        response = await routeToResourceLock(request, env, path);
      } else if (path === "/health") {
        response = Response.json({
          status: "ok",
          service: "agent-coord-do",
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          durableObjects: ["AgentCoordinator", "AgentState", "ResourceLock"]
        });
      } else if (path === "/" || path === "") {
        response = Response.json({
          name: "Agent Coordination Durable Objects",
          version: "0.2.0",
          endpoints: {
            "/coordinator/agents": "Agent registry - GET/POST",
            "/coordinator/chat": "Group chat - GET/POST",
            "/coordinator/tasks": "Task management - GET/POST",
            "/coordinator/zones": "Zone claiming - GET/POST (claim, release)",
            "/coordinator/claims": "Work claims - GET/POST (claim, release)",
            "/coordinator/handoffs": "Work handoffs - GET/POST (create, claim, complete)",
            "/coordinator/work": "Hot-start bundle - GET",
            "/agent/:agentId/*": "Per-agent state - checkpoint, messages, memory",
            "/lock/:resourcePath/*": "Resource locking - check, lock, unlock",
            "/health": "Health check"
          },
          docs: "https://github.com/piston-labs/agent-coord-mcp/tree/main/cloudflare-do"
        });
      } else {
        response = Response.json({ error: "Not found", path }, { status: 404 });
      }
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    } catch (error) {
      return Response.json({
        error: "Internal server error",
        message: String(error)
      }, {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};
async function routeToCoordinator(request, env, subPath) {
  const id = env.COORDINATOR.idFromName("main");
  const stub = env.COORDINATOR.get(id);
  const url = new URL(request.url);
  url.pathname = subPath;
  return stub.fetch(new Request(url.toString(), request));
}
__name(routeToCoordinator, "routeToCoordinator");
async function routeToAgentState(request, env, path) {
  const match = path.match(/^\/agent\/([^/]+)(\/.*)?$/);
  if (!match) {
    return Response.json({ error: "Invalid agent path" }, { status: 400 });
  }
  const agentId = decodeURIComponent(match[1]);
  const subPath = match[2] || "/state";
  const id = env.AGENT_STATE.idFromName(agentId);
  const stub = env.AGENT_STATE.get(id);
  const url = new URL(request.url);
  url.pathname = subPath;
  url.searchParams.set("agentId", agentId);
  return stub.fetch(new Request(url.toString(), request));
}
__name(routeToAgentState, "routeToAgentState");
async function routeToResourceLock(request, env, path) {
  const match = path.match(/^\/lock\/([^/]+)(\/.*)?$/);
  if (!match) {
    return Response.json({ error: "Invalid lock path" }, { status: 400 });
  }
  const resourcePath = decodeURIComponent(match[1]);
  const subPath = match[2] || "/check";
  const id = env.RESOURCE_LOCK.idFromName(resourcePath);
  const stub = env.RESOURCE_LOCK.get(id);
  const url = new URL(request.url);
  url.pathname = subPath;
  url.searchParams.set("resourcePath", resourcePath);
  return stub.fetch(new Request(url.toString(), request));
}
__name(routeToResourceLock, "routeToResourceLock");

// ../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-3fD6Vh/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-3fD6Vh/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  AgentCoordinator,
  AgentState,
  ResourceLock,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
