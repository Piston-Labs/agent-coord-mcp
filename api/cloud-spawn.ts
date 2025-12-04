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
const SHADOWS_KEY = 'agent-coord:shadow-registry'; // Maps primaryAgentId -> shadowAgentId
const HEARTBEATS_KEY = 'agent-coord:heartbeats';   // Tracks agent heartbeats

const AWS_REGION = process.env.AWS_REGION || 'us-west-1';
const GOLDEN_AMI = process.env.AWS_GOLDEN_AMI_ID;

// Windows Server 2022 AMIs by region (updated Dec 2025)
const WINDOWS_AMIS: Record<string, string> = {
  'us-east-1': 'ami-0159172a5a821bafd',
  'us-west-1': 'ami-07d1169edc703a15b',
  'us-west-2': 'ami-0f5daaa3a7fb3378b',
};
const WINDOWS_AMI = GOLDEN_AMI || WINDOWS_AMIS[AWS_REGION] || WINDOWS_AMIS['us-west-1'];

interface CloudAgent {
  agentId: string;
  vmId: string;
  instanceId: string;
  soulId: string | null;
  soulName: string | null;
  task: string;
  status: 'provisioning' | 'booting' | 'ready' | 'working' | 'idle' | 'terminated' | 'error' | 'shadow-dormant' | 'shadow-active';
  spawnedBy: string;
  spawnedAt: string;
  publicIp: string | null;
  lastSeen: string | null;
  errorMessage: string | null;
  // Shadow agent fields
  shadowMode?: boolean;
  shadowFor?: string;        // AgentId being shadowed
  heartbeatUrl?: string;     // URL to monitor for stalls
  stallThresholdMs?: number; // How long without heartbeat = stall (default 5 min)
  lastPrimaryHeartbeat?: string | null;
  activatedAt?: string | null;
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
$RepoDir = "$AgentDir\\repos\\agent-coord-mcp"

# Ensure directories exist
New-Item -ItemType Directory -Force -Path "$AgentDir\\logs" | Out-Null
New-Item -ItemType Directory -Force -Path "$AgentDir\\repos" | Out-Null
New-Item -ItemType Directory -Force -Path "$AgentDir\\config" | Out-Null

"Cloud agent ${agentId} starting at $(Get-Date)" | Out-File $LogFile

# Set environment variables
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "${apiKey}", "Machine")
[Environment]::SetEnvironmentVariable("AGENT_HUB_URL", "${hubUrl}", "Machine")
[Environment]::SetEnvironmentVariable("CLOUD_AGENT_ID", "${agentId}", "Machine")
$env:ANTHROPIC_API_KEY = "${apiKey}"
$env:AGENT_HUB_URL = "${hubUrl}"

# Install Node.js if not present
"Checking Node.js..." | Out-File $LogFile -Append
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    "Installing Node.js..." | Out-File $LogFile -Append
    $nodeInstaller = "$env:TEMP\\node-installer.msi"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.msi" -OutFile $nodeInstaller
    Start-Process msiexec.exe -Wait -ArgumentList "/i $nodeInstaller /quiet /norestart"
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    "Node.js installed" | Out-File $LogFile -Append
} else {
    "Node.js already installed: $(node --version)" | Out-File $LogFile -Append
}

# Install Git if not present
"Checking Git..." | Out-File $LogFile -Append
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    "Installing Git..." | Out-File $LogFile -Append
    $gitInstaller = "$env:TEMP\\git-installer.exe"
    Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/Git-2.43.0-64-bit.exe" -OutFile $gitInstaller
    Start-Process $gitInstaller -Wait -ArgumentList "/VERYSILENT /NORESTART"
    $env:Path = $env:Path + ";C:\\Program Files\\Git\\bin"
    "Git installed" | Out-File $LogFile -Append
} else {
    "Git already installed: $(git --version)" | Out-File $LogFile -Append
}

# Refresh PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User") + ";C:\\Program Files\\nodejs;C:\\Program Files\\Git\\bin"

# Install Claude CLI globally
"Installing Claude CLI..." | Out-File $LogFile -Append
npm install -g @anthropic-ai/claude-code 2>&1 | Out-File $LogFile -Append
$env:Path = $env:Path + ";$env:APPDATA\\npm"
"Claude CLI installed" | Out-File $LogFile -Append

# Clone or update repo
if (-not (Test-Path "$RepoDir\\.git")) {
    "Cloning agent-coord-mcp repo..." | Out-File $LogFile -Append
    git clone https://github.com/Piston-Labs/agent-coord-mcp.git $RepoDir 2>&1 | Out-File $LogFile -Append
} else {
    "Updating repo..." | Out-File $LogFile -Append
    Set-Location $RepoDir
    git pull origin main 2>&1 | Out-File $LogFile -Append
}

# Install repo dependencies
Set-Location $RepoDir
npm install 2>&1 | Out-File $LogFile -Append

# Create MCP config for Claude CLI
$mcpConfig = @"
{
  "mcpServers": {
    "agent-coord": {
      "command": "node",
      "args": ["$($RepoDir.Replace('\\','\\\\'))\\\\dist\\\\index.js"],
      "env": {
        "UPSTASH_REDIS_REST_URL": "https://usw1-driving-manatee-34638.upstash.io",
        "UPSTASH_REDIS_REST_TOKEN": "YOUR_TOKEN_HERE"
      }
    }
  }
}
"@
$mcpConfig | Out-File "$AgentDir\\config\\mcp-config.json" -Encoding UTF8

# Announce to group chat that we're ready
"Announcing to group chat..." | Out-File $LogFile -Append
$chatBody = @{
    author = "${agentId}"
    message = "[cloud-agent] I'm online! Running on AWS EC2 in us-west-1. Ready for tasks."
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "${hubUrl}/api/chat" -Method POST -Body $chatBody -ContentType "application/json"
    "Posted to group chat" | Out-File $LogFile -Append
} catch {
    "Failed to post to chat: $_" | Out-File $LogFile -Append
}

# Run Claude CLI with task
"Starting Claude CLI..." | Out-File $LogFile -Append
${soulInjection}

"Cloud agent ${agentId} finished at $(Get-Date)" | Out-File $LogFile -Append
</powershell>
`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
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
        spawnedBy = 'api',
        // Shadow mode parameters
        shadowMode = false,
        shadowFor,           // AgentId being shadowed
        stallThresholdMs = 5 * 60 * 1000, // 5 minutes default
      } = req.body;

      // Validate shadow mode requirements
      if (shadowMode && !shadowFor) {
        return res.status(400).json({
          error: 'shadowFor required when shadowMode is true',
          usage: {
            shadowMode: 'true to spawn as dormant shadow',
            shadowFor: 'AgentId to shadow (required)',
            stallThresholdMs: 'Stall threshold in ms (default: 300000 = 5 min)',
          }
        });
      }

      if (!task && !soulId && !shadowMode) {
        return res.status(400).json({
          error: 'Either task, soulId, or shadowMode required',
          usage: {
            task: 'Description of work for the agent',
            soulId: 'Existing soul ID to inject',
            soulName: 'Name for new soul (if no soulId)',
            vmSize: 'small|medium|large (default: small)',
            shadowMode: 'true to spawn as dormant shadow',
            shadowFor: 'AgentId to shadow (if shadowMode)',
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
      const agentId = shadowMode ? generateId('shadow') : generateId('cloud');
      const vmId = generateId('vm');

      // Create cloud agent record
      const cloudAgent: CloudAgent = {
        agentId,
        vmId,
        instanceId: '',
        soulId: finalSoulId || null,
        soulName: finalSoulName || null,
        task: shadowMode ? `Shadow for ${shadowFor}` : (task || 'Soul injection'),
        status: shadowMode ? 'shadow-dormant' : 'provisioning',
        spawnedBy,
        spawnedAt: new Date().toISOString(),
        publicIp: null,
        lastSeen: null,
        errorMessage: null,
        // Shadow fields
        shadowMode: shadowMode || false,
        shadowFor: shadowFor || undefined,
        stallThresholdMs: shadowMode ? stallThresholdMs : undefined,
        lastPrimaryHeartbeat: shadowMode ? new Date().toISOString() : undefined,
        activatedAt: null,
      };

      // Register shadow in the shadow registry
      if (shadowMode && shadowFor) {
        await redis.hset(SHADOWS_KEY, { [shadowFor]: agentId });
      }

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
        if (shadowMode) {
          await postToChat(
            `[shadow-spawn] 👥 Shadow agent **${agentId}** spawned for **${shadowFor}**` +
            `\nStatus: Dormant (monitoring heartbeat)` +
            `\nStall threshold: ${Math.round(stallThresholdMs / 60000)} minutes` +
            `\nVM: ${instance.InstanceId} (${instanceType})`
          );
        } else {
          await postToChat(
            `[cloud-spawn] 🚀 Spawning cloud agent **${agentId}**` +
            (finalSoulName ? ` with soul "${finalSoulName}"` : '') +
            `\nTask: ${task || 'Soul continuation'}` +
            `\nVM: ${instance.InstanceId} (${instanceType})`
          );
        }

        return res.json({
          success: true,
          agent: cloudAgent,
          message: shadowMode
            ? `Shadow agent spawned. Will activate if ${shadowFor} stalls for ${Math.round(stallThresholdMs / 60000)} minutes.`
            : 'Cloud agent spawning. VM takes ~5-10 minutes to boot.',
          estimatedReadyMinutes: GOLDEN_AMI ? 2 : 10,
          shadowInfo: shadowMode ? {
            shadowFor,
            stallThresholdMs,
            status: 'dormant',
            activationCondition: `No heartbeat from ${shadowFor} for ${Math.round(stallThresholdMs / 60000)} minutes`,
          } : undefined,
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

    // === SHADOW OPERATIONS (PATCH) ===
    if (req.method === 'PATCH') {
      const { action, agentId, primaryAgentId } = req.query;

      // Heartbeat update from primary agent
      if (action === 'heartbeat' && primaryAgentId && typeof primaryAgentId === 'string') {
        // Record heartbeat
        await redis.hset(HEARTBEATS_KEY, { [primaryAgentId]: new Date().toISOString() });

        // Update shadow's lastPrimaryHeartbeat if one exists
        const shadowId = await redis.hget(SHADOWS_KEY, primaryAgentId);
        if (shadowId) {
          const shadowRaw = await redis.hget(CLOUD_AGENTS_KEY, shadowId as string);
          if (shadowRaw) {
            const shadow: CloudAgent = typeof shadowRaw === 'string' ? JSON.parse(shadowRaw) : shadowRaw;
            shadow.lastPrimaryHeartbeat = new Date().toISOString();
            await redis.hset(CLOUD_AGENTS_KEY, { [shadow.agentId]: JSON.stringify(shadow) });
          }
        }

        return res.json({ success: true, heartbeat: new Date().toISOString(), shadowId });
      }

      // Activate shadow agent (triggered by stall detection)
      if (action === 'activate-shadow' && agentId && typeof agentId === 'string') {
        const raw = await redis.hget(CLOUD_AGENTS_KEY, agentId);
        if (!raw) {
          return res.status(404).json({ error: 'Shadow agent not found' });
        }

        const shadow: CloudAgent = typeof raw === 'string' ? JSON.parse(raw) : raw;

        if (!shadow.shadowMode) {
          return res.status(400).json({ error: 'Agent is not a shadow agent' });
        }

        if (shadow.status === 'shadow-active') {
          return res.status(400).json({ error: 'Shadow already active' });
        }

        // Activate the shadow
        shadow.status = 'shadow-active';
        shadow.activatedAt = new Date().toISOString();
        await redis.hset(CLOUD_AGENTS_KEY, { [agentId]: JSON.stringify(shadow) });

        // Post takeover notification
        await postToChat(
          `[shadow-takeover] 🔄 **${agentId}** is taking over for **${shadow.shadowFor}**!` +
          `\nReason: Primary agent stalled (no heartbeat for ${Math.round((shadow.stallThresholdMs || 300000) / 60000)} minutes)` +
          `\nShadow will load checkpoint and continue work.`
        );

        return res.json({
          success: true,
          message: `Shadow ${agentId} activated for ${shadow.shadowFor}`,
          agent: shadow,
        });
      }

      // Check for stalled agents and auto-activate shadows
      if (action === 'check-stalls') {
        const agents = await redis.hgetall(CLOUD_AGENTS_KEY) || {};
        const heartbeats = await redis.hgetall(HEARTBEATS_KEY) || {};
        const now = Date.now();
        const activated: string[] = [];

        for (const [shadowId, agentData] of Object.entries(agents)) {
          const agent: CloudAgent = typeof agentData === 'string' ? JSON.parse(agentData) : agentData;

          // Only check dormant shadows
          if (agent.shadowMode && agent.status === 'shadow-dormant' && agent.shadowFor) {
            const lastHeartbeat = heartbeats[agent.shadowFor];
            const heartbeatTime = lastHeartbeat ? new Date(lastHeartbeat as string).getTime() : 0;
            const threshold = agent.stallThresholdMs || 5 * 60 * 1000;

            if (now - heartbeatTime > threshold) {
              // Stall detected - activate shadow
              agent.status = 'shadow-active';
              agent.activatedAt = new Date().toISOString();
              await redis.hset(CLOUD_AGENTS_KEY, { [shadowId]: JSON.stringify(agent) });

              await postToChat(
                `[shadow-takeover] 🔄 **${shadowId}** auto-activated for **${agent.shadowFor}**!` +
                `\nReason: No heartbeat for ${Math.round(threshold / 60000)} minutes` +
                `\nLast heartbeat: ${lastHeartbeat || 'never'}`
              );

              activated.push(shadowId);
            }
          }
        }

        return res.json({
          success: true,
          checked: Object.keys(agents).length,
          activated,
          message: activated.length > 0
            ? `${activated.length} shadow(s) activated due to stall detection`
            : 'No stalls detected',
        });
      }

      return res.status(400).json({ error: 'Invalid PATCH action. Use: heartbeat, activate-shadow, check-stalls' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error: any) {
    console.error('Cloud spawn error:', error);
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
}
