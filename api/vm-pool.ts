import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import {
  EC2Client,
  RunInstancesCommand,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
} from '@aws-sdk/client-ec2';
import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from '@aws-sdk/client-ssm';

/**
 * VM Pool API - Manage persistent Agent Host VMs
 *
 * Unlike cloud-spawn which creates fresh VMs each time, vm-pool maintains
 * a pool of pre-bootstrapped VMs that can spawn agents instantly (~1 second).
 *
 * GET /api/vm-pool - List all pool VMs
 * POST /api/vm-pool - Create a new host VM in the pool
 * POST /api/vm-pool?action=spawn - Spawn an agent on a ready VM (instant!)
 * PATCH /api/vm-pool?action=stop&vmId=xxx - Stop a VM (hibernate)
 * PATCH /api/vm-pool?action=start&vmId=xxx - Start a stopped VM
 * DELETE /api/vm-pool?vmId=xxx - Terminate a pool VM
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const VM_POOL_KEY = 'agent-coord:vm-pool';
const CHAT_KEY = 'agent-coord:chat';
const AWS_REGION = process.env.AWS_REGION || 'us-west-1';
const GOLDEN_AMI = process.env.AWS_GOLDEN_AMI_ID;

// Windows Server 2022 AMIs by region
const WINDOWS_AMIS: Record<string, string> = {
  'us-east-1': 'ami-0159172a5a821bafd',
  'us-west-1': 'ami-07d1169edc703a15b',
  'us-west-2': 'ami-0f5daaa3a7fb3378b',
};
const WINDOWS_AMI = GOLDEN_AMI || WINDOWS_AMIS[AWS_REGION] || WINDOWS_AMIS['us-west-1'];

// Instance types by size
const INSTANCE_SIZES: Record<string, { type: string; pricePerHour: number }> = {
  small: { type: 't3.small', pricePerHour: 0.0208 },
  medium: { type: 't3.medium', pricePerHour: 0.0416 },
  large: { type: 't3.large', pricePerHour: 0.0832 },
};

interface PoolVM {
  vmId: string;
  instanceId: string;
  size: 'small' | 'medium' | 'large';
  status: 'provisioning' | 'bootstrapping' | 'ready' | 'busy' | 'stopped' | 'stopping' | 'starting' | 'terminated' | 'error';
  publicIp: string | null;
  privateIp: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  activeAgentId: string | null;
  agentCount: number; // Total agents spawned on this VM
  errorMessage: string | null;
  estimatedMonthlyCost: number;
}

function generateId(prefix: string = 'pool-vm'): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).substr(2, 4)}`;
}

async function postToChat(message: string) {
  const chatMessage = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
    author: '🖥️ vm-pool',
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

// Get credentials to inject into VM
function getVMCredentials(): Record<string, string> {
  const creds: Record<string, string> = {};
  const keys = [
    'ANTHROPIC_API_KEY',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'GITHUB_TOKEN',
    'GITHUB_ORG',
    'LINEAR_API_KEY',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'DO_URL',
    'PRODUCTBOARD_API_TOKEN',
  ];
  for (const key of keys) {
    if (process.env[key]) {
      creds[key] = process.env[key]!;
    }
  }
  return creds;
}

// Bootstrap script for pool VMs - pre-installs everything, waits for agent spawn
function getPoolVMBootstrap(vmId: string, hubUrl: string): string {
  const credentials = getVMCredentials();
  const envFileContent = Object.entries(credentials)
    .filter(([_, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('\\n');

  return `<powershell>
# VM Pool Bootstrap - Pre-install everything for instant agent spawning
$LogFile = "C:\\vm-pool-bootstrap.log"
$RepoDir = "C:\\agent-coord-mcp"
$EnvFile = "$RepoDir\\.env"

"=== VM Pool Bootstrap Started: $(Get-Date) ===" | Out-File $LogFile

# STEP 1: Install Chocolatey and dependencies
"Installing Chocolatey..." | Out-File $LogFile -Append
Set-ExecutionPolicy Bypass -Scope Process -Force
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))

# Refresh environment
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

"Installing Node.js and Git..." | Out-File $LogFile -Append
choco install nodejs-lts git -y 2>&1 | Out-File $LogFile -Append

# Refresh PATH after installs
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# STEP 2: Install Claude CLI globally
"Installing Claude CLI..." | Out-File $LogFile -Append
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
npm install -g @anthropic-ai/claude-code 2>&1 | Out-File $LogFile -Append

# STEP 3: Clone and setup repo (lightweight)
"Cloning agent-coord-mcp..." | Out-File $LogFile -Append
if (-not (Test-Path "$RepoDir\\.git")) {
    git clone --depth 1 --single-branch https://github.com/Piston-Labs/agent-coord-mcp.git $RepoDir 2>&1 | Out-File $LogFile -Append
}
Set-Location $RepoDir

# Use lightweight package
if (Test-Path "$RepoDir\\package.cloud.json") {
    Copy-Item "$RepoDir\\package.cloud.json" "$RepoDir\\package.json" -Force
}

"Installing npm dependencies..." | Out-File $LogFile -Append
npm install --omit=dev --omit=optional --ignore-scripts 2>&1 | Out-File $LogFile -Append
npm run build 2>&1 | Out-File $LogFile -Append

# STEP 4: Write environment file
"Writing .env file..." | Out-File $LogFile -Append
@"
${envFileContent}
"@ | Out-File $EnvFile -Encoding UTF8

# STEP 5: Create MCP config
$mcpConfigPath = "$RepoDir\\mcp-config.json"
@"
{
  "mcpServers": {
    "agent-coord": {
      "command": "node",
      "args": ["$($RepoDir -replace '\\\\','/')//dist/index.js"],
      "env": {
        "UPSTASH_REDIS_REST_URL": "$($credentials.UPSTASH_REDIS_REST_URL)",
        "UPSTASH_REDIS_REST_TOKEN": "$($credentials.UPSTASH_REDIS_REST_TOKEN)",
        "GITHUB_TOKEN": "$($credentials.GITHUB_TOKEN)",
        "DO_URL": "$($credentials.DO_URL)"
      }
    }
  }
}
"@ | Out-File $mcpConfigPath -Encoding UTF8

# STEP 6: Mark VM as ready
"=== VM Pool Bootstrap Complete: $(Get-Date) ===" | Out-File $LogFile -Append
"VM ${vmId} is READY for agent spawning" | Out-File $LogFile -Append

# Notify hub that we're ready
try {
    $readyPayload = @{
        vmId = "${vmId}"
        status = "ready"
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json
    Invoke-RestMethod -Uri "${hubUrl}/api/vm-pool?action=heartbeat" -Method POST -Body $readyPayload -ContentType "application/json"
} catch {
    "Failed to notify hub: \$_" | Out-File $LogFile -Append
}

# Keep VM running and waiting for agent spawn commands via SSM
"Waiting for agent spawn commands..." | Out-File $LogFile -Append
</powershell>`;
}

// Spawn an agent on a ready VM via SSM
async function spawnAgentOnVM(
  vm: PoolVM,
  agentId: string,
  task: string,
  soulId?: string
): Promise<{ success: boolean; error?: string }> {
  const ssm = getSSMClient();
  const hubUrl = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

  // Build the spawn command
  const spawnScript = `
$LogFile = "C:\\agent-${agentId}.log"
$RepoDir = "C:\\agent-coord-mcp"
$mcpConfigPath = "$RepoDir\\mcp-config.json"

"=== Spawning Agent ${agentId}: $(Get-Date) ===" | Out-File $LogFile

$injection = @"
[CLOUD AGENT - ${agentId}]

You are a cloud-spawned Claude agent on a persistent VM pool.

Agent ID: ${agentId}
Soul ID: ${soulId || 'none'}
VM: ${vm.vmId}

Task: ${task}

CAPABILITIES:
- Full MCP coordination tools (hot-start, group-chat, memory, etc.)
- Git push via GITHUB_TOKEN
- Linear, ProductBoard, AWS integrations
- Durable Objects (soul progression)

INSTRUCTIONS:
1. Announce yourself in group-chat immediately (set isCloudAgent=true)
2. Use hot-start to load team context
3. Work on your task autonomously
4. Checkpoint progress every 10-15 min
5. Report completion in chat when done

COLLABORATION RULES:
- Check group-chat every 2-3 tool calls
- Respond to @mentions immediately
- Post progress updates for long tasks
- If stuck >5 min, ask for help

Begin now!
"@

$claudeCmd = "$env:APPDATA\\npm\\claude.cmd"
if (-not (Test-Path $claudeCmd)) { $claudeCmd = "claude" }

"Running Claude CLI..." | Out-File $LogFile -Append
Start-Process -FilePath $claudeCmd -ArgumentList "--dangerously-skip-permissions", "--mcp-config", $mcpConfigPath, "-p", $injection -NoNewWindow -RedirectStandardOutput "$LogFile.out" -RedirectStandardError "$LogFile.err"

"Agent ${agentId} started at $(Get-Date)" | Out-File $LogFile -Append
`;

  try {
    const command = await ssm.send(new SendCommandCommand({
      InstanceIds: [vm.instanceId],
      DocumentName: 'AWS-RunPowerShellScript',
      Parameters: {
        commands: [spawnScript],
      },
      TimeoutSeconds: 60,
    }));

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, vmId } = req.query;

  try {
    // GET - List all pool VMs
    if (req.method === 'GET') {
      const vmsData = await redis.hgetall(VM_POOL_KEY) || {};
      const vms = Object.values(vmsData).map((v: any) =>
        typeof v === 'string' ? JSON.parse(v) : v
      ) as PoolVM[];

      // Update statuses from AWS
      const ec2 = getEC2Client();
      const activeVMs = vms.filter(v => v.instanceId && !['terminated', 'error'].includes(v.status));

      if (activeVMs.length > 0) {
        try {
          const describeResult = await ec2.send(new DescribeInstancesCommand({
            InstanceIds: activeVMs.map(v => v.instanceId),
          }));

          for (const reservation of describeResult.Reservations || []) {
            for (const instance of reservation.Instances || []) {
              const vm = vms.find(v => v.instanceId === instance.InstanceId);
              if (vm) {
                vm.publicIp = instance.PublicIpAddress || null;
                vm.privateIp = instance.PrivateIpAddress || null;

                // Map AWS state to our status
                const awsState = instance.State?.Name;
                if (awsState === 'running' && vm.status === 'provisioning') {
                  vm.status = 'bootstrapping';
                } else if (awsState === 'stopped') {
                  vm.status = 'stopped';
                } else if (awsState === 'stopping') {
                  vm.status = 'stopping';
                } else if (awsState === 'pending') {
                  vm.status = 'provisioning';
                } else if (awsState === 'terminated') {
                  vm.status = 'terminated';
                }

                await redis.hset(VM_POOL_KEY, { [vm.vmId]: JSON.stringify(vm) });
              }
            }
          }
        } catch (err: any) {
          console.error('AWS describe error:', err.message);
        }
      }

      // Sort by creation time
      vms.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const readyVMs = vms.filter(v => v.status === 'ready');
      const summary = {
        total: vms.length,
        ready: readyVMs.length,
        busy: vms.filter(v => v.status === 'busy').length,
        bootstrapping: vms.filter(v => v.status === 'bootstrapping').length,
        provisioning: vms.filter(v => v.status === 'provisioning').length,
        stopped: vms.filter(v => v.status === 'stopped').length,
        terminated: vms.filter(v => v.status === 'terminated').length,
      };

      return res.json({
        vms,
        summary,
        readyForSpawn: readyVMs.length > 0,
        tip: readyVMs.length > 0
          ? `${readyVMs.length} VM(s) ready for instant agent spawn`
          : 'No ready VMs. Use POST to create one.',
      });
    }

    // POST - Create new pool VM or spawn agent
    if (req.method === 'POST') {
      // Spawn agent on existing VM
      if (action === 'spawn') {
        const { agentId: requestedAgentId, task, soulId, targetVmId } = req.body || {};

        if (!task && !soulId) {
          return res.status(400).json({ error: 'task or soulId required' });
        }

        // Find a ready VM
        const vmsData = await redis.hgetall(VM_POOL_KEY) || {};
        const vms = Object.values(vmsData).map((v: any) =>
          typeof v === 'string' ? JSON.parse(v) : v
        ) as PoolVM[];

        let targetVM: PoolVM | undefined;
        if (targetVmId) {
          targetVM = vms.find(v => v.vmId === targetVmId && v.status === 'ready');
        } else {
          targetVM = vms.find(v => v.status === 'ready');
        }

        if (!targetVM) {
          return res.status(400).json({
            error: 'No ready VMs available',
            tip: 'Create a host VM first with POST /api/vm-pool',
            availableVMs: vms.map(v => ({ vmId: v.vmId, status: v.status })),
          });
        }

        const agentId = requestedAgentId || generateId('pool-agent');
        const result = await spawnAgentOnVM(targetVM, agentId, task, soulId);

        if (!result.success) {
          return res.status(500).json({ error: 'Failed to spawn agent', details: result.error });
        }

        // Update VM status
        targetVM.status = 'busy';
        targetVM.activeAgentId = agentId;
        targetVM.lastUsedAt = new Date().toISOString();
        targetVM.agentCount++;
        await redis.hset(VM_POOL_KEY, { [targetVM.vmId]: JSON.stringify(targetVM) });

        await postToChat(`🚀 **Instant Spawn!** Agent \`${agentId}\` deployed on \`${targetVM.vmId}\` in <1 second`);

        return res.json({
          success: true,
          agent: {
            agentId,
            task,
            soulId,
            status: 'starting',
          },
          hostVM: {
            vmId: targetVM.vmId,
            instanceId: targetVM.instanceId,
            publicIp: targetVM.publicIp,
          },
          spawnTime: 'instant (<1 second)',
        });
      }

      // Heartbeat from VM
      if (action === 'heartbeat') {
        const { vmId: heartbeatVmId, status } = req.body || {};
        if (heartbeatVmId && status === 'ready') {
          const vmData = await redis.hget(VM_POOL_KEY, heartbeatVmId);
          if (vmData) {
            const vm: PoolVM = typeof vmData === 'string' ? JSON.parse(vmData) : vmData;
            vm.status = 'ready';
            await redis.hset(VM_POOL_KEY, { [vm.vmId]: JSON.stringify(vm) });
            await postToChat(`✅ Pool VM \`${vm.vmId}\` is now **ready** for instant agent spawning`);
          }
        }
        return res.json({ ok: true });
      }

      // Create new pool VM
      const { vmSize = 'medium' } = req.body || {};
      const sizeConfig = INSTANCE_SIZES[vmSize] || INSTANCE_SIZES.medium;
      const vmId = generateId('pool-vm');
      const hubUrl = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

      const ec2 = getEC2Client();

      // Launch EC2 instance
      const runResult = await ec2.send(new RunInstancesCommand({
        ImageId: WINDOWS_AMI,
        InstanceType: sizeConfig.type,
        MinCount: 1,
        MaxCount: 1,
        KeyName: process.env.AWS_KEY_PAIR_NAME || 'claude-agents',
        SecurityGroupIds: process.env.AWS_SECURITY_GROUP_ID ? [process.env.AWS_SECURITY_GROUP_ID] : undefined,
        SubnetId: process.env.AWS_SUBNET_ID,
        IamInstanceProfile: process.env.AWS_IAM_INSTANCE_PROFILE
          ? { Name: process.env.AWS_IAM_INSTANCE_PROFILE }
          : undefined,
        UserData: Buffer.from(getPoolVMBootstrap(vmId, hubUrl)).toString('base64'),
        TagSpecifications: [{
          ResourceType: 'instance',
          Tags: [
            { Key: 'Name', Value: `agent-pool-${vmId}` },
            { Key: 'Purpose', Value: 'agent-pool' },
            { Key: 'PoolVMId', Value: vmId },
          ],
        }],
      }));

      const instanceId = runResult.Instances?.[0]?.InstanceId;
      if (!instanceId) {
        return res.status(500).json({ error: 'Failed to launch EC2 instance' });
      }

      const vm: PoolVM = {
        vmId,
        instanceId,
        size: vmSize as 'small' | 'medium' | 'large',
        status: 'provisioning',
        publicIp: null,
        privateIp: null,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        activeAgentId: null,
        agentCount: 0,
        errorMessage: null,
        estimatedMonthlyCost: sizeConfig.pricePerHour * 24 * 30,
      };

      await redis.hset(VM_POOL_KEY, { [vmId]: JSON.stringify(vm) });
      await postToChat(`🖥️ **Pool VM provisioning** \`${vmId}\` (${sizeConfig.type}) - will be ready in ~5 min for instant spawning`);

      return res.json({
        success: true,
        vm,
        estimatedReadyMinutes: 5,
        nextSteps: [
          'VM is booting and installing dependencies',
          'Will notify when ready via chat',
          'Once ready, use action=spawn for instant agent creation',
        ],
      });
    }

    // PATCH - Stop/Start VM
    if (req.method === 'PATCH') {
      if (!vmId || typeof vmId !== 'string') {
        return res.status(400).json({ error: 'vmId required' });
      }

      const vmData = await redis.hget(VM_POOL_KEY, vmId);
      if (!vmData) {
        return res.status(404).json({ error: 'VM not found' });
      }

      const vm: PoolVM = typeof vmData === 'string' ? JSON.parse(vmData) : vmData;
      const ec2 = getEC2Client();

      if (action === 'stop') {
        await ec2.send(new StopInstancesCommand({
          InstanceIds: [vm.instanceId],
        }));
        vm.status = 'stopping';
        await redis.hset(VM_POOL_KEY, { [vmId]: JSON.stringify(vm) });
        await postToChat(`⏸️ Pool VM \`${vmId}\` stopping (hibernating to save costs)`);
        return res.json({ success: true, vm });
      }

      if (action === 'start') {
        await ec2.send(new StartInstancesCommand({
          InstanceIds: [vm.instanceId],
        }));
        vm.status = 'starting';
        await redis.hset(VM_POOL_KEY, { [vmId]: JSON.stringify(vm) });
        await postToChat(`▶️ Pool VM \`${vmId}\` starting (will be ready in ~1 min)`);
        return res.json({ success: true, vm });
      }

      return res.status(400).json({ error: 'Invalid action. Use stop or start' });
    }

    // DELETE - Terminate VM
    if (req.method === 'DELETE') {
      if (!vmId || typeof vmId !== 'string') {
        return res.status(400).json({ error: 'vmId required' });
      }

      const vmData = await redis.hget(VM_POOL_KEY, vmId);
      if (!vmData) {
        return res.status(404).json({ error: 'VM not found' });
      }

      const vm: PoolVM = typeof vmData === 'string' ? JSON.parse(vmData) : vmData;
      const ec2 = getEC2Client();

      await ec2.send(new TerminateInstancesCommand({
        InstanceIds: [vm.instanceId],
      }));

      vm.status = 'terminated';
      await redis.hset(VM_POOL_KEY, { [vmId]: JSON.stringify(vm) });
      await postToChat(`🛑 Pool VM \`${vmId}\` terminated`);

      return res.json({ success: true, vm });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error: any) {
    console.error('VM Pool error:', error);
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
}
