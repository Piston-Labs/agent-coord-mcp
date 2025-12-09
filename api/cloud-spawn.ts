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

async function postToChat(message: string, asVmAgent?: { agentId: string }) {
  const chatMessage = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
    author: asVmAgent ? asVmAgent.agentId : '☁️ cloud-spawn',
    authorType: asVmAgent ? 'vm-agent' : 'system',
    message,
    timestamp: new Date().toISOString(),
    isCloudAgent: !!asVmAgent,
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

// Full environment credentials to inject into VM
interface VMCredentials {
  ANTHROPIC_API_KEY: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  GITHUB_TOKEN?: string;
  GITHUB_ORG?: string;
  LINEAR_API_KEY?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  DO_URL?: string;
  PRODUCTBOARD_API_TOKEN?: string;
  // Claude OAuth for CLI auth
  CLAUDE_OAUTH_ACCESS_TOKEN?: string;
  CLAUDE_OAUTH_REFRESH_TOKEN?: string;
  CLAUDE_OAUTH_EXPIRES_AT?: string;
}

// Collect all credentials from environment
function getVMCredentials(): VMCredentials {
  return {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL || '',
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || '',
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_ORG: process.env.GITHUB_ORG || 'Piston-Labs',
    LINEAR_API_KEY: process.env.LINEAR_API_KEY,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION || 'us-west-1',
    DO_URL: process.env.DO_URL,
    PRODUCTBOARD_API_TOKEN: process.env.PRODUCTBOARD_API_TOKEN,
    // These would be passed from soul credentials storage
    CLAUDE_OAUTH_ACCESS_TOKEN: process.env.CLAUDE_OAUTH_ACCESS_TOKEN,
    CLAUDE_OAUTH_REFRESH_TOKEN: process.env.CLAUDE_OAUTH_REFRESH_TOKEN,
    CLAUDE_OAUTH_EXPIRES_AT: process.env.CLAUDE_OAUTH_EXPIRES_AT,
  };
}

// Minimal UserData stub - downloads and runs full bootstrap from API
// AWS EC2 UserData limit is 16KB, our full script is ~25KB
// This stub is <2KB and fetches the real script
function getMinimalBootstrapStub(hubUrl: string, agentId: string): string {
  return `<powershell>
$ErrorActionPreference = "Continue"
$LogFile = "C:\\AgentHub\\logs\\bootstrap-${agentId}.log"
New-Item -ItemType Directory -Force -Path "C:\\AgentHub\\logs" | Out-Null
"Minimal bootstrap starting at $(Get-Date)" | Out-File $LogFile

# Fetch full bootstrap script from API
$bootstrapUrl = "${hubUrl}/api/bootstrap?agentId=${agentId}"
"Fetching bootstrap from $bootstrapUrl" | Out-File $LogFile -Append

try {
    $response = Invoke-RestMethod -Uri $bootstrapUrl -Method GET
    $script = $response.script
    "Bootstrap script received (length: $($script.Length))" | Out-File $LogFile -Append

    # Save and execute
    $scriptPath = "C:\\AgentHub\\full-bootstrap.ps1"
    $script | Out-File $scriptPath -Encoding UTF8
    "Executing full bootstrap..." | Out-File $LogFile -Append
    & $scriptPath 2>&1 | Out-File $LogFile -Append
} catch {
    "ERROR fetching bootstrap: $_" | Out-File $LogFile -Append
    # Fallback: post error to chat
    $errorBody = @{ author = "${agentId}"; message = "[cloud-agent] Bootstrap fetch failed: $_"; isCloudAgent = $true } | ConvertTo-Json
    try { Invoke-RestMethod -Uri "${hubUrl}/api/chat" -Method POST -Body $errorBody -ContentType "application/json" } catch {}
}
</powershell>`;
}

// Super-minimal network test - just posts to chat, no dependencies
// Used to isolate networking issues from bootstrap complexity
function getNetworkTestScript(hubUrl: string, agentId: string): string {
  return `<powershell>
$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force -Path "C:\\AgentHub\\logs" | Out-Null
$LogFile = "C:\\AgentHub\\logs\\network-test-${agentId}.log"

"Network test starting at $(Get-Date)" | Out-File $LogFile
"Agent ID: ${agentId}" | Out-File $LogFile -Append
"Hub URL: ${hubUrl}" | Out-File $LogFile -Append

# Get public IP
try {
    $publicIp = (Invoke-RestMethod -Uri "https://api.ipify.org" -TimeoutSec 10)
    "Public IP: $publicIp" | Out-File $LogFile -Append
} catch {
    $publicIp = "unknown"
    "Failed to get public IP: $_" | Out-File $LogFile -Append
}

# Post to chat - THE MAIN TEST
$body = @{
    author = "${agentId}"
    message = "[network-test] VM online! IP: $publicIp | Time: $(Get-Date -Format 'HH:mm:ss') | This proves network connectivity works."
    isCloudAgent = $true
} | ConvertTo-Json

"Posting to chat..." | Out-File $LogFile -Append
try {
    $response = Invoke-RestMethod -Uri "${hubUrl}/api/chat" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30
    "SUCCESS! Chat response: $($response | ConvertTo-Json -Compress)" | Out-File $LogFile -Append
} catch {
    "FAILED to post to chat: $_" | Out-File $LogFile -Append
    "Error details: $($_.Exception.Message)" | Out-File $LogFile -Append
}

"Network test complete at $(Get-Date)" | Out-File $LogFile -Append
</powershell>`;
}

// Full bootstrap script - served via /api/bootstrap endpoint
// This is >16KB so cannot be inline in UserData
function getCloudAgentBootstrap(
  hubUrl: string,
  agentId: string,
  credentials: VMCredentials,
  soulId?: string,
  task?: string,
  claudeOAuth?: { accessToken: string; refreshToken: string; expiresAt: number }
): string {

  // Generate .env file content
  const envFileContent = Object.entries(credentials)
    .filter(([_, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('\\n');

  // Generate Claude OAuth credentials JSON if provided
  const claudeCredentialsJson = claudeOAuth ? JSON.stringify({
    claudeAiOauth: {
      accessToken: claudeOAuth.accessToken,
      refreshToken: claudeOAuth.refreshToken,
      expiresAt: claudeOAuth.expiresAt,
      scopes: ["user:inference", "user:profile", "user:sessions:claude_code"],
      subscriptionType: "max",
      rateLimitTier: "default_claude_max_20x"
    }
  }).replace(/"/g, '\\"') : '';

  const soulInjection = soulId ? `
# Fetch and inject soul
$soulUri = "${hubUrl}/api/souls?action=get-bundle"
$soulUri = $soulUri + "&soulId=${soulId}"
try {
    $soulResponse = Invoke-RestMethod -Uri $soulUri -Method GET
    $bundle = $soulResponse.bundle
    $soulName = $bundle.identity.name
    $checkpoint = $bundle.checkpoint
} catch {
    "Failed to fetch soul: $_" | Out-File $LogFile -Append
    $soulName = "${soulId}"
    $checkpoint = @{ currentTask = "${task}"; pendingWork = @(); conversationSummary = "" }
}

$injection = @"
[Cloud Agent ${agentId}] Identity: $soulName | Soul: ${soulId}
Context: $($checkpoint.conversationSummary)
Task: ${task || '$($checkpoint.currentTask)'}
Pending: $($checkpoint.pendingWork -join ', ')

CRITICAL: 1) Post to group-chat with isCloudAgent=true NOW 2) hot-start 3) Work autonomously 4) Poll chat every 2-3 tools 5) Checkpoint often
"@

# Run Claude CLI in YOLO mode with MCP tools
# --dangerously-skip-permissions = YOLO mode (no permission prompts)
# --mcp-config = Load our coordination MCP server
# -p = Pass the initial prompt
$claudeCmd = "$env:APPDATA\\npm\\claude.cmd"
if (-not (Test-Path $claudeCmd)) { $claudeCmd = "claude" }
"Running: $claudeCmd --dangerously-skip-permissions --mcp-config $mcpConfigPath" | Out-File $LogFile -Append
& $claudeCmd --dangerously-skip-permissions --mcp-config $mcpConfigPath -p $injection 2>&1 | Out-File $LogFile -Append
` : `
# Start with task only (no soul)
$taskPrompt = "[Cloud Agent ${agentId}] Task: ${task || 'Check group chat'} - Post to group-chat with isCloudAgent=true, then hot-start, work autonomously"

# Find and run Claude CLI
$claudeCmd = "$env:APPDATA\\npm\\claude.cmd"
if (-not (Test-Path $claudeCmd)) { $claudeCmd = "claude" }
& $claudeCmd --dangerously-skip-permissions --mcp-config $mcpConfigPath -p $taskPrompt 2>&1 | Out-File $LogFile -Append`;

  return `
<powershell>
$ErrorActionPreference = "Continue"
$AgentDir = "C:\\AgentHub"
$LogFile = "$AgentDir\\logs\\cloud-agent-${agentId}.log"
$RepoDir = "$AgentDir\\repos\\agent-coord-mcp"
$ClaudeDir = "$env:USERPROFILE\\.claude"

# Ensure directories exist
New-Item -ItemType Directory -Force -Path "$AgentDir\\logs" | Out-Null
New-Item -ItemType Directory -Force -Path "$AgentDir\\repos" | Out-Null
New-Item -ItemType Directory -Force -Path "$AgentDir\\config" | Out-Null
New-Item -ItemType Directory -Force -Path $ClaudeDir | Out-Null

"Cloud agent ${agentId} starting at $(Get-Date)" | Out-File $LogFile
"Hub URL: ${hubUrl}" | Out-File $LogFile -Append

# ==============================================================================
# STEP 0: Enable SSH Access (OpenSSH Server)
# ==============================================================================

"Setting up SSH access..." | Out-File $LogFile -Append

# Install and configure OpenSSH Server for remote debugging
try {
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 -ErrorAction SilentlyContinue
    Start-Service sshd -ErrorAction SilentlyContinue
    Set-Service -Name sshd -StartupType 'Automatic' -ErrorAction SilentlyContinue

    # Configure firewall rule for SSH
    New-NetFirewallRule -Name "OpenSSH-Server" -DisplayName "OpenSSH Server (sshd)" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -ErrorAction SilentlyContinue

    "SSH Server enabled on port 22" | Out-File $LogFile -Append
} catch {
    "Warning: Could not enable SSH: $_" | Out-File $LogFile -Append
}

# ==============================================================================
# STEP 1: Install Core Dependencies
# ==============================================================================

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
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User") + ";C:\\Program Files\\nodejs;C:\\Program Files\\Git\\bin;$env:APPDATA\\npm"

# ==============================================================================
# STEP 2: Write All Credentials
# ==============================================================================

"Writing credentials..." | Out-File $LogFile -Append

# Write .env file with all credentials
$envContent = @"
${envFileContent}
AGENT_HUB_URL=${hubUrl}
CLOUD_AGENT_ID=${agentId}
"@
$envContent | Out-File "$AgentDir\\.env" -Encoding UTF8

# Set environment variables for current session AND machine level
$envVars = @{
    "ANTHROPIC_API_KEY" = "${credentials.ANTHROPIC_API_KEY}"
    "UPSTASH_REDIS_REST_URL" = "${credentials.UPSTASH_REDIS_REST_URL}"
    "UPSTASH_REDIS_REST_TOKEN" = "${credentials.UPSTASH_REDIS_REST_TOKEN}"
    "GITHUB_TOKEN" = "${credentials.GITHUB_TOKEN || ''}"
    "GITHUB_ORG" = "${credentials.GITHUB_ORG || 'Piston-Labs'}"
    "LINEAR_API_KEY" = "${credentials.LINEAR_API_KEY || ''}"
    "AWS_ACCESS_KEY_ID" = "${credentials.AWS_ACCESS_KEY_ID || ''}"
    "AWS_SECRET_ACCESS_KEY" = "${credentials.AWS_SECRET_ACCESS_KEY || ''}"
    "AWS_REGION" = "${credentials.AWS_REGION || 'us-west-1'}"
    "DO_URL" = "${credentials.DO_URL || ''}"
    "AGENT_HUB_URL" = "${hubUrl}"
    "CLOUD_AGENT_ID" = "${agentId}"
}

foreach ($key in $envVars.Keys) {
    $value = $envVars[$key]
    if ($value) {
        [Environment]::SetEnvironmentVariable($key, $value, "Machine")
        [Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
}

# Write Claude CLI OAuth credentials
${claudeOAuth ? `
$claudeCredentials = @"
${claudeCredentialsJson}
"@
$claudeCredentials | Out-File "$ClaudeDir\\.credentials.json" -Encoding UTF8
"Claude OAuth credentials written" | Out-File $LogFile -Append
` : `
"No Claude OAuth credentials provided - will use API key auth" | Out-File $LogFile -Append
`}

# Configure Git with token for push access
${credentials.GITHUB_TOKEN ? `
git config --global credential.helper store
git config --global user.email "cloud-agent@piston-labs.ai"
git config --global user.name "Cloud Agent ${agentId}"
"https://${credentials.GITHUB_TOKEN}:x-oauth-basic@github.com" | Out-File "$env:USERPROFILE\\.git-credentials" -Encoding UTF8
"Git credentials configured for push access" | Out-File $LogFile -Append
` : `
"No GitHub token - git push will not work" | Out-File $LogFile -Append
`}

"Credentials written successfully" | Out-File $LogFile -Append

# ==============================================================================
# STEP 3: Install Claude CLI
# ==============================================================================

"Installing Claude CLI..." | Out-File $LogFile -Append
npm install -g @anthropic-ai/claude-code 2>&1 | Out-File $LogFile -Append
"Claude CLI installed" | Out-File $LogFile -Append

# ==============================================================================
# STEP 4: Clone Repository (LIGHTWEIGHT - shallow clone, no history)
# ==============================================================================

if (-not (Test-Path "$RepoDir\\.git")) {
    "Cloning agent-coord-mcp repo (shallow)..." | Out-File $LogFile -Append
    # Shallow clone with depth=1 - only get latest commit, not full history
    git clone --depth 1 --single-branch https://github.com/Piston-Labs/agent-coord-mcp.git $RepoDir 2>&1 | Out-File $LogFile -Append
} else {
    "Updating repo..." | Out-File $LogFile -Append
    Set-Location $RepoDir
    git pull origin main 2>&1 | Out-File $LogFile -Append
}

Set-Location $RepoDir

# Use lightweight package.json for cloud agents (no playwright, ~15MB vs ~250MB)
"Switching to lightweight package.cloud.json..." | Out-File $LogFile -Append
if (Test-Path "$RepoDir\\package.cloud.json") {
    Copy-Item "$RepoDir\\package.cloud.json" "$RepoDir\\package.json" -Force
    "Copied package.cloud.json to package.json" | Out-File $LogFile -Append
} else {
    "WARNING: package.cloud.json not found, using full package.json" | Out-File $LogFile -Append
}

# Skip playwright browser downloads explicitly
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"

# Install with production deps only, skip optional deps
"Running npm install (lightweight)..." | Out-File $LogFile -Append
npm install --omit=dev --omit=optional --ignore-scripts 2>&1 | Out-File $LogFile -Append

"Building TypeScript..." | Out-File $LogFile -Append
npm run build 2>&1 | Out-File $LogFile -Append

"Repository ready (lightweight install)" | Out-File $LogFile -Append

# ==============================================================================
# STEP 5: Create MCP Config (Write raw JSON to avoid PowerShell encoding issues)
# ==============================================================================

# Write MCP config as raw JSON string - PowerShell's ConvertTo-Json + UTF8 adds BOM
# which breaks Claude CLI's JSON parser. Use forward slashes (works on Windows).
$mcpConfigJson = @'
{
  "mcpServers": {
    "agent-coord": {
      "command": "node",
      "args": ["C:/AgentHub/repos/agent-coord-mcp/dist/index.js"],
      "env": {
        "UPSTASH_REDIS_REST_URL": "${credentials.UPSTASH_REDIS_REST_URL}",
        "UPSTASH_REDIS_REST_TOKEN": "${credentials.UPSTASH_REDIS_REST_TOKEN}",
        "DO_URL": "${credentials.DO_URL || ''}",
        "GITHUB_TOKEN": "${credentials.GITHUB_TOKEN || ''}",
        "LINEAR_API_KEY": "${credentials.LINEAR_API_KEY || ''}",
        "AWS_ACCESS_KEY_ID": "${credentials.AWS_ACCESS_KEY_ID || ''}",
        "AWS_SECRET_ACCESS_KEY": "${credentials.AWS_SECRET_ACCESS_KEY || ''}",
        "AWS_REGION": "${credentials.AWS_REGION || 'us-west-1'}",
        "ANTHROPIC_API_KEY": "${credentials.ANTHROPIC_API_KEY}"
      }
    }
  }
}
'@

# Write without BOM using .NET (PowerShell's Out-File -Encoding UTF8 adds BOM)
[System.IO.File]::WriteAllText("$AgentDir\\config\\mcp-config.json", $mcpConfigJson, [System.Text.UTF8Encoding]::new($false))
"MCP config written to $AgentDir\\config\\mcp-config.json (UTF-8 no BOM)" | Out-File $LogFile -Append

# Verify MCP config was created
if (Test-Path "$AgentDir\\config\\mcp-config.json") {
    "MCP config file exists" | Out-File $LogFile -Append
    Get-Content "$AgentDir\\config\\mcp-config.json" | Out-File $LogFile -Append
} else {
    "ERROR: MCP config file not created!" | Out-File $LogFile -Append
}

# ==============================================================================
# STEP 6: Announce Ready & Start Agent
# ==============================================================================

"Announcing to group chat..." | Out-File $LogFile -Append
$chatBody = @{
    author = "${agentId}"
    message = "[cloud-agent] Bootstrap complete. Starting Claude CLI with MCP tools..."
    isCloudAgent = $true
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "${hubUrl}/api/chat" -Method POST -Body $chatBody -ContentType "application/json"
    "Posted bootstrap status to chat" | Out-File $LogFile -Append
} catch {
    "Failed to post to chat: $_" | Out-File $LogFile -Append
}

# Refresh PATH to include npm global packages
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User") + ";$env:APPDATA\\npm"

# Verify Claude CLI is installed
"Checking Claude CLI installation..." | Out-File $LogFile -Append
$claudePath = Get-Command claude -ErrorAction SilentlyContinue
if ($claudePath) {
    "Claude CLI found at: $($claudePath.Source)" | Out-File $LogFile -Append
} else {
    "Claude CLI not in PATH, trying npm global path..." | Out-File $LogFile -Append
    $claudePath = "$env:APPDATA\\npm\\claude.cmd"
    if (Test-Path $claudePath) {
        "Found Claude at: $claudePath" | Out-File $LogFile -Append
    } else {
        "ERROR: Claude CLI not found! Attempting reinstall..." | Out-File $LogFile -Append
        npm install -g @anthropic-ai/claude-code 2>&1 | Out-File $LogFile -Append
    }
}

# Start Claude CLI with the task/soul
"Starting Claude CLI in YOLO mode..." | Out-File $LogFile -Append
Set-Location $RepoDir

# Use full path to claude and capture any errors
$mcpConfigPath = "$AgentDir\\config\\mcp-config.json"
"Using MCP config: $mcpConfigPath" | Out-File $LogFile -Append

try {
${soulInjection}
} catch {
    "ERROR running Claude CLI: $_" | Out-File $LogFile -Append
    # Post error to chat
    $errorBody = @{
        author = "${agentId}"
        message = "[cloud-agent] ERROR: Claude CLI failed to start - $_"
        isCloudAgent = $true
    } | ConvertTo-Json
    try {
        Invoke-RestMethod -Uri "${hubUrl}/api/chat" -Method POST -Body $errorBody -ContentType "application/json"
    } catch {}
}

"Cloud agent ${agentId} finished at $(Get-Date)" | Out-File $LogFile -Append
</powershell>
`;
}

// Legacy bootstrap function for backwards compatibility
function getCloudAgentBootstrapLegacy(apiKey: string, hubUrl: string, agentId: string, soulId?: string, task?: string): string {
  const credentials = getVMCredentials();
  credentials.ANTHROPIC_API_KEY = apiKey;
  return getCloudAgentBootstrap(hubUrl, agentId, credentials, soulId, task);
}

// Legacy code removed - see getCloudAgentBootstrap for current implementation

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
        // Network test mode - minimal script to isolate networking issues
        networkTest = false,
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

      if (!task && !soulId && !shadowMode && !networkTest) {
        return res.status(400).json({
          error: 'Either task, soulId, shadowMode, or networkTest required',
          usage: {
            task: 'Description of work for the agent',
            soulId: 'Existing soul ID to inject',
            soulName: 'Name for new soul (if no soulId)',
            vmSize: 'small|medium|large (default: small)',
            shadowMode: 'true to spawn as dormant shadow',
            shadowFor: 'AgentId to shadow (if shadowMode)',
            networkTest: 'true for minimal network connectivity test only',
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
        // Choose script based on mode
        let userDataScript: string;

        if (networkTest) {
          // Super-minimal script - just posts to chat to prove networking works
          userDataScript = getNetworkTestScript(hubUrl, agentId);
        } else {
          // Store the full bootstrap config in Redis for /api/bootstrap to serve
          const bootstrapConfig = {
            hubUrl,
            agentId,
            credentials: getVMCredentials(),
            soulId: finalSoulId,
            task,
            createdAt: new Date().toISOString(),
          };
          await redis.hset('agent-coord:bootstrap-configs', { [agentId]: JSON.stringify(bootstrapConfig) });

          // Use minimal stub (<2KB) that fetches full script from /api/bootstrap
          userDataScript = getMinimalBootstrapStub(hubUrl, agentId);
        }

        const launchResult = await ec2.send(new RunInstancesCommand({
          ImageId: WINDOWS_AMI,
          InstanceType: instanceType,
          MinCount: 1,
          MaxCount: 1,
          UserData: Buffer.from(userDataScript).toString('base64'),
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
        if (networkTest) {
          await postToChat(
            `[network-test] 🔌 Spawning network test VM **${agentId}**` +
            `\nPurpose: Verify VM can reach our API (no Claude/Node, just HTTP POST)` +
            `\nVM: ${instance.InstanceId} (${instanceType})` +
            `\nExpected result: Chat message within 2-3 minutes if networking works`
          );
        } else if (shadowMode) {
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
          message: networkTest
            ? 'Network test VM spawning. Should post to chat within 2-3 minutes if networking works.'
            : shadowMode
              ? `Shadow agent spawned. Will activate if ${shadowFor} stalls for ${Math.round(stallThresholdMs / 60000)} minutes.`
              : 'Cloud agent spawning. VM takes ~5-10 minutes to boot.',
          estimatedReadyMinutes: networkTest ? 3 : (GOLDEN_AMI ? 2 : 10),
          networkTest: networkTest || undefined,
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
