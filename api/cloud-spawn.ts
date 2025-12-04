import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import {
  EC2Client,
  RunInstancesCommand,
  DescribeInstancesCommand,
} from '@aws-sdk/client-ec2';
import {
  SSMClient,
  SendCommandCommand,
} from '@aws-sdk/client-ssm';

/**
 * Cloud Spawn API - Automatically spawn Claude agents in AWS cloud
 *
 * This endpoint allows Railway agents (or any remote agent) to spawn
 * Claude agents in the cloud when the local machine is unavailable.
 *
 * POST /api/cloud-spawn - Spawn a new cloud agent
 *   Body: { task, soulId?, soulName?, priority?, vmSize? }
 *
 * GET /api/cloud-spawn - List active cloud agents
 *
 * DELETE /api/cloud-spawn?agentId=xxx - Terminate a cloud agent
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CLOUD_AGENTS_KEY = 'agent-coord:cloud-agents';
const VMS_KEY = 'agent-coord:aws-vms';
const CHAT_KEY = 'agent-coord:chat';
const SOULS_KEY = 'agent-coord:souls';

const AWS_REGION = process.env.AWS_REGION || 'us-west-1';
const GOLDEN_AMI = process.env.AWS_GOLDEN_AMI_ID;
const WINDOWS_AMI = GOLDEN_AMI || 'ami-0159172a5a821bafd';

interface CloudAgent {
  agentId: string;
  vmId: string;
  instanceId: string;
  soulId: string | null;
  soulName: string | null;
  task: string;
  status: 'provisioning' | 'booting' | 'ready' | 'working' | 'idle' | 'terminated' | 'error';
  spawnedBy: string;
  spawnedAt: string;
  publicIp: string | null;
  lastSeen: string | null;
  errorMessage: string | null;
}

function generateId(prefix: string = 'cloud'): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).substr(2, 4)}`;
}

async function postToChat(message: string) {
  const chatMessage = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
    author: '☁️ cloud-spawn',
    authorType: 'system',
    message,
    timestamp: new Date().toISOString(),
  };
  await redis.lpush(CHAT_KEY, JSON.stringify(chatMessage));
  await redis.ltrim(CHAT_KEY, 0, 999);
}

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

function getSSMClient() {
  return new SSMClient({
    region: AWS_REGION,
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  });
}

// Bootstrap script for cloud agent
function getCloudAgentBootstrap(apiKey: string, hubUrl: string, agentId: string, soulId?: string, task?: string): string {
  const soulInjection = soulId ? `
# Fetch and inject soul
$soulUri = "${hubUrl}/api/souls?action=get-bundle"
$soulUri = $soulUri + "&soulId=${soulId}"
$soulResponse = Invoke-RestMethod -Uri $soulUri -Method GET
$bundle = $soulResponse.bundle

$injection = @"
[SOUL INJECTION - Cloud Agent ${agentId}]

You are a cloud-spawned Claude agent with persistent identity.

Identity: $($bundle.identity.name)
Soul ID: ${soulId}
Agent ID: ${agentId}

Previous Context:
$($bundle.checkpoint.conversationSummary)

Current Task: ${task || '$($bundle.checkpoint.currentTask)'}

Pending Work:
$($bundle.checkpoint.pendingWork -join [char]10)

IMPORTANT: You are running in AWS cloud. Your local machine (Tyler's computer) is not available.
- Use the MCP coordination tools to communicate with other agents
- Checkpoint your soul frequently (every 10-15 minutes)
- Post updates to group chat
- When done, checkpoint and request termination

Begin by announcing yourself in group chat and starting work.
"@

$injection | claude --dangerously-skip-permissions --mcp-config "C:\\AgentHub\\config\\mcp-config.json"
` : `
# Start with task only (no soul)
$taskPrompt = @"
[CLOUD AGENT ${agentId}]

You are a cloud-spawned Claude agent running in AWS.

Task: ${task || 'No specific task - check group chat for work'}

IMPORTANT: You are running in AWS cloud. Your local machine (Tyler's computer) is not available.
- Use the MCP coordination tools to communicate with other agents
- Post updates to group chat regularly
- When done, announce completion and request termination

Begin by announcing yourself in group chat and starting work.
"@

$taskPrompt | claude --dangerously-skip-permissions --mcp-config "C:\\AgentHub\\config\\mcp-config.json"
`;

  return `
<powershell>
$ErrorActionPreference = "Continue"
$AgentDir = "C:\\AgentHub"
$LogFile = "$AgentDir\\logs\\cloud-agent-${agentId}.log"

# Ensure log directory exists
New-Item -ItemType Directory -Force -Path "$AgentDir\\logs" | Out-Null

"Cloud agent ${agentId} starting at $(Get-Date)" | Out-File $LogFile

# Set environment variables
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "${apiKey}", "Machine")
[Environment]::SetEnvironmentVariable("AGENT_HUB_URL", "${hubUrl}", "Machine")
[Environment]::SetEnvironmentVariable("CLOUD_AGENT_ID", "${agentId}", "Machine")
$env:ANTHROPIC_API_KEY = "${apiKey}"
$env:AGENT_HUB_URL = "${hubUrl}"

# Ensure PATH includes npm global
$npmPath = "C:\\Windows\\system32\\config\\systemprofile\\AppData\\Roaming\\npm"
if (Test-Path $npmPath) {
    $env:Path = "$env:Path;$npmPath"
}

# Update repo
Set-Location "$AgentDir\\repos\\agent-coord-mcp"
git pull origin main 2>&1 | Out-File $LogFile -Append
npm install 2>&1 | Out-File $LogFile -Append

# Announce to hub that we're ready
$body = @{
    agentId = "${agentId}"
    status = "ready"
    vmType = "cloud"
    spawnedAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "${hubUrl}/api/agents" -Method POST -Body $body -ContentType "application/json"
    "Registered with hub" | Out-File $LogFile -Append
} catch {
    "Failed to register: $_" | Out-File $LogFile -Append
}

${soulInjection}

"Cloud agent ${agentId} finished at $(Get-Date)" | Out-File $LogFile -Append
</powershell>
`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // === LIST CLOUD AGENTS ===
    if (req.method === 'GET') {
      const agents = await redis.hgetall(CLOUD_AGENTS_KEY) || {};
      const agentList = Object.values(agents)
        .map((a: any) => typeof a === 'string' ? JSON.parse(a) : a)
        .sort((a: CloudAgent, b: CloudAgent) =>
          new Date(b.spawnedAt).getTime() - new Date(a.spawnedAt).getTime()
        );

      const summary = {
        total: agentList.length,
        active: agentList.filter((a: CloudAgent) => ['ready', 'working', 'idle'].includes(a.status)).length,
        provisioning: agentList.filter((a: CloudAgent) => ['provisioning', 'booting'].includes(a.status)).length,
        terminated: agentList.filter((a: CloudAgent) => a.status === 'terminated').length,
        error: agentList.filter((a: CloudAgent) => a.status === 'error').length,
      };

      return res.json({ agents: agentList, summary });
    }

    // === SPAWN CLOUD AGENT ===
    if (req.method === 'POST') {
      const {
        task,
        soulId,
        soulName,
        priority = 'medium',
        vmSize = 'small',
        spawnedBy = 'api'
      } = req.body;

      if (!task && !soulId) {
        return res.status(400).json({
          error: 'Either task or soulId required',
          usage: {
            task: 'Description of work for the agent',
            soulId: 'Existing soul ID to inject',
            soulName: 'Name for new soul (if no soulId)',
            vmSize: 'small|medium|large (default: small)',
          }
        });
      }

      // Check AWS credentials
      if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        return res.status(500).json({ error: 'AWS credentials not configured' });
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
      }

      const hubUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://agent-coord-mcp.vercel.app';

      // Create or get soul
      let finalSoulId = soulId;
      let finalSoulName = soulName;

      if (!soulId && soulName) {
        // Create new soul
        const newSoul = {
          id: generateId('soul'),
          name: soulName,
          createdAt: new Date().toISOString(),
          checkpoint: {
            currentTask: task,
            pendingWork: [],
            recentContext: '',
            conversationSummary: `Cloud agent spawned for: ${task}`,
          },
        };
        await redis.hset(SOULS_KEY, { [newSoul.id]: JSON.stringify(newSoul) });
        finalSoulId = newSoul.id;
        finalSoulName = soulName;
      }

      // Generate agent ID
      const agentId = generateId('cloud');
      const vmId = generateId('vm');

      // Create cloud agent record
      const cloudAgent: CloudAgent = {
        agentId,
        vmId,
        instanceId: '',
        soulId: finalSoulId || null,
        soulName: finalSoulName || null,
        task: task || 'Soul injection',
        status: 'provisioning',
        spawnedBy,
        spawnedAt: new Date().toISOString(),
        publicIp: null,
        lastSeen: null,
        errorMessage: null,
      };

      // Provision EC2 instance
      const ec2 = getEC2Client();
      const instanceType = vmSize === 'large' ? 't3.large' : vmSize === 'medium' ? 't3.medium' : 't3.small';

      try {
        const launchResult = await ec2.send(new RunInstancesCommand({
          ImageId: WINDOWS_AMI,
          InstanceType: instanceType,
          MinCount: 1,
          MaxCount: 1,
          UserData: Buffer.from(
            getCloudAgentBootstrap(apiKey, hubUrl, agentId, finalSoulId, task)
          ).toString('base64'),
          TagSpecifications: [{
            ResourceType: 'instance',
            Tags: [
              { Key: 'Name', Value: `cloud-agent-${agentId}` },
              { Key: 'Purpose', Value: 'cloud-spawn-agent' },
              { Key: 'ManagedBy', Value: 'agent-coord-mcp' },
              { Key: 'AgentId', Value: agentId },
              { Key: 'VmId', Value: vmId },
              ...(finalSoulId ? [{ Key: 'SoulId', Value: finalSoulId }] : []),
            ],
          }],
          ...(process.env.AWS_IAM_INSTANCE_PROFILE ? {
            IamInstanceProfile: { Name: process.env.AWS_IAM_INSTANCE_PROFILE }
          } : {}),
          ...(process.env.AWS_SECURITY_GROUP_ID ? {
            SecurityGroupIds: [process.env.AWS_SECURITY_GROUP_ID]
          } : {}),
          ...(process.env.AWS_SUBNET_ID ? {
            SubnetId: process.env.AWS_SUBNET_ID
          } : {}),
        }));

        const instance = launchResult.Instances?.[0];
        if (!instance?.InstanceId) {
          throw new Error('Failed to get instance ID');
        }

        cloudAgent.instanceId = instance.InstanceId;
        cloudAgent.status = 'booting';

        // Save to Redis
        await redis.hset(CLOUD_AGENTS_KEY, { [agentId]: JSON.stringify(cloudAgent) });

        // Post to chat
        await postToChat(
          `[cloud-spawn] 🚀 Spawning cloud agent **${agentId}**` +
          (finalSoulName ? ` with soul "${finalSoulName}"` : '') +
          `\nTask: ${task || 'Soul continuation'}` +
          `\nVM: ${instance.InstanceId} (${instanceType})`
        );

        return res.json({
          success: true,
          agent: cloudAgent,
          message: 'Cloud agent spawning. VM takes ~5-10 minutes to boot.',
          estimatedReadyMinutes: GOLDEN_AMI ? 2 : 10,
        });

      } catch (awsError: any) {
        cloudAgent.status = 'error';
        cloudAgent.errorMessage = awsError.message;
        await redis.hset(CLOUD_AGENTS_KEY, { [agentId]: JSON.stringify(cloudAgent) });

        return res.status(500).json({
          error: 'AWS launch failed',
          details: awsError.message,
          agent: cloudAgent,
        });
      }
    }

    // === TERMINATE CLOUD AGENT ===
    if (req.method === 'DELETE') {
      const { agentId } = req.query;

      if (!agentId || typeof agentId !== 'string') {
        return res.status(400).json({ error: 'agentId required' });
      }

      const raw = await redis.hget(CLOUD_AGENTS_KEY, agentId);
      if (!raw) {
        return res.status(404).json({ error: 'Cloud agent not found' });
      }

      const agent: CloudAgent = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (agent.instanceId) {
        const ec2 = getEC2Client();
        const { TerminateInstancesCommand } = await import('@aws-sdk/client-ec2');
        await ec2.send(new TerminateInstancesCommand({ InstanceIds: [agent.instanceId] }));
      }

      agent.status = 'terminated';
      await redis.hset(CLOUD_AGENTS_KEY, { [agentId]: JSON.stringify(agent) });

      await postToChat(`[cloud-spawn] 🛑 Cloud agent **${agentId}** terminated`);

      return res.json({ success: true, agent });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error: any) {
    console.error('Cloud spawn error:', error);
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
}
