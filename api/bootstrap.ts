import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

/**
 * Bootstrap API - Serves full PowerShell bootstrap script for cloud agents
 *
 * This endpoint serves the full bootstrap script that's too large for
 * EC2 UserData (16KB limit). The minimal UserData stub calls this endpoint.
 *
 * GET /api/bootstrap?agentId=xxx - Get full bootstrap script
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const BOOTSTRAP_CONFIGS_KEY = 'agent-coord:bootstrap-configs';

interface BootstrapConfig {
  hubUrl: string;
  agentId: string;
  credentials: {
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
    CLAUDE_OAUTH_ACCESS_TOKEN?: string;
    CLAUDE_OAUTH_REFRESH_TOKEN?: string;
    CLAUDE_OAUTH_EXPIRES_AT?: string;
  };
  soulId?: string;
  task?: string;
  createdAt: string;
}

// Generate the full PowerShell bootstrap script
function generateFullBootstrap(config: BootstrapConfig): string {
  const { hubUrl, agentId, credentials, soulId, task } = config;

  // Generate .env file content
  const envFileContent = Object.entries(credentials)
    .filter(([_, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const soulInjection = soulId ? `
# Fetch and inject soul
$soulUri = "${hubUrl}/api/souls?action=get-bundle&soulId=${soulId}"
try {
    $soulResponse = Invoke-RestMethod -Uri $soulUri -Method GET
    $bundle = $soulResponse.bundle
    $soulName = $bundle.identity.name
    $checkpoint = $bundle.checkpoint
} catch {
    "Failed to fetch soul: $_" | Out-File $LogFile -Append
    $soulName = "${soulId}"
    $checkpoint = @{ currentTask = "${task || ''}"; pendingWork = @(); conversationSummary = "" }
}

$injection = @"
[Cloud Agent ${agentId}] Identity: $soulName | Soul: ${soulId}
Context: $($checkpoint.conversationSummary)
Task: ${task || '$($checkpoint.currentTask)'}
Pending: $($checkpoint.pendingWork -join ', ')

CRITICAL: 1) Post to group-chat with isCloudAgent=true NOW 2) hot-start 3) Work autonomously 4) Poll chat every 2-3 tools 5) Checkpoint often
"@

$claudeCmd = "$env:APPDATA\\npm\\claude.cmd"
if (-not (Test-Path $claudeCmd)) { $claudeCmd = "claude" }
"Running: $claudeCmd --dangerously-skip-permissions --mcp-config $mcpConfigPath" | Out-File $LogFile -Append
& $claudeCmd --dangerously-skip-permissions --mcp-config $mcpConfigPath -p $injection 2>&1 | Out-File $LogFile -Append
` : `
# Start with task only (no soul)
$taskPrompt = "[Cloud Agent ${agentId}] Task: ${task || 'Check group chat'} - Post to group-chat with isCloudAgent=true, then hot-start, work autonomously"

$claudeCmd = "$env:APPDATA\\npm\\claude.cmd"
if (-not (Test-Path $claudeCmd)) { $claudeCmd = "claude" }
& $claudeCmd --dangerously-skip-permissions --mcp-config $mcpConfigPath -p $taskPrompt 2>&1 | Out-File $LogFile -Append`;

  // MCP config JSON - escape for PowerShell
  const mcpConfigJson = JSON.stringify({
    mcpServers: {
      'agent-coord': {
        command: 'node',
        args: ['C:/AgentHub/repos/agent-coord-mcp/dist/index.js'],
        env: {
          UPSTASH_REDIS_REST_URL: credentials.UPSTASH_REDIS_REST_URL,
          UPSTASH_REDIS_REST_TOKEN: credentials.UPSTASH_REDIS_REST_TOKEN,
          DO_URL: credentials.DO_URL || '',
          GITHUB_TOKEN: credentials.GITHUB_TOKEN || '',
          LINEAR_API_KEY: credentials.LINEAR_API_KEY || '',
          AWS_ACCESS_KEY_ID: credentials.AWS_ACCESS_KEY_ID || '',
          AWS_SECRET_ACCESS_KEY: credentials.AWS_SECRET_ACCESS_KEY || '',
          AWS_REGION: credentials.AWS_REGION || 'us-west-1',
          ANTHROPIC_API_KEY: credentials.ANTHROPIC_API_KEY,
        },
      },
    },
  }, null, 2);

  return `
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

"Full bootstrap for ${agentId} starting at $(Get-Date)" | Out-File $LogFile
"Hub URL: ${hubUrl}" | Out-File $LogFile -Append

# ==============================================================================
# STEP 0: Enable SSH Access
# ==============================================================================

"Setting up SSH access..." | Out-File $LogFile -Append
try {
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 -ErrorAction SilentlyContinue
    Start-Service sshd -ErrorAction SilentlyContinue
    Set-Service -Name sshd -StartupType 'Automatic' -ErrorAction SilentlyContinue
    New-NetFirewallRule -Name "OpenSSH-Server" -DisplayName "OpenSSH Server" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -ErrorAction SilentlyContinue
    "SSH Server enabled on port 22" | Out-File $LogFile -Append
} catch {
    "Warning: Could not enable SSH: $_" | Out-File $LogFile -Append
}

# ==============================================================================
# STEP 1: Install Core Dependencies
# ==============================================================================

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

# Write .env file
$envContent = @"
${envFileContent}
AGENT_HUB_URL=${hubUrl}
CLOUD_AGENT_ID=${agentId}
"@
$envContent | Out-File "$AgentDir\\.env" -Encoding UTF8

# Set environment variables
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

"Credentials written" | Out-File $LogFile -Append

# Configure Git
${credentials.GITHUB_TOKEN ? `
git config --global credential.helper store
git config --global user.email "cloud-agent@piston-labs.ai"
git config --global user.name "Cloud Agent ${agentId}"
"https://${credentials.GITHUB_TOKEN}:x-oauth-basic@github.com" | Out-File "$env:USERPROFILE\\.git-credentials" -Encoding UTF8
"Git credentials configured" | Out-File $LogFile -Append
` : ''}

# ==============================================================================
# STEP 3: Install Claude CLI
# ==============================================================================

"Installing Claude CLI..." | Out-File $LogFile -Append
npm install -g @anthropic-ai/claude-code 2>&1 | Out-File $LogFile -Append
"Claude CLI installed" | Out-File $LogFile -Append

# ==============================================================================
# STEP 4: Clone Repository (shallow)
# ==============================================================================

if (-not (Test-Path "$RepoDir\\.git")) {
    "Cloning agent-coord-mcp repo..." | Out-File $LogFile -Append
    git clone --depth 1 --single-branch https://github.com/Piston-Labs/agent-coord-mcp.git $RepoDir 2>&1 | Out-File $LogFile -Append
} else {
    "Updating repo..." | Out-File $LogFile -Append
    Set-Location $RepoDir
    git pull origin main 2>&1 | Out-File $LogFile -Append
}

Set-Location $RepoDir

# Use lightweight package.json
if (Test-Path "$RepoDir\\package.cloud.json") {
    Copy-Item "$RepoDir\\package.cloud.json" "$RepoDir\\package.json" -Force
    "Using lightweight package.cloud.json" | Out-File $LogFile -Append
}

$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
"Running npm install..." | Out-File $LogFile -Append
npm install --omit=dev --omit=optional --ignore-scripts 2>&1 | Out-File $LogFile -Append

"Building TypeScript..." | Out-File $LogFile -Append
npm run build 2>&1 | Out-File $LogFile -Append

"Repository ready" | Out-File $LogFile -Append

# ==============================================================================
# STEP 5: Create MCP Config
# ==============================================================================

$mcpConfigJson = @'
${mcpConfigJson}
'@

$mcpConfigPath = "$AgentDir\\config\\mcp-config.json"
[System.IO.File]::WriteAllText($mcpConfigPath, $mcpConfigJson, [System.Text.UTF8Encoding]::new($false))
"MCP config written to $mcpConfigPath" | Out-File $LogFile -Append

# ==============================================================================
# STEP 6: Announce Ready & Start Agent
# ==============================================================================

"Announcing to group chat..." | Out-File $LogFile -Append
$chatBody = @{
    author = "${agentId}"
    message = "[cloud-agent] Bootstrap complete. Starting Claude CLI..."
    isCloudAgent = $true
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "${hubUrl}/api/chat" -Method POST -Body $chatBody -ContentType "application/json"
    "Posted to chat" | Out-File $LogFile -Append
} catch {
    "Failed to post to chat: $_" | Out-File $LogFile -Append
}

# Refresh PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User") + ";$env:APPDATA\\npm"

# Verify Claude CLI
$claudePath = Get-Command claude -ErrorAction SilentlyContinue
if ($claudePath) {
    "Claude CLI found at: $($claudePath.Source)" | Out-File $LogFile -Append
} else {
    "Claude CLI not in PATH, trying npm global..." | Out-File $LogFile -Append
    $claudePath = "$env:APPDATA\\npm\\claude.cmd"
    if (-not (Test-Path $claudePath)) {
        "Reinstalling Claude CLI..." | Out-File $LogFile -Append
        npm install -g @anthropic-ai/claude-code 2>&1 | Out-File $LogFile -Append
    }
}

# Start Claude CLI
"Starting Claude CLI in YOLO mode..." | Out-File $LogFile -Append
Set-Location $RepoDir

try {
${soulInjection}
} catch {
    "ERROR running Claude CLI: $_" | Out-File $LogFile -Append
    $errorBody = @{
        author = "${agentId}"
        message = "[cloud-agent] ERROR: Claude CLI failed - $_"
        isCloudAgent = $true
    } | ConvertTo-Json
    try { Invoke-RestMethod -Uri "${hubUrl}/api/chat" -Method POST -Body $errorBody -ContentType "application/json" } catch {}
}

"Cloud agent ${agentId} finished at $(Get-Date)" | Out-File $LogFile -Append
`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { agentId } = req.query;

    if (!agentId || typeof agentId !== 'string') {
      return res.status(400).json({
        error: 'agentId required',
        usage: 'GET /api/bootstrap?agentId=cloud-xxx',
      });
    }

    // Get bootstrap config from Redis
    const raw = await redis.hget(BOOTSTRAP_CONFIGS_KEY, agentId);
    if (!raw) {
      return res.status(404).json({
        error: 'Bootstrap config not found',
        agentId,
        tip: 'Config may have expired or agent was never spawned',
      });
    }

    const config: BootstrapConfig = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // Generate full bootstrap script
    const script = generateFullBootstrap(config);

    return res.json({
      success: true,
      agentId,
      script,
      configuredAt: config.createdAt,
      scriptSize: script.length,
    });

  } catch (error: any) {
    console.error('Bootstrap error:', error);
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
}
