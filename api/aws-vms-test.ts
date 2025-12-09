import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

/**
 * AWS VM Test API - Minimal version to debug FUNCTION_INVOCATION_FAILED
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const VMS_KEY = 'agent-coord:aws-vms';

// Instance types with pricing (Windows, on-demand)
const INSTANCE_CONFIGS: Record<string, { type: string; vcpu: number; memory: number; price: number; capacity: number }> = {
  small: { type: 't3.small', vcpu: 2, memory: 2, price: 0.035, capacity: 2 },
  medium: { type: 't3.medium', vcpu: 2, memory: 4, price: 0.070, capacity: 3 },
  large: { type: 't3.large', vcpu: 2, memory: 8, price: 0.138, capacity: 5 },
  xlarge: { type: 't3.xlarge', vcpu: 4, memory: 16, price: 0.276, capacity: 8 },
};

const WINDOWS_AMIS: Record<string, string> = {
  'us-east-1': 'ami-0159172a5a821bafd',
  'us-east-2': 'ami-0c1704bac156af62c',
  'us-west-1': 'ami-0e5d865c678e78624',
  'us-west-2': 'ami-0f5daaa3a7fb3378b',
};

interface AWSVM {
  vmId: string;
  instanceId: string;
  region: string;
  size: string;
  status: 'provisioning' | 'bootstrapping' | 'ready' | 'running' | 'stopping' | 'stopped' | 'terminated' | 'error';
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
  errorMessage: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, vmId } = req.query;

  try {
    // === PRICING INFO ===
    if (action === 'pricing' && req.method === 'GET') {
      return res.json({
        instanceTypes: INSTANCE_CONFIGS,
        regions: Object.keys(WINDOWS_AMIS),
        notes: {
          pricing: 'Windows Server on-demand pricing (includes license)',
          recommendation: 'Use t3.medium for most workloads (2-3 agents)',
          spotSavings: 'Spot instances can save 60-70% but may be interrupted',
        },
      });
    }

    // === LIST VMS ===
    if (action === 'list' && req.method === 'GET') {
      const vms = await redis.hgetall(VMS_KEY) || {};
      const vmList = Object.values(vms)
        .map((v: any) => typeof v === 'string' ? JSON.parse(v) : v)
        .sort((a: AWSVM, b: AWSVM) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Calculate costs
      for (const vm of vmList) {
        if (vm.status === 'running' || vm.status === 'ready' || vm.status === 'bootstrapping') {
          const hours = (Date.now() - new Date(vm.createdAt).getTime()) / 3600000;
          vm.totalCost = vm.pricePerHour * hours;
        }
      }

      const summary = {
        total: vmList.length,
        running: vmList.filter((v: AWSVM) => ['running', 'ready', 'bootstrapping'].includes(v.status)).length,
        stopped: vmList.filter((v: AWSVM) => v.status === 'stopped').length,
        error: vmList.filter((v: AWSVM) => v.status === 'error').length,
        totalCapacity: vmList.filter((v: AWSVM) => v.status === 'ready' || v.status === 'running')
          .reduce((sum: number, v: AWSVM) => sum + v.agentCapacity, 0),
        totalCost: vmList.reduce((sum: number, v: AWSVM) => sum + (v.totalCost || 0), 0),
      };

      return res.json({ vms: vmList, summary });
    }

    return res.status(400).json({
      error: 'Invalid action',
      validActions: ['list', 'pricing'],
      note: 'This is a minimal test endpoint. Use cloud-spawn for full VM management.',
    });

  } catch (error: any) {
    console.error('AWS VMs Test API error:', error);
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
}
