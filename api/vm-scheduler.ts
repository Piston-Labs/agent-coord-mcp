import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import {
  EC2Client,
  StopInstancesCommand,
  StartInstancesCommand,
  DescribeInstancesCommand,
} from '@aws-sdk/client-ec2';

/**
 * VM Scheduler API
 *
 * Handles auto-shutdown of idle VMs to minimize costs.
 * Call this via Vercel Cron or external scheduler every 5-10 minutes.
 *
 * Cost-saving features:
 * - Auto-stop VMs with no agents after 15 minutes
 * - Auto-stop all VMs during off-hours (configurable)
 * - Spot instance support (future)
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const VMS_KEY = 'agent-coord:aws-vms';
const SCHEDULER_CONFIG_KEY = 'agent-coord:vm-scheduler-config';
const CHAT_KEY = 'agent-coord:chat';

// Default config
const DEFAULT_CONFIG = {
  enabled: true,
  idleShutdownMinutes: 15,  // Stop VMs idle for 15+ minutes
  offHoursEnabled: true,
  offHoursStart: 22,  // 10 PM UTC
  offHoursEnd: 6,     // 6 AM UTC
  weekendsOff: true,  // Stop VMs on weekends
  maxDailySpend: 10,  // Stop all VMs if daily spend exceeds $10
};

interface SchedulerConfig {
  enabled: boolean;
  idleShutdownMinutes: number;
  offHoursEnabled: boolean;
  offHoursStart: number;
  offHoursEnd: number;
  weekendsOff: boolean;
  maxDailySpend: number;
}

interface AWSVM {
  vmId: string;
  instanceId: string;
  region: string;
  size: string;
  status: string;
  publicIp: string | null;
  privateIp: string | null;
  agentCapacity: number;
  activeAgents: string[];
  pricePerHour: number;
  totalCost: number;
  createdAt: string;
  readyAt: string | null;
  stoppedAt: string | null;
  lastHealthCheck: string | null;
  lastAgentActivity: string | null;
  errorMessage: string | null;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

async function postToChat(message: string) {
  const chatMessage = {
    id: generateId(),
    author: '⏰ vm-scheduler',
    authorType: 'system',
    message,
    timestamp: new Date().toISOString(),
  };
  await redis.lpush(CHAT_KEY, JSON.stringify(chatMessage));
  await redis.ltrim(CHAT_KEY, 0, 999);
}

async function getConfig(): Promise<SchedulerConfig> {
  const raw = await redis.get(SCHEDULER_CONFIG_KEY);
  if (raw) {
    return { ...DEFAULT_CONFIG, ...(typeof raw === 'string' ? JSON.parse(raw) : raw) };
  }
  return DEFAULT_CONFIG;
}

function getEC2Client(region: string) {
  return new EC2Client({
    region,
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  });
}

function isOffHours(config: SchedulerConfig): boolean {
  const now = new Date();
  const hour = now.getUTCHours();
  const day = now.getUTCDay();

  // Check weekends
  if (config.weekendsOff && (day === 0 || day === 6)) {
    return true;
  }

  // Check off-hours
  if (config.offHoursEnabled) {
    if (config.offHoursStart > config.offHoursEnd) {
      // Wraps around midnight (e.g., 22-6)
      return hour >= config.offHoursStart || hour < config.offHoursEnd;
    } else {
      return hour >= config.offHoursStart && hour < config.offHoursEnd;
    }
  }

  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;

  try {
    // === GET/UPDATE CONFIG ===
    if (action === 'config') {
      if (req.method === 'GET') {
        const config = await getConfig();
        return res.json({ config });
      }

      if (req.method === 'PUT') {
        const config = await getConfig();
        const updates = req.body;
        const newConfig = { ...config, ...updates };
        await redis.set(SCHEDULER_CONFIG_KEY, JSON.stringify(newConfig));
        return res.json({ success: true, config: newConfig });
      }
    }

    // === RUN SCHEDULER (call via cron) ===
    if (action === 'run' || (req.method === 'POST' && !action)) {
      const config = await getConfig();

      if (!config.enabled) {
        return res.json({ skipped: true, reason: 'Scheduler disabled' });
      }

      const results = {
        checked: 0,
        stopped: [] as string[],
        reasons: {} as Record<string, string>,
        totalSaved: 0,
      };

      // Get all VMs
      const vms = await redis.hgetall(VMS_KEY) || {};
      const vmList = Object.values(vms)
        .map((v: any) => typeof v === 'string' ? JSON.parse(v) : v) as AWSVM[];

      const runningVms = vmList.filter(v =>
        ['running', 'ready', 'bootstrapping'].includes(v.status)
      );

      // Calculate current daily spend
      let dailySpend = 0;
      for (const vm of runningVms) {
        const hours = (Date.now() - new Date(vm.createdAt).getTime()) / 3600000;
        dailySpend += vm.pricePerHour * Math.min(hours, 24);
      }

      const offHours = isOffHours(config);

      for (const vm of runningVms) {
        results.checked++;
        let shouldStop = false;
        let reason = '';

        // Check: Over daily budget
        if (dailySpend > config.maxDailySpend) {
          shouldStop = true;
          reason = `Daily spend ($${dailySpend.toFixed(2)}) exceeds limit ($${config.maxDailySpend})`;
        }

        // Check: Off-hours
        if (!shouldStop && offHours && vm.activeAgents.length === 0) {
          shouldStop = true;
          reason = 'Off-hours and no active agents';
        }

        // Check: Idle too long
        if (!shouldStop && vm.activeAgents.length === 0) {
          const lastActivity = vm.lastAgentActivity || vm.readyAt || vm.createdAt;
          const idleMinutes = (Date.now() - new Date(lastActivity).getTime()) / 60000;

          if (idleMinutes > config.idleShutdownMinutes) {
            shouldStop = true;
            reason = `Idle for ${Math.floor(idleMinutes)} minutes (limit: ${config.idleShutdownMinutes})`;
          }
        }

        if (shouldStop) {
          try {
            const ec2 = getEC2Client(vm.region);
            await ec2.send(new StopInstancesCommand({ InstanceIds: [vm.instanceId] }));

            vm.status = 'stopped';
            vm.stoppedAt = new Date().toISOString();
            await redis.hset(VMS_KEY, { [vm.vmId]: JSON.stringify(vm) });

            results.stopped.push(vm.vmId);
            results.reasons[vm.vmId] = reason;
            results.totalSaved += vm.pricePerHour * 24; // Projected daily savings

            await postToChat(`[auto-shutdown] 💤 VM **${vm.vmId}** stopped: ${reason}`);
          } catch (err: any) {
            console.error(`Failed to stop ${vm.vmId}:`, err.message);
          }
        }
      }

      return res.json({
        success: true,
        timestamp: new Date().toISOString(),
        offHours,
        dailySpend: dailySpend.toFixed(2),
        results,
      });
    }

    // === STATUS CHECK ===
    if (action === 'status' && req.method === 'GET') {
      const config = await getConfig();
      const vms = await redis.hgetall(VMS_KEY) || {};
      const vmList = Object.values(vms)
        .map((v: any) => typeof v === 'string' ? JSON.parse(v) : v) as AWSVM[];

      const runningVms = vmList.filter(v =>
        ['running', 'ready', 'bootstrapping'].includes(v.status)
      );

      let currentHourlyRate = 0;
      let dailySpend = 0;

      for (const vm of runningVms) {
        currentHourlyRate += vm.pricePerHour;
        const hours = (Date.now() - new Date(vm.createdAt).getTime()) / 3600000;
        dailySpend += vm.pricePerHour * Math.min(hours, 24);
      }

      return res.json({
        config,
        currentState: {
          runningVms: runningVms.length,
          currentHourlyRate,
          projectedDailyCost: currentHourlyRate * 24,
          actualDailySpend: dailySpend,
          isOffHours: isOffHours(config),
          nextCheck: 'Call POST /api/vm-scheduler?action=run',
        },
        vmsAtRisk: runningVms
          .filter(v => v.activeAgents.length === 0)
          .map(v => ({
            vmId: v.vmId,
            idleMinutes: Math.floor((Date.now() - new Date(v.lastAgentActivity || v.readyAt || v.createdAt).getTime()) / 60000),
            willStopIn: Math.max(0, config.idleShutdownMinutes - Math.floor((Date.now() - new Date(v.lastAgentActivity || v.readyAt || v.createdAt).getTime()) / 60000)),
          })),
      });
    }

    return res.status(400).json({
      error: 'Invalid action',
      validActions: ['config', 'run', 'status'],
      usage: {
        'GET /config': 'Get scheduler configuration',
        'PUT /config': 'Update configuration',
        'POST /run': 'Run scheduler (stops idle VMs)',
        'GET /status': 'Get current status and at-risk VMs',
      },
    });

  } catch (error: any) {
    console.error('VM Scheduler error:', error);
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
}
