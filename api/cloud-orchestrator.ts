import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const VMS_KEY = 'agent-coord:cloud-vms';
const ORCHESTRATOR_CONFIG_KEY = 'agent-coord:orchestrator-config';

// Cloud provider configurations
const CLOUD_PROVIDERS = {
  azure: {
    name: 'Azure',
    vmSizes: {
      small: { name: 'Standard_B2s', vcpus: 2, memoryGb: 4, pricePerHour: 0.042 },
      medium: { name: 'Standard_D2s_v3', vcpus: 2, memoryGb: 8, pricePerHour: 0.166 },
      large: { name: 'Standard_D4s_v3', vcpus: 4, memoryGb: 16, pricePerHour: 0.332 },
    },
    regions: ['eastus', 'westus2', 'northeurope', 'westeurope'],
  },
  aws: {
    name: 'AWS',
    vmSizes: {
      small: { name: 't3.small', vcpus: 2, memoryGb: 2, pricePerHour: 0.035 },
      medium: { name: 't3.large', vcpus: 2, memoryGb: 8, pricePerHour: 0.138 },
      large: { name: 't3.xlarge', vcpus: 4, memoryGb: 16, pricePerHour: 0.276 },
    },
    regions: ['us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1'],
  },
};

interface CloudVM {
  vmId: string;
  provider: 'azure' | 'aws' | 'local';
  region: string;
  size: 'small' | 'medium' | 'large';
  status: 'provisioning' | 'running' | 'stopping' | 'stopped' | 'terminated' | 'error';

  // Network
  publicIp: string | null;
  privateIp: string | null;

  // Agent info
  agentCapacity: number;  // How many agents can run on this VM
  activeAgents: string[];  // Body IDs of agents on this VM

  // Costs
  pricePerHour: number;
  totalCost: number;
  startedAt: string;
  stoppedAt: string | null;

  // Health
  lastHealthCheck: string;
  cpuUsage: number;
  memoryUsage: number;
  errorCount: number;

  // Metadata
  providerVmId: string | null;  // Azure/AWS resource ID
  tags: Record<string, string>;
}

interface OrchestratorConfig {
  enabled: boolean;
  provider: 'azure' | 'aws' | 'local';
  region: string;
  defaultVmSize: 'small' | 'medium' | 'large';

  // Auto-scaling
  minVms: number;
  maxVms: number;
  scaleUpThreshold: number;  // CPU % to trigger scale up
  scaleDownThreshold: number;  // CPU % to trigger scale down
  cooldownMinutes: number;

  // Cost controls
  maxDailySpend: number;
  maxMonthlySpend: number;
  currentDailySpend: number;
  currentMonthlySpend: number;

  // Scheduling
  autoShutdownEnabled: boolean;
  autoShutdownHour: number;  // 0-23 UTC
  autoStartEnabled: boolean;
  autoStartHour: number;  // 0-23 UTC

  // Alerts
  alertOnHighCost: boolean;
  alertOnLowCapacity: boolean;
  alertWebhook: string | null;
}

interface ProvisionRequest {
  provider?: 'azure' | 'aws' | 'local';
  region?: string;
  size?: 'small' | 'medium' | 'large';
  tags?: Record<string, string>;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

async function getConfig(): Promise<OrchestratorConfig> {
  const raw = await redis.get(ORCHESTRATOR_CONFIG_KEY);
  if (raw) {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  // Default config
  return {
    enabled: false,
    provider: 'local',
    region: 'local',
    defaultVmSize: 'medium',

    minVms: 0,
    maxVms: 5,
    scaleUpThreshold: 80,
    scaleDownThreshold: 20,
    cooldownMinutes: 10,

    maxDailySpend: 50,
    maxMonthlySpend: 500,
    currentDailySpend: 0,
    currentMonthlySpend: 0,

    autoShutdownEnabled: false,
    autoShutdownHour: 2,  // 2 AM UTC
    autoStartEnabled: false,
    autoStartHour: 8,  // 8 AM UTC

    alertOnHighCost: true,
    alertOnLowCapacity: true,
    alertWebhook: null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, vmId } = req.query;

  try {
    // === CONFIGURATION ===

    // Get orchestrator config
    if (action === 'config' && req.method === 'GET') {
      const config = await getConfig();
      return res.json({ config });
    }

    // Update orchestrator config
    if (action === 'config' && req.method === 'PUT') {
      const config = await getConfig();
      const updates = req.body;

      const newConfig: OrchestratorConfig = {
        ...config,
        ...updates,
      };

      await redis.set(ORCHESTRATOR_CONFIG_KEY, JSON.stringify(newConfig));
      return res.json({ success: true, config: newConfig });
    }

    // === VM MANAGEMENT ===

    // Provision new VM
    if (action === 'provision' && req.method === 'POST') {
      const config = await getConfig();
      const request: ProvisionRequest = req.body;

      const provider = request.provider || config.provider;
      const region = request.region || config.region;
      const size = request.size || config.defaultVmSize;

      // Check cost limits
      const providerConfig = CLOUD_PROVIDERS[provider as keyof typeof CLOUD_PROVIDERS];
      if (!providerConfig && provider !== 'local') {
        return res.status(400).json({ error: 'Invalid provider' });
      }

      const pricePerHour = provider === 'local'
        ? 0
        : providerConfig?.vmSizes[size]?.pricePerHour || 0;

      if (config.currentDailySpend + pricePerHour * 24 > config.maxDailySpend) {
        return res.status(400).json({
          error: 'Would exceed daily spend limit',
          currentSpend: config.currentDailySpend,
          maxSpend: config.maxDailySpend,
        });
      }

      // Count existing VMs
      const vms = await redis.hgetall(VMS_KEY) || {};
      const activeVms = Object.values(vms)
        .map((v: any) => typeof v === 'string' ? JSON.parse(v) : v)
        .filter((v: CloudVM) => v.status === 'running' || v.status === 'provisioning');

      if (activeVms.length >= config.maxVms) {
        return res.status(400).json({
          error: 'Maximum VM limit reached',
          current: activeVms.length,
          max: config.maxVms,
        });
      }

      // Create VM record
      const vm: CloudVM = {
        vmId: generateId(),
        provider: provider as 'azure' | 'aws' | 'local',
        region,
        size,
        status: 'provisioning',

        publicIp: null,
        privateIp: null,

        agentCapacity: size === 'small' ? 2 : size === 'medium' ? 4 : 8,
        activeAgents: [],

        pricePerHour,
        totalCost: 0,
        startedAt: new Date().toISOString(),
        stoppedAt: null,

        lastHealthCheck: new Date().toISOString(),
        cpuUsage: 0,
        memoryUsage: 0,
        errorCount: 0,

        providerVmId: null,
        tags: request.tags || {},
      };

      await redis.hset(VMS_KEY, { [vm.vmId]: JSON.stringify(vm) });

      // In production, this would call Azure/AWS APIs
      // For now, we'll simulate provisioning
      if (provider === 'local') {
        vm.status = 'running';
        vm.publicIp = '127.0.0.1';
        vm.privateIp = '127.0.0.1';
        await redis.hset(VMS_KEY, { [vm.vmId]: JSON.stringify(vm) });
      }

      return res.json({
        success: true,
        vm,
        note: provider !== 'local'
          ? 'VM provisioning initiated. Poll status to check when ready.'
          : 'Local VM ready immediately.',
        provisioningSteps: provider !== 'local' ? [
          '1. Creating resource group (if needed)',
          '2. Provisioning Windows Server VM',
          '3. Installing Claude Code CLI',
          '4. Configuring agent spawn service',
          '5. Opening firewall ports',
          '6. Registering with orchestrator',
        ] : [],
      });
    }

    // List VMs
    if (action === 'list' && req.method === 'GET') {
      const vms = await redis.hgetall(VMS_KEY) || {};
      const vmList = Object.values(vms).map((v: any) => {
        const vm = typeof v === 'string' ? JSON.parse(v) : v;

        // Calculate running cost
        if (vm.status === 'running' && !vm.stoppedAt) {
          const hours = (Date.now() - new Date(vm.startedAt).getTime()) / 3600000;
          vm.totalCost = vm.pricePerHour * hours;
        }

        return vm;
      });

      const summary = {
        total: vmList.length,
        running: vmList.filter((v: CloudVM) => v.status === 'running').length,
        provisioning: vmList.filter((v: CloudVM) => v.status === 'provisioning').length,
        stopped: vmList.filter((v: CloudVM) => v.status === 'stopped').length,
        totalCapacity: vmList
          .filter((v: CloudVM) => v.status === 'running')
          .reduce((sum: number, v: CloudVM) => sum + v.agentCapacity, 0),
        usedCapacity: vmList
          .filter((v: CloudVM) => v.status === 'running')
          .reduce((sum: number, v: CloudVM) => sum + v.activeAgents.length, 0),
        totalCostToday: vmList.reduce((sum: number, v: CloudVM) => sum + v.totalCost, 0),
      };

      return res.json({ vms: vmList, summary });
    }

    // Get VM details
    if (action === 'get' && req.method === 'GET') {
      if (!vmId || typeof vmId !== 'string') {
        return res.status(400).json({ error: 'vmId required' });
      }

      const raw = await redis.hget(VMS_KEY, vmId);
      if (!raw) {
        return res.status(404).json({ error: 'VM not found' });
      }

      const vm: CloudVM = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return res.json({ vm });
    }

    // Stop VM
    if (action === 'stop' && req.method === 'POST') {
      if (!vmId || typeof vmId !== 'string') {
        return res.status(400).json({ error: 'vmId required' });
      }

      const raw = await redis.hget(VMS_KEY, vmId);
      if (!raw) {
        return res.status(404).json({ error: 'VM not found' });
      }

      const vm: CloudVM = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (vm.activeAgents.length > 0) {
        return res.status(400).json({
          error: 'Cannot stop VM with active agents',
          activeAgents: vm.activeAgents,
          suggestion: 'Transfer agents to another VM first',
        });
      }

      vm.status = 'stopping';
      await redis.hset(VMS_KEY, { [vmId]: JSON.stringify(vm) });

      // In production, call Azure/AWS stop API
      // Simulate stop
      vm.status = 'stopped';
      vm.stoppedAt = new Date().toISOString();
      const hours = (Date.now() - new Date(vm.startedAt).getTime()) / 3600000;
      vm.totalCost = vm.pricePerHour * hours;
      await redis.hset(VMS_KEY, { [vmId]: JSON.stringify(vm) });

      return res.json({ success: true, vm });
    }

    // Start VM
    if (action === 'start' && req.method === 'POST') {
      if (!vmId || typeof vmId !== 'string') {
        return res.status(400).json({ error: 'vmId required' });
      }

      const raw = await redis.hget(VMS_KEY, vmId);
      if (!raw) {
        return res.status(404).json({ error: 'VM not found' });
      }

      const vm: CloudVM = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (vm.status !== 'stopped') {
        return res.status(400).json({ error: 'VM is not stopped', currentStatus: vm.status });
      }

      vm.status = 'running';
      vm.startedAt = new Date().toISOString();
      vm.stoppedAt = null;
      vm.lastHealthCheck = new Date().toISOString();
      await redis.hset(VMS_KEY, { [vmId]: JSON.stringify(vm) });

      return res.json({ success: true, vm });
    }

    // Terminate VM
    if (action === 'terminate' && req.method === 'DELETE') {
      if (!vmId || typeof vmId !== 'string') {
        return res.status(400).json({ error: 'vmId required' });
      }

      const raw = await redis.hget(VMS_KEY, vmId);
      if (!raw) {
        return res.status(404).json({ error: 'VM not found' });
      }

      const vm: CloudVM = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (vm.activeAgents.length > 0) {
        return res.status(400).json({
          error: 'Cannot terminate VM with active agents',
          activeAgents: vm.activeAgents,
        });
      }

      vm.status = 'terminated';
      vm.stoppedAt = new Date().toISOString();
      await redis.hset(VMS_KEY, { [vmId]: JSON.stringify(vm) });

      // In production, call Azure/AWS delete API
      // Clean up after delay
      await redis.hdel(VMS_KEY, vmId);

      return res.json({ success: true, deleted: vmId, finalCost: vm.totalCost });
    }

    // Update VM health
    if (action === 'health' && req.method === 'POST') {
      if (!vmId || typeof vmId !== 'string') {
        return res.status(400).json({ error: 'vmId required' });
      }

      const { cpuUsage, memoryUsage, activeAgents } = req.body;

      const raw = await redis.hget(VMS_KEY, vmId);
      if (!raw) {
        return res.status(404).json({ error: 'VM not found' });
      }

      const vm: CloudVM = typeof raw === 'string' ? JSON.parse(raw) : raw;
      vm.cpuUsage = cpuUsage ?? vm.cpuUsage;
      vm.memoryUsage = memoryUsage ?? vm.memoryUsage;
      vm.activeAgents = activeAgents ?? vm.activeAgents;
      vm.lastHealthCheck = new Date().toISOString();

      // Update running cost
      if (vm.status === 'running') {
        const hours = (Date.now() - new Date(vm.startedAt).getTime()) / 3600000;
        vm.totalCost = vm.pricePerHour * hours;
      }

      await redis.hset(VMS_KEY, { [vmId]: JSON.stringify(vm) });

      return res.json({ success: true, vm });
    }

    // === AUTO-SCALING ===

    // Check scaling needs
    if (action === 'check-scaling' && req.method === 'GET') {
      const config = await getConfig();
      const vms = await redis.hgetall(VMS_KEY) || {};
      const runningVms = Object.values(vms)
        .map((v: any) => typeof v === 'string' ? JSON.parse(v) : v)
        .filter((v: CloudVM) => v.status === 'running');

      const totalCapacity = runningVms.reduce((sum: number, v: CloudVM) => sum + v.agentCapacity, 0);
      const usedCapacity = runningVms.reduce((sum: number, v: CloudVM) => sum + v.activeAgents.length, 0);
      const avgCpuUsage = runningVms.length > 0
        ? runningVms.reduce((sum: number, v: CloudVM) => sum + v.cpuUsage, 0) / runningVms.length
        : 0;

      const utilizationPercent = totalCapacity > 0 ? (usedCapacity / totalCapacity) * 100 : 0;

      let recommendation: 'scale_up' | 'scale_down' | 'maintain' = 'maintain';
      let reason = 'Current capacity is appropriate';

      if (avgCpuUsage > config.scaleUpThreshold || utilizationPercent > 80) {
        if (runningVms.length < config.maxVms) {
          recommendation = 'scale_up';
          reason = `High utilization (CPU: ${avgCpuUsage.toFixed(1)}%, Capacity: ${utilizationPercent.toFixed(1)}%)`;
        }
      } else if (avgCpuUsage < config.scaleDownThreshold && utilizationPercent < 30) {
        if (runningVms.length > config.minVms) {
          recommendation = 'scale_down';
          reason = `Low utilization (CPU: ${avgCpuUsage.toFixed(1)}%, Capacity: ${utilizationPercent.toFixed(1)}%)`;
        }
      }

      return res.json({
        recommendation,
        reason,
        metrics: {
          runningVms: runningVms.length,
          totalCapacity,
          usedCapacity,
          utilizationPercent,
          avgCpuUsage,
        },
        thresholds: {
          scaleUp: config.scaleUpThreshold,
          scaleDown: config.scaleDownThreshold,
          minVms: config.minVms,
          maxVms: config.maxVms,
        },
      });
    }

    // === COST TRACKING ===

    // Get cost summary
    if (action === 'costs' && req.method === 'GET') {
      const config = await getConfig();
      const vms = await redis.hgetall(VMS_KEY) || {};
      const vmList = Object.values(vms).map((v: any) => {
        const vm = typeof v === 'string' ? JSON.parse(v) : v;
        if (vm.status === 'running' && !vm.stoppedAt) {
          const hours = (Date.now() - new Date(vm.startedAt).getTime()) / 3600000;
          vm.totalCost = vm.pricePerHour * hours;
        }
        return vm;
      });

      const totalCost = vmList.reduce((sum: number, v: CloudVM) => sum + v.totalCost, 0);
      const hourlyRate = vmList
        .filter((v: CloudVM) => v.status === 'running')
        .reduce((sum: number, v: CloudVM) => sum + v.pricePerHour, 0);

      return res.json({
        summary: {
          totalSpentToday: totalCost,
          currentHourlyRate: hourlyRate,
          projectedDaily: hourlyRate * 24,
          projectedMonthly: hourlyRate * 24 * 30,
        },
        limits: {
          dailyLimit: config.maxDailySpend,
          monthlyLimit: config.maxMonthlySpend,
          dailyRemaining: config.maxDailySpend - totalCost,
        },
        byVm: vmList.map((v: CloudVM) => ({
          vmId: v.vmId,
          provider: v.provider,
          size: v.size,
          status: v.status,
          cost: v.totalCost,
          pricePerHour: v.pricePerHour,
        })),
      });
    }

    // === PROVIDER INFO ===

    // List available providers and options
    if (action === 'providers' && req.method === 'GET') {
      return res.json({
        providers: CLOUD_PROVIDERS,
        recommendation: {
          forDevelopment: 'local',
          forProduction: 'azure',
          forCostSavings: 'aws with spot instances',
        },
      });
    }

    return res.status(400).json({
      error: 'Invalid action',
      validActions: [
        'config',  // GET/PUT
        'provision', 'list', 'get', 'stop', 'start', 'terminate', 'health',  // VM operations
        'check-scaling',  // Auto-scaling
        'costs',  // Cost tracking
        'providers',  // Provider info
      ],
    });

  } catch (error) {
    console.error('Cloud Orchestrator error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
