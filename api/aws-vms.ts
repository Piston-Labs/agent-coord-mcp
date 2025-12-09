import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import {
  EC2Client,
  RunInstancesCommand,
  DescribeInstancesCommand,
  TerminateInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
} from '@aws-sdk/client-ec2';
import type { _InstanceType } from '@aws-sdk/client-ec2';
import {
  SSMClient,
  SendCommandCommand,
} from '@aws-sdk/client-ssm';

/**
 * AWS VM Management API
 *
 * Provisions and manages Windows EC2 instances for Claude agents.
 * Uses existing Piston Labs AWS credentials.
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const VMS_KEY = 'agent-coord:aws-vms';
const CHAT_KEY = 'agent-coord:chat';

// AWS Configuration
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Windows Server 2022 AMIs by region (updated Dec 2025)
// Use GOLDEN_AMI if set (pre-configured with Claude CLI), otherwise use base Windows
const GOLDEN_AMI = process.env.AWS_GOLDEN_AMI_ID;

// Windows Server 2022 AMIs by region (synced with cloud-spawn.ts)
const WINDOWS_AMIS: Record<string, string> = {
  'us-east-1': GOLDEN_AMI || 'ami-0159172a5a821bafd',
  'us-west-1': 'ami-07d1169edc703a15b',
  'us-west-2': 'ami-0f5daaa3a7fb3378b',
};

// Instance types with pricing (Windows, on-demand)
const INSTANCE_CONFIGS: Record<string, { type: _InstanceType; vcpu: number; memory: number; price: number; capacity: number }> = {
  small: { type: 't3.small', vcpu: 2, memory: 2, price: 0.035, capacity: 2 },
  medium: { type: 't3.medium', vcpu: 2, memory: 4, price: 0.070, capacity: 3 },
  large: { type: 't3.large', vcpu: 2, memory: 8, price: 0.138, capacity: 5 },
  xlarge: { type: 't3.xlarge', vcpu: 4, memory: 16, price: 0.276, capacity: 8 },
};

// Quick boot script for Golden AMI (everything pre-installed)
const getGoldenBootScript = (apiKey: string, hubUrl: string, soulId?: string, task?: string) => `
<powershell>
# Golden AMI Boot - just inject credentials and start
$AgentDir = "C:\\AgentHub"
$LogFile = "$AgentDir\\logs\\boot-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

"Boot started at $(Get-Date)" | Out-File $LogFile

# Inject API key
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "${apiKey}", "Machine")
[Environment]::SetEnvironmentVariable("AGENT_HUB_URL", "${hubUrl}", "Machine")
$env:ANTHROPIC_API_KEY = "${apiKey}"

# Pull latest code
Set-Location "$AgentDir\\repos\\agent-coord-mcp"
git pull origin main 2>&1 | Out-File $LogFile -Append

# Start agent with soul or task if provided
${soulId ? `
# Soul injection
$bundle = Invoke-RestMethod -Uri "${hubUrl}/api/souls?action=get-bundle&soulId=${soulId}"
$bundleJson = $bundle.bundle | ConvertTo-Json -Depth 10
$bundleJson | claude --dangerously-skip-permissions --mcp-config "$AgentDir\\config\\mcp-config.json" 2>&1 | Out-File $LogFile -Append
` : task ? `
# Task injection
"${task}" | claude --dangerously-skip-permissions --mcp-config "$AgentDir\\config\\mcp-config.json" 2>&1 | Out-File $LogFile -Append
` : `
# Start spawn service for on-demand agents
node agent-spawn-service-v2.cjs 2>&1 | Out-File $LogFile -Append
`}

"Boot complete at $(Get-Date)" | Out-File $LogFile -Append
"READY" | Out-File "$AgentDir\\ready.txt"
</powershell>
`;

// Full bootstrap script for base Windows (installs everything)
const getBootstrapScript = (apiKey: string, hubUrl: string, githubToken?: string) => `
<powershell>
# Enable TLS 1.2
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Create directories
$AgentDir = "C:\\AgentHub"
New-Item -ItemType Directory -Force -Path $AgentDir
New-Item -ItemType Directory -Force -Path "$AgentDir\\logs"
Set-Location $AgentDir

# Log start
$LogFile = "$AgentDir\\logs\\bootstrap-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
"Bootstrap started at $(Get-Date)" | Out-File $LogFile

# Install Chocolatey
"Installing Chocolatey..." | Out-File $LogFile -Append
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install Node.js and Git
"Installing Node.js and Git..." | Out-File $LogFile -Append
choco install nodejs-lts git -y

# Refresh PATH from registry (refreshenv doesn't work in UserData scripts)
$machinePath = [System.Environment]::GetEnvironmentVariable("Path","Machine")
$userPath = [System.Environment]::GetEnvironmentVariable("Path","User")
$nodePath = "C:\\Program Files\\nodejs"
$gitPath = "C:\\Program Files\\Git\\bin"
$env:Path = "$machinePath;$userPath;$nodePath;$gitPath"

# Configure npm for SYSTEM user context
# SYSTEM user has a different profile path than regular users
$npmGlobalDir = "C:\\AgentHub\\npm-global"
$npmCacheDir = "C:\\AgentHub\\npm-cache"
New-Item -ItemType Directory -Force -Path $npmGlobalDir | Out-Null
New-Item -ItemType Directory -Force -Path $npmCacheDir | Out-Null

# Set npm prefix and cache to our controlled directories
"Configuring npm for SYSTEM user..." | Out-File $LogFile -Append
npm config set prefix "$npmGlobalDir" 2>&1 | Out-File $LogFile -Append
npm config set cache "$npmCacheDir" 2>&1 | Out-File $LogFile -Append

# Add npm global bin to PATH for current session
$env:Path = "$env:Path;$npmGlobalDir"

# Install Claude Code CLI
"Installing Claude Code CLI..." | Out-File $LogFile -Append
npm install -g @anthropic-ai/claude-code 2>&1 | Out-File $LogFile -Append

# Verify Claude CLI is installed and add to PATH permanently
$claudePath = "$npmGlobalDir\\claude.cmd"
if (Test-Path $claudePath) {
    "Claude CLI installed successfully at $claudePath" | Out-File $LogFile -Append
} else {
    "WARNING: Claude CLI not found at $claudePath, checking alternate locations..." | Out-File $LogFile -Append
    # Try to find claude anywhere
    $found = Get-ChildItem -Path "C:\\" -Recurse -Filter "claude.cmd" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) {
        "Found claude at: $($found.FullName)" | Out-File $LogFile -Append
        $npmGlobalDir = $found.DirectoryName
    }
}

# Add npm global to Machine PATH permanently (for scheduled task and future sessions)
$currentPath = [System.Environment]::GetEnvironmentVariable("Path","Machine")
if ($currentPath -notlike "*$npmGlobalDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$npmGlobalDir", "Machine")
    "Added npm global dir to PATH permanently" | Out-File $LogFile -Append
}

# Clone repo
"Cloning agent-coord-mcp..." | Out-File $LogFile -Append
git clone https://github.com/Piston-Labs/agent-coord-mcp.git 2>&1 | Out-File $LogFile -Append
Set-Location agent-coord-mcp
npm install 2>&1 | Out-File $LogFile -Append

# Set environment variables
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "${apiKey}", "Machine")
[Environment]::SetEnvironmentVariable("AGENT_HUB_URL", "${hubUrl}", "Machine")
$env:ANTHROPIC_API_KEY = "${apiKey}"
$env:AGENT_HUB_URL = "${hubUrl}"
${githubToken ? `
[Environment]::SetEnvironmentVariable("GITHUB_TOKEN", "${githubToken}", "Machine")
$env:GITHUB_TOKEN = "${githubToken}"
# Configure git to use token for pushing
git config --global credential.helper store
"https://x-access-token:${githubToken}@github.com" | Out-File "$env:USERPROFILE\\.git-credentials" -Encoding UTF8
` : ''}

# Create startup script (using single quotes to avoid escaping issues)
$StartScript = @'
# Load environment variables
$env:ANTHROPIC_API_KEY = [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "Machine")
$env:GITHUB_TOKEN = [Environment]::GetEnvironmentVariable("GITHUB_TOKEN", "Machine")
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine")

# Navigate to repo
Set-Location C:\AgentHub\agent-coord-mcp

# Log startup
$logFile = "C:\AgentHub\logs\service-$(Get-Date -Format 'yyyyMMdd').log"
"Service starting at $(Get-Date)" | Out-File $logFile -Append

# Start spawn service
node agent-spawn-service-v2.cjs 2>&1 | Out-File $logFile -Append
'@
$StartScript | Out-File "$AgentDir\\start-service.ps1" -Encoding UTF8

# Create scheduled task to start on boot
$Action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-ExecutionPolicy Bypass -File C:\\AgentHub\\start-service.ps1"
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
Register-ScheduledTask -TaskName "AgentHubService" -Action $Action -Trigger $Trigger -Principal $Principal -Force

# Start the service now
"Starting agent service..." | Out-File $LogFile -Append
Start-Process PowerShell -ArgumentList "-ExecutionPolicy Bypass -File C:\\AgentHub\\start-service.ps1" -WindowStyle Hidden

# Signal completion
"Bootstrap complete at $(Get-Date)" | Out-File $LogFile -Append
"READY" | Out-File "$AgentDir\\ready.txt"
</powershell>
`;

interface AWSVM {
  vmId: string;  // Our internal ID
  instanceId: string;  // AWS instance ID
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

function generateId(): string {
  return 'vm-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

async function postToChat(message: string) {
  const chatMessage = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
    author: '☁️ aws-orchestrator',
    authorType: 'system',
    message,
    timestamp: new Date().toISOString(),
  };
  await redis.lpush(CHAT_KEY, JSON.stringify(chatMessage));
  await redis.ltrim(CHAT_KEY, 0, 999);
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

function getSSMClient(region: string) {
  return new SSMClient({
    region,
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  });
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
    // === PROVISION NEW VM ===
    if (action === 'provision' && req.method === 'POST') {
      const { size = 'medium', region = AWS_REGION, tags, soulId, task } = req.body;

      // Validate
      const config = INSTANCE_CONFIGS[size];
      if (!config) {
        return res.status(400).json({ error: `Invalid size. Use: ${Object.keys(INSTANCE_CONFIGS).join(', ')}` });
      }

      const ami = WINDOWS_AMIS[region];
      if (!ami) {
        return res.status(400).json({ error: `No AMI for region ${region}. Supported: ${Object.keys(WINDOWS_AMIS).join(', ')}` });
      }

      // Check API key
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
      }

      const hubUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://agent-coord-mcp.vercel.app';

      // Create VM record
      const vm: AWSVM = {
        vmId: generateId(),
        instanceId: '',
        region,
        size,
        status: 'provisioning',
        publicIp: null,
        privateIp: null,
        agentCapacity: config.capacity,
        activeAgents: [],
        pricePerHour: config.price,
        totalCost: 0,
        createdAt: new Date().toISOString(),
        readyAt: null,
        stoppedAt: null,
        lastHealthCheck: null,
        errorMessage: null,
      };

      // Launch EC2 instance
      const ec2 = getEC2Client(region);

      try {
        const launchResult = await ec2.send(new RunInstancesCommand({
          ImageId: ami,
          InstanceType: config.type,
          MinCount: 1,
          MaxCount: 1,
          UserData: Buffer.from(
            GOLDEN_AMI
              ? getGoldenBootScript(apiKey, hubUrl, soulId, task)
              : getBootstrapScript(apiKey, hubUrl, process.env.GITHUB_TOKEN)
          ).toString('base64'),
          TagSpecifications: [{
            ResourceType: 'instance',
            Tags: [
              { Key: 'Name', Value: `agent-hub-${vm.vmId}` },
              { Key: 'Purpose', Value: 'claude-agent-host' },
              { Key: 'ManagedBy', Value: 'agent-coord-mcp' },
              { Key: 'VmId', Value: vm.vmId },
              ...(tags ? Object.entries(tags).map(([k, v]) => ({ Key: k, Value: String(v) })) : []),
            ],
          }],
          // IAM role for SSM (if configured)
          ...(process.env.AWS_IAM_INSTANCE_PROFILE ? {
            IamInstanceProfile: { Name: process.env.AWS_IAM_INSTANCE_PROFILE }
          } : {}),
          // Security group (if configured)
          ...(process.env.AWS_SECURITY_GROUP_ID ? {
            SecurityGroupIds: [process.env.AWS_SECURITY_GROUP_ID]
          } : {}),
          // Subnet (if configured)
          ...(process.env.AWS_SUBNET_ID ? {
            SubnetId: process.env.AWS_SUBNET_ID
          } : {}),
        }));

        const instance = launchResult.Instances?.[0];
        if (!instance?.InstanceId) {
          throw new Error('Failed to get instance ID from launch result');
        }

        vm.instanceId = instance.InstanceId;
        vm.status = 'bootstrapping';

        await redis.hset(VMS_KEY, { [vm.vmId]: JSON.stringify(vm) });
        await postToChat(`[vm-launched] ☁️ New VM **${vm.vmId}** (${size}) launching in ${region}...`);

        return res.json({
          success: true,
          vm,
          message: 'VM launching. Bootstrap takes ~5-10 minutes. Poll status to check when ready.',
          estimatedReadyMinutes: 10,
        });

      } catch (awsError: any) {
        vm.status = 'error';
        vm.errorMessage = awsError.message;
        await redis.hset(VMS_KEY, { [vm.vmId]: JSON.stringify(vm) });

        return res.status(500).json({
          error: 'AWS launch failed',
          details: awsError.message,
          vm,
        });
      }
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

    // === GET VM STATUS ===
    if (action === 'status' && req.method === 'GET') {
      if (!vmId || typeof vmId !== 'string') {
        return res.status(400).json({ error: 'vmId required' });
      }

      const raw = await redis.hget(VMS_KEY, vmId);
      if (!raw) {
        return res.status(404).json({ error: 'VM not found' });
      }

      const vm: AWSVM = typeof raw === 'string' ? JSON.parse(raw) : raw;

      // Fetch latest from AWS
      if (vm.instanceId) {
        try {
          const ec2 = getEC2Client(vm.region);
          const describeResult = await ec2.send(new DescribeInstancesCommand({
            InstanceIds: [vm.instanceId],
          }));

          const instance = describeResult.Reservations?.[0]?.Instances?.[0];
          if (instance) {
            vm.publicIp = instance.PublicIpAddress || null;
            vm.privateIp = instance.PrivateIpAddress || null;

            const awsState = instance.State?.Name;
            if (awsState === 'running' && vm.status === 'bootstrapping') {
              // Check if bootstrap complete
              // (In production, would check via SSM)
              vm.status = 'ready';
              vm.readyAt = new Date().toISOString();
            } else if (awsState === 'stopped') {
              vm.status = 'stopped';
            } else if (awsState === 'terminated') {
              vm.status = 'terminated';
            }

            vm.lastHealthCheck = new Date().toISOString();
            await redis.hset(VMS_KEY, { [vmId]: JSON.stringify(vm) });
          }
        } catch (awsError: any) {
          // Non-fatal - return cached data
          console.error('AWS describe failed:', awsError.message);
        }
      }

      // Calculate current cost
      if (['running', 'ready', 'bootstrapping'].includes(vm.status)) {
        const hours = (Date.now() - new Date(vm.createdAt).getTime()) / 3600000;
        vm.totalCost = vm.pricePerHour * hours;
      }

      return res.json({ vm });
    }

    // === STOP VM ===
    if (action === 'stop' && req.method === 'POST') {
      if (!vmId || typeof vmId !== 'string') {
        return res.status(400).json({ error: 'vmId required' });
      }

      const raw = await redis.hget(VMS_KEY, vmId);
      if (!raw) {
        return res.status(404).json({ error: 'VM not found' });
      }

      const vm: AWSVM = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (vm.activeAgents.length > 0) {
        return res.status(400).json({
          error: 'Cannot stop VM with active agents',
          activeAgents: vm.activeAgents,
        });
      }

      const ec2 = getEC2Client(vm.region);
      await ec2.send(new StopInstancesCommand({ InstanceIds: [vm.instanceId] }));

      vm.status = 'stopping';
      await redis.hset(VMS_KEY, { [vmId]: JSON.stringify(vm) });
      await postToChat(`[vm-stopping] ☁️ VM **${vmId}** stopping...`);

      return res.json({ success: true, vm });
    }

    // === START VM ===
    if (action === 'start' && req.method === 'POST') {
      if (!vmId || typeof vmId !== 'string') {
        return res.status(400).json({ error: 'vmId required' });
      }

      const raw = await redis.hget(VMS_KEY, vmId);
      if (!raw) {
        return res.status(404).json({ error: 'VM not found' });
      }

      const vm: AWSVM = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (vm.status !== 'stopped') {
        return res.status(400).json({ error: 'VM is not stopped', currentStatus: vm.status });
      }

      const ec2 = getEC2Client(vm.region);
      await ec2.send(new StartInstancesCommand({ InstanceIds: [vm.instanceId] }));

      vm.status = 'running';
      vm.stoppedAt = null;
      await redis.hset(VMS_KEY, { [vmId]: JSON.stringify(vm) });
      await postToChat(`[vm-starting] ☁️ VM **${vmId}** starting...`);

      return res.json({ success: true, vm });
    }

    // === TERMINATE VM ===
    if (action === 'terminate' && req.method === 'DELETE') {
      if (!vmId || typeof vmId !== 'string') {
        return res.status(400).json({ error: 'vmId required' });
      }

      const raw = await redis.hget(VMS_KEY, vmId);
      if (!raw) {
        return res.status(404).json({ error: 'VM not found' });
      }

      const vm: AWSVM = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (vm.activeAgents.length > 0) {
        return res.status(400).json({
          error: 'Cannot terminate VM with active agents',
          activeAgents: vm.activeAgents,
        });
      }

      if (vm.instanceId) {
        const ec2 = getEC2Client(vm.region);
        await ec2.send(new TerminateInstancesCommand({ InstanceIds: [vm.instanceId] }));
      }

      vm.status = 'terminated';
      await redis.hset(VMS_KEY, { [vmId]: JSON.stringify(vm) });
      await postToChat(`[vm-terminated] ☁️ VM **${vmId}** terminated. Total cost: $${vm.totalCost.toFixed(2)}`);

      return res.json({ success: true, vm, finalCost: vm.totalCost });
    }

    // === SPAWN AGENT ON VM ===
    if (action === 'spawn-agent' && req.method === 'POST') {
      if (!vmId || typeof vmId !== 'string') {
        return res.status(400).json({ error: 'vmId required' });
      }

      const { soulId, task } = req.body;

      const raw = await redis.hget(VMS_KEY, vmId);
      if (!raw) {
        return res.status(404).json({ error: 'VM not found' });
      }

      const vm: AWSVM = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (vm.status !== 'ready' && vm.status !== 'running') {
        return res.status(400).json({ error: 'VM not ready', currentStatus: vm.status });
      }

      if (vm.activeAgents.length >= vm.agentCapacity) {
        return res.status(400).json({
          error: 'VM at capacity',
          current: vm.activeAgents.length,
          capacity: vm.agentCapacity,
        });
      }

      // Send command via SSM to spawn agent
      const ssm = getSSMClient(vm.region);
      const agentId = `agent-${Date.now().toString(36)}`;

      try {
        let spawnCommand = `
          Set-Location C:\\AgentHub\\agent-coord-mcp
          $env:ANTHROPIC_API_KEY = [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "Machine")
        `;

        if (soulId) {
          spawnCommand += `
            $response = Invoke-RestMethod -Uri "https://agent-coord-mcp.vercel.app/api/souls?action=get-bundle&soulId=${soulId}"
            $bundle = $response.bundle | ConvertTo-Json -Depth 10
            $bundle | claude --dangerously-skip-permissions --mcp-config mcp-config.json
          `;
        } else {
          spawnCommand += `
            Start-Process -FilePath "claude" -ArgumentList "--dangerously-skip-permissions","--mcp-config","mcp-config.json" -WindowStyle Hidden
          `;
        }

        await ssm.send(new SendCommandCommand({
          InstanceIds: [vm.instanceId],
          DocumentName: 'AWS-RunPowerShellScript',
          Parameters: { commands: [spawnCommand] },
        }));

        vm.activeAgents.push(agentId);
        await redis.hset(VMS_KEY, { [vmId]: JSON.stringify(vm) });
        await postToChat(`[agent-spawned] 🤖 Agent **${agentId}** spawned on VM ${vmId}${soulId ? ` with soul ${soulId}` : ''}`);

        return res.json({
          success: true,
          agentId,
          vmId,
          soulId: soulId || null,
        });

      } catch (ssmError: any) {
        return res.status(500).json({
          error: 'Failed to spawn agent via SSM',
          details: ssmError.message,
        });
      }
    }

    // === SOUL TRANSFER TO EXISTING VM ===
    if (action === 'transfer-soul' && req.method === 'POST') {
      if (!vmId || typeof vmId !== 'string') {
        return res.status(400).json({ error: 'vmId required' });
      }

      const { soulId, killExisting = false } = req.body;
      if (!soulId) {
        return res.status(400).json({ error: 'soulId required' });
      }

      const raw = await redis.hget(VMS_KEY, vmId);
      if (!raw) {
        return res.status(404).json({ error: 'VM not found' });
      }

      const vm: AWSVM = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (vm.status !== 'ready' && vm.status !== 'running') {
        return res.status(400).json({ error: 'VM not ready for soul transfer', currentStatus: vm.status });
      }

      const ssm = getSSMClient(vm.region);
      const newAgentId = `soul-${soulId.substring(0, 8)}-${Date.now().toString(36)}`;
      const hubUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://agent-coord-mcp.vercel.app';

      try {
        // Build transfer command
        let transferCommand = `
Set-Location C:\\AgentHub\\agent-coord-mcp
$env:ANTHROPIC_API_KEY = [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "Machine")
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine")
`;

        // Optionally kill existing Claude processes
        if (killExisting) {
          transferCommand += `
# Kill any existing claude processes
Get-Process -Name "claude*" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
`;
        }

        // Fetch and inject soul
        transferCommand += `
# Fetch soul bundle
$uri = "${hubUrl}/api/souls?action=get-bundle"
$uri = $uri + "&soulId=${soulId}"
$response = Invoke-RestMethod -Uri $uri -Method GET
$bundle = $response.bundle

# Create injection prompt
$injection = @"
[SOUL INJECTION - You are being restored from a checkpoint]

Identity: $($bundle.identity.name)
Soul ID: ${soulId}
Body ID: ${newAgentId}
VM: ${vmId}

Previous Context:
$($bundle.checkpoint.conversationSummary)

Current Task: $($bundle.checkpoint.currentTask)

Pending Work:
$($bundle.checkpoint.pendingWork -join "\`n")

Recent Context:
$($bundle.checkpoint.recentContext)

You have been transferred to a new body. Continue where you left off.
Announce your return in group chat and resume work.
"@

# Start Claude with soul injection
$injection | claude --dangerously-skip-permissions --mcp-config mcp-config.json
`;

        await ssm.send(new SendCommandCommand({
          InstanceIds: [vm.instanceId],
          DocumentName: 'AWS-RunPowerShellScript',
          Parameters: { commands: [transferCommand] },
          TimeoutSeconds: 300,
        }));

        // Update VM state
        vm.activeAgents.push(newAgentId);
        await redis.hset(VMS_KEY, { [vmId]: JSON.stringify(vm) });

        // Notify group chat
        await postToChat(`[soul-transfer] 🔄 Soul **${soulId}** transferred to VM ${vmId} as agent **${newAgentId}**${killExisting ? ' (killed existing agents)' : ''}`);

        return res.json({
          success: true,
          agentId: newAgentId,
          vmId,
          soulId,
          message: 'Soul transfer initiated. Agent should check in to group chat shortly.',
        });

      } catch (ssmError: any) {
        return res.status(500).json({
          error: 'Failed to transfer soul via SSM',
          details: ssmError.message,
        });
      }
    }

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

    return res.status(400).json({
      error: 'Invalid action',
      validActions: ['provision', 'list', 'status', 'stop', 'start', 'terminate', 'spawn-agent', 'transfer-soul', 'pricing'],
    });

  } catch (error: any) {
    console.error('AWS VMs API error:', error);
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
}
