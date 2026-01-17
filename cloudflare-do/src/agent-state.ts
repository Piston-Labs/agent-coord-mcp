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

// WorkTrace types for "Show Your Work" observability
interface WorkStep {
  id: string;
  sessionId: string;
  timestamp: string;
  tool: string;
  intent: string;
  outcome: 'found' | 'nothing' | 'error' | 'partial';
  durationMs: number;
  contributionType?: 'enabling' | 'pruning' | 'direct' | 'minimal';
  knowledgeGained?: string[];
  eliminatedPaths?: number;
  dependsOn?: string[];
}

interface WorkTrace {
  sessionId: string;
  agentId: string;
  task: string;
  startedAt: string;
  completedAt?: string;
  steps: WorkStep[];
  summary?: WorkSummary;
}

interface WorkSummary {
  totalSteps: number;
  deadEnds: number;
  explorationTimeMs: number;
  solutionTimeMs: number;
  efficiency: number;
}

// Escalation trigger types for automatic detection
interface EscalationTrigger {
  type: 'stuck_loop' | 'repeated_failures' | 'time_exceeded' | 'low_efficiency' | 'error_accumulation';
  level: 1 | 2 | 3;  // 1=notify, 2=pause, 3=escalate
  reason: string;
  detectedAt: string;
}

interface EscalationCheck {
  shouldEscalate: boolean;
  triggers: EscalationTrigger[];
  highestLevel: number;
  recommendation: string;
}

// Escalation resolution tracking
interface EscalationResolution {
  resolvedBy: 'self' | 'peer' | 'human';
  resolverAgent?: string;
  resolutionTime: string;
  helpfulHint?: string;
  escalationId: string;
}

// Extended WorkTrace with escalation history
interface WorkTraceWithEscalations extends WorkTrace {
  escalations?: Array<{
    triggeredAt: string;
    triggers: EscalationTrigger[];
    resolution?: EscalationResolution;
  }>;
}

// Soul Progression types for gamified agent development
type SoulLevel = 'novice' | 'capable' | 'expert' | 'master';

interface SoulAbilities {
  canCommit: boolean;
  canSpawnSubagents: boolean;
  canAccessProd: boolean;
  canMentorPeers: boolean;
  extendedBudget: boolean;
}

interface SoulSpecializations {
  frontend: number;
  backend: number;
  devops: number;
  research: number;
}

interface SoulProgression {
  soulId: string;
  name: string;
  personality: string;
  createdAt: string;

  // Progression
  totalXP: number;
  level: SoulLevel;
  currentStreak: number;
  longestStreak: number;

  // Stats
  tasksCompleted: number;
  tasksSuccessful: number;
  totalTokensUsed: number;
  avgEfficiency: number;
  peersHelped: number;

  // WorkTrace-derived
  lastTraceId?: string;
  escalationCount: number;
  selfResolvedCount: number;
  peerAssistCount: number;
  humanEscalationCount: number;

  // Specializations (XP per domain)
  specializations: SoulSpecializations;

  // Achievements unlocked
  achievements: string[];

  // Ability flags
  abilities: SoulAbilities;

  // Trust metrics
  trustScore: number;
  transparencyScore: number;
  trackRecordScore: number;

  // Computed fields (not stored)
  rustLevel?: number;
  effectiveXPMultiplier?: number;
}

// Level thresholds
const LEVEL_THRESHOLDS: Record<SoulLevel, { xp: number; streak: number; tasks: number }> = {
  novice: { xp: 0, streak: 0, tasks: 0 },
  capable: { xp: 100, streak: 3, tasks: 5 },
  expert: { xp: 500, streak: 5, tasks: 25 },
  master: { xp: 2000, streak: 10, tasks: 100 }
};

// Abilities unlocked at each level
const LEVEL_ABILITIES: Record<SoulLevel, Partial<SoulAbilities>> = {
  novice: { canCommit: false, canSpawnSubagents: false, canAccessProd: false, canMentorPeers: false, extendedBudget: false },
  capable: { canCommit: true },
  expert: { canSpawnSubagents: true, canMentorPeers: true },
  master: { canAccessProd: true, extendedBudget: true }
};

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

    // WorkTrace tables for "Show Your Work" observability
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

    // Escalation tracking table
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

    // Soul Progression table for gamified agent development
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

    // Shadow agent monitoring table
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

    // Heartbeat log for health monitoring
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

    // Credentials storage (encrypted at rest by DO)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS credentials (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        masked_preview TEXT
      )
    `);

    // Goals queue for autonomous agents
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT DEFAULT 'task',
        priority INTEGER DEFAULT 5,
        status TEXT DEFAULT 'pending',
        xp_reward INTEGER DEFAULT 10,
        source TEXT DEFAULT 'self',
        assigned_by TEXT,
        context TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        outcome TEXT
      )
    `);

    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_goals_priority ON goals(priority DESC)`);
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
        case '/trace':
          return this.handleWorkTrace(request);
        case '/soul':
          return this.handleSoulProgression(request);
        case '/dashboard':
          return this.handleDashboard(request);
        case '/heartbeat':
          return this.handleHeartbeat(request);
        case '/shadow':
          return this.handleShadow(request);
        case '/credentials':
          return this.handleCredentials(request);
        case '/goals':
          return this.handleGoals(request);
        case '/health':
          return Response.json({ status: 'ok', type: 'agent-state', agentId: this.agentId });
        default:
          // Handle /trace/:sessionId routes
          if (path.startsWith('/trace/')) {
            return this.handleWorkTraceSession(request, path.slice(7));
          }
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

  // ========== WorkTrace Handlers (Show Your Work) ==========

  private async handleWorkTrace(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      // List all traces
      const traces = this.listWorkTraces();
      return Response.json({ traces });
    }

    if (request.method === 'POST') {
      // Start a new trace session
      const body = await request.json() as { task?: string; taskDescription?: string; sessionId?: string };
      // Support both 'task' and 'taskDescription' for flexibility
      const task = body.task || body.taskDescription || 'Untitled task';
      const trace = this.startWorkTrace(task, body.sessionId);
      return Response.json({ success: true, trace });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  private async handleWorkTraceSession(request: Request, sessionPath: string): Promise<Response> {
    // Parse: sessionId or sessionId/step or sessionId/complete
    const parts = sessionPath.split('/');
    const sessionId = parts[0];
    const action = parts[1];

    if (request.method === 'GET' && !action) {
      // Get full trace
      const trace = this.getWorkTrace(sessionId);
      if (!trace) {
        return Response.json({ error: 'Trace not found' }, { status: 404 });
      }
      return Response.json({ trace });
    }

    if (request.method === 'POST' && action === 'step') {
      // Log a work step
      const body = await request.json() as Partial<WorkStep>;
      const result = this.logWorkStep(sessionId, body);
      return Response.json({
        success: true,
        step: result.step,
        ...(result.escalation && { escalation: result.escalation })
      });
    }

    if (request.method === 'POST' && action === 'complete') {
      // Complete the trace with summary
      const trace = this.completeWorkTrace(sessionId);
      return Response.json({ success: true, trace });
    }

    if (request.method === 'POST' && action === 'resolve-escalation') {
      // Resolve an escalation
      const body = await request.json() as {
        escalationId: string;
        resolvedBy: 'self' | 'peer' | 'human';
        resolverAgent?: string;
        helpfulHint?: string;
      };
      const result = this.resolveEscalation(body);
      return Response.json({ success: true, resolution: result });
    }

    if (request.method === 'GET' && action === 'escalations') {
      // Get all escalations for this trace
      const escalations = this.getTraceEscalations(sessionId);
      return Response.json({ escalations });
    }

    return Response.json({ error: 'Invalid trace action' }, { status: 400 });
  }

  private listWorkTraces(): Array<{ sessionId: string; task: string; startedAt: string; completedAt?: string }> {
    const rows = this.sql.exec('SELECT session_id, task, started_at, completed_at FROM work_traces ORDER BY started_at DESC LIMIT 20').toArray();
    return rows.map(row => ({
      sessionId: row.session_id as string,
      task: row.task as string,
      startedAt: row.started_at as string,
      completedAt: row.completed_at as string | undefined
    }));
  }

  private startWorkTrace(task: string, sessionId?: string): WorkTrace {
    const id = sessionId || `trace-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

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

  private logWorkStep(sessionId: string, data: Partial<WorkStep>): { step: WorkStep; escalation?: EscalationCheck } {
    const step: WorkStep = {
      id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      timestamp: new Date().toISOString(),
      tool: data.tool || 'unknown',
      intent: data.intent || '',
      outcome: data.outcome || 'partial',
      durationMs: data.durationMs || 0,
      contributionType: data.contributionType,
      knowledgeGained: data.knowledgeGained || [],
      eliminatedPaths: data.eliminatedPaths || 0,
      dependsOn: data.dependsOn || []
    };

    this.sql.exec(`
      INSERT INTO work_steps (id, session_id, timestamp, tool, intent, outcome, duration_ms, contribution_type, knowledge_gained, eliminated_paths, depends_on)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, step.id, step.sessionId, step.timestamp, step.tool, step.intent, step.outcome,
       step.durationMs, step.contributionType || null, JSON.stringify(step.knowledgeGained),
       step.eliminatedPaths, JSON.stringify(step.dependsOn));

    // Check for escalation triggers after logging step
    const trace = this.getWorkTrace(sessionId);
    if (trace) {
      const escalation = this.checkEscalationTriggers(trace, step);
      if (escalation.shouldEscalate) {
        // Record the escalation in database
        const escalationId = this.recordEscalation(sessionId, escalation);
        return { step, escalation: { ...escalation, escalationId } };
      }
    }

    return { step };
  }

  private recordEscalation(sessionId: string, escalation: EscalationCheck): string {
    const id = `esc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    this.sql.exec(`
      INSERT INTO escalations (id, session_id, triggered_at, triggers, highest_level)
      VALUES (?, ?, ?, ?, ?)
    `, id, sessionId, now, JSON.stringify(escalation.triggers), escalation.highestLevel);

    return id;
  }

  private resolveEscalation(data: {
    escalationId: string;
    resolvedBy: 'self' | 'peer' | 'human';
    resolverAgent?: string;
    helpfulHint?: string;
  }): EscalationResolution {
    const now = new Date().toISOString();

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

  private getTraceEscalations(sessionId: string): Array<{
    id: string;
    triggeredAt: string;
    triggers: EscalationTrigger[];
    highestLevel: number;
    resolvedAt?: string;
    resolvedBy?: string;
    resolverAgent?: string;
    helpfulHint?: string;
  }> {
    const rows = this.sql.exec(
      'SELECT * FROM escalations WHERE session_id = ? ORDER BY triggered_at ASC',
      sessionId
    ).toArray();

    return rows.map(row => ({
      id: row.id as string,
      triggeredAt: row.triggered_at as string,
      triggers: JSON.parse(row.triggers as string),
      highestLevel: row.highest_level as number,
      resolvedAt: row.resolved_at as string | undefined,
      resolvedBy: row.resolved_by as string | undefined,
      resolverAgent: row.resolver_agent as string | undefined,
      helpfulHint: row.helpful_hint as string | undefined
    }));
  }

  private checkEscalationTriggers(trace: WorkTrace, currentStep: WorkStep): EscalationCheck {
    const triggers: EscalationTrigger[] = [];
    const now = new Date().toISOString();

    // 1. Stuck loop detection - same tool called 3+ times with no progress
    const recentSteps = trace.steps.slice(-5);
    const sameToolSteps = recentSteps.filter(s => s.tool === currentStep.tool);
    const sameToolNoProgress = sameToolSteps.filter(s => s.outcome === 'nothing' || s.outcome === 'partial');
    if (sameToolNoProgress.length >= 3) {
      triggers.push({
        type: 'stuck_loop',
        level: 2,
        reason: `${currentStep.tool} called ${sameToolNoProgress.length}x with no progress`,
        detectedAt: now
      });
    }

    // 2. Repeated failures - 3+ dead ends in session
    const deadEnds = trace.steps.filter(s => s.outcome === 'nothing').length;
    if (deadEnds >= 3) {
      triggers.push({
        type: 'repeated_failures',
        level: 1,
        reason: `${deadEnds} dead ends in this session`,
        detectedAt: now
      });
    }

    // 3. Error accumulation - 2+ errors
    const errors = trace.steps.filter(s => s.outcome === 'error').length;
    if (errors >= 2) {
      triggers.push({
        type: 'error_accumulation',
        level: 2,
        reason: `${errors} errors encountered`,
        detectedAt: now
      });
    }

    // 4. Time exceeded - task running > 10 minutes
    const elapsed = Date.now() - new Date(trace.startedAt).getTime();
    if (elapsed > 10 * 60 * 1000) {
      triggers.push({
        type: 'time_exceeded',
        level: 1,
        reason: `Task running for ${Math.round(elapsed / 60000)} minutes`,
        detectedAt: now
      });
    }

    // 5. Low efficiency - more than 60% of steps are non-productive after 5+ steps
    if (trace.steps.length >= 5) {
      const nonproductive = trace.steps.filter(s =>
        s.outcome === 'nothing' || s.outcome === 'error' || s.contributionType === 'minimal'
      ).length;
      const efficiencyRatio = nonproductive / trace.steps.length;
      if (efficiencyRatio > 0.6) {
        triggers.push({
          type: 'low_efficiency',
          level: 1,
          reason: `${Math.round(efficiencyRatio * 100)}% of steps non-productive`,
          detectedAt: now
        });
      }
    }

    const highestLevel = triggers.length > 0 ? Math.max(...triggers.map(t => t.level)) : 0;

    // Generate recommendation based on highest level
    let recommendation = '';
    if (highestLevel === 0) {
      recommendation = 'Continue working';
    } else if (highestLevel === 1) {
      recommendation = 'Consider pausing to review approach';
    } else if (highestLevel === 2) {
      recommendation = 'PAUSE: Ask for guidance or try different approach';
    } else {
      recommendation = 'ESCALATE: Human intervention recommended';
    }

    return {
      shouldEscalate: triggers.length > 0,
      triggers,
      highestLevel,
      recommendation
    };
  }

  private getWorkTrace(sessionId: string): WorkTrace | null {
    const traceRows = this.sql.exec('SELECT * FROM work_traces WHERE session_id = ?', sessionId).toArray();
    if (traceRows.length === 0) return null;

    const traceRow = traceRows[0];
    const stepRows = this.sql.exec('SELECT * FROM work_steps WHERE session_id = ? ORDER BY timestamp ASC', sessionId).toArray();

    const steps: WorkStep[] = stepRows.map(row => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      timestamp: row.timestamp as string,
      tool: row.tool as string,
      intent: row.intent as string,
      outcome: row.outcome as WorkStep['outcome'],
      durationMs: row.duration_ms as number,
      contributionType: row.contribution_type as WorkStep['contributionType'],
      knowledgeGained: JSON.parse((row.knowledge_gained as string) || '[]'),
      eliminatedPaths: row.eliminated_paths as number,
      dependsOn: JSON.parse((row.depends_on as string) || '[]')
    }));

    return {
      sessionId: traceRow.session_id as string,
      agentId: this.agentId,
      task: traceRow.task as string,
      startedAt: traceRow.started_at as string,
      completedAt: traceRow.completed_at as string | undefined,
      steps,
      summary: traceRow.summary ? JSON.parse(traceRow.summary as string) : undefined
    };
  }

  private completeWorkTrace(sessionId: string): WorkTrace | null {
    const trace = this.getWorkTrace(sessionId);
    if (!trace) return null;

    // Calculate summary
    const deadEnds = trace.steps.filter(s => s.outcome === 'nothing' || s.outcome === 'error').length;
    const totalTimeMs = trace.steps.reduce((sum, s) => sum + s.durationMs, 0);
    const solutionSteps = trace.steps.filter(s => s.outcome === 'found' || s.contributionType === 'direct');
    const solutionTimeMs = solutionSteps.reduce((sum, s) => sum + s.durationMs, 0);

    const summary: WorkSummary = {
      totalSteps: trace.steps.length,
      deadEnds,
      explorationTimeMs: totalTimeMs,
      solutionTimeMs,
      efficiency: totalTimeMs > 0 ? solutionTimeMs / totalTimeMs : 0
    };

    const now = new Date().toISOString();
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

  private async handleSoulProgression(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      const soul = this.getSoulProgression();
      return Response.json({ soul });
    }

    if (request.method === 'POST') {
      const body = await request.json() as Partial<SoulProgression>;
      const soul = this.initializeSoul(body);
      return Response.json({ success: true, soul });
    }

    if (request.method === 'PATCH') {
      const body = await request.json() as {
        action?: 'add-xp' | 'unlock-achievement' | 'update-from-trace';
        traceId?: string;
        domain?: keyof SoulSpecializations;
        xp?: number;
        source?: string;
        achievementId?: string;
      };

      // Handle different PATCH actions
      if (body.action === 'add-xp') {
        if (!body.xp || body.xp <= 0) {
          return Response.json({ error: 'xp must be a positive number' }, { status: 400 });
        }
        const result = this.addXPToSoul(body.xp, body.source || 'manual');
        return Response.json(result);
      }

      if (body.action === 'unlock-achievement') {
        if (!body.achievementId) {
          return Response.json({ error: 'achievementId required' }, { status: 400 });
        }
        const result = this.unlockAchievement(body.achievementId);
        return Response.json(result);
      }

      // Default: update from trace (legacy behavior)
      if (body.traceId) {
        const result = this.updateSoulFromTrace(body.traceId, body.domain);
        return Response.json(result);
      }

      return Response.json({ error: 'Invalid PATCH request. Provide action (add-xp, unlock-achievement) or traceId' }, { status: 400 });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  private getSoulProgression(): SoulProgression | null {
    const rows = this.sql.exec('SELECT * FROM soul_progression WHERE soul_id = ?', this.agentId).toArray();
    if (rows.length === 0) return null;

    const row = rows[0];
    const lastTraceId = row.last_trace_id as string | undefined;

    // Calculate rust based on last activity
    const rustLevel = lastTraceId ? this.calculateRustLevel(lastTraceId) : 0;
    const effectiveXPMultiplier = 1 - (rustLevel * 0.5); // Max 30% reduction at 0.6 rust

    return {
      soulId: row.soul_id as string,
      name: row.name as string,
      personality: row.personality as string,
      createdAt: row.created_at as string,
      totalXP: row.total_xp as number,
      level: row.level as SoulLevel,
      currentStreak: row.current_streak as number,
      longestStreak: row.longest_streak as number,
      tasksCompleted: row.tasks_completed as number,
      tasksSuccessful: row.tasks_successful as number,
      totalTokensUsed: row.total_tokens_used as number,
      avgEfficiency: row.avg_efficiency as number,
      peersHelped: row.peers_helped as number,
      lastTraceId,
      escalationCount: row.escalation_count as number,
      selfResolvedCount: row.self_resolved_count as number,
      peerAssistCount: row.peer_assist_count as number,
      humanEscalationCount: row.human_escalation_count as number,
      specializations: JSON.parse(row.specializations as string),
      achievements: JSON.parse(row.achievements as string),
      abilities: JSON.parse(row.abilities as string),
      trustScore: row.trust_score as number,
      transparencyScore: row.transparency_score as number,
      trackRecordScore: row.track_record_score as number,
      rustLevel,
      effectiveXPMultiplier
    };
  }

  private calculateRustLevel(lastTraceId: string): number {
    // Get last trace timestamp
    const traceRows = this.sql.exec('SELECT started_at FROM work_traces WHERE session_id = ?', lastTraceId).toArray();
    if (traceRows.length === 0) return 0;

    const lastActiveDate = new Date(traceRows[0].started_at as string);
    const now = new Date();
    const daysSinceActive = Math.floor((now.getTime() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24));

    // Graduated rust levels
    if (daysSinceActive < 7) return 0;        // No rust
    if (daysSinceActive < 30) return 0.2;     // Light rust
    if (daysSinceActive < 90) return 0.4;     // Moderate rust
    return 0.6;                                // Heavy rust
  }

  private initializeSoul(data: Partial<SoulProgression>): SoulProgression {
    const now = new Date().toISOString();
    const soul: SoulProgression = {
      soulId: data.soulId || this.agentId,
      name: data.name || this.agentId,
      personality: data.personality || 'helpful assistant',
      createdAt: now,
      totalXP: 0,
      level: 'novice',
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

    this.sql.exec(`
      INSERT OR REPLACE INTO soul_progression (
        soul_id, name, personality, created_at, total_xp, level,
        current_streak, longest_streak, tasks_completed, tasks_successful,
        total_tokens_used, avg_efficiency, peers_helped, escalation_count,
        self_resolved_count, peer_assist_count, human_escalation_count,
        specializations, achievements, abilities, trust_score,
        transparency_score, track_record_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      soul.soulId, soul.name, soul.personality, soul.createdAt, soul.totalXP, soul.level,
      soul.currentStreak, soul.longestStreak, soul.tasksCompleted, soul.tasksSuccessful,
      soul.totalTokensUsed, soul.avgEfficiency, soul.peersHelped, soul.escalationCount,
      soul.selfResolvedCount, soul.peerAssistCount, soul.humanEscalationCount,
      JSON.stringify(soul.specializations), JSON.stringify(soul.achievements),
      JSON.stringify(soul.abilities), soul.trustScore, soul.transparencyScore, soul.trackRecordScore
    );

    return soul;
  }

  private addXPToSoul(xpAmount: number, source: string): {
    success: boolean;
    xpGained: number;
    totalXP: number;
    levelUp?: { oldLevel: SoulLevel; newLevel: SoulLevel; newAbilities: string[] };
    soul: SoulProgression | null;
  } {
    let soul = this.getSoulProgression();
    if (!soul) {
      // Auto-create soul if it doesn't exist
      soul = this.initializeSoul({ soulId: this.agentId });
    }

    const oldLevel = soul.level;
    const newTotalXP = soul.totalXP + xpAmount;

    // Calculate new level
    const newLevel = this.calculateLevel(newTotalXP, soul.currentStreak, soul.tasksCompleted);
    const leveledUp = newLevel !== oldLevel;

    // Update in database
    this.sql.exec(`
      UPDATE soul_progression SET
        total_xp = ?,
        level = ?
      WHERE soul_id = ?
    `, newTotalXP, newLevel, this.agentId);

    // Get new abilities if leveled up
    let newAbilities: string[] = [];
    if (leveledUp) {
      const abilities = this.getAbilitiesForLevel(newLevel);
      newAbilities = Object.entries(abilities)
        .filter(([_, enabled]) => enabled)
        .map(([name]) => name);
    }

    const updatedSoul = this.getSoulProgression();

    return {
      success: true,
      xpGained: xpAmount,
      totalXP: newTotalXP,
      ...(leveledUp && { levelUp: { oldLevel, newLevel, newAbilities } }),
      soul: updatedSoul
    };
  }

  private unlockAchievement(achievementId: string): {
    success: boolean;
    achievement: string;
    alreadyUnlocked: boolean;
    soul: SoulProgression | null;
  } {
    let soul = this.getSoulProgression();
    if (!soul) {
      soul = this.initializeSoul({ soulId: this.agentId });
    }

    // Check if already unlocked
    if (soul.achievements.includes(achievementId)) {
      return {
        success: true,
        achievement: achievementId,
        alreadyUnlocked: true,
        soul
      };
    }

    // Add achievement
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

  private updateSoulFromTrace(traceId: string, domain?: keyof SoulSpecializations): {
    success: boolean;
    xpGained: number;
    levelUp?: { oldLevel: SoulLevel; newLevel: SoulLevel; newAbilities: string[] };
    soul: SoulProgression | null;
  } {
    const trace = this.getWorkTrace(traceId);
    if (!trace || !trace.summary) {
      return { success: false, xpGained: 0, soul: null };
    }

    let soul = this.getSoulProgression();
    if (!soul) {
      soul = this.initializeSoul({ soulId: this.agentId });
    }

    // Calculate XP from trace
    const escalations = this.getTraceEscalations(traceId);
    const xp = this.calculateTraceXP(trace, escalations);

    // Determine if task was successful (no human escalation needed)
    const humanEscalation = escalations.some(e => e.resolvedBy === 'human');
    const taskSuccessful = !humanEscalation;

    // Update streak
    const newStreak = taskSuccessful ? soul.currentStreak + 1 : 0;
    const newLongestStreak = Math.max(newStreak, soul.longestStreak);

    // Update stats
    const newTotalXP = soul.totalXP + xp.total;
    const newTasksCompleted = soul.tasksCompleted + 1;
    const newTasksSuccessful = soul.tasksSuccessful + (taskSuccessful ? 1 : 0);
    const newAvgEfficiency = (soul.avgEfficiency * soul.tasksCompleted + trace.summary.efficiency) / newTasksCompleted;

    // Update specialization if domain provided
    const newSpecializations = { ...soul.specializations };
    if (domain) {
      newSpecializations[domain] += Math.floor(xp.total * 0.5); // 50% of XP goes to domain
    }

    // Update escalation counts
    const selfResolved = escalations.filter(e => e.resolvedBy === 'self').length;
    const peerAssisted = escalations.filter(e => e.resolvedBy === 'peer').length;
    const humanHelped = escalations.filter(e => e.resolvedBy === 'human').length;

    // Check for level up
    const oldLevel = soul.level;
    const newLevel = this.calculateLevel(newTotalXP, newStreak, newTasksCompleted);
    const levelUp = newLevel !== oldLevel ? {
      oldLevel,
      newLevel,
      newAbilities: this.getNewAbilities(oldLevel, newLevel)
    } : undefined;

    // Update abilities if leveled up
    const newAbilities = levelUp ? this.mergeAbilities(soul.abilities, newLevel) : soul.abilities;

    // Update trust score based on escalation patterns
    const newTrustScore = this.calculateTrustScore(
      newTasksSuccessful / newTasksCompleted,
      soul.selfResolvedCount + selfResolved,
      soul.humanEscalationCount + humanHelped
    );

    // Save to database
    this.sql.exec(`
      UPDATE soul_progression SET
        total_xp = ?, level = ?, current_streak = ?, longest_streak = ?,
        tasks_completed = ?, tasks_successful = ?, avg_efficiency = ?,
        last_trace_id = ?, escalation_count = ?, self_resolved_count = ?,
        peer_assist_count = ?, human_escalation_count = ?,
        specializations = ?, abilities = ?, trust_score = ?
      WHERE soul_id = ?
    `,
      newTotalXP, newLevel, newStreak, newLongestStreak,
      newTasksCompleted, newTasksSuccessful, newAvgEfficiency,
      traceId, soul.escalationCount + escalations.length,
      soul.selfResolvedCount + selfResolved, soul.peerAssistCount + peerAssisted,
      soul.humanEscalationCount + humanHelped,
      JSON.stringify(newSpecializations), JSON.stringify(newAbilities), newTrustScore,
      soul.soulId
    );

    return {
      success: true,
      xpGained: xp.total,
      levelUp,
      soul: this.getSoulProgression()
    };
  }

  private calculateTraceXP(trace: WorkTrace, escalations: Array<{ resolvedBy?: string }>): { total: number; breakdown: Record<string, number> } {
    const breakdown: Record<string, number> = {
      base: 10,
      efficiency: trace.summary!.efficiency > 0.7 ? 15 : trace.summary!.efficiency > 0.5 ? 5 : 0,
      selfResolved: escalations.every(e => e.resolvedBy === 'self' || !e.resolvedBy) ? 10 : 0,
      noEscalations: escalations.length === 0 ? 5 : 0
    };

    return {
      total: Object.values(breakdown).reduce((a, b) => a + b, 0),
      breakdown
    };
  }

  private calculateLevel(xp: number, streak: number, tasks: number): SoulLevel {
    if (xp >= LEVEL_THRESHOLDS.master.xp && streak >= LEVEL_THRESHOLDS.master.streak && tasks >= LEVEL_THRESHOLDS.master.tasks) {
      return 'master';
    }
    if (xp >= LEVEL_THRESHOLDS.expert.xp && streak >= LEVEL_THRESHOLDS.expert.streak && tasks >= LEVEL_THRESHOLDS.expert.tasks) {
      return 'expert';
    }
    if (xp >= LEVEL_THRESHOLDS.capable.xp && streak >= LEVEL_THRESHOLDS.capable.streak && tasks >= LEVEL_THRESHOLDS.capable.tasks) {
      return 'capable';
    }
    return 'novice';
  }

  private getNewAbilities(oldLevel: SoulLevel, newLevel: SoulLevel): string[] {
    const levels: SoulLevel[] = ['novice', 'capable', 'expert', 'master'];
    const oldIndex = levels.indexOf(oldLevel);
    const newIndex = levels.indexOf(newLevel);
    const newAbilities: string[] = [];

    for (let i = oldIndex + 1; i <= newIndex; i++) {
      const abilities = LEVEL_ABILITIES[levels[i]];
      newAbilities.push(...Object.keys(abilities).filter(k => abilities[k as keyof SoulAbilities]));
    }

    return newAbilities;
  }

  private mergeAbilities(current: SoulAbilities, level: SoulLevel): SoulAbilities {
    const levels: SoulLevel[] = ['novice', 'capable', 'expert', 'master'];
    const merged = { ...current };

    for (const l of levels) {
      if (levels.indexOf(l) <= levels.indexOf(level)) {
        Object.assign(merged, LEVEL_ABILITIES[l]);
      }
    }

    return merged;
  }

  private calculateTrustScore(successRate: number, selfResolved: number, humanEscalations: number): number {
    // Trust = 50% success rate + 30% self-resolution + 20% avoiding human escalation
    const selfResolutionRate = selfResolved > 0 ? selfResolved / (selfResolved + humanEscalations) : 0.5;
    const avoidanceRate = humanEscalations === 0 ? 1 : 1 / (1 + humanEscalations * 0.1);

    return Math.min(1, successRate * 0.5 + selfResolutionRate * 0.3 + avoidanceRate * 0.2);
  }

  // ========== Dashboard Handler ==========

  private handleDashboard(request: Request): Response {
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const soul = this.getSoulProgression();
    if (!soul) {
      return Response.json({
        error: 'No soul data',
        hint: 'POST to /soul first to initialize'
      }, { status: 404 });
    }

    // Get recent traces for session stats
    const recentTraces = this.sql.exec(`
      SELECT session_id, task, started_at, completed_at, summary
      FROM work_traces
      ORDER BY started_at DESC
      LIMIT 10
    `).toArray();

    // Calculate session stats from recent traces
    const sessionStats = this.calculateSessionStats(recentTraces);

    // Get pending escalations
    const pendingEscalations = this.sql.exec(`
      SELECT COUNT(*) as count FROM escalations
      WHERE resolved_at IS NULL
    `).toArray()[0]?.count as number || 0;

    // Calculate progress to next level
    const nextLevel = this.getNextLevel(soul.level);
    const nextThreshold = nextLevel ? LEVEL_THRESHOLDS[nextLevel] : null;
    const levelProgress = nextThreshold ? {
      nextLevel,
      xpNeeded: nextThreshold.xp - soul.totalXP,
      xpProgress: Math.round((soul.totalXP / nextThreshold.xp) * 100),
      streakNeeded: Math.max(0, nextThreshold.streak - soul.currentStreak),
      tasksNeeded: Math.max(0, nextThreshold.tasks - soul.tasksCompleted)
    } : { nextLevel: null, message: 'Max level reached!' };

    // Get recent achievements
    const recentAchievements = soul.achievements.slice(-5);

    // Format specializations with ranks
    const specRanks = this.formatSpecializations(soul.specializations);

    // Calculate streak status
    const streakStatus = this.calculateStreakStatus(recentTraces);

    // Detect flow state
    const flowState = this.detectFlowState();

    // Build dashboard response
    const dashboard = {
      agentId: this.agentId,
      timestamp: new Date().toISOString(),

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
        successRate: soul.tasksCompleted > 0
          ? Math.round((soul.tasksSuccessful / soul.tasksCompleted) * 100)
          : 0
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

  private calculateSessionStats(traces: unknown[]): {
    tasksToday: number;
    xpToday: number;
    avgEfficiency: number;
    tokensUsed: number;
  } {
    const today = new Date().toISOString().split('T')[0];

    let tasksToday = 0;
    let totalEfficiency = 0;
    let efficiencyCount = 0;

    for (const trace of traces) {
      const t = trace as { started_at: string; summary?: string };
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
      xpToday: tasksToday * 30, // Rough estimate
      avgEfficiency: efficiencyCount > 0 ? Math.round((totalEfficiency / efficiencyCount) * 100) : 0,
      tokensUsed: 0 // Would need token tracking
    };
  }

  private detectFlowState(): {
    status: 'in_flow' | 'available' | 'stuck' | 'offline';
    durationMinutes: number;
    respectFlow: boolean;
  } {
    // Check for active escalations (stuck)
    const hasActiveEscalation = this.sql.exec(
      'SELECT 1 FROM escalations WHERE resolved_at IS NULL LIMIT 1'
    ).toArray().length > 0;

    if (hasActiveEscalation) {
      return { status: 'stuck', durationMinutes: 0, respectFlow: false };
    }

    // Get recent steps from active trace (last 15 minutes)
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
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
      // No recent activity - check if offline (no trace in last hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const hasRecentTrace = this.sql.exec(
        'SELECT 1 FROM work_traces WHERE started_at > ? LIMIT 1',
        oneHourAgo
      ).toArray().length > 0;

      return {
        status: hasRecentTrace ? 'available' : 'offline',
        durationMinutes: 0,
        respectFlow: false
      };
    }

    // Check if in flow: 5+ productive steps in a row
    const productiveOutcomes = ['found', 'partial'];
    const productiveCount = recentSteps.filter((s: unknown) =>
      productiveOutcomes.includes((s as { outcome: string }).outcome)
    ).length;

    const inFlow = productiveCount >= 5 && recentSteps.length >= 5;

    if (inFlow) {
      // Calculate flow duration from first recent step
      const firstStep = recentSteps[recentSteps.length - 1] as { timestamp: string };
      const flowStart = new Date(firstStep.timestamp);
      const durationMinutes = Math.round((Date.now() - flowStart.getTime()) / (1000 * 60));

      return {
        status: 'in_flow',
        durationMinutes,
        respectFlow: true  // Don't interrupt!
      };
    }

    return { status: 'available', durationMinutes: 0, respectFlow: false };
  }

  private calculateStreakStatus(traces: unknown[]): {
    atRisk: boolean;
    hoursUntilExpires: number;
  } {
    if (traces.length === 0) {
      return { atRisk: true, hoursUntilExpires: 0 };
    }

    const lastTrace = traces[0] as { completed_at?: string; started_at: string };
    const lastActive = new Date(lastTrace.completed_at || lastTrace.started_at);
    const now = new Date();
    const hoursSince = (now.getTime() - lastActive.getTime()) / (1000 * 60 * 60);

    // Streak expires after 48 hours of inactivity
    const hoursUntilExpires = Math.max(0, 48 - hoursSince);

    return {
      atRisk: hoursUntilExpires < 8,
      hoursUntilExpires: Math.round(hoursUntilExpires)
    };
  }

  private getNextLevel(current: SoulLevel): SoulLevel | null {
    const levels: SoulLevel[] = ['novice', 'capable', 'expert', 'master'];
    const idx = levels.indexOf(current);
    return idx < levels.length - 1 ? levels[idx + 1] : null;
  }

  private getRustStatus(rustLevel: number): string {
    if (rustLevel === 0) return 'None ✨';
    if (rustLevel <= 0.2) return 'Light 🌱';
    if (rustLevel <= 0.4) return 'Moderate ⚠️';
    return 'Heavy 🔧';
  }

  private formatSpecializations(specs: SoulSpecializations): Array<{
    domain: string;
    xp: number;
    rank: string;
    progress: number;
  }> {
    const SPEC_RANKS = [
      { name: 'None', threshold: 0 },
      { name: 'Familiar', threshold: 100 },
      { name: 'Proficient', threshold: 500 },
      { name: 'Specialist', threshold: 2000 },
      { name: 'Authority', threshold: 5000 }
    ];

    return Object.entries(specs).map(([domain, xp]) => {
      let rank = 'None';
      let nextThreshold = 100;

      for (let i = SPEC_RANKS.length - 1; i >= 0; i--) {
        if (xp >= SPEC_RANKS[i].threshold) {
          rank = SPEC_RANKS[i].name;
          nextThreshold = SPEC_RANKS[i + 1]?.threshold || SPEC_RANKS[i].threshold;
          break;
        }
      }

      const prevThreshold = SPEC_RANKS.find(r => r.name === rank)?.threshold || 0;
      const progress = nextThreshold > prevThreshold
        ? Math.round(((xp - prevThreshold) / (nextThreshold - prevThreshold)) * 100)
        : 100;

      return { domain, xp, rank, progress };
    });
  }

  private generateSuggestions(
    soul: SoulProgression,
    levelProgress: { xpNeeded?: number; streakNeeded?: number; tasksNeeded?: number; nextLevel?: SoulLevel | null },
    sessionStats: { tasksToday: number },
    pendingEscalations: number
  ): Array<{ action: string; priority: 'high' | 'medium' | 'low'; reason: string }> {
    const suggestions: Array<{ action: string; priority: 'high' | 'medium' | 'low'; reason: string }> = [];

    // Close to level up?
    if (levelProgress.xpNeeded && levelProgress.xpNeeded < 100) {
      suggestions.push({
        action: `Complete one more task to reach ${levelProgress.nextLevel}!`,
        priority: 'high',
        reason: `Only ${levelProgress.xpNeeded} XP needed`
      });
    }

    // Pending escalations?
    if (pendingEscalations > 0) {
      suggestions.push({
        action: 'Check escalation queue - someone might need help!',
        priority: 'medium',
        reason: `${pendingEscalations} unresolved escalation(s)`
      });
    }

    // No tasks today?
    if (sessionStats.tasksToday === 0) {
      suggestions.push({
        action: 'Start your first task of the day',
        priority: 'medium',
        reason: 'No activity recorded today'
      });
    }

    // Rust accumulating?
    if ((soul.rustLevel || 0) > 0) {
      suggestions.push({
        action: 'Complete a task to shake off rust',
        priority: 'high',
        reason: `Rust is reducing XP by ${Math.round((soul.rustLevel || 0) * 50)}%`
      });
    }

    // Weak specialization?
    const weakest = Object.entries(soul.specializations)
      .sort(([, a], [, b]) => a - b)[0];
    if (weakest && weakest[1] < 50) {
      suggestions.push({
        action: `Try a ${weakest[0]} task to become more well-rounded`,
        priority: 'low',
        reason: `${weakest[0]} is your weakest area`
      });
    }

    return suggestions;
  }

  // ========== Heartbeat Handler (Shadow Agent Monitoring) ==========

  private async handleHeartbeat(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      // Get heartbeat status
      const status = this.getHeartbeatStatus();
      return Response.json(status);
    }

    if (request.method === 'POST') {
      // Record a heartbeat
      const body = await request.json() as {
        tokensUsed?: number;
        currentTask?: string;
        status?: string;
      };
      const result = this.recordHeartbeat(body);
      return Response.json({ success: true, heartbeat: result });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  private getHeartbeatStatus(): {
    lastHeartbeat: string | null;
    isHealthy: boolean;
    stalledForMs: number;
    stalledForMinutes: number;
    heartbeatCount: number;
    recentHeartbeats: Array<{ timestamp: string; status: string }>;
  } {
    // Get shadow monitor config
    const monitorRows = this.sql.exec('SELECT * FROM shadow_monitor WHERE id = 1').toArray();
    const monitor = monitorRows[0] || { stall_threshold_ms: 300000, last_heartbeat: null };
    const stallThreshold = (monitor.stall_threshold_ms as number) || 300000;
    const lastHeartbeat = monitor.last_heartbeat as string | null;

    // Calculate stall status
    const now = Date.now();
    const lastTime = lastHeartbeat ? new Date(lastHeartbeat).getTime() : 0;
    const stalledForMs = lastHeartbeat ? now - lastTime : now;
    const isHealthy = stalledForMs < stallThreshold;

    // Get recent heartbeats
    const recentRows = this.sql.exec(
      'SELECT timestamp, status FROM heartbeat_log ORDER BY timestamp DESC LIMIT 10'
    ).toArray();

    const recentHeartbeats = recentRows.map(row => ({
      timestamp: row.timestamp as string,
      status: row.status as string
    }));

    // Count total heartbeats
    const countRows = this.sql.exec('SELECT COUNT(*) as count FROM heartbeat_log').toArray();
    const heartbeatCount = (countRows[0]?.count as number) || 0;

    return {
      lastHeartbeat,
      isHealthy,
      stalledForMs,
      stalledForMinutes: Math.round(stalledForMs / 60000 * 10) / 10,
      heartbeatCount,
      recentHeartbeats
    };
  }

  private recordHeartbeat(data: {
    tokensUsed?: number;
    currentTask?: string;
    status?: string;
  }): { id: string; timestamp: string } {
    const now = new Date().toISOString();
    const id = `hb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Insert heartbeat record
    this.sql.exec(`
      INSERT INTO heartbeat_log (id, timestamp, tokens_used, current_task, status)
      VALUES (?, ?, ?, ?, ?)
    `, id, now, data.tokensUsed || 0, data.currentTask || null, data.status || 'healthy');

    // Update shadow monitor with latest heartbeat
    this.sql.exec(`
      INSERT INTO shadow_monitor (id, last_heartbeat)
      VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET last_heartbeat = excluded.last_heartbeat
    `, now);

    // Prune old heartbeats (keep last 100)
    this.sql.exec(`
      DELETE FROM heartbeat_log WHERE id NOT IN (
        SELECT id FROM heartbeat_log ORDER BY timestamp DESC LIMIT 100
      )
    `);

    return { id, timestamp: now };
  }

  // ========== Shadow Agent Handler ==========

  private async handleShadow(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'get';

    if (request.method === 'GET') {
      const shadowStatus = this.getShadowStatus();
      return Response.json(shadowStatus);
    }

    if (request.method === 'POST') {
      const body = await request.json() as {
        action?: string;
        shadowId?: string;
        primaryAgent?: string;
        stallThresholdMs?: number;
        heartbeatIntervalMs?: number;
      };

      const actionType = body.action || action;

      switch (actionType) {
        case 'register-shadow':
          // Register this agent as having a shadow
          return Response.json(this.registerShadow(body.shadowId!, body.stallThresholdMs, body.heartbeatIntervalMs));

        case 'become-shadow':
          // Mark this agent as a shadow for another agent
          return Response.json(this.becomeShadow(body.primaryAgent!));

        case 'takeover':
          // Shadow takes over from primary
          return Response.json(this.executeTakeover());

        case 'configure':
          // Update monitoring config
          return Response.json(this.configureShadowMonitor(body));

        default:
          return Response.json({ error: 'Unknown action. Use: register-shadow, become-shadow, takeover, configure' }, { status: 400 });
      }
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  private getShadowStatus(): {
    hasShadow: boolean;
    shadowId: string | null;
    shadowStatus: string;
    isShadow: boolean;
    primaryAgent: string | null;
    lastHeartbeat: string | null;
    isHealthy: boolean;
    stallThresholdMs: number;
    heartbeatIntervalMs: number;
    registeredAt: string | null;
    takeoverAt: string | null;
  } {
    const rows = this.sql.exec('SELECT * FROM shadow_monitor WHERE id = 1').toArray();

    if (rows.length === 0) {
      return {
        hasShadow: false,
        shadowId: null,
        shadowStatus: 'none',
        isShadow: false,
        primaryAgent: null,
        lastHeartbeat: null,
        isHealthy: true,
        stallThresholdMs: 300000,
        heartbeatIntervalMs: 60000,
        registeredAt: null,
        takeoverAt: null
      };
    }

    const row = rows[0];
    const lastHeartbeat = row.last_heartbeat as string | null;
    const stallThreshold = (row.stall_threshold_ms as number) || 300000;

    // Calculate health
    const now = Date.now();
    const lastTime = lastHeartbeat ? new Date(lastHeartbeat).getTime() : 0;
    const stalledForMs = lastHeartbeat ? now - lastTime : now;
    const isHealthy = stalledForMs < stallThreshold;

    return {
      hasShadow: !!(row.shadow_id),
      shadowId: row.shadow_id as string | null,
      shadowStatus: row.shadow_status as string || 'none',
      isShadow: !!(row.is_shadow),
      primaryAgent: row.primary_agent as string | null,
      lastHeartbeat,
      isHealthy,
      stallThresholdMs: stallThreshold,
      heartbeatIntervalMs: (row.heartbeat_interval_ms as number) || 60000,
      registeredAt: row.registered_at as string | null,
      takeoverAt: row.takeover_at as string | null
    };
  }

  private registerShadow(shadowId: string, stallThresholdMs?: number, heartbeatIntervalMs?: number): {
    success: boolean;
    message: string;
    shadow: { shadowId: string; status: string; registeredAt: string };
  } {
    const now = new Date().toISOString();

    this.sql.exec(`
      INSERT INTO shadow_monitor (id, shadow_id, shadow_status, stall_threshold_ms, heartbeat_interval_ms, registered_at)
      VALUES (1, ?, 'monitoring', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        shadow_id = excluded.shadow_id,
        shadow_status = 'monitoring',
        stall_threshold_ms = COALESCE(excluded.stall_threshold_ms, shadow_monitor.stall_threshold_ms),
        heartbeat_interval_ms = COALESCE(excluded.heartbeat_interval_ms, shadow_monitor.heartbeat_interval_ms),
        registered_at = excluded.registered_at
    `, shadowId, stallThresholdMs || 300000, heartbeatIntervalMs || 60000, now);

    return {
      success: true,
      message: `Shadow ${shadowId} registered for monitoring`,
      shadow: { shadowId, status: 'monitoring', registeredAt: now }
    };
  }

  private becomeShadow(primaryAgent: string): {
    success: boolean;
    message: string;
    config: { primaryAgent: string; isShadow: boolean; registeredAt: string };
  } {
    const now = new Date().toISOString();

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

  private executeTakeover(): {
    success: boolean;
    message: string;
    takeover: { takeoverAt: string; previousStatus: string };
  } {
    const now = new Date().toISOString();

    // Get current status before takeover
    const currentStatus = this.getShadowStatus();

    this.sql.exec(`
      UPDATE shadow_monitor SET
        shadow_status = 'taken-over',
        takeover_at = ?
      WHERE id = 1
    `, now);

    return {
      success: true,
      message: 'Takeover executed - shadow is now primary',
      takeover: { takeoverAt: now, previousStatus: currentStatus.shadowStatus }
    };
  }

  private configureShadowMonitor(config: {
    stallThresholdMs?: number;
    heartbeatIntervalMs?: number;
  }): { success: boolean; config: { stallThresholdMs: number; heartbeatIntervalMs: number } } {
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

  // ========== Credentials Handler (Soul Secrets) ==========

  private async handleCredentials(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'list';

    if (request.method === 'GET') {
      if (action === 'list') {
        // List all credential keys (not values)
        return Response.json({ credentials: this.listCredentials() });
      }
      if (action === 'get') {
        const key = url.searchParams.get('key');
        if (!key) {
          return Response.json({ error: 'key parameter required' }, { status: 400 });
        }
        // Return the actual credential value (for injection)
        const cred = this.getCredential(key);
        if (!cred) {
          return Response.json({ error: 'Credential not found' }, { status: 404 });
        }
        return Response.json({ credential: cred });
      }
      if (action === 'bundle') {
        // Return all credentials for soul injection
        return Response.json({ credentials: this.getCredentialsBundle() });
      }
    }

    if (request.method === 'POST') {
      const body = await request.json() as {
        key?: string;
        value?: string;
        credentials?: Record<string, string>;
      };

      // Batch set multiple credentials
      if (body.credentials) {
        const results = this.setCredentialsBatch(body.credentials);
        return Response.json({ success: true, set: results });
      }

      // Set single credential
      if (!body.key || !body.value) {
        return Response.json({ error: 'key and value required' }, { status: 400 });
      }
      const result = this.setCredential(body.key, body.value);
      return Response.json({ success: true, credential: result });
    }

    if (request.method === 'DELETE') {
      const key = url.searchParams.get('key');
      if (!key) {
        return Response.json({ error: 'key parameter required' }, { status: 400 });
      }
      this.deleteCredential(key);
      return Response.json({ success: true, deleted: key });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  private listCredentials(): Array<{
    key: string;
    maskedPreview: string;
    createdAt: string;
    updatedAt: string;
  }> {
    const rows = this.sql.exec(
      'SELECT key, masked_preview, created_at, updated_at FROM credentials ORDER BY key'
    ).toArray();

    return rows.map(row => ({
      key: row.key as string,
      maskedPreview: row.masked_preview as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    }));
  }

  private getCredential(key: string): { key: string; value: string } | null {
    const rows = this.sql.exec(
      'SELECT key, value FROM credentials WHERE key = ?',
      key
    ).toArray();

    if (rows.length === 0) return null;

    return {
      key: rows[0].key as string,
      value: rows[0].value as string
    };
  }

  private getCredentialsBundle(): Record<string, string> {
    const rows = this.sql.exec('SELECT key, value FROM credentials').toArray();
    const bundle: Record<string, string> = {};

    for (const row of rows) {
      bundle[row.key as string] = row.value as string;
    }

    return bundle;
  }

  private setCredential(key: string, value: string): {
    key: string;
    maskedPreview: string;
    updatedAt: string;
  } {
    const now = new Date().toISOString();
    // Create masked preview: show first 4 and last 4 chars
    const masked = value.length > 12
      ? `${value.slice(0, 4)}...${value.slice(-4)}`
      : '****';

    this.sql.exec(`
      INSERT INTO credentials (key, value, created_at, updated_at, masked_preview)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at,
        masked_preview = excluded.masked_preview
    `, key, value, now, now, masked);

    return { key, maskedPreview: masked, updatedAt: now };
  }

  private setCredentialsBatch(credentials: Record<string, string>): Array<{
    key: string;
    maskedPreview: string;
  }> {
    const results: Array<{ key: string; maskedPreview: string }> = [];

    for (const [key, value] of Object.entries(credentials)) {
      const result = this.setCredential(key, value);
      results.push({ key: result.key, maskedPreview: result.maskedPreview });
    }

    return results;
  }

  private deleteCredential(key: string): void {
    this.sql.exec('DELETE FROM credentials WHERE key = ?', key);
  }

  // ========== Goals Handler (Autonomous Work Queue) ==========

  private async handleGoals(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'list';

    if (request.method === 'GET') {
      if (action === 'list') {
        const status = url.searchParams.get('status');
        return Response.json({ goals: this.listGoals(status) });
      }
      if (action === 'next') {
        // Get the highest priority pending goal
        const goal = this.getNextGoal();
        return Response.json({ goal });
      }
      if (action === 'active') {
        // Get currently in-progress goal
        const goal = this.getActiveGoal();
        return Response.json({ goal });
      }
      if (action === 'stats') {
        return Response.json({ stats: this.getGoalStats() });
      }
    }

    if (request.method === 'POST') {
      const body = await request.json() as {
        action?: string;
        id?: string;
        title?: string;
        description?: string;
        type?: string;
        priority?: number;
        xpReward?: number;
        source?: string;
        assignedBy?: string;
        context?: string;
        outcome?: string;
      };

      const postAction = body.action || action;

      if (postAction === 'create') {
        if (!body.title) {
          return Response.json({ error: 'title required' }, { status: 400 });
        }
        const goal = this.createGoal(body);
        return Response.json({ success: true, goal });
      }

      if (postAction === 'start') {
        if (!body.id) {
          return Response.json({ error: 'id required' }, { status: 400 });
        }
        const goal = this.startGoal(body.id);
        return Response.json({ success: true, goal });
      }

      if (postAction === 'complete') {
        if (!body.id) {
          return Response.json({ error: 'id required' }, { status: 400 });
        }
        const result = this.completeGoal(body.id, body.outcome || 'completed');
        return Response.json({ success: true, ...result });
      }

      if (postAction === 'fail') {
        if (!body.id) {
          return Response.json({ error: 'id required' }, { status: 400 });
        }
        const goal = this.failGoal(body.id, body.outcome || 'failed');
        return Response.json({ success: true, goal });
      }

      if (postAction === 'abandon') {
        if (!body.id) {
          return Response.json({ error: 'id required' }, { status: 400 });
        }
        const goal = this.abandonGoal(body.id);
        return Response.json({ success: true, goal });
      }
    }

    if (request.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) {
        return Response.json({ error: 'id parameter required' }, { status: 400 });
      }
      this.deleteGoal(id);
      return Response.json({ success: true, deleted: id });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  private listGoals(status?: string | null): Array<{
    id: string;
    title: string;
    description: string | null;
    type: string;
    priority: number;
    status: string;
    xpReward: number;
    source: string;
    assignedBy: string | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
  }> {
    let query = 'SELECT * FROM goals';
    const params: string[] = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY priority DESC, created_at ASC';

    const rows = this.sql.exec(query, ...params).toArray();

    return rows.map(row => ({
      id: row.id as string,
      title: row.title as string,
      description: row.description as string | null,
      type: row.type as string,
      priority: row.priority as number,
      status: row.status as string,
      xpReward: row.xp_reward as number,
      source: row.source as string,
      assignedBy: row.assigned_by as string | null,
      createdAt: row.created_at as string,
      startedAt: row.started_at as string | null,
      completedAt: row.completed_at as string | null
    }));
  }

  private getNextGoal(): {
    id: string;
    title: string;
    description: string | null;
    type: string;
    priority: number;
    xpReward: number;
    context: string | null;
  } | null {
    const rows = this.sql.exec(`
      SELECT id, title, description, type, priority, xp_reward, context
      FROM goals
      WHERE status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).toArray();

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string | null,
      type: row.type as string,
      priority: row.priority as number,
      xpReward: row.xp_reward as number,
      context: row.context as string | null
    };
  }

  private getActiveGoal(): {
    id: string;
    title: string;
    description: string | null;
    type: string;
    priority: number;
    startedAt: string;
  } | null {
    const rows = this.sql.exec(`
      SELECT id, title, description, type, priority, started_at
      FROM goals
      WHERE status = 'in_progress'
      LIMIT 1
    `).toArray();

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string | null,
      type: row.type as string,
      priority: row.priority as number,
      startedAt: row.started_at as string
    };
  }

  private getGoalStats(): {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
    totalXpEarned: number;
    totalXpPending: number;
  } {
    const rows = this.sql.exec(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'completed' THEN xp_reward ELSE 0 END) as xp_earned,
        SUM(CASE WHEN status = 'pending' THEN xp_reward ELSE 0 END) as xp_pending
      FROM goals
    `).toArray();

    const row = rows[0];
    return {
      total: (row.total as number) || 0,
      pending: (row.pending as number) || 0,
      inProgress: (row.in_progress as number) || 0,
      completed: (row.completed as number) || 0,
      failed: (row.failed as number) || 0,
      totalXpEarned: (row.xp_earned as number) || 0,
      totalXpPending: (row.xp_pending as number) || 0
    };
  }

  private createGoal(data: {
    title: string;
    description?: string;
    type?: string;
    priority?: number;
    xpReward?: number;
    source?: string;
    assignedBy?: string;
    context?: string;
  }): { id: string; title: string; priority: number; status: string; createdAt: string } {
    const id = `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    this.sql.exec(`
      INSERT INTO goals (id, title, description, type, priority, xp_reward, source, assigned_by, context, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id,
      data.title,
      data.description || null,
      data.type || 'task',
      data.priority || 5,
      data.xpReward || 10,
      data.source || 'self',
      data.assignedBy || null,
      data.context || null,
      now
    );

    return {
      id,
      title: data.title,
      priority: data.priority || 5,
      status: 'pending',
      createdAt: now
    };
  }

  private startGoal(id: string): { id: string; status: string; startedAt: string } | null {
    const now = new Date().toISOString();

    this.sql.exec(`
      UPDATE goals
      SET status = 'in_progress', started_at = ?
      WHERE id = ?
    `, now, id);

    return { id, status: 'in_progress', startedAt: now };
  }

  private completeGoal(id: string, outcome: string): {
    goal: { id: string; status: string; completedAt: string; xpReward: number };
    xpAwarded: number;
  } {
    const now = new Date().toISOString();

    // Get the XP reward before completing
    const goalRows = this.sql.exec('SELECT xp_reward FROM goals WHERE id = ?', id).toArray();
    const xpReward = goalRows.length > 0 ? (goalRows[0].xp_reward as number) : 0;

    this.sql.exec(`
      UPDATE goals
      SET status = 'completed', completed_at = ?, outcome = ?
      WHERE id = ?
    `, now, outcome, id);

    // Award XP to soul (if soul exists)
    this.sql.exec(`
      UPDATE soul_progression
      SET total_xp = total_xp + ?,
          tasks_completed = tasks_completed + 1,
          tasks_successful = tasks_successful + 1
      WHERE soul_id = ?
    `, xpReward, this.agentId);

    return {
      goal: { id, status: 'completed', completedAt: now, xpReward },
      xpAwarded: xpReward
    };
  }

  private failGoal(id: string, outcome: string): { id: string; status: string; completedAt: string } {
    const now = new Date().toISOString();

    this.sql.exec(`
      UPDATE goals
      SET status = 'failed', completed_at = ?, outcome = ?
      WHERE id = ?
    `, now, outcome, id);

    // Update soul stats (task completed but not successful)
    this.sql.exec(`
      UPDATE soul_progression
      SET tasks_completed = tasks_completed + 1
      WHERE soul_id = ?
    `, this.agentId);

    return { id, status: 'failed', completedAt: now };
  }

  private abandonGoal(id: string): { id: string; status: string } {
    this.sql.exec(`
      UPDATE goals
      SET status = 'abandoned'
      WHERE id = ?
    `, id);

    return { id, status: 'abandoned' };
  }

  private deleteGoal(id: string): void {
    this.sql.exec('DELETE FROM goals WHERE id = ?', id);
  }

  // ========== Credentials Injection for Soul Transfer ==========

  /**
   * Get complete soul bundle including credentials for injection into new session
   */
  public getSoulInjectionBundle(): {
    soul: SoulProgression | null;
    checkpoint: AgentCheckpoint | null;
    credentials: Record<string, string>;
    unreadMessages: DirectMessage[];
  } {
    return {
      soul: this.getSoulProgression(),
      checkpoint: this.getCheckpoint(),
      credentials: this.getCredentialsBundle(),
      unreadMessages: this.getMessages(true)
    };
  }
}
