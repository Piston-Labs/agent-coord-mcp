import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeInstanceStatusCommand,
} from '@aws-sdk/client-ec2';

/**
 * VM Status API - Real-time AWS VM monitoring for the dashboard
 *
 * GET /api/vm-status - Get all cloud agent VMs with live AWS status
 * GET /api/vm-status?instanceId=xxx - Get specific instance details
 * PATCH /api/vm-status?action=refresh - Force refresh all VM statuses from AWS
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CLOUD_AGENTS_KEY = 'agent-coord:cloud-agents';
const AWS_REGION = process.env.AWS_REGION || 'us-west-1';

interface CloudAgent {
  agentId: string;
  vmId: string;
  instanceId: string;
  soulId: string | null;
  soulName: string | null;
  task: string;
  status: string;
  spawnedBy: string;
  spawnedAt: string;
  publicIp: string | null;
  lastSeen: string | null;
  errorMessage: string | null;
  shadowMode?: boolean;
  shadowFor?: string;
}

interface VMStatus {
  instanceId: string;
  agentId: string;
  // AWS instance state
  state: string;
  stateReason?: string;
  // Network
  publicIp: string | null;
  privateIp: string | null;
  // Health checks
  instanceStatus: string;
  systemStatus: string;
  // Timing
  launchTime: string;
  uptimeMinutes: number;
  // Instance details
  instanceType: string;
  availabilityZone: string;
  // Cost estimate
  estimatedHourlyCost: number;
  estimatedTotalCost: number;
  // Agent info
  task: string;
  spawnedBy: string;
  agentStatus: string;
  // Bootstrap progress (estimated)
  bootstrapPhase: string;
  bootstrapProgress: number;
}

const INSTANCE_PRICES: Record<string, number> = {
  't3.small': 0.0208,
  't3.medium': 0.0416,
  't3.large': 0.0832,
};

function getEC2Client() {
  return new EC2Client({
    region: AWS_REGION,
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  });
}

function estimateBootstrapPhase(uptimeMinutes: number, agentStatus: string): { phase: string; progress: number } {
  // Bootstrap phases based on typical Windows VM boot times
  if (agentStatus === 'terminated' || agentStatus === 'error') {
    return { phase: 'terminated', progress: 0 };
  }

  if (uptimeMinutes < 1) {
    return { phase: 'starting', progress: 5 };
  } else if (uptimeMinutes < 2) {
    return { phase: 'booting-os', progress: 15 };
  } else if (uptimeMinutes < 3) {
    return { phase: 'initializing-windows', progress: 30 };
  } else if (uptimeMinutes < 4) {
    return { phase: 'running-userdata', progress: 45 };
  } else if (uptimeMinutes < 5) {
    return { phase: 'installing-nodejs', progress: 55 };
  } else if (uptimeMinutes < 6) {
    return { phase: 'installing-git', progress: 65 };
  } else if (uptimeMinutes < 7) {
    return { phase: 'cloning-repo', progress: 75 };
  } else if (uptimeMinutes < 8) {
    return { phase: 'npm-install', progress: 85 };
  } else if (uptimeMinutes < 10) {
    return { phase: 'starting-claude-cli', progress: 95 };
  } else {
    // After 10 minutes, should be ready
    if (agentStatus === 'ready' || agentStatus === 'working' || agentStatus === 'idle') {
      return { phase: 'ready', progress: 100 };
    }
    return { phase: 'waiting-for-agent', progress: 98 };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { instanceId, action } = req.query;

    // Get all cloud agents from Redis
    const agents = await redis.hgetall(CLOUD_AGENTS_KEY) || {};
    const agentList = Object.values(agents)
      .map((a: any) => typeof a === 'string' ? JSON.parse(a) : a) as CloudAgent[];

    // Filter to only agents with instance IDs (successfully launched)
    const activeAgents = agentList.filter(a =>
      a.instanceId &&
      !['terminated', 'error'].includes(a.status) ||
      // Include recently terminated for visibility
      (a.status === 'terminated' &&
       new Date(a.spawnedAt).getTime() > Date.now() - 24 * 60 * 60 * 1000)
    );

    if (activeAgents.length === 0) {
      return res.json({
        vms: [],
        summary: {
          total: 0,
          running: 0,
          booting: 0,
          stopped: 0,
          terminated: 0,
        },
        message: 'No active cloud agents with VMs',
      });
    }

    // Get AWS instance details
    const ec2 = getEC2Client();
    const instanceIds = Array.from(new Set(activeAgents.map(a => a.instanceId).filter(Boolean)));

    let awsInstances: Record<string, any> = {};
    let awsStatuses: Record<string, any> = {};

    try {
      // Describe instances
      const describeResult = await ec2.send(new DescribeInstancesCommand({
        InstanceIds: instanceIds,
      }));

      for (const reservation of describeResult.Reservations || []) {
        for (const instance of reservation.Instances || []) {
          if (instance.InstanceId) {
            awsInstances[instance.InstanceId] = instance;
          }
        }
      }

      // Get instance statuses (health checks)
      const statusResult = await ec2.send(new DescribeInstanceStatusCommand({
        InstanceIds: instanceIds,
        IncludeAllInstances: true,
      }));

      for (const status of statusResult.InstanceStatuses || []) {
        if (status.InstanceId) {
          awsStatuses[status.InstanceId] = status;
        }
      }
    } catch (awsError: any) {
      console.error('AWS API error:', awsError.message);
      // Continue with cached data if AWS fails
    }

    // Build VM status list
    const vmStatuses: VMStatus[] = [];

    for (const agent of activeAgents) {
      if (!agent.instanceId) continue;

      const instance = awsInstances[agent.instanceId];
      const status = awsStatuses[agent.instanceId];

      const launchTime = instance?.LaunchTime
        ? new Date(instance.LaunchTime).toISOString()
        : agent.spawnedAt;

      const uptimeMinutes = (Date.now() - new Date(launchTime).getTime()) / 60000;
      const instanceType = instance?.InstanceType || 't3.small';
      const hourlyPrice = INSTANCE_PRICES[instanceType] || 0.02;

      const { phase, progress } = estimateBootstrapPhase(uptimeMinutes, agent.status);

      const vmStatus: VMStatus = {
        instanceId: agent.instanceId,
        agentId: agent.agentId,
        state: instance?.State?.Name || 'unknown',
        stateReason: instance?.StateReason?.Message,
        publicIp: instance?.PublicIpAddress || agent.publicIp,
        privateIp: instance?.PrivateIpAddress || null,
        instanceStatus: status?.InstanceStatus?.Status || 'unknown',
        systemStatus: status?.SystemStatus?.Status || 'unknown',
        launchTime,
        uptimeMinutes: Math.round(uptimeMinutes),
        instanceType,
        availabilityZone: instance?.Placement?.AvailabilityZone || AWS_REGION,
        estimatedHourlyCost: hourlyPrice,
        estimatedTotalCost: parseFloat((hourlyPrice * (uptimeMinutes / 60)).toFixed(4)),
        task: agent.task,
        spawnedBy: agent.spawnedBy,
        agentStatus: agent.status,
        bootstrapPhase: phase,
        bootstrapProgress: progress,
      };

      vmStatuses.push(vmStatus);

      // Update agent record with latest IP if changed
      if (instance?.PublicIpAddress && instance.PublicIpAddress !== agent.publicIp) {
        agent.publicIp = instance.PublicIpAddress;
        await redis.hset(CLOUD_AGENTS_KEY, { [agent.agentId]: JSON.stringify(agent) });
      }
    }

    // Sort by launch time (newest first)
    vmStatuses.sort((a, b) =>
      new Date(b.launchTime).getTime() - new Date(a.launchTime).getTime()
    );

    // Calculate summary
    const summary = {
      total: vmStatuses.length,
      running: vmStatuses.filter(v => v.state === 'running').length,
      booting: vmStatuses.filter(v => v.state === 'pending').length,
      stopped: vmStatuses.filter(v => v.state === 'stopped').length,
      terminated: vmStatuses.filter(v => v.state === 'terminated').length,
      totalHourlyCost: vmStatuses
        .filter(v => v.state === 'running')
        .reduce((sum, v) => sum + v.estimatedHourlyCost, 0),
      totalSpentToday: vmStatuses.reduce((sum, v) => sum + v.estimatedTotalCost, 0),
    };

    // If specific instance requested
    if (instanceId && typeof instanceId === 'string') {
      const vm = vmStatuses.find(v => v.instanceId === instanceId);
      if (!vm) {
        return res.status(404).json({ error: 'Instance not found' });
      }
      return res.json({ vm });
    }

    return res.json({
      vms: vmStatuses,
      summary,
      timestamp: new Date().toISOString(),
      region: AWS_REGION,
    });

  } catch (error: any) {
    console.error('VM Status error:', error);
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
}
