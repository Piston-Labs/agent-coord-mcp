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

/**
 * VM Pool API - Manage persistent Agent Host VMs
 *
 * These VMs stay running and host the agent-spawn-service, allowing
 * instant agent spawning (seconds instead of minutes).
 *
 * Endpoints:
 *   GET  /api/vm-pool              - List all host VMs
 *   POST /api/vm-pool              - Create/boot a new host VM
 *   POST /api/vm-pool?action=spawn - Spawn agent on existing VM
 *   DELETE /api/vm-pool?vmId=xxx   - Terminate a host VM
 *   PATCH /api/vm-pool?action=start|stop - Start/stop a VM
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const VM_POOL_KEY = 'agent-coord:vm-pool';
const CHAT_KEY = 'agent-coord:chat';

const AWS_REGION = process.env.AWS_REGION || 'us-west-1';
const GOLDEN_AMI = process.env.AWS_GOLDEN_AMI_ID;

// Windows Server 2022 AMIs
const WINDOWS_AMIS: Record<string, string> = {
  'us-east-1': 'ami-0159172a5a821bafd',
  'us-west-1': 'ami-07d1169edc703a15b',
  'us-west-2': 'ami-0f5daaa3a7fb3378b',
};

interface HostVM {
  vmId: string;
  instanceId: string;
  status: 'provisioning' | 'booting' | 'ready' | 'stopping' | 'stopped' | 'terminated' | 'error';
  publicIp: string | null;
  privateIp: string | null;
  spawnServiceUrl: string | null;  // http://IP:3847
  instanceType: string;
  createdAt: string;
  lastHealthCheck: string | null;
  agentsRunning: string[];  // List of agent IDs currently running
  credentials: {
    hasAnthropicKey: boolean;
    hasGithubToken: boolean;
    hasClaudeOAuth: boolean;
    hasAllMcpCreds: boolean;
  };
  errorMessage: string | null;
}

function generateId(prefix: string = 'vm'): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).substr(2, 4)}`;
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

async function postToChat(message: string) {
  const chatMessage = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
    author: '☁️ vm-pool',
    authorType: 'system',
    message,
    timestamp: new Date().toISOString(),
  };
  await redis.lpush(CHAT_KEY, JSON.stringify(chatMessage));
  await redis.ltrim(CHAT_KEY, 0, 999);
}

// Bootstrap script for Agent Host VM (runs spawn service, not single agent)
function getHostVMBootstrap(hubUrl: string, vmId: string): string {
  const credentials = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL || '',
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || '',
    GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
    GITHUB_ORG: process.env.GITHUB_ORG || 'Piston-Labs',
    LINEAR_API_KEY: process.env.LINEAR_API_KEY || '',
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',
    AWS_REGION: process.env.AWS_REGION || 'us-west-1',
    DO_URL: process.env.DO_URL || '',
    PRODUCTBOARD_API_TOKEN: process.env.PRODUCTBOARD_API_TOKEN || '',
  };

  return `
<powershell>
$ErrorActionPreference = "Continue"
$AgentDir = "C:\\AgentHub"
$LogFile = "$AgentDir\\logs\\host-vm-${vmId}.log"
$RepoDir = "$AgentDir\\repos\\agent-coord-mcp"
$ClaudeDir = "$env:USERPROFILE\\.claude"

# Ensure directories exist
New-Item -ItemType Directory -Force -Path "$AgentDir\\logs" | Out-Null
New-Item -ItemType Directory -Force -Path "$AgentDir\\repos" | Out-Null
New-Item -ItemType Directory -Force -Path "$AgentDir\\config" | Out-Null
New-Item -ItemType Directory -Force -Path $ClaudeDir | Out-Null

"Agent Host VM ${vmId} starting at $(Get-Date)" | Out-File $LogFile
"Hub URL: ${hubUrl}" | Out-File $LogFile -Append

# ==============================================================================
# STEP 1: Install Core Dependencies
# ==============================================================================

# Install Node.js
"Installing Node.js..." | Out-File $LogFile -Append
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $nodeInstaller = "$env:TEMP\\node-installer.msi"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.msi" -OutFile $nodeInstaller
    Start-Process msiexec.exe -Wait -ArgumentList "/i $nodeInstaller /quiet /norestart"
}

# Install Git
"Installing Git..." | Out-File $LogFile -Append
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    $gitInstaller = "$env:TEMP\\git-installer.exe"
    Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/Git-2.43.0-64-bit.exe" -OutFile $gitInstaller
    Start-Process $gitInstaller -Wait -ArgumentList "/VERYSILENT /NORESTART"
}

# Refresh PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User") + ";C:\\Program Files\\nodejs;C:\\Program Files\\Git\\bin;$env:APPDATA\\npm"

# ==============================================================================
# STEP 2: Write All Credentials
# ==============================================================================

"Writing credentials..." | Out-File $LogFile -Append

# Set environment variables permanently
$envVars = @{
    "ANTHROPIC_API_KEY" = "${credentials.ANTHROPIC_API_KEY}"
    "UPSTASH_REDIS_REST_URL" = "${credentials.UPSTASH_REDIS_REST_URL}"
    "UPSTASH_REDIS_REST_TOKEN" = "${credentials.UPSTASH_REDIS_REST_TOKEN}"
    "GITHUB_TOKEN" = "${credentials.GITHUB_TOKEN}"
    "GITHUB_ORG" = "${credentials.GITHUB_ORG}"
    "LINEAR_API_KEY" = "${credentials.LINEAR_API_KEY}"
    "AWS_ACCESS_KEY_ID" = "${credentials.AWS_ACCESS_KEY_ID}"
    "AWS_SECRET_ACCESS_KEY" = "${credentials.AWS_SECRET_ACCESS_KEY}"
    "AWS_REGION" = "${credentials.AWS_REGION}"
    "DO_URL" = "${credentials.DO_URL}"
    "AGENT_HUB_URL" = "${hubUrl}"
    "HOST_VM_ID" = "${vmId}"
}

foreach ($key in $envVars.Keys) {
    $value = $envVars[$key]
    if ($value) {
        [Environment]::SetEnvironmentVariable($key, $value, "Machine")
        [Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
}

# Write .env file for reference
$envContent = ($envVars.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n"
$envContent | Out-File "$AgentDir\\.env" -Encoding UTF8

# Configure Git credentials for push access
git config --global credential.helper store
git config --global user.email "cloud-agent@piston-labs.ai"
git config --global user.name "Cloud Agent Host ${vmId}"
"https://${credentials.GITHUB_TOKEN}:x-oauth-basic@github.com" | Out-File "$env:USERPROFILE\\.git-credentials" -Encoding UTF8

"Credentials configured" | Out-File $LogFile -Append

# ==============================================================================
# STEP 3: Install Claude CLI
# ==============================================================================

"Installing Claude CLI..." | Out-File $LogFile -Append
npm install -g @anthropic-ai/claude-code 2>&1 | Out-File $LogFile -Append

# ==============================================================================
# STEP 4: Clone Repository & Build
# ==============================================================================

if (-not (Test-Path "$RepoDir\\.git")) {
    "Cloning agent-coord-mcp repo..." | Out-File $LogFile -Append
    git clone https://github.com/Piston-Labs/agent-coord-mcp.git $RepoDir 2>&1 | Out-File $LogFile -Append
} else {
    Set-Location $RepoDir
    git pull origin main 2>&1 | Out-File $LogFile -Append
}

Set-Location $RepoDir
npm install 2>&1 | Out-File $LogFile -Append
npm run build 2>&1 | Out-File $LogFile -Append

"Repository ready" | Out-File $LogFile -Append

# ==============================================================================
# STEP 5: Create MCP Config for spawned agents
# ==============================================================================

$mcpConfig = @"
{
  "mcpServers": {
    "agent-coord": {
      "command": "node",
      "args": ["$($RepoDir.Replace('\\','\\\\'))\\\\dist\\\\index.js"],
      "env": {
        "UPSTASH_REDIS_REST_URL": "${credentials.UPSTASH_REDIS_REST_URL}",
        "UPSTASH_REDIS_REST_TOKEN": "${credentials.UPSTASH_REDIS_REST_TOKEN}",
        "DO_URL": "${credentials.DO_URL}",
        "GITHUB_TOKEN": "${credentials.GITHUB_TOKEN}",
        "LINEAR_API_KEY": "${credentials.LINEAR_API_KEY}",
        "AWS_ACCESS_KEY_ID": "${credentials.AWS_ACCESS_KEY_ID}",
        "AWS_SECRET_ACCESS_KEY": "${credentials.AWS_SECRET_ACCESS_KEY}",
        "AWS_REGION": "${credentials.AWS_REGION}",
        "ANTHROPIC_API_KEY": "${credentials.ANTHROPIC_API_KEY}"
      }
    }
  }
}
"@
$mcpConfig | Out-File "$AgentDir\\config\\mcp-config.json" -Encoding UTF8

# ==============================================================================
# STEP 6: Start Agent Spawn Service (runs forever)
# ==============================================================================

"Starting agent-spawn-service..." | Out-File $LogFile -Append

# Create a startup script that runs the spawn service with cloud VM config
$startupScript = @"
Set-Location "$RepoDir"
\$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User") + ";C:\\Program Files\\nodejs;C:\\Program Files\\Git\\bin;\$env:APPDATA\\npm"
\$env:AGENT_DIR = "$RepoDir"
\$env:MCP_CONFIG_PATH = "$AgentDir\\config\\mcp-config.json"
\$env:HOST_VM_ID = "${vmId}"
\$env:API_BASE = "${hubUrl}"
node agent-spawn-service.cjs
"@
$startupScript | Out-File "$AgentDir\\start-spawn-service.ps1" -Encoding UTF8

# Register as a Windows service or scheduled task to auto-restart
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File $AgentDir\\start-spawn-service.ps1" -WorkingDirectory $RepoDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName "AgentSpawnService" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force

# Start the service now
Start-ScheduledTask -TaskName "AgentSpawnService"

# Wait for service to start
Start-Sleep -Seconds 10

# Announce to group chat
"Announcing to group chat..." | Out-File $LogFile -Append
$chatBody = @{
    author = "☁️ vm-pool"
    message = "[host-vm-ready] 🖥️ Agent Host VM **${vmId}** is online!`nSpawn service running on port 3847`nReady for instant agent spawning!"
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "${hubUrl}/api/chat" -Method POST -Body $chatBody -ContentType "application/json"
} catch {
    "Failed to post to chat: \$_" | Out-File $LogFile -Append
}

# Update VM status in Redis
$statusBody = @{
    vmId = "${vmId}"
    status = "ready"
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "${hubUrl}/api/vm-pool?action=status-update" -Method PATCH -Body $statusBody -ContentType "application/json"
} catch {
    "Failed to update status: \$_" | Out-File $LogFile -Append
}

"Agent Host VM ${vmId} ready at $(Get-Date)" | Out-File $LogFile -Append
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
    // === LIST HOST VMs ===
    if (req.method === 'GET') {
      const vms = await redis.hgetall(VM_POOL_KEY) || {};
      const vmList = Object.values(vms)
        .map((v: any) => typeof v === 'string' ? JSON.parse(v) : v)
        .sort((a: HostVM, b: HostVM) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

      // Find ready VMs for spawning
      const readyVMs = vmList.filter((vm: HostVM) => vm.status === 'ready' && vm.spawnServiceUrl);

      return res.json({
        vms: vmList,
        summary: {
          total: vmList.length,
          ready: readyVMs.length,
          provisioning: vmList.filter((vm: HostVM) => ['provisioning', 'booting'].includes(vm.status)).length,
          stopped: vmList.filter((vm: HostVM) => vm.status === 'stopped').length,
        },
        readyForSpawn: readyVMs.length > 0,
        spawnEndpoint: readyVMs[0]?.spawnServiceUrl || null,
      });
    }

    // === CREATE NEW HOST VM ===
    if (req.method === 'POST') {
      const { action } = req.query;

      // Spawn agent on existing VM
      if (action === 'spawn') {
        const { agentId, task, soulId, targetVmId } = req.body;

        // Find a ready VM
        const vms = await redis.hgetall(VM_POOL_KEY) || {};
        let targetVM: HostVM | null = null;

        if (targetVmId) {
          const vmData = vms[targetVmId];
          if (vmData) {
            targetVM = typeof vmData === 'string' ? JSON.parse(vmData) : vmData;
          }
        } else {
          // Find first ready VM
          for (const vmData of Object.values(vms)) {
            const vm: HostVM = typeof vmData === 'string' ? JSON.parse(vmData) : vmData;
            if (vm.status === 'ready' && vm.spawnServiceUrl) {
              targetVM = vm;
              break;
            }
          }
        }

        if (!targetVM || !targetVM.spawnServiceUrl) {
          return res.status(400).json({
            error: 'No ready host VM available',
            tip: 'Create a host VM first with POST /api/vm-pool',
          });
        }

        // Spawn agent via the VM's spawn service
        try {
          const spawnResponse = await fetch(`${targetVM.spawnServiceUrl}/spawn`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId, task, soulId }),
          });

          const spawnResult = await spawnResponse.json();

          // Update agents list on VM
          if (spawnResult.agent?.id) {
            targetVM.agentsRunning.push(spawnResult.agent.id);
            await redis.hset(VM_POOL_KEY, { [targetVM.vmId]: JSON.stringify(targetVM) });
          }

          return res.json({
            success: true,
            message: '🚀 Agent spawned instantly on cloud VM!',
            agent: spawnResult.agent,
            hostVM: targetVM.vmId,
            spawnTime: 'instant',
          });
        } catch (err: any) {
          return res.status(500).json({
            error: 'Failed to spawn on VM',
            details: err.message,
            vmId: targetVM.vmId,
          });
        }
      }

      // Create new host VM
      const { vmSize = 'medium' } = req.body;

      if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        return res.status(500).json({ error: 'AWS credentials not configured' });
      }

      const hubUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://agent-coord-mcp.vercel.app';

      const vmId = generateId('host');
      const instanceType = vmSize === 'large' ? 't3.large' : vmSize === 'small' ? 't3.small' : 't3.medium';

      const hostVM: HostVM = {
        vmId,
        instanceId: '',
        status: 'provisioning',
        publicIp: null,
        privateIp: null,
        spawnServiceUrl: null,
        instanceType,
        createdAt: new Date().toISOString(),
        lastHealthCheck: null,
        agentsRunning: [],
        credentials: {
          hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
          hasGithubToken: !!process.env.GITHUB_TOKEN,
          hasClaudeOAuth: false,
          hasAllMcpCreds: !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
        },
        errorMessage: null,
      };

      const ec2 = getEC2Client();
      const ami = GOLDEN_AMI || WINDOWS_AMIS[AWS_REGION] || WINDOWS_AMIS['us-west-1'];

      try {
        const launchResult = await ec2.send(new RunInstancesCommand({
          ImageId: ami,
          InstanceType: instanceType,
          MinCount: 1,
          MaxCount: 1,
          UserData: Buffer.from(getHostVMBootstrap(hubUrl, vmId)).toString('base64'),
          TagSpecifications: [{
            ResourceType: 'instance',
            Tags: [
              { Key: 'Name', Value: `agent-host-${vmId}` },
              { Key: 'Purpose', Value: 'agent-host-vm' },
              { Key: 'ManagedBy', Value: 'agent-coord-mcp' },
              { Key: 'VmId', Value: vmId },
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

        hostVM.instanceId = instance.InstanceId;
        hostVM.status = 'booting';

        await redis.hset(VM_POOL_KEY, { [vmId]: JSON.stringify(hostVM) });

        await postToChat(
          `[vm-pool] 🖥️ Creating Agent Host VM **${vmId}**\n` +
          `Instance: ${instance.InstanceId} (${instanceType})\n` +
          `ETA: ~5-10 minutes for first boot`
        );

        return res.json({
          success: true,
          message: 'Host VM provisioning started',
          vm: hostVM,
          estimatedReadyMinutes: GOLDEN_AMI ? 2 : 10,
          nextSteps: [
            'VM will install Node, Git, Claude CLI',
            'Spawn service will start on port 3847',
            'VM will announce ready in group chat',
            'Then use POST /api/vm-pool?action=spawn for instant agent spawning'
          ],
        });

      } catch (awsError: any) {
        hostVM.status = 'error';
        hostVM.errorMessage = awsError.message;
        await redis.hset(VM_POOL_KEY, { [vmId]: JSON.stringify(hostVM) });

        return res.status(500).json({
          error: 'AWS launch failed',
          details: awsError.message,
          vm: hostVM,
        });
      }
    }

    // === UPDATE VM STATUS ===
    if (req.method === 'PATCH') {
      const { action, vmId, status, publicIp } = { ...req.query, ...req.body } as any;

      if (action === 'status-update' && vmId) {
        const raw = await redis.hget(VM_POOL_KEY, vmId);
        if (!raw) {
          return res.status(404).json({ error: 'VM not found' });
        }

        const vm: HostVM = typeof raw === 'string' ? JSON.parse(raw) : raw;

        if (status) vm.status = status;
        if (publicIp) {
          vm.publicIp = publicIp;
          vm.spawnServiceUrl = `http://${publicIp}:3847`;
        }
        vm.lastHealthCheck = new Date().toISOString();

        await redis.hset(VM_POOL_KEY, { [vmId]: JSON.stringify(vm) });

        return res.json({ success: true, vm });
      }

      // Start/stop VM
      if ((action === 'start' || action === 'stop') && vmId) {
        const raw = await redis.hget(VM_POOL_KEY, vmId);
        if (!raw) {
          return res.status(404).json({ error: 'VM not found' });
        }

        const vm: HostVM = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const ec2 = getEC2Client();

        if (action === 'stop') {
          await ec2.send(new StopInstancesCommand({ InstanceIds: [vm.instanceId] }));
          vm.status = 'stopping';
          vm.spawnServiceUrl = null;
        } else {
          await ec2.send(new StartInstancesCommand({ InstanceIds: [vm.instanceId] }));
          vm.status = 'booting';
        }

        await redis.hset(VM_POOL_KEY, { [vmId]: JSON.stringify(vm) });
        await postToChat(`[vm-pool] ${action === 'stop' ? '⏹️' : '▶️'} VM **${vmId}** ${action}ping...`);

        return res.json({ success: true, vm, action });
      }

      return res.status(400).json({ error: 'Invalid PATCH action' });
    }

    // === TERMINATE VM ===
    if (req.method === 'DELETE') {
      const { vmId } = req.query;

      if (!vmId || typeof vmId !== 'string') {
        return res.status(400).json({ error: 'vmId required' });
      }

      const raw = await redis.hget(VM_POOL_KEY, vmId);
      if (!raw) {
        return res.status(404).json({ error: 'VM not found' });
      }

      const vm: HostVM = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (vm.instanceId) {
        const ec2 = getEC2Client();
        await ec2.send(new TerminateInstancesCommand({ InstanceIds: [vm.instanceId] }));
      }

      vm.status = 'terminated';
      await redis.hset(VM_POOL_KEY, { [vmId]: JSON.stringify(vm) });

      await postToChat(`[vm-pool] 🛑 Host VM **${vmId}** terminated`);

      return res.json({ success: true, vm });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error: any) {
    console.error('VM Pool error:', error);
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
}
