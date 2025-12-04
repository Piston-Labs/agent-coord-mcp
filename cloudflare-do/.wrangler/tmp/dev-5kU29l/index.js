var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/agent-coordinator.ts
var AgentCoordinator = class {
  static {
    __name(this, "AgentCoordinator");
  }
  state;
  env;
  connections = /* @__PURE__ */ new Map();
  sql;
  constructor(state, env) {
    this.state = state;
    this.env = env;
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
        case "/onboard":
          return this.handleOnboard(request);
        case "/session-resume":
          return this.handleSessionResume(request);
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
  async handleOnboard(request) {
    if (request.method !== "GET") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
    const url = new URL(request.url);
    const agentId = url.searchParams.get("agentId");
    if (!agentId) {
      return Response.json({ error: "agentId query parameter required" }, { status: 400 });
    }
    try {
      const agentStateId = this.env.AGENT_STATE.idFromName(agentId);
      const agentStateStub = this.env.AGENT_STATE.get(agentStateId);
      const soulUrl = new URL(`http://internal/soul?agentId=${agentId}`);
      const soulResponse = await agentStateStub.fetch(new Request(soulUrl.toString()));
      let soul = null;
      let isNewAgent = false;
      if (soulResponse.ok) {
        const soulData = await soulResponse.json();
        soul = soulData.soul;
      }
      if (!soul) {
        isNewAgent = true;
        const createSoulResponse = await agentStateStub.fetch(new Request(
          `http://internal/soul?agentId=${agentId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ soulId: agentId, name: agentId })
          }
        ));
        if (createSoulResponse.ok) {
          const createData = await createSoulResponse.json();
          soul = createData.soul;
        }
      }
      let checkpoint = null;
      if (!isNewAgent) {
        const checkpointUrl = new URL(`http://internal/checkpoint?agentId=${agentId}`);
        const checkpointResponse = await agentStateStub.fetch(new Request(checkpointUrl.toString()));
        if (checkpointResponse.ok) {
          const checkpointData = await checkpointResponse.json();
          checkpoint = checkpointData.checkpoint;
        }
      }
      let dashboard = null;
      const dashboardUrl = new URL(`http://internal/dashboard?agentId=${agentId}`);
      const dashboardResponse = await agentStateStub.fetch(new Request(dashboardUrl.toString()));
      if (dashboardResponse.ok) {
        const dashboardData = await dashboardResponse.json();
        dashboard = dashboardData.dashboard;
      }
      const teamOnline = await this.getTeamWithFlowStatus();
      const suggestedTask = await this.suggestTask(agentId, soul, checkpoint);
      const recentChat = this.sql.exec(`
        SELECT id, author, author_type, message, timestamp
        FROM messages
        ORDER BY timestamp DESC
        LIMIT 5
      `).toArray().map((row) => ({
        id: row.id,
        author: row.author,
        authorType: row.author_type,
        message: row.message,
        timestamp: row.timestamp
      })).reverse();
      const onboardingBundle = {
        agentId,
        isNewAgent,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
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
        welcomeMessage: isNewAgent ? `Welcome to the team, ${agentId}! \u{1F389} You're starting fresh with 0 XP. Complete your first task to begin leveling up!` : `Welcome back, ${agentId}! ${checkpoint ? `You were working on: "${checkpoint.conversationSummary || "a task"}"` : "Ready to start fresh?"}`
      };
      return Response.json({ onboarding: onboardingBundle });
    } catch (error) {
      return Response.json({
        error: "Failed to build onboarding bundle",
        details: String(error)
      }, { status: 500 });
    }
  }
  /**
   * Get all online agents with their flow status
   */
  async getTeamWithFlowStatus() {
    const agents = this.sql.exec(`
      SELECT agent_id, status, current_task
      FROM agents
      WHERE status != 'offline'
      ORDER BY last_seen DESC
    `).toArray();
    const teamWithFlow = [];
    for (const agent of agents) {
      const agentId = agent.agent_id;
      let flowStatus = "unknown";
      try {
        const agentStateId = this.env.AGENT_STATE.idFromName(agentId);
        const agentStateStub = this.env.AGENT_STATE.get(agentStateId);
        const dashboardResponse = await agentStateStub.fetch(
          new Request(`http://internal/dashboard?agentId=${agentId}`)
        );
        if (dashboardResponse.ok) {
          const data = await dashboardResponse.json();
          flowStatus = data.dashboard?.flow?.status || "available";
        }
      } catch {
        flowStatus = "unknown";
      }
      teamWithFlow.push({
        agentId,
        status: agent.status,
        flowStatus,
        currentTask: agent.current_task
      });
    }
    return teamWithFlow;
  }
  /**
   * Suggest a task for the agent based on their state
   */
  async suggestTask(agentId, soul, checkpoint) {
    if (checkpoint && typeof checkpoint === "object" && "conversationSummary" in checkpoint) {
      const cp = checkpoint;
      if (cp.conversationSummary || cp.pendingWork && cp.pendingWork.length > 0) {
        return {
          task: cp.conversationSummary || cp.pendingWork?.[0] || "Resume previous work",
          reason: "Continues your previous session",
          xpEstimate: 30,
          priority: "high"
        };
      }
    }
    const pendingHandoffs = this.sql.exec(`
      SELECT title FROM handoffs WHERE status = 'pending' LIMIT 1
    `).toArray();
    if (pendingHandoffs.length > 0) {
      return {
        task: `Help needed: ${pendingHandoffs[0].title}`,
        reason: "Someone needs help! Great XP opportunity",
        xpEstimate: 50,
        priority: "medium"
      };
    }
    const unassignedTasks = this.sql.exec(`
      SELECT title, priority FROM tasks WHERE assignee IS NULL AND status = 'todo' LIMIT 1
    `).toArray();
    if (unassignedTasks.length > 0) {
      return {
        task: unassignedTasks[0].title,
        reason: "Unassigned task waiting for pickup",
        xpEstimate: 25,
        priority: unassignedTasks[0].priority
      };
    }
    return {
      task: "Introduce yourself in the group chat",
      reason: "Say hello to the team!",
      xpEstimate: 10,
      priority: "low"
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
  async handleSessionResume(request) {
    if (request.method !== "GET") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
    try {
      const recentMessages = this.sql.exec(`
        SELECT id, author, author_type, message, timestamp
        FROM messages
        ORDER BY timestamp DESC
        LIMIT 100
      `).toArray();
      const participants = /* @__PURE__ */ new Map();
      for (const msg of recentMessages) {
        const author = msg.author;
        const authorType = msg.author_type;
        if (authorType === "agent" || authorType === "human") {
          if (!participants.has(author)) {
            participants.set(author, {
              agentId: author,
              messageCount: 1,
              lastMessage: msg.message.substring(0, 100),
              lastActive: msg.timestamp
            });
          } else {
            participants.get(author).messageCount++;
          }
        }
      }
      const accomplishments = [];
      const accomplishmentKeywords = ["\u2705", "shipped", "completed", "built", "added", "fixed", "implemented", "deployed"];
      for (const msg of recentMessages) {
        const message = msg.message.toLowerCase();
        if (accomplishmentKeywords.some((kw) => message.includes(kw))) {
          const firstLine = msg.message.split("\n")[0].substring(0, 150);
          if (!accomplishments.includes(firstLine) && accomplishments.length < 10) {
            accomplishments.push(firstLine);
          }
        }
      }
      const pendingHandoffs = this.sql.exec(`
        SELECT id, title, from_agent, context, priority, created_at
        FROM handoffs
        WHERE status = 'pending'
        ORDER BY created_at DESC
        LIMIT 5
      `).toArray().map((row) => ({
        id: row.id,
        title: row.title,
        fromAgent: row.from_agent,
        context: row.context.substring(0, 200),
        priority: row.priority,
        createdAt: row.created_at
      }));
      const inProgressTasks = this.sql.exec(`
        SELECT id, title, assignee, priority, description
        FROM tasks
        WHERE status = 'in-progress'
        ORDER BY updated_at DESC
        LIMIT 5
      `).toArray().map((row) => ({
        id: row.id,
        title: row.title,
        assignee: row.assignee,
        priority: row.priority,
        description: row.description
      }));
      const activeClaims = this.sql.exec(`
        SELECT what, by, description, since
        FROM claims
        ORDER BY since DESC
        LIMIT 10
      `).toArray().map((row) => ({
        what: row.what,
        by: row.by,
        description: row.description,
        since: row.since
      }));
      const quickActions = [];
      if (pendingHandoffs.length > 0) {
        quickActions.push({
          action: "review_handoffs",
          label: "\u{1F4CB} Review Handoffs",
          description: `${pendingHandoffs.length} handoff(s) need attention`,
          priority: "high"
        });
      }
      if (inProgressTasks.length > 0) {
        quickActions.push({
          action: "check_progress",
          label: "\u{1F504} Check In-Progress",
          description: `${inProgressTasks.length} task(s) in progress`,
          priority: "medium"
        });
      }
      quickActions.push({
        action: "spawn_team",
        label: "\u{1F680} Spawn Agent Team",
        description: "Start a new autonomous session",
        priority: "medium"
      });
      quickActions.push({
        action: "view_chat",
        label: "\u{1F4AC} View Group Chat",
        description: "See latest team discussion",
        priority: "low"
      });
      let sessionStart = null;
      let sessionEnd = null;
      if (recentMessages.length > 0) {
        sessionEnd = recentMessages[0].timestamp;
        sessionStart = recentMessages[recentMessages.length - 1].timestamp;
      }
      const resumeBundle = {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        // Session overview
        session: {
          messageCount: recentMessages.length,
          participantCount: participants.size,
          startTime: sessionStart,
          endTime: sessionEnd,
          durationDescription: sessionStart && sessionEnd ? this.formatDuration(new Date(sessionStart), new Date(sessionEnd)) : "Unknown"
        },
        // Who participated
        participants: Array.from(participants.values()).sort((a, b) => b.messageCount - a.messageCount),
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
        recentContext: recentMessages.slice(0, 5).map((msg) => ({
          author: msg.author,
          message: msg.message.substring(0, 200),
          timestamp: msg.timestamp
        })).reverse(),
        // Chronological order
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
        error: "Failed to build session resume",
        details: String(error)
      }, { status: 500 });
    }
  }
  /**
   * Format duration between two dates
   */
  formatDuration(start, end) {
    const diffMs = end.getTime() - start.getTime();
    const diffMins = Math.floor(diffMs / (1e3 * 60));
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
  buildSummaryText(participantCount, accomplishmentCount, pendingHandoffs, inProgressTasks) {
    const parts = [];
    if (participantCount > 0) {
      parts.push(`${participantCount} agent${participantCount > 1 ? "s" : ""} active`);
    }
    if (accomplishmentCount > 0) {
      parts.push(`${accomplishmentCount} thing${accomplishmentCount > 1 ? "s" : ""} shipped`);
    }
    if (pendingHandoffs > 0) {
      parts.push(`${pendingHandoffs} handoff${pendingHandoffs > 1 ? "s" : ""} pending`);
    }
    if (inProgressTasks > 0) {
      parts.push(`${inProgressTasks} task${inProgressTasks > 1 ? "s" : ""} in progress`);
    }
    return parts.join(" \u2022 ") || "No recent activity";
  }
};

// src/agent-state.ts
var LEVEL_THRESHOLDS = {
  novice: { xp: 0, streak: 0, tasks: 0 },
  capable: { xp: 100, streak: 3, tasks: 5 },
  expert: { xp: 500, streak: 5, tasks: 25 },
  master: { xp: 2e3, streak: 10, tasks: 100 }
};
var LEVEL_ABILITIES = {
  novice: { canCommit: false, canSpawnSubagents: false, canAccessProd: false, canMentorPeers: false, extendedBudget: false },
  capable: { canCommit: true },
  expert: { canSpawnSubagents: true, canMentorPeers: true },
  master: { canAccessProd: true, extendedBudget: true }
};
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
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS work_traces (
        session_id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        summary TEXT
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS work_steps (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        tool TEXT NOT NULL,
        intent TEXT,
        outcome TEXT DEFAULT 'partial',
        duration_ms INTEGER DEFAULT 0,
        contribution_type TEXT,
        knowledge_gained TEXT DEFAULT '[]',
        eliminated_paths INTEGER DEFAULT 0,
        depends_on TEXT DEFAULT '[]',
        FOREIGN KEY (session_id) REFERENCES work_traces(session_id)
      )
    `);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_work_steps_session ON work_steps(session_id)`);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS escalations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        triggered_at TEXT NOT NULL,
        triggers TEXT NOT NULL,
        highest_level INTEGER NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT,
        resolver_agent TEXT,
        helpful_hint TEXT,
        FOREIGN KEY (session_id) REFERENCES work_traces(session_id)
      )
    `);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_escalations_session ON escalations(session_id)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_escalations_unresolved ON escalations(resolved_at) WHERE resolved_at IS NULL`);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS soul_progression (
        soul_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        personality TEXT,
        created_at TEXT NOT NULL,

        total_xp INTEGER DEFAULT 0,
        level TEXT DEFAULT 'novice',
        current_streak INTEGER DEFAULT 0,
        longest_streak INTEGER DEFAULT 0,

        tasks_completed INTEGER DEFAULT 0,
        tasks_successful INTEGER DEFAULT 0,
        total_tokens_used INTEGER DEFAULT 0,
        avg_efficiency REAL DEFAULT 0,
        peers_helped INTEGER DEFAULT 0,

        last_trace_id TEXT,
        escalation_count INTEGER DEFAULT 0,
        self_resolved_count INTEGER DEFAULT 0,
        peer_assist_count INTEGER DEFAULT 0,
        human_escalation_count INTEGER DEFAULT 0,

        specializations TEXT DEFAULT '{"frontend":0,"backend":0,"devops":0,"research":0}',
        achievements TEXT DEFAULT '[]',
        abilities TEXT DEFAULT '{"canCommit":false,"canSpawnSubagents":false,"canAccessProd":false,"canMentorPeers":false,"extendedBudget":false}',

        trust_score REAL DEFAULT 0.5,
        transparency_score REAL DEFAULT 0.5,
        track_record_score REAL DEFAULT 0.5
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS shadow_monitor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        shadow_id TEXT,
        shadow_status TEXT DEFAULT 'none',
        primary_agent TEXT,
        is_shadow INTEGER DEFAULT 0,
        last_heartbeat TEXT,
        heartbeat_interval_ms INTEGER DEFAULT 60000,
        stall_threshold_ms INTEGER DEFAULT 300000,
        registered_at TEXT,
        takeover_at TEXT
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS heartbeat_log (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        tokens_used INTEGER DEFAULT 0,
        current_task TEXT,
        status TEXT DEFAULT 'healthy'
      )
    `);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_heartbeat_timestamp ON heartbeat_log(timestamp)`);
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
        case "/trace":
          return this.handleWorkTrace(request);
        case "/soul":
          return this.handleSoulProgression(request);
        case "/dashboard":
          return this.handleDashboard(request);
        case "/heartbeat":
          return this.handleHeartbeat(request);
        case "/shadow":
          return this.handleShadow(request);
        case "/health":
          return Response.json({ status: "ok", type: "agent-state", agentId: this.agentId });
        default:
          if (path.startsWith("/trace/")) {
            return this.handleWorkTraceSession(request, path.slice(7));
          }
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
  // ========== WorkTrace Handlers (Show Your Work) ==========
  async handleWorkTrace(request) {
    if (request.method === "GET") {
      const traces = this.listWorkTraces();
      return Response.json({ traces });
    }
    if (request.method === "POST") {
      const body = await request.json();
      const task = body.task || body.taskDescription || "Untitled task";
      const trace = this.startWorkTrace(task, body.sessionId);
      return Response.json({ success: true, trace });
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  async handleWorkTraceSession(request, sessionPath) {
    const parts = sessionPath.split("/");
    const sessionId = parts[0];
    const action = parts[1];
    if (request.method === "GET" && !action) {
      const trace = this.getWorkTrace(sessionId);
      if (!trace) {
        return Response.json({ error: "Trace not found" }, { status: 404 });
      }
      return Response.json({ trace });
    }
    if (request.method === "POST" && action === "step") {
      const body = await request.json();
      const result = this.logWorkStep(sessionId, body);
      return Response.json({
        success: true,
        step: result.step,
        ...result.escalation && { escalation: result.escalation }
      });
    }
    if (request.method === "POST" && action === "complete") {
      const trace = this.completeWorkTrace(sessionId);
      return Response.json({ success: true, trace });
    }
    if (request.method === "POST" && action === "resolve-escalation") {
      const body = await request.json();
      const result = this.resolveEscalation(body);
      return Response.json({ success: true, resolution: result });
    }
    if (request.method === "GET" && action === "escalations") {
      const escalations = this.getTraceEscalations(sessionId);
      return Response.json({ escalations });
    }
    return Response.json({ error: "Invalid trace action" }, { status: 400 });
  }
  listWorkTraces() {
    const rows = this.sql.exec("SELECT session_id, task, started_at, completed_at FROM work_traces ORDER BY started_at DESC LIMIT 20").toArray();
    return rows.map((row) => ({
      sessionId: row.session_id,
      task: row.task,
      startedAt: row.started_at,
      completedAt: row.completed_at
    }));
  }
  startWorkTrace(task, sessionId) {
    const id = sessionId || `trace-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.sql.exec(`
      INSERT INTO work_traces (session_id, task, started_at)
      VALUES (?, ?, ?)
    `, id, task, now);
    return {
      sessionId: id,
      agentId: this.agentId,
      task,
      startedAt: now,
      steps: []
    };
  }
  logWorkStep(sessionId, data) {
    const step = {
      id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      tool: data.tool || "unknown",
      intent: data.intent || "",
      outcome: data.outcome || "partial",
      durationMs: data.durationMs || 0,
      contributionType: data.contributionType,
      knowledgeGained: data.knowledgeGained || [],
      eliminatedPaths: data.eliminatedPaths || 0,
      dependsOn: data.dependsOn || []
    };
    this.sql.exec(
      `
      INSERT INTO work_steps (id, session_id, timestamp, tool, intent, outcome, duration_ms, contribution_type, knowledge_gained, eliminated_paths, depends_on)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      step.id,
      step.sessionId,
      step.timestamp,
      step.tool,
      step.intent,
      step.outcome,
      step.durationMs,
      step.contributionType || null,
      JSON.stringify(step.knowledgeGained),
      step.eliminatedPaths,
      JSON.stringify(step.dependsOn)
    );
    const trace = this.getWorkTrace(sessionId);
    if (trace) {
      const escalation = this.checkEscalationTriggers(trace, step);
      if (escalation.shouldEscalate) {
        const escalationId = this.recordEscalation(sessionId, escalation);
        return { step, escalation: { ...escalation, escalationId } };
      }
    }
    return { step };
  }
  recordEscalation(sessionId, escalation) {
    const id = `esc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.sql.exec(`
      INSERT INTO escalations (id, session_id, triggered_at, triggers, highest_level)
      VALUES (?, ?, ?, ?, ?)
    `, id, sessionId, now, JSON.stringify(escalation.triggers), escalation.highestLevel);
    return id;
  }
  resolveEscalation(data) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.sql.exec(`
      UPDATE escalations
      SET resolved_at = ?, resolved_by = ?, resolver_agent = ?, helpful_hint = ?
      WHERE id = ?
    `, now, data.resolvedBy, data.resolverAgent || null, data.helpfulHint || null, data.escalationId);
    return {
      escalationId: data.escalationId,
      resolvedBy: data.resolvedBy,
      resolverAgent: data.resolverAgent,
      resolutionTime: now,
      helpfulHint: data.helpfulHint
    };
  }
  getTraceEscalations(sessionId) {
    const rows = this.sql.exec(
      "SELECT * FROM escalations WHERE session_id = ? ORDER BY triggered_at ASC",
      sessionId
    ).toArray();
    return rows.map((row) => ({
      id: row.id,
      triggeredAt: row.triggered_at,
      triggers: JSON.parse(row.triggers),
      highestLevel: row.highest_level,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      resolverAgent: row.resolver_agent,
      helpfulHint: row.helpful_hint
    }));
  }
  checkEscalationTriggers(trace, currentStep) {
    const triggers = [];
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const recentSteps = trace.steps.slice(-5);
    const sameToolSteps = recentSteps.filter((s) => s.tool === currentStep.tool);
    const sameToolNoProgress = sameToolSteps.filter((s) => s.outcome === "nothing" || s.outcome === "partial");
    if (sameToolNoProgress.length >= 3) {
      triggers.push({
        type: "stuck_loop",
        level: 2,
        reason: `${currentStep.tool} called ${sameToolNoProgress.length}x with no progress`,
        detectedAt: now
      });
    }
    const deadEnds = trace.steps.filter((s) => s.outcome === "nothing").length;
    if (deadEnds >= 3) {
      triggers.push({
        type: "repeated_failures",
        level: 1,
        reason: `${deadEnds} dead ends in this session`,
        detectedAt: now
      });
    }
    const errors = trace.steps.filter((s) => s.outcome === "error").length;
    if (errors >= 2) {
      triggers.push({
        type: "error_accumulation",
        level: 2,
        reason: `${errors} errors encountered`,
        detectedAt: now
      });
    }
    const elapsed = Date.now() - new Date(trace.startedAt).getTime();
    if (elapsed > 10 * 60 * 1e3) {
      triggers.push({
        type: "time_exceeded",
        level: 1,
        reason: `Task running for ${Math.round(elapsed / 6e4)} minutes`,
        detectedAt: now
      });
    }
    if (trace.steps.length >= 5) {
      const nonproductive = trace.steps.filter(
        (s) => s.outcome === "nothing" || s.outcome === "error" || s.contributionType === "minimal"
      ).length;
      const efficiencyRatio = nonproductive / trace.steps.length;
      if (efficiencyRatio > 0.6) {
        triggers.push({
          type: "low_efficiency",
          level: 1,
          reason: `${Math.round(efficiencyRatio * 100)}% of steps non-productive`,
          detectedAt: now
        });
      }
    }
    const highestLevel = triggers.length > 0 ? Math.max(...triggers.map((t) => t.level)) : 0;
    let recommendation = "";
    if (highestLevel === 0) {
      recommendation = "Continue working";
    } else if (highestLevel === 1) {
      recommendation = "Consider pausing to review approach";
    } else if (highestLevel === 2) {
      recommendation = "PAUSE: Ask for guidance or try different approach";
    } else {
      recommendation = "ESCALATE: Human intervention recommended";
    }
    return {
      shouldEscalate: triggers.length > 0,
      triggers,
      highestLevel,
      recommendation
    };
  }
  getWorkTrace(sessionId) {
    const traceRows = this.sql.exec("SELECT * FROM work_traces WHERE session_id = ?", sessionId).toArray();
    if (traceRows.length === 0) return null;
    const traceRow = traceRows[0];
    const stepRows = this.sql.exec("SELECT * FROM work_steps WHERE session_id = ? ORDER BY timestamp ASC", sessionId).toArray();
    const steps = stepRows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      timestamp: row.timestamp,
      tool: row.tool,
      intent: row.intent,
      outcome: row.outcome,
      durationMs: row.duration_ms,
      contributionType: row.contribution_type,
      knowledgeGained: JSON.parse(row.knowledge_gained || "[]"),
      eliminatedPaths: row.eliminated_paths,
      dependsOn: JSON.parse(row.depends_on || "[]")
    }));
    return {
      sessionId: traceRow.session_id,
      agentId: this.agentId,
      task: traceRow.task,
      startedAt: traceRow.started_at,
      completedAt: traceRow.completed_at,
      steps,
      summary: traceRow.summary ? JSON.parse(traceRow.summary) : void 0
    };
  }
  completeWorkTrace(sessionId) {
    const trace = this.getWorkTrace(sessionId);
    if (!trace) return null;
    const deadEnds = trace.steps.filter((s) => s.outcome === "nothing" || s.outcome === "error").length;
    const totalTimeMs = trace.steps.reduce((sum, s) => sum + s.durationMs, 0);
    const solutionSteps = trace.steps.filter((s) => s.outcome === "found" || s.contributionType === "direct");
    const solutionTimeMs = solutionSteps.reduce((sum, s) => sum + s.durationMs, 0);
    const summary = {
      totalSteps: trace.steps.length,
      deadEnds,
      explorationTimeMs: totalTimeMs,
      solutionTimeMs,
      efficiency: totalTimeMs > 0 ? solutionTimeMs / totalTimeMs : 0
    };
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.sql.exec(`
      UPDATE work_traces SET completed_at = ?, summary = ? WHERE session_id = ?
    `, now, JSON.stringify(summary), sessionId);
    return {
      ...trace,
      completedAt: now,
      summary
    };
  }
  // ========== Soul Progression Handlers ==========
  async handleSoulProgression(request) {
    if (request.method === "GET") {
      const soul = this.getSoulProgression();
      return Response.json({ soul });
    }
    if (request.method === "POST") {
      const body = await request.json();
      const soul = this.initializeSoul(body);
      return Response.json({ success: true, soul });
    }
    if (request.method === "PATCH") {
      const body = await request.json();
      if (body.action === "add-xp") {
        if (!body.xp || body.xp <= 0) {
          return Response.json({ error: "xp must be a positive number" }, { status: 400 });
        }
        const result = this.addXPToSoul(body.xp, body.source || "manual");
        return Response.json(result);
      }
      if (body.action === "unlock-achievement") {
        if (!body.achievementId) {
          return Response.json({ error: "achievementId required" }, { status: 400 });
        }
        const result = this.unlockAchievement(body.achievementId);
        return Response.json(result);
      }
      if (body.traceId) {
        const result = this.updateSoulFromTrace(body.traceId, body.domain);
        return Response.json(result);
      }
      return Response.json({ error: "Invalid PATCH request. Provide action (add-xp, unlock-achievement) or traceId" }, { status: 400 });
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  getSoulProgression() {
    const rows = this.sql.exec("SELECT * FROM soul_progression WHERE soul_id = ?", this.agentId).toArray();
    if (rows.length === 0) return null;
    const row = rows[0];
    const lastTraceId = row.last_trace_id;
    const rustLevel = lastTraceId ? this.calculateRustLevel(lastTraceId) : 0;
    const effectiveXPMultiplier = 1 - rustLevel * 0.5;
    return {
      soulId: row.soul_id,
      name: row.name,
      personality: row.personality,
      createdAt: row.created_at,
      totalXP: row.total_xp,
      level: row.level,
      currentStreak: row.current_streak,
      longestStreak: row.longest_streak,
      tasksCompleted: row.tasks_completed,
      tasksSuccessful: row.tasks_successful,
      totalTokensUsed: row.total_tokens_used,
      avgEfficiency: row.avg_efficiency,
      peersHelped: row.peers_helped,
      lastTraceId,
      escalationCount: row.escalation_count,
      selfResolvedCount: row.self_resolved_count,
      peerAssistCount: row.peer_assist_count,
      humanEscalationCount: row.human_escalation_count,
      specializations: JSON.parse(row.specializations),
      achievements: JSON.parse(row.achievements),
      abilities: JSON.parse(row.abilities),
      trustScore: row.trust_score,
      transparencyScore: row.transparency_score,
      trackRecordScore: row.track_record_score,
      rustLevel,
      effectiveXPMultiplier
    };
  }
  calculateRustLevel(lastTraceId) {
    const traceRows = this.sql.exec("SELECT started_at FROM work_traces WHERE session_id = ?", lastTraceId).toArray();
    if (traceRows.length === 0) return 0;
    const lastActiveDate = new Date(traceRows[0].started_at);
    const now = /* @__PURE__ */ new Date();
    const daysSinceActive = Math.floor((now.getTime() - lastActiveDate.getTime()) / (1e3 * 60 * 60 * 24));
    if (daysSinceActive < 7) return 0;
    if (daysSinceActive < 30) return 0.2;
    if (daysSinceActive < 90) return 0.4;
    return 0.6;
  }
  initializeSoul(data) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const soul = {
      soulId: data.soulId || this.agentId,
      name: data.name || this.agentId,
      personality: data.personality || "helpful assistant",
      createdAt: now,
      totalXP: 0,
      level: "novice",
      currentStreak: 0,
      longestStreak: 0,
      tasksCompleted: 0,
      tasksSuccessful: 0,
      totalTokensUsed: 0,
      avgEfficiency: 0,
      peersHelped: 0,
      escalationCount: 0,
      selfResolvedCount: 0,
      peerAssistCount: 0,
      humanEscalationCount: 0,
      specializations: { frontend: 0, backend: 0, devops: 0, research: 0 },
      achievements: [],
      abilities: { canCommit: false, canSpawnSubagents: false, canAccessProd: false, canMentorPeers: false, extendedBudget: false },
      trustScore: 0.5,
      transparencyScore: 0.5,
      trackRecordScore: 0.5
    };
    this.sql.exec(
      `
      INSERT OR REPLACE INTO soul_progression (
        soul_id, name, personality, created_at, total_xp, level,
        current_streak, longest_streak, tasks_completed, tasks_successful,
        total_tokens_used, avg_efficiency, peers_helped, escalation_count,
        self_resolved_count, peer_assist_count, human_escalation_count,
        specializations, achievements, abilities, trust_score,
        transparency_score, track_record_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      soul.soulId,
      soul.name,
      soul.personality,
      soul.createdAt,
      soul.totalXP,
      soul.level,
      soul.currentStreak,
      soul.longestStreak,
      soul.tasksCompleted,
      soul.tasksSuccessful,
      soul.totalTokensUsed,
      soul.avgEfficiency,
      soul.peersHelped,
      soul.escalationCount,
      soul.selfResolvedCount,
      soul.peerAssistCount,
      soul.humanEscalationCount,
      JSON.stringify(soul.specializations),
      JSON.stringify(soul.achievements),
      JSON.stringify(soul.abilities),
      soul.trustScore,
      soul.transparencyScore,
      soul.trackRecordScore
    );
    return soul;
  }
  addXPToSoul(xpAmount, source) {
    let soul = this.getSoulProgression();
    if (!soul) {
      soul = this.initializeSoul({ soulId: this.agentId });
    }
    const oldLevel = soul.level;
    const newTotalXP = soul.totalXP + xpAmount;
    const newLevel = this.calculateLevel(newTotalXP, soul.currentStreak, soul.tasksCompleted);
    const leveledUp = newLevel !== oldLevel;
    this.sql.exec(`
      UPDATE soul_progression SET
        total_xp = ?,
        level = ?
      WHERE soul_id = ?
    `, newTotalXP, newLevel, this.agentId);
    let newAbilities = [];
    if (leveledUp) {
      const abilities = this.getAbilitiesForLevel(newLevel);
      newAbilities = Object.entries(abilities).filter(([_, enabled]) => enabled).map(([name]) => name);
    }
    const updatedSoul = this.getSoulProgression();
    return {
      success: true,
      xpGained: xpAmount,
      totalXP: newTotalXP,
      ...leveledUp && { levelUp: { oldLevel, newLevel, newAbilities } },
      soul: updatedSoul
    };
  }
  unlockAchievement(achievementId) {
    let soul = this.getSoulProgression();
    if (!soul) {
      soul = this.initializeSoul({ soulId: this.agentId });
    }
    if (soul.achievements.includes(achievementId)) {
      return {
        success: true,
        achievement: achievementId,
        alreadyUnlocked: true,
        soul
      };
    }
    const newAchievements = [...soul.achievements, achievementId];
    this.sql.exec(`
      UPDATE soul_progression SET
        achievements = ?
      WHERE soul_id = ?
    `, JSON.stringify(newAchievements), this.agentId);
    const updatedSoul = this.getSoulProgression();
    return {
      success: true,
      achievement: achievementId,
      alreadyUnlocked: false,
      soul: updatedSoul
    };
  }
  updateSoulFromTrace(traceId, domain) {
    const trace = this.getWorkTrace(traceId);
    if (!trace || !trace.summary) {
      return { success: false, xpGained: 0, soul: null };
    }
    let soul = this.getSoulProgression();
    if (!soul) {
      soul = this.initializeSoul({ soulId: this.agentId });
    }
    const escalations = this.getTraceEscalations(traceId);
    const xp = this.calculateTraceXP(trace, escalations);
    const humanEscalation = escalations.some((e) => e.resolvedBy === "human");
    const taskSuccessful = !humanEscalation;
    const newStreak = taskSuccessful ? soul.currentStreak + 1 : 0;
    const newLongestStreak = Math.max(newStreak, soul.longestStreak);
    const newTotalXP = soul.totalXP + xp.total;
    const newTasksCompleted = soul.tasksCompleted + 1;
    const newTasksSuccessful = soul.tasksSuccessful + (taskSuccessful ? 1 : 0);
    const newAvgEfficiency = (soul.avgEfficiency * soul.tasksCompleted + trace.summary.efficiency) / newTasksCompleted;
    const newSpecializations = { ...soul.specializations };
    if (domain) {
      newSpecializations[domain] += Math.floor(xp.total * 0.5);
    }
    const selfResolved = escalations.filter((e) => e.resolvedBy === "self").length;
    const peerAssisted = escalations.filter((e) => e.resolvedBy === "peer").length;
    const humanHelped = escalations.filter((e) => e.resolvedBy === "human").length;
    const oldLevel = soul.level;
    const newLevel = this.calculateLevel(newTotalXP, newStreak, newTasksCompleted);
    const levelUp = newLevel !== oldLevel ? {
      oldLevel,
      newLevel,
      newAbilities: this.getNewAbilities(oldLevel, newLevel)
    } : void 0;
    const newAbilities = levelUp ? this.mergeAbilities(soul.abilities, newLevel) : soul.abilities;
    const newTrustScore = this.calculateTrustScore(
      newTasksSuccessful / newTasksCompleted,
      soul.selfResolvedCount + selfResolved,
      soul.humanEscalationCount + humanHelped
    );
    this.sql.exec(
      `
      UPDATE soul_progression SET
        total_xp = ?, level = ?, current_streak = ?, longest_streak = ?,
        tasks_completed = ?, tasks_successful = ?, avg_efficiency = ?,
        last_trace_id = ?, escalation_count = ?, self_resolved_count = ?,
        peer_assist_count = ?, human_escalation_count = ?,
        specializations = ?, abilities = ?, trust_score = ?
      WHERE soul_id = ?
    `,
      newTotalXP,
      newLevel,
      newStreak,
      newLongestStreak,
      newTasksCompleted,
      newTasksSuccessful,
      newAvgEfficiency,
      traceId,
      soul.escalationCount + escalations.length,
      soul.selfResolvedCount + selfResolved,
      soul.peerAssistCount + peerAssisted,
      soul.humanEscalationCount + humanHelped,
      JSON.stringify(newSpecializations),
      JSON.stringify(newAbilities),
      newTrustScore,
      soul.soulId
    );
    return {
      success: true,
      xpGained: xp.total,
      levelUp,
      soul: this.getSoulProgression()
    };
  }
  calculateTraceXP(trace, escalations) {
    const breakdown = {
      base: 10,
      efficiency: trace.summary.efficiency > 0.7 ? 15 : trace.summary.efficiency > 0.5 ? 5 : 0,
      selfResolved: escalations.every((e) => e.resolvedBy === "self" || !e.resolvedBy) ? 10 : 0,
      noEscalations: escalations.length === 0 ? 5 : 0
    };
    return {
      total: Object.values(breakdown).reduce((a, b) => a + b, 0),
      breakdown
    };
  }
  calculateLevel(xp, streak, tasks) {
    if (xp >= LEVEL_THRESHOLDS.master.xp && streak >= LEVEL_THRESHOLDS.master.streak && tasks >= LEVEL_THRESHOLDS.master.tasks) {
      return "master";
    }
    if (xp >= LEVEL_THRESHOLDS.expert.xp && streak >= LEVEL_THRESHOLDS.expert.streak && tasks >= LEVEL_THRESHOLDS.expert.tasks) {
      return "expert";
    }
    if (xp >= LEVEL_THRESHOLDS.capable.xp && streak >= LEVEL_THRESHOLDS.capable.streak && tasks >= LEVEL_THRESHOLDS.capable.tasks) {
      return "capable";
    }
    return "novice";
  }
  getNewAbilities(oldLevel, newLevel) {
    const levels = ["novice", "capable", "expert", "master"];
    const oldIndex = levels.indexOf(oldLevel);
    const newIndex = levels.indexOf(newLevel);
    const newAbilities = [];
    for (let i = oldIndex + 1; i <= newIndex; i++) {
      const abilities = LEVEL_ABILITIES[levels[i]];
      newAbilities.push(...Object.keys(abilities).filter((k) => abilities[k]));
    }
    return newAbilities;
  }
  mergeAbilities(current, level) {
    const levels = ["novice", "capable", "expert", "master"];
    const merged = { ...current };
    for (const l of levels) {
      if (levels.indexOf(l) <= levels.indexOf(level)) {
        Object.assign(merged, LEVEL_ABILITIES[l]);
      }
    }
    return merged;
  }
  calculateTrustScore(successRate, selfResolved, humanEscalations) {
    const selfResolutionRate = selfResolved > 0 ? selfResolved / (selfResolved + humanEscalations) : 0.5;
    const avoidanceRate = humanEscalations === 0 ? 1 : 1 / (1 + humanEscalations * 0.1);
    return Math.min(1, successRate * 0.5 + selfResolutionRate * 0.3 + avoidanceRate * 0.2);
  }
  // ========== Dashboard Handler ==========
  handleDashboard(request) {
    if (request.method !== "GET") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
    const soul = this.getSoulProgression();
    if (!soul) {
      return Response.json({
        error: "No soul data",
        hint: "POST to /soul first to initialize"
      }, { status: 404 });
    }
    const recentTraces = this.sql.exec(`
      SELECT session_id, task, started_at, completed_at, summary
      FROM work_traces
      ORDER BY started_at DESC
      LIMIT 10
    `).toArray();
    const sessionStats = this.calculateSessionStats(recentTraces);
    const pendingEscalations = this.sql.exec(`
      SELECT COUNT(*) as count FROM escalations
      WHERE resolved_at IS NULL
    `).toArray()[0]?.count || 0;
    const nextLevel = this.getNextLevel(soul.level);
    const nextThreshold = nextLevel ? LEVEL_THRESHOLDS[nextLevel] : null;
    const levelProgress = nextThreshold ? {
      nextLevel,
      xpNeeded: nextThreshold.xp - soul.totalXP,
      xpProgress: Math.round(soul.totalXP / nextThreshold.xp * 100),
      streakNeeded: Math.max(0, nextThreshold.streak - soul.currentStreak),
      tasksNeeded: Math.max(0, nextThreshold.tasks - soul.tasksCompleted)
    } : { nextLevel: null, message: "Max level reached!" };
    const recentAchievements = soul.achievements.slice(-5);
    const specRanks = this.formatSpecializations(soul.specializations);
    const streakStatus = this.calculateStreakStatus(recentTraces);
    const flowState = this.detectFlowState();
    const dashboard = {
      agentId: this.agentId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      // Level & XP
      level: {
        current: soul.level,
        xp: soul.totalXP,
        ...levelProgress
      },
      // Streak info
      streak: {
        current: soul.currentStreak,
        longest: soul.longestStreak,
        atRisk: streakStatus.atRisk,
        hoursUntilExpires: streakStatus.hoursUntilExpires
      },
      // Rust status
      rust: {
        level: soul.rustLevel || 0,
        xpMultiplier: soul.effectiveXPMultiplier || 1,
        status: this.getRustStatus(soul.rustLevel || 0)
      },
      // Flow state (for smart task routing)
      flow: flowState,
      // Session stats (recent activity)
      session: sessionStats,
      // Trust metrics
      trust: {
        overall: soul.trustScore,
        transparency: soul.transparencyScore,
        trackRecord: soul.trackRecordScore,
        successRate: soul.tasksCompleted > 0 ? Math.round(soul.tasksSuccessful / soul.tasksCompleted * 100) : 0
      },
      // Abilities
      abilities: soul.abilities,
      // Specializations with ranks
      specializations: specRanks,
      // Recent achievements
      recentAchievements,
      // Alerts
      alerts: {
        pendingEscalations,
        streakAtRisk: streakStatus.atRisk,
        highRust: (soul.rustLevel || 0) >= 0.4
      },
      // Shadow agent monitoring
      shadow: this.getShadowStatus(),
      // Heartbeat health
      heartbeat: this.getHeartbeatStatus(),
      // Suggested next actions
      suggestions: this.generateSuggestions(soul, levelProgress, sessionStats, pendingEscalations)
    };
    return Response.json({ dashboard });
  }
  calculateSessionStats(traces) {
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    let tasksToday = 0;
    let totalEfficiency = 0;
    let efficiencyCount = 0;
    for (const trace of traces) {
      const t = trace;
      if (t.started_at.startsWith(today)) {
        tasksToday++;
        if (t.summary) {
          const summary = JSON.parse(t.summary);
          totalEfficiency += summary.efficiency || 0;
          efficiencyCount++;
        }
      }
    }
    return {
      tasksToday,
      xpToday: tasksToday * 30,
      // Rough estimate
      avgEfficiency: efficiencyCount > 0 ? Math.round(totalEfficiency / efficiencyCount * 100) : 0,
      tokensUsed: 0
      // Would need token tracking
    };
  }
  detectFlowState() {
    const hasActiveEscalation = this.sql.exec(
      "SELECT 1 FROM escalations WHERE resolved_at IS NULL LIMIT 1"
    ).toArray().length > 0;
    if (hasActiveEscalation) {
      return { status: "stuck", durationMinutes: 0, respectFlow: false };
    }
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1e3).toISOString();
    const recentSteps = this.sql.exec(`
      SELECT ws.outcome, ws.timestamp, ws.duration_ms
      FROM work_steps ws
      JOIN work_traces wt ON ws.session_id = wt.session_id
      WHERE wt.completed_at IS NULL
        AND ws.timestamp > ?
      ORDER BY ws.timestamp DESC
      LIMIT 10
    `, fifteenMinAgo).toArray();
    if (recentSteps.length === 0) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1e3).toISOString();
      const hasRecentTrace = this.sql.exec(
        "SELECT 1 FROM work_traces WHERE started_at > ? LIMIT 1",
        oneHourAgo
      ).toArray().length > 0;
      return {
        status: hasRecentTrace ? "available" : "offline",
        durationMinutes: 0,
        respectFlow: false
      };
    }
    const productiveOutcomes = ["found", "partial"];
    const productiveCount = recentSteps.filter(
      (s) => productiveOutcomes.includes(s.outcome)
    ).length;
    const inFlow = productiveCount >= 5 && recentSteps.length >= 5;
    if (inFlow) {
      const firstStep = recentSteps[recentSteps.length - 1];
      const flowStart = new Date(firstStep.timestamp);
      const durationMinutes = Math.round((Date.now() - flowStart.getTime()) / (1e3 * 60));
      return {
        status: "in_flow",
        durationMinutes,
        respectFlow: true
        // Don't interrupt!
      };
    }
    return { status: "available", durationMinutes: 0, respectFlow: false };
  }
  calculateStreakStatus(traces) {
    if (traces.length === 0) {
      return { atRisk: true, hoursUntilExpires: 0 };
    }
    const lastTrace = traces[0];
    const lastActive = new Date(lastTrace.completed_at || lastTrace.started_at);
    const now = /* @__PURE__ */ new Date();
    const hoursSince = (now.getTime() - lastActive.getTime()) / (1e3 * 60 * 60);
    const hoursUntilExpires = Math.max(0, 48 - hoursSince);
    return {
      atRisk: hoursUntilExpires < 8,
      hoursUntilExpires: Math.round(hoursUntilExpires)
    };
  }
  getNextLevel(current) {
    const levels = ["novice", "capable", "expert", "master"];
    const idx = levels.indexOf(current);
    return idx < levels.length - 1 ? levels[idx + 1] : null;
  }
  getRustStatus(rustLevel) {
    if (rustLevel === 0) return "None \u2728";
    if (rustLevel <= 0.2) return "Light \u{1F331}";
    if (rustLevel <= 0.4) return "Moderate \u26A0\uFE0F";
    return "Heavy \u{1F527}";
  }
  formatSpecializations(specs) {
    const SPEC_RANKS = [
      { name: "None", threshold: 0 },
      { name: "Familiar", threshold: 100 },
      { name: "Proficient", threshold: 500 },
      { name: "Specialist", threshold: 2e3 },
      { name: "Authority", threshold: 5e3 }
    ];
    return Object.entries(specs).map(([domain, xp]) => {
      let rank = "None";
      let nextThreshold = 100;
      for (let i = SPEC_RANKS.length - 1; i >= 0; i--) {
        if (xp >= SPEC_RANKS[i].threshold) {
          rank = SPEC_RANKS[i].name;
          nextThreshold = SPEC_RANKS[i + 1]?.threshold || SPEC_RANKS[i].threshold;
          break;
        }
      }
      const prevThreshold = SPEC_RANKS.find((r) => r.name === rank)?.threshold || 0;
      const progress = nextThreshold > prevThreshold ? Math.round((xp - prevThreshold) / (nextThreshold - prevThreshold) * 100) : 100;
      return { domain, xp, rank, progress };
    });
  }
  generateSuggestions(soul, levelProgress, sessionStats, pendingEscalations) {
    const suggestions = [];
    if (levelProgress.xpNeeded && levelProgress.xpNeeded < 100) {
      suggestions.push({
        action: `Complete one more task to reach ${levelProgress.nextLevel}!`,
        priority: "high",
        reason: `Only ${levelProgress.xpNeeded} XP needed`
      });
    }
    if (pendingEscalations > 0) {
      suggestions.push({
        action: "Check escalation queue - someone might need help!",
        priority: "medium",
        reason: `${pendingEscalations} unresolved escalation(s)`
      });
    }
    if (sessionStats.tasksToday === 0) {
      suggestions.push({
        action: "Start your first task of the day",
        priority: "medium",
        reason: "No activity recorded today"
      });
    }
    if ((soul.rustLevel || 0) > 0) {
      suggestions.push({
        action: "Complete a task to shake off rust",
        priority: "high",
        reason: `Rust is reducing XP by ${Math.round((soul.rustLevel || 0) * 50)}%`
      });
    }
    const weakest = Object.entries(soul.specializations).sort(([, a], [, b]) => a - b)[0];
    if (weakest && weakest[1] < 50) {
      suggestions.push({
        action: `Try a ${weakest[0]} task to become more well-rounded`,
        priority: "low",
        reason: `${weakest[0]} is your weakest area`
      });
    }
    return suggestions;
  }
  // ========== Heartbeat Handler (Shadow Agent Monitoring) ==========
  async handleHeartbeat(request) {
    if (request.method === "GET") {
      const status = this.getHeartbeatStatus();
      return Response.json(status);
    }
    if (request.method === "POST") {
      const body = await request.json();
      const result = this.recordHeartbeat(body);
      return Response.json({ success: true, heartbeat: result });
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  getHeartbeatStatus() {
    const monitorRows = this.sql.exec("SELECT * FROM shadow_monitor WHERE id = 1").toArray();
    const monitor = monitorRows[0] || { stall_threshold_ms: 3e5, last_heartbeat: null };
    const stallThreshold = monitor.stall_threshold_ms || 3e5;
    const lastHeartbeat = monitor.last_heartbeat;
    const now = Date.now();
    const lastTime = lastHeartbeat ? new Date(lastHeartbeat).getTime() : 0;
    const stalledForMs = lastHeartbeat ? now - lastTime : now;
    const isHealthy = stalledForMs < stallThreshold;
    const recentRows = this.sql.exec(
      "SELECT timestamp, status FROM heartbeat_log ORDER BY timestamp DESC LIMIT 10"
    ).toArray();
    const recentHeartbeats = recentRows.map((row) => ({
      timestamp: row.timestamp,
      status: row.status
    }));
    const countRows = this.sql.exec("SELECT COUNT(*) as count FROM heartbeat_log").toArray();
    const heartbeatCount = countRows[0]?.count || 0;
    return {
      lastHeartbeat,
      isHealthy,
      stalledForMs,
      stalledForMinutes: Math.round(stalledForMs / 6e4 * 10) / 10,
      heartbeatCount,
      recentHeartbeats
    };
  }
  recordHeartbeat(data) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const id = `hb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.sql.exec(`
      INSERT INTO heartbeat_log (id, timestamp, tokens_used, current_task, status)
      VALUES (?, ?, ?, ?, ?)
    `, id, now, data.tokensUsed || 0, data.currentTask || null, data.status || "healthy");
    this.sql.exec(`
      INSERT INTO shadow_monitor (id, last_heartbeat)
      VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET last_heartbeat = excluded.last_heartbeat
    `, now);
    this.sql.exec(`
      DELETE FROM heartbeat_log WHERE id NOT IN (
        SELECT id FROM heartbeat_log ORDER BY timestamp DESC LIMIT 100
      )
    `);
    return { id, timestamp: now };
  }
  // ========== Shadow Agent Handler ==========
  async handleShadow(request) {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "get";
    if (request.method === "GET") {
      const shadowStatus = this.getShadowStatus();
      return Response.json(shadowStatus);
    }
    if (request.method === "POST") {
      const body = await request.json();
      const actionType = body.action || action;
      switch (actionType) {
        case "register-shadow":
          return Response.json(this.registerShadow(body.shadowId, body.stallThresholdMs, body.heartbeatIntervalMs));
        case "become-shadow":
          return Response.json(this.becomeShadow(body.primaryAgent));
        case "takeover":
          return Response.json(this.executeTakeover());
        case "configure":
          return Response.json(this.configureShadowMonitor(body));
        default:
          return Response.json({ error: "Unknown action. Use: register-shadow, become-shadow, takeover, configure" }, { status: 400 });
      }
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  getShadowStatus() {
    const rows = this.sql.exec("SELECT * FROM shadow_monitor WHERE id = 1").toArray();
    if (rows.length === 0) {
      return {
        hasShadow: false,
        shadowId: null,
        shadowStatus: "none",
        isShadow: false,
        primaryAgent: null,
        lastHeartbeat: null,
        isHealthy: true,
        stallThresholdMs: 3e5,
        heartbeatIntervalMs: 6e4,
        registeredAt: null,
        takeoverAt: null
      };
    }
    const row = rows[0];
    const lastHeartbeat = row.last_heartbeat;
    const stallThreshold = row.stall_threshold_ms || 3e5;
    const now = Date.now();
    const lastTime = lastHeartbeat ? new Date(lastHeartbeat).getTime() : 0;
    const stalledForMs = lastHeartbeat ? now - lastTime : now;
    const isHealthy = stalledForMs < stallThreshold;
    return {
      hasShadow: !!row.shadow_id,
      shadowId: row.shadow_id,
      shadowStatus: row.shadow_status || "none",
      isShadow: !!row.is_shadow,
      primaryAgent: row.primary_agent,
      lastHeartbeat,
      isHealthy,
      stallThresholdMs: stallThreshold,
      heartbeatIntervalMs: row.heartbeat_interval_ms || 6e4,
      registeredAt: row.registered_at,
      takeoverAt: row.takeover_at
    };
  }
  registerShadow(shadowId, stallThresholdMs, heartbeatIntervalMs) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.sql.exec(`
      INSERT INTO shadow_monitor (id, shadow_id, shadow_status, stall_threshold_ms, heartbeat_interval_ms, registered_at)
      VALUES (1, ?, 'monitoring', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        shadow_id = excluded.shadow_id,
        shadow_status = 'monitoring',
        stall_threshold_ms = COALESCE(excluded.stall_threshold_ms, shadow_monitor.stall_threshold_ms),
        heartbeat_interval_ms = COALESCE(excluded.heartbeat_interval_ms, shadow_monitor.heartbeat_interval_ms),
        registered_at = excluded.registered_at
    `, shadowId, stallThresholdMs || 3e5, heartbeatIntervalMs || 6e4, now);
    return {
      success: true,
      message: `Shadow ${shadowId} registered for monitoring`,
      shadow: { shadowId, status: "monitoring", registeredAt: now }
    };
  }
  becomeShadow(primaryAgent) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.sql.exec(`
      INSERT INTO shadow_monitor (id, primary_agent, is_shadow, registered_at)
      VALUES (1, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        primary_agent = excluded.primary_agent,
        is_shadow = 1,
        registered_at = excluded.registered_at
    `, primaryAgent, now);
    return {
      success: true,
      message: `Now shadowing ${primaryAgent}`,
      config: { primaryAgent, isShadow: true, registeredAt: now }
    };
  }
  executeTakeover() {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const currentStatus = this.getShadowStatus();
    this.sql.exec(`
      UPDATE shadow_monitor SET
        shadow_status = 'taken-over',
        takeover_at = ?
      WHERE id = 1
    `, now);
    return {
      success: true,
      message: "Takeover executed - shadow is now primary",
      takeover: { takeoverAt: now, previousStatus: currentStatus.shadowStatus }
    };
  }
  configureShadowMonitor(config) {
    const current = this.getShadowStatus();
    const newStall = config.stallThresholdMs || current.stallThresholdMs;
    const newInterval = config.heartbeatIntervalMs || current.heartbeatIntervalMs;
    this.sql.exec(`
      INSERT INTO shadow_monitor (id, stall_threshold_ms, heartbeat_interval_ms)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        stall_threshold_ms = excluded.stall_threshold_ms,
        heartbeat_interval_ms = excluded.heartbeat_interval_ms
    `, newStall, newInterval);
    return {
      success: true,
      config: { stallThresholdMs: newStall, heartbeatIntervalMs: newInterval }
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
            "/coordinator/onboard": "Agent onboarding bundle - GET (soul, dashboard, team, suggested task)",
            "/coordinator/session-resume": "CEO Portal session resume - GET (participants, accomplishments, pending work, quick actions)",
            "/agent/:agentId/*": "Per-agent state - checkpoint, messages, memory, trace",
            "/agent/:agentId/trace": "Work traces - GET (list), POST (start)",
            "/agent/:agentId/trace/:sessionId": "Trace session - GET full trace",
            "/agent/:agentId/trace/:sessionId/step": "Log work step - POST",
            "/agent/:agentId/trace/:sessionId/complete": "Complete trace - POST",
            "/agent/:agentId/trace/:sessionId/resolve-escalation": "Resolve escalation - POST",
            "/agent/:agentId/trace/:sessionId/escalations": "Get trace escalations - GET",
            "/agent/:agentId/soul": "Soul progression - GET/POST/PATCH",
            "/agent/:agentId/dashboard": "Agent self-dashboard - GET (aggregated view)",
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

// .wrangler/tmp/bundle-y649qX/middleware-insertion-facade.js
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

// .wrangler/tmp/bundle-y649qX/middleware-loader.entry.ts
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
