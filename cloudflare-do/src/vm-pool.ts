/**
 * VMPool - Singleton Durable Object for VM Fleet Management
 *
 * Manages a pool of persistent cloud VMs for instant agent spawning.
 *
 * Architecture:
 * - One singleton DO managing all cloud VMs (like AgentCoordinator)
 * - Maintains pool of pre-warmed VMs (target: 1-2 hot VMs)
 * - Handles VM health checks, agent assignment, capacity planning
 * - Uses Alarms API for scheduled health checks and auto-scaling
 *
 * Pattern: Singleton (use 'main' as DO name)
 * Scale: All VMs managed by one DO for global coordination
 */

interface VMState {
  vmId: string;
  instanceId: string;       // AWS EC2 instance ID
  status: 'provisioning' | 'booting' | 'ready' | 'busy' | 'draining' | 'terminated' | 'error';
  publicIp?: string;
  privateIp?: string;
  region: string;
  vmSize: 'small' | 'medium' | 'large';
  createdAt: string;
  readyAt?: string;
  lastHealthCheck?: string;
  healthStatus: 'unknown' | 'healthy' | 'unhealthy' | 'unresponsive';
  errorMessage?: string;
  agentCount: number;       // Number of agents currently on this VM
  maxAgents: number;        // Max agents this VM can host (based on size)
  metadata?: Record<string, string>;
}

interface AgentAssignment {
  assignmentId: string;
  agentId: string;
  vmId: string;
  assignedAt: string;
  status: 'active' | 'completed' | 'failed';
  completedAt?: string;
  task?: string;
}

interface HealthCheck {
  checkId: string;
  vmId: string;
  checkedAt: string;
  status: 'healthy' | 'unhealthy' | 'unresponsive' | 'timeout';
  responseTimeMs?: number;
  details?: string;
}

interface PoolConfig {
  minVMs: number;           // Minimum VMs to keep running (default: 1)
  maxVMs: number;           // Maximum VMs allowed (default: 5)
  targetFreeCapacity: number; // Keep this many agent slots free (default: 2)
  healthCheckIntervalMs: number; // How often to check health (default: 60000)
  vmBootTimeoutMs: number;  // Max time for VM to become ready (default: 600000)
  drainTimeoutMs: number;   // Time to wait for agents to finish before terminating (default: 300000)
}

const DEFAULT_CONFIG: PoolConfig = {
  minVMs: 1,
  maxVMs: 5,
  targetFreeCapacity: 2,
  healthCheckIntervalMs: 60 * 1000,       // 1 minute
  vmBootTimeoutMs: 10 * 60 * 1000,        // 10 minutes
  drainTimeoutMs: 5 * 60 * 1000           // 5 minutes
};

// Agent capacity by VM size
const VM_CAPACITY: Record<string, number> = {
  small: 2,
  medium: 5,
  large: 10
};

export class VMPool implements DurableObject {
  private state: DurableObjectState;
  private sql: SqlStorage;
  private config: PoolConfig = DEFAULT_CONFIG;

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state;
    this.sql = state.storage.sql;
    this.initializeDatabase();
    this.loadConfig();
  }

  private initializeDatabase() {
    // VM registry
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS vms (
        vm_id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'provisioning',
        public_ip TEXT,
        private_ip TEXT,
        region TEXT NOT NULL DEFAULT 'us-west-1',
        vm_size TEXT NOT NULL DEFAULT 'small',
        created_at TEXT NOT NULL,
        ready_at TEXT,
        last_health_check TEXT,
        health_status TEXT NOT NULL DEFAULT 'unknown',
        error_message TEXT,
        agent_count INTEGER NOT NULL DEFAULT 0,
        max_agents INTEGER NOT NULL DEFAULT 2,
        metadata TEXT
      )
    `);

    // Agent assignments
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS assignments (
        assignment_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        vm_id TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        completed_at TEXT,
        task TEXT,
        FOREIGN KEY (vm_id) REFERENCES vms(vm_id)
      )
    `);

    // Health check history
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS health_checks (
        check_id TEXT PRIMARY KEY,
        vm_id TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        status TEXT NOT NULL,
        response_time_ms INTEGER,
        details TEXT,
        FOREIGN KEY (vm_id) REFERENCES vms(vm_id)
      )
    `);

    // Pool configuration
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Create indexes
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_vms_status ON vms(status)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_assignments_agent ON assignments(agent_id)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_assignments_vm ON assignments(vm_id)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_health_checks_vm ON health_checks(vm_id)`);
  }

  private loadConfig() {
    const rows = this.sql.exec('SELECT key, value FROM config').toArray();
    for (const row of rows) {
      const key = row.key as keyof PoolConfig;
      const value = JSON.parse(row.value as string);
      if (key in this.config) {
        (this.config as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // Route based on path and method
      switch (path) {
        case '/status':
        case '/':
          return this.handleStatus();

        case '/vms':
          if (method === 'GET') return this.handleListVMs();
          break;

        case '/spawn':
          if (method === 'POST') return this.handleSpawnAgent(request);
          break;

        case '/provision':
          if (method === 'POST') return this.handleProvisionVM(request);
          break;

        case '/terminate':
          if (method === 'POST') return this.handleTerminateVM(request);
          break;

        case '/health-check':
          if (method === 'POST') return this.handleHealthCheckResult(request);
          break;

        case '/scale':
          if (method === 'POST') return this.handleScale(request);
          break;

        case '/config':
          if (method === 'GET') return this.handleGetConfig();
          if (method === 'POST') return this.handleSetConfig(request);
          break;

        case '/release':
          if (method === 'POST') return this.handleReleaseAgent(request);
          break;

        case '/health':
          return Response.json({ status: 'ok', type: 'vm-pool' });
      }

      // Handle VM-specific routes: /vm/:vmId/*
      const vmMatch = path.match(/^\/vm\/([^/]+)(\/.*)?$/);
      if (vmMatch) {
        const vmId = vmMatch[1];
        const subPath = vmMatch[2] || '';
        return this.handleVMRoute(vmId, subPath, request);
      }

      return Response.json({ error: 'Not found', path }, { status: 404 });

    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  /**
   * Alarm handler - runs scheduled tasks:
   * 1. Health checks on all VMs
   * 2. Auto-scaling based on capacity
   * 3. Cleanup of stale VMs
   */
  async alarm() {
    const now = new Date();

    // 1. Check for boot timeouts
    await this.checkBootTimeouts(now);

    // 2. Check for stale health (VMs that haven't responded)
    await this.checkStaleHealth(now);

    // 3. Auto-scale based on capacity
    await this.autoScale();

    // 4. Clean up old health check records
    this.cleanupOldRecords();

    // Schedule next alarm
    await this.state.storage.setAlarm(now.getTime() + this.config.healthCheckIntervalMs);
  }

  // ========== Route Handlers ==========

  private handleStatus(): Response {
    const vms = this.getAllVMs();
    const readyVMs = vms.filter(vm => vm.status === 'ready');
    const busyVMs = vms.filter(vm => vm.status === 'busy');
    const provisioningVMs = vms.filter(vm => vm.status === 'provisioning' || vm.status === 'booting');

    const totalCapacity = vms.reduce((sum, vm) => sum + vm.maxAgents, 0);
    const usedCapacity = vms.reduce((sum, vm) => sum + vm.agentCount, 0);
    const freeCapacity = totalCapacity - usedCapacity;

    // Count agents that can be instantly spawned (ready VMs with capacity)
    const instantSpawnSlots = readyVMs.reduce((sum, vm) => sum + (vm.maxAgents - vm.agentCount), 0);

    return Response.json({
      pool: {
        totalVMs: vms.length,
        readyVMs: readyVMs.length,
        busyVMs: busyVMs.length,
        provisioningVMs: provisioningVMs.length,
        totalCapacity,
        usedCapacity,
        freeCapacity,
        instantSpawnSlots,
        healthyVMs: vms.filter(vm => vm.healthStatus === 'healthy').length
      },
      config: this.config,
      vms: vms.map(vm => ({
        vmId: vm.vmId,
        status: vm.status,
        healthStatus: vm.healthStatus,
        agentCount: vm.agentCount,
        maxAgents: vm.maxAgents,
        publicIp: vm.publicIp,
        region: vm.region,
        vmSize: vm.vmSize
      })),
      timestamp: new Date().toISOString()
    });
  }

  private handleListVMs(): Response {
    const vms = this.getAllVMs();
    return Response.json({ vms, count: vms.length });
  }

  private async handleSpawnAgent(request: Request): Promise<Response> {
    const body = await request.json() as {
      agentId: string;
      task?: string;
      preferredVmId?: string;
    };

    if (!body.agentId) {
      return Response.json({ error: 'agentId required' }, { status: 400 });
    }

    // Check if agent is already assigned
    const existingAssignment = this.getActiveAssignment(body.agentId);
    if (existingAssignment) {
      return Response.json({
        success: true,
        alreadyAssigned: true,
        assignment: existingAssignment,
        vm: this.getVM(existingAssignment.vmId)
      });
    }

    // Find available VM
    let vm: VMState | null = null;

    if (body.preferredVmId) {
      const preferred = this.getVM(body.preferredVmId);
      if (preferred && preferred.status === 'ready' && preferred.agentCount < preferred.maxAgents) {
        vm = preferred;
      }
    }

    if (!vm) {
      vm = this.findAvailableVM();
    }

    if (!vm) {
      return Response.json({
        success: false,
        error: 'No VMs available',
        suggestion: 'Call /provision to create a new VM or wait for existing VMs to become ready',
        poolStatus: this.getPoolSummary()
      }, { status: 503 });
    }

    // Create assignment
    const assignment: AgentAssignment = {
      assignmentId: `assign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentId: body.agentId,
      vmId: vm.vmId,
      assignedAt: new Date().toISOString(),
      status: 'active',
      task: body.task
    };

    this.sql.exec(`
      INSERT INTO assignments (assignment_id, agent_id, vm_id, assigned_at, status, task)
      VALUES (?, ?, ?, ?, ?, ?)
    `, assignment.assignmentId, assignment.agentId, assignment.vmId, assignment.assignedAt, assignment.status, assignment.task || null);

    // Update VM agent count
    this.sql.exec(`
      UPDATE vms SET agent_count = agent_count + 1, status = CASE WHEN agent_count + 1 >= max_agents THEN 'busy' ELSE status END
      WHERE vm_id = ?
    `, vm.vmId);

    // Refresh VM data
    vm = this.getVM(vm.vmId)!;

    return Response.json({
      success: true,
      assignment,
      vm: {
        vmId: vm.vmId,
        publicIp: vm.publicIp,
        privateIp: vm.privateIp,
        status: vm.status,
        agentCount: vm.agentCount,
        maxAgents: vm.maxAgents
      },
      message: 'Agent assigned to VM. Use SSH/SSM to spawn Claude CLI.'
    });
  }

  private async handleProvisionVM(request: Request): Promise<Response> {
    const body = await request.json() as {
      instanceId: string;
      vmSize?: 'small' | 'medium' | 'large';
      region?: string;
      publicIp?: string;
      privateIp?: string;
      metadata?: Record<string, string>;
    };

    if (!body.instanceId) {
      return Response.json({ error: 'instanceId required' }, { status: 400 });
    }

    const vmId = `vm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const vmSize = body.vmSize || 'small';
    const now = new Date().toISOString();

    const vm: VMState = {
      vmId,
      instanceId: body.instanceId,
      status: 'provisioning',
      publicIp: body.publicIp,
      privateIp: body.privateIp,
      region: body.region || 'us-west-1',
      vmSize,
      createdAt: now,
      healthStatus: 'unknown',
      agentCount: 0,
      maxAgents: VM_CAPACITY[vmSize] || 2,
      metadata: body.metadata
    };

    this.sql.exec(`
      INSERT INTO vms (vm_id, instance_id, status, public_ip, private_ip, region, vm_size, created_at, health_status, agent_count, max_agents, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, vm.vmId, vm.instanceId, vm.status, vm.publicIp || null, vm.privateIp || null, vm.region, vm.vmSize, vm.createdAt, vm.healthStatus, vm.agentCount, vm.maxAgents, vm.metadata ? JSON.stringify(vm.metadata) : null);

    // Ensure alarm is set for health checks
    await this.ensureAlarmSet();

    return Response.json({
      success: true,
      vm,
      message: 'VM registered. Call /vm/:vmId/ready when bootstrap completes.'
    });
  }

  private async handleTerminateVM(request: Request): Promise<Response> {
    const body = await request.json() as { vmId: string; force?: boolean };

    if (!body.vmId) {
      return Response.json({ error: 'vmId required' }, { status: 400 });
    }

    const vm = this.getVM(body.vmId);
    if (!vm) {
      return Response.json({ error: 'VM not found' }, { status: 404 });
    }

    // Check for active agents
    const activeAgents = this.getVMAgents(body.vmId).filter(a => a.status === 'active');
    if (activeAgents.length > 0 && !body.force) {
      return Response.json({
        error: 'VM has active agents',
        activeAgents: activeAgents.length,
        suggestion: 'Use force=true to terminate anyway, or wait for agents to complete'
      }, { status: 409 });
    }

    // Mark as terminated
    this.sql.exec(`
      UPDATE vms SET status = 'terminated', error_message = ?
      WHERE vm_id = ?
    `, body.force && activeAgents.length > 0 ? `Force terminated with ${activeAgents.length} active agents` : null, body.vmId);

    // Complete any active assignments
    if (activeAgents.length > 0) {
      this.sql.exec(`
        UPDATE assignments SET status = 'failed', completed_at = ?
        WHERE vm_id = ? AND status = 'active'
      `, new Date().toISOString(), body.vmId);
    }

    return Response.json({
      success: true,
      vmId: body.vmId,
      instanceId: vm.instanceId,
      message: 'VM marked as terminated. Caller should terminate EC2 instance.',
      activeAgentsTerminated: activeAgents.length
    });
  }

  private async handleHealthCheckResult(request: Request): Promise<Response> {
    const body = await request.json() as {
      vmId: string;
      status: 'healthy' | 'unhealthy' | 'unresponsive' | 'timeout';
      responseTimeMs?: number;
      details?: string;
    };

    if (!body.vmId || !body.status) {
      return Response.json({ error: 'vmId and status required' }, { status: 400 });
    }

    const vm = this.getVM(body.vmId);
    if (!vm) {
      return Response.json({ error: 'VM not found' }, { status: 404 });
    }

    const checkId = `check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    // Record health check
    this.sql.exec(`
      INSERT INTO health_checks (check_id, vm_id, checked_at, status, response_time_ms, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `, checkId, body.vmId, now, body.status, body.responseTimeMs || null, body.details || null);

    // Update VM health status
    this.sql.exec(`
      UPDATE vms SET last_health_check = ?, health_status = ?
      WHERE vm_id = ?
    `, now, body.status, body.vmId);

    return Response.json({
      success: true,
      checkId,
      vmId: body.vmId,
      status: body.status
    });
  }

  private async handleScale(request: Request): Promise<Response> {
    const body = await request.json() as {
      action: 'up' | 'down' | 'set';
      count?: number;
    };

    // This returns a recommendation - actual VM creation is done by caller
    const vms = this.getAllVMs();
    const activeVMs = vms.filter(vm => !['terminated', 'error'].includes(vm.status));

    let recommendation: { action: string; reason: string; vmIds?: string[] } = { action: 'none', reason: '' };

    switch (body.action) {
      case 'up':
        const targetCount = body.count || activeVMs.length + 1;
        if (activeVMs.length >= this.config.maxVMs) {
          recommendation = { action: 'blocked', reason: `Already at max VMs (${this.config.maxVMs})` };
        } else {
          recommendation = {
            action: 'provision',
            reason: `Scale up to ${targetCount} VMs`,
            vmIds: []
          };
        }
        break;

      case 'down':
        const terminateCount = body.count || 1;
        const drainableVMs = activeVMs
          .filter(vm => vm.agentCount === 0 && vm.status === 'ready')
          .slice(0, terminateCount);

        if (activeVMs.length <= this.config.minVMs) {
          recommendation = { action: 'blocked', reason: `Already at min VMs (${this.config.minVMs})` };
        } else if (drainableVMs.length === 0) {
          recommendation = { action: 'blocked', reason: 'No idle VMs to terminate' };
        } else {
          recommendation = {
            action: 'terminate',
            reason: `Terminate ${drainableVMs.length} idle VM(s)`,
            vmIds: drainableVMs.map(vm => vm.vmId)
          };
        }
        break;

      case 'set':
        if (body.count === undefined) {
          return Response.json({ error: 'count required for set action' }, { status: 400 });
        }
        const targetTotal = Math.min(Math.max(body.count, this.config.minVMs), this.config.maxVMs);
        if (targetTotal > activeVMs.length) {
          recommendation = {
            action: 'provision',
            reason: `Scale to ${targetTotal} VMs (need ${targetTotal - activeVMs.length} more)`
          };
        } else if (targetTotal < activeVMs.length) {
          const excess = activeVMs.length - targetTotal;
          const drainable = activeVMs.filter(vm => vm.agentCount === 0).slice(0, excess);
          recommendation = {
            action: 'terminate',
            reason: `Scale to ${targetTotal} VMs (remove ${excess})`,
            vmIds: drainable.map(vm => vm.vmId)
          };
        } else {
          recommendation = { action: 'none', reason: 'Already at target count' };
        }
        break;
    }

    return Response.json({
      currentVMs: activeVMs.length,
      config: { min: this.config.minVMs, max: this.config.maxVMs },
      recommendation
    });
  }

  private handleGetConfig(): Response {
    return Response.json({ config: this.config });
  }

  private async handleSetConfig(request: Request): Promise<Response> {
    const body = await request.json() as Partial<PoolConfig>;
    const now = new Date().toISOString();

    for (const [key, value] of Object.entries(body)) {
      if (key in this.config) {
        this.sql.exec(`
          INSERT INTO config (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `, key, JSON.stringify(value), now);
        (this.config as unknown as Record<string, unknown>)[key] = value;
      }
    }

    // Restart health check alarm with new interval
    await this.ensureAlarmSet();

    return Response.json({ success: true, config: this.config });
  }

  private async handleReleaseAgent(request: Request): Promise<Response> {
    const body = await request.json() as {
      agentId: string;
      status?: 'completed' | 'failed';
    };

    if (!body.agentId) {
      return Response.json({ error: 'agentId required' }, { status: 400 });
    }

    const assignment = this.getActiveAssignment(body.agentId);
    if (!assignment) {
      return Response.json({ success: true, message: 'No active assignment found' });
    }

    const now = new Date().toISOString();
    const finalStatus = body.status || 'completed';

    // Update assignment
    this.sql.exec(`
      UPDATE assignments SET status = ?, completed_at = ?
      WHERE assignment_id = ?
    `, finalStatus, now, assignment.assignmentId);

    // Update VM agent count
    this.sql.exec(`
      UPDATE vms SET agent_count = MAX(0, agent_count - 1), status = CASE WHEN status = 'busy' THEN 'ready' ELSE status END
      WHERE vm_id = ?
    `, assignment.vmId);

    return Response.json({
      success: true,
      assignmentId: assignment.assignmentId,
      vmId: assignment.vmId,
      status: finalStatus
    });
  }

  private handleVMRoute(vmId: string, subPath: string, request: Request): Response {
    const vm = this.getVM(vmId);
    if (!vm) {
      return Response.json({ error: 'VM not found' }, { status: 404 });
    }

    switch (subPath) {
      case '':
      case '/':
        return Response.json({ vm });

      case '/ready':
        if (request.method === 'POST') {
          return this.handleVMReady(vmId, request);
        }
        break;

      case '/agents':
        return Response.json({
          vmId,
          agents: this.getVMAgents(vmId),
          count: vm.agentCount
        });

      case '/health':
        return Response.json({
          vmId,
          healthStatus: vm.healthStatus,
          lastCheck: vm.lastHealthCheck,
          recentChecks: this.getRecentHealthChecks(vmId, 10)
        });
    }

    return Response.json({ error: 'Not found', path: subPath }, { status: 404 });
  }

  private handleVMReady(vmId: string, request: Request): Response {
    const now = new Date().toISOString();

    this.sql.exec(`
      UPDATE vms SET status = 'ready', ready_at = ?, health_status = 'healthy'
      WHERE vm_id = ? AND status IN ('provisioning', 'booting')
    `, now, vmId);

    const vm = this.getVM(vmId);
    return Response.json({
      success: true,
      vm,
      message: 'VM marked as ready for agent assignment'
    });
  }

  // ========== Alarm Tasks ==========

  private async checkBootTimeouts(now: Date) {
    const timeoutThreshold = new Date(now.getTime() - this.config.vmBootTimeoutMs).toISOString();

    const timedOut = this.sql.exec(`
      SELECT vm_id FROM vms
      WHERE status IN ('provisioning', 'booting')
      AND created_at < ?
    `, timeoutThreshold).toArray();

    for (const row of timedOut) {
      this.sql.exec(`
        UPDATE vms SET status = 'error', error_message = 'Boot timeout'
        WHERE vm_id = ?
      `, row.vm_id);
    }
  }

  private async checkStaleHealth(now: Date) {
    const staleThreshold = new Date(now.getTime() - this.config.healthCheckIntervalMs * 3).toISOString();

    this.sql.exec(`
      UPDATE vms SET health_status = 'unresponsive'
      WHERE status IN ('ready', 'busy')
      AND (last_health_check IS NULL OR last_health_check < ?)
      AND health_status != 'unresponsive'
    `, staleThreshold);
  }

  private async autoScale() {
    const vms = this.getAllVMs();
    const activeVMs = vms.filter(vm => !['terminated', 'error'].includes(vm.status));
    const readyVMs = activeVMs.filter(vm => vm.status === 'ready');

    const freeSlots = readyVMs.reduce((sum, vm) => sum + (vm.maxAgents - vm.agentCount), 0);

    // If we're below target free capacity and under max VMs, recommend scaling up
    // The actual provisioning is done externally - we just flag the need
    if (freeSlots < this.config.targetFreeCapacity && activeVMs.length < this.config.maxVMs) {
      // Store scaling recommendation (external system can poll this)
      this.sql.exec(`
        INSERT INTO config (key, value, updated_at)
        VALUES ('pending_scale_up', 'true', ?)
        ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = excluded.updated_at
      `, new Date().toISOString());
    }
  }

  private cleanupOldRecords() {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    // Clean old health checks
    this.sql.exec(`DELETE FROM health_checks WHERE checked_at < ?`, cutoff);

    // Clean old completed assignments
    this.sql.exec(`DELETE FROM assignments WHERE status != 'active' AND completed_at < ?`, cutoff);
  }

  // ========== Helper Methods ==========

  private getAllVMs(): VMState[] {
    const rows = this.sql.exec('SELECT * FROM vms ORDER BY created_at DESC').toArray();
    return rows.map(row => this.rowToVM(row));
  }

  private getVM(vmId: string): VMState | null {
    const rows = this.sql.exec('SELECT * FROM vms WHERE vm_id = ?', vmId).toArray();
    if (rows.length === 0) return null;
    return this.rowToVM(rows[0]);
  }

  private findAvailableVM(): VMState | null {
    const rows = this.sql.exec(`
      SELECT * FROM vms
      WHERE status = 'ready' AND agent_count < max_agents AND health_status = 'healthy'
      ORDER BY agent_count ASC, created_at DESC
      LIMIT 1
    `).toArray();

    if (rows.length === 0) return null;
    return this.rowToVM(rows[0]);
  }

  private getActiveAssignment(agentId: string): AgentAssignment | null {
    const rows = this.sql.exec(`
      SELECT * FROM assignments WHERE agent_id = ? AND status = 'active'
      ORDER BY assigned_at DESC LIMIT 1
    `, agentId).toArray();

    if (rows.length === 0) return null;
    return this.rowToAssignment(rows[0]);
  }

  private getVMAgents(vmId: string): AgentAssignment[] {
    const rows = this.sql.exec(`
      SELECT * FROM assignments WHERE vm_id = ? ORDER BY assigned_at DESC
    `, vmId).toArray();
    return rows.map(row => this.rowToAssignment(row));
  }

  private getRecentHealthChecks(vmId: string, limit: number): HealthCheck[] {
    const rows = this.sql.exec(`
      SELECT * FROM health_checks WHERE vm_id = ? ORDER BY checked_at DESC LIMIT ?
    `, vmId, limit).toArray();
    return rows.map(row => ({
      checkId: row.check_id as string,
      vmId: row.vm_id as string,
      checkedAt: row.checked_at as string,
      status: row.status as HealthCheck['status'],
      responseTimeMs: row.response_time_ms as number | undefined,
      details: row.details as string | undefined
    }));
  }

  private getPoolSummary() {
    const vms = this.getAllVMs();
    return {
      total: vms.length,
      ready: vms.filter(vm => vm.status === 'ready').length,
      busy: vms.filter(vm => vm.status === 'busy').length,
      provisioning: vms.filter(vm => ['provisioning', 'booting'].includes(vm.status)).length
    };
  }

  private async ensureAlarmSet() {
    const alarm = await this.state.storage.getAlarm();
    if (!alarm) {
      await this.state.storage.setAlarm(Date.now() + this.config.healthCheckIntervalMs);
    }
  }

  private rowToVM(row: Record<string, unknown>): VMState {
    return {
      vmId: row.vm_id as string,
      instanceId: row.instance_id as string,
      status: row.status as VMState['status'],
      publicIp: row.public_ip as string | undefined,
      privateIp: row.private_ip as string | undefined,
      region: row.region as string,
      vmSize: row.vm_size as VMState['vmSize'],
      createdAt: row.created_at as string,
      readyAt: row.ready_at as string | undefined,
      lastHealthCheck: row.last_health_check as string | undefined,
      healthStatus: row.health_status as VMState['healthStatus'],
      errorMessage: row.error_message as string | undefined,
      agentCount: row.agent_count as number,
      maxAgents: row.max_agents as number,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined
    };
  }

  private rowToAssignment(row: Record<string, unknown>): AgentAssignment {
    return {
      assignmentId: row.assignment_id as string,
      agentId: row.agent_id as string,
      vmId: row.vm_id as string,
      assignedAt: row.assigned_at as string,
      status: row.status as AgentAssignment['status'],
      completedAt: row.completed_at as string | undefined,
      task: row.task as string | undefined
    };
  }
}
