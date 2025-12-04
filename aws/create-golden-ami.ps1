# Golden AMI Creation Script for Claude Agent VMs
# Run this ONCE on a fresh Windows Server to create a reusable AMI
#
# After running this script:
# 1. Stop the EC2 instance
# 2. Create AMI from the instance in AWS Console
# 3. Update GOLDEN_AMI_ID in api/aws-vms.ts
# 4. Terminate the original instance

param(
    [string]$GithubToken = "",  # Optional: for private repos
    [string]$AnthropicApiKey = ""  # Will be injected at boot time if not set
)

$ErrorActionPreference = "Stop"
$AgentDir = "C:\AgentHub"
$LogFile = "$AgentDir\setup.log"

function Log($msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp - $msg" | Tee-Object -FilePath $LogFile -Append
}

# Create directories
Log "Creating directories..."
New-Item -ItemType Directory -Force -Path $AgentDir
New-Item -ItemType Directory -Force -Path "$AgentDir\repos"
New-Item -ItemType Directory -Force -Path "$AgentDir\config"
New-Item -ItemType Directory -Force -Path "$AgentDir\logs"
Set-Location $AgentDir

# Enable TLS 1.2
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Install Chocolatey
Log "Installing Chocolatey..."
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
refreshenv

# Install core tools
Log "Installing Node.js, Git, and other tools..."
choco install nodejs-lts git vscode awscli -y
refreshenv

# Refresh PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Install Claude Code CLI
Log "Installing Claude Code CLI..."
npm install -g @anthropic-ai/claude-code

# Clone repositories
Log "Cloning repositories..."
Set-Location "$AgentDir\repos"

# Main coordination repo
git clone https://github.com/Piston-Labs/agent-coord-mcp.git
Set-Location agent-coord-mcp
npm install
npm run build

# Context system repo
Set-Location "$AgentDir\repos"
git clone https://github.com/Piston-Labs/teltonika-context-system.git

# Create MCP config template
Log "Creating MCP config..."
$mcpConfig = @"
{
  "mcpServers": {
    "agent-coord": {
      "command": "node",
      "args": ["$($AgentDir -replace '\\', '/')/repos/agent-coord-mcp/dist/index.js"],
      "env": {
        "API_BASE": "https://agent-coord-mcp.vercel.app"
      }
    }
  }
}
"@
$mcpConfig | Out-File -FilePath "$AgentDir\config\mcp-config.json" -Encoding UTF8

# Create startup script that runs on boot
Log "Creating startup script..."
$startupScript = @'
# Agent Hub Startup Script
# This runs on every boot to start the agent service

$AgentDir = "C:\AgentHub"
$LogFile = "$AgentDir\logs\startup-$(Get-Date -Format 'yyyy-MM-dd').log"

function Log($msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp - $msg" | Tee-Object -FilePath $LogFile -Append
}

Log "Starting Agent Hub..."

# Pull latest code
Set-Location "$AgentDir\repos\agent-coord-mcp"
git pull origin main 2>&1 | Out-File $LogFile -Append
npm install 2>&1 | Out-File $LogFile -Append

# Check for soul injection from instance tags or user data
$instanceId = (Invoke-RestMethod -Uri "http://169.254.169.254/latest/meta-data/instance-id")
$region = (Invoke-RestMethod -Uri "http://169.254.169.254/latest/meta-data/placement/region")

# Get instance tags
try {
    $tags = aws ec2 describe-tags --filters "Name=resource-id,Values=$instanceId" --region $region --output json | ConvertFrom-Json
    $soulId = ($tags.Tags | Where-Object { $_.Key -eq "SoulId" }).Value
    $task = ($tags.Tags | Where-Object { $_.Key -eq "Task" }).Value
    $agentId = ($tags.Tags | Where-Object { $_.Key -eq "AgentId" }).Value

    if ($soulId) {
        Log "Found soul injection: $soulId"
        # Fetch soul bundle and inject
        $bundle = Invoke-RestMethod -Uri "https://agent-coord-mcp.vercel.app/api/souls?action=get-bundle&soulId=$soulId"
        $bundleJson = $bundle.bundle | ConvertTo-Json -Depth 10

        # Start Claude with soul injection
        $bundleJson | claude --dangerously-skip-permissions --mcp-config "$AgentDir\config\mcp-config.json"
    }
    elseif ($task) {
        Log "Found task: $task"
        # Start Claude with task
        echo $task | claude --dangerously-skip-permissions --mcp-config "$AgentDir\config\mcp-config.json"
    }
    else {
        Log "No soul or task found, starting idle"
        # Register as available agent
        $body = @{
            agentId = if ($agentId) { $agentId } else { "cloud-$instanceId" }
            status = "idle"
            currentTask = "Waiting for work"
        } | ConvertTo-Json

        Invoke-RestMethod -Uri "https://agent-coord-mcp.vercel.app/api/agents" -Method POST -Body $body -ContentType "application/json"
    }
}
catch {
    Log "Error during startup: $_"
}

Log "Agent Hub startup complete"
'@
$startupScript | Out-File -FilePath "$AgentDir\start-agent.ps1" -Encoding UTF8

# Create scheduled task for startup
Log "Creating scheduled task..."
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-ExecutionPolicy Bypass -File $AgentDir\start-agent.ps1"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "AgentHubStartup" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force

# Set environment variables (API key will be injected at runtime via instance metadata or tags)
Log "Setting environment variables..."
[Environment]::SetEnvironmentVariable("AGENT_HUB_URL", "https://agent-coord-mcp.vercel.app", "Machine")
[Environment]::SetEnvironmentVariable("AGENT_HUB_DIR", $AgentDir, "Machine")

if ($AnthropicApiKey) {
    [Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", $AnthropicApiKey, "Machine")
}

# Clean up for AMI
Log "Cleaning up for AMI creation..."
Remove-Item -Path "$env:USERPROFILE\AppData\Local\Temp\*" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "C:\Windows\Temp\*" -Recurse -Force -ErrorAction SilentlyContinue

# Create ready marker
Log "Setup complete!"
"READY" | Out-File -FilePath "$AgentDir\READY"

Write-Host @"

========================================
GOLDEN AMI SETUP COMPLETE
========================================

Next steps:
1. Stop this EC2 instance
2. In AWS Console: Actions > Image and templates > Create image
3. Name it: agent-hub-golden-YYYY-MM-DD
4. Wait for AMI to be available
5. Copy the AMI ID and update api/aws-vms.ts
6. Terminate this instance

The AMI includes:
- Windows Server 2022
- Node.js LTS
- Git
- Claude Code CLI
- VS Code
- AWS CLI
- agent-coord-mcp repo (pre-built)
- teltonika-context-system repo
- MCP configuration
- Auto-startup on boot

"@
