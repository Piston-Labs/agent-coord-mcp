/**
 * AgentState - Per-Agent Durable Object
 *
 * Each agent gets their own Durable Object instance with:
 * - Personal checkpoint/state persistence
 * - Direct message inbox
 * - Personal memory store
 * - Task queue
 *
 * Pattern: One DO per agent (use agentId as DO name)
 * Scale: Naturally distributed - one instance per agent
 */

import type { AgentCheckpoint, WebSocketMessage } from './types';

interface DirectMessage {
  id: string;
  from: string;
  type: 'status' | 'handoff' | 'note' | 'mention';
  message: string;
  timestamp: string;
  read: boolean;
}

interface Memory {
  id: string;
  category: 'discovery' | 'decision' | 'blocker' | 'learning' | 'pattern' | 'warning';
  content: string;
  tags: string[];
  createdAt: string;
}

export class AgentState implements DurableObject {
  private state: DurableObjectState;
  private sql: SqlStorage;
  private agentId: string = '';
  private wsConnection: WebSocket | null = null;

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state;
    this.sql = state.storage.sql;
    this.initializeDatabase();
  }

  private initializeDatabase() {
    // Agent metadata
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS agent_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // Checkpoint (only one per agent)
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

    // Direct messages inbox
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

    // Personal memory store
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

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Extract agent ID from the DO name (passed via header or query)
    this.agentId = url.searchParams.get('agentId') || request.headers.get('X-Agent-Id') || 'unknown';

    // WebSocket for real-time updates to this specific agent
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    try {
      switch (path) {
        case '/checkpoint':
          return this.handleCheckpoint(request);
        case '/messages':
          return this.handleMessages(request);
        case '/memory':
          return this.handleMemory(request);
        case '/state':
          return this.handleFullState(request);
        case '/health':
          return Response.json({ status: 'ok', type: 'agent-state', agentId: this.agentId });
        default:
          return Response.json({ error: 'Not found' }, { status: 404 });
      }
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  private handleWebSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    this.wsConnection = server;

    // Send current state
    const state = this.getFullState();
    server.send(JSON.stringify({
      type: 'state-sync',
      payload: state,
      timestamp: new Date().toISOString()
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const data = JSON.parse(message as string);
    // Handle incoming messages from the agent
    if (data.type === 'checkpoint-save') {
      await this.saveCheckpoint(data.payload);
      ws.send(JSON.stringify({ type: 'checkpoint-saved', timestamp: new Date().toISOString() }));
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.wsConnection = null;
  }

  private notifyAgent(message: WebSocketMessage) {
    if (this.wsConnection) {
      try {
        this.wsConnection.send(JSON.stringify(message));
      } catch {
        this.wsConnection = null;
      }
    }
  }

  // ========== Checkpoint Handlers ==========

  private async handleCheckpoint(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      return Response.json({ checkpoint: this.getCheckpoint() });
    }

    if (request.method === 'POST') {
      const body = await request.json() as Partial<AgentCheckpoint>;
      await this.saveCheckpoint(body);
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  private getCheckpoint(): AgentCheckpoint | null {
    const rows = this.sql.exec('SELECT * FROM checkpoint WHERE id = 1').toArray();
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      agentId: this.agentId,
      conversationSummary: row.conversation_summary as string | undefined,
      accomplishments: JSON.parse((row.accomplishments as string) || '[]'),
      pendingWork: JSON.parse((row.pending_work as string) || '[]'),
      recentContext: row.recent_context as string | undefined,
      filesEdited: JSON.parse((row.files_edited as string) || '[]'),
      checkpointAt: row.checkpoint_at as string
    };
  }

  private async saveCheckpoint(data: Partial<AgentCheckpoint>) {
    const now = new Date().toISOString();
    this.sql.exec(`
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

  private async handleMessages(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const unreadOnly = url.searchParams.get('unread') === 'true';
      return Response.json({ messages: this.getMessages(unreadOnly) });
    }

    if (request.method === 'POST') {
      const body = await request.json() as { from: string; type?: string; message: string };
      const msg = this.addMessage(body);

      // Notify agent in real-time
      this.notifyAgent({
        type: 'chat',
        payload: msg,
        timestamp: new Date().toISOString()
      });

      return Response.json({ success: true, message: msg });
    }

    if (request.method === 'PATCH') {
      // Mark messages as read
      const body = await request.json() as { messageIds: string[] };
      this.markAsRead(body.messageIds);
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  private getMessages(unreadOnly: boolean): DirectMessage[] {
    const query = unreadOnly
      ? 'SELECT * FROM messages WHERE read = 0 ORDER BY timestamp DESC'
      : 'SELECT * FROM messages ORDER BY timestamp DESC LIMIT 100';

    const rows = this.sql.exec(query).toArray();
    return rows.map(row => ({
      id: row.id as string,
      from: row.from_agent as string,
      type: row.type as DirectMessage['type'],
      message: row.message as string,
      timestamp: row.timestamp as string,
      read: Boolean(row.read)
    }));
  }

  private addMessage(data: { from: string; type?: string; message: string }): DirectMessage {
    const msg: DirectMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      from: data.from,
      type: (data.type || 'note') as DirectMessage['type'],
      message: data.message,
      timestamp: new Date().toISOString(),
      read: false
    };

    this.sql.exec(`
      INSERT INTO messages (id, from_agent, type, message, timestamp, read)
      VALUES (?, ?, ?, ?, ?, 0)
    `, msg.id, msg.from, msg.type, msg.message, msg.timestamp);

    return msg;
  }

  private markAsRead(messageIds: string[]) {
    for (const id of messageIds) {
      this.sql.exec('UPDATE messages SET read = 1 WHERE id = ?', id);
    }
  }

  // ========== Memory Handlers ==========

  private async handleMemory(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const category = url.searchParams.get('category');
      const query = url.searchParams.get('query');
      return Response.json({ memories: this.getMemories(category, query) });
    }

    if (request.method === 'POST') {
      const body = await request.json() as Partial<Memory>;
      const mem = this.addMemory(body);
      return Response.json({ success: true, memory: mem });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  private getMemories(category: string | null, query: string | null): Memory[] {
    let sql = 'SELECT * FROM memory WHERE 1=1';
    const params: string[] = [];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (query) {
      sql += ' AND (content LIKE ? OR tags LIKE ?)';
      params.push(`%${query}%`, `%${query}%`);
    }

    sql += ' ORDER BY created_at DESC LIMIT 50';

    const rows = this.sql.exec(sql, ...params).toArray();
    return rows.map(row => ({
      id: row.id as string,
      category: row.category as Memory['category'],
      content: row.content as string,
      tags: JSON.parse((row.tags as string) || '[]'),
      createdAt: row.created_at as string
    }));
  }

  private addMemory(data: Partial<Memory>): Memory {
    const mem: Memory = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      category: data.category || 'learning',
      content: data.content || '',
      tags: data.tags || [],
      createdAt: new Date().toISOString()
    };

    this.sql.exec(`
      INSERT INTO memory (id, category, content, tags, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, mem.id, mem.category, mem.content, JSON.stringify(mem.tags), mem.createdAt);

    return mem;
  }

  // ========== Full State ==========

  private handleFullState(request: Request): Response {
    return Response.json(this.getFullState());
  }

  private getFullState() {
    return {
      agentId: this.agentId,
      checkpoint: this.getCheckpoint(),
      unreadMessages: this.getMessages(true),
      recentMemories: this.getMemories(null, null).slice(0, 10)
    };
  }
}
