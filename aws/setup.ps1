# Agent Hub AWS Setup Script
# Run this to deploy the CloudFormation stack

param(
    [string]$Environment = "prod",
    [string]$Region = "us-east-1",
    [string]$AnthropicApiKey = ""
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Agent Hub AWS Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check AWS CLI
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: AWS CLI not found. Install from https://aws.amazon.com/cli/" -ForegroundColor Red
    exit 1
}

# Check credentials
Write-Host "Checking AWS credentials..." -ForegroundColor Yellow
$identity = aws sts get-caller-identity 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: AWS credentials not configured. Run 'aws configure'" -ForegroundColor Red
    exit 1
}
Write-Host "Authenticated as: $identity" -ForegroundColor Green

# Deploy CloudFormation stack
$stackName = "agent-hub-$Environment"
$templateFile = Join-Path $PSScriptRoot "agent-hub-setup.yaml"

Write-Host ""
Write-Host "Deploying CloudFormation stack: $stackName" -ForegroundColor Yellow
Write-Host "Region: $Region" -ForegroundColor Yellow
Write-Host "Template: $templateFile" -ForegroundColor Yellow
Write-Host ""

aws cloudformation deploy `
    --template-file $templateFile `
    --stack-name $stackName `
    --parameter-overrides Environment=$Environment `
    --capabilities CAPABILITY_NAMED_IAM `
    --region $Region

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: CloudFormation deployment failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Stack deployed successfully!" -ForegroundColor Green

# Get outputs
Write-Host ""
Write-Host "Fetching stack outputs..." -ForegroundColor Yellow

$outputs = aws cloudformation describe-stacks `
    --stack-name $stackName `
    --query "Stacks[0].Outputs" `
    --output json `
    --region $Region | ConvertFrom-Json

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Stack Outputs" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

foreach ($output in $outputs) {
    Write-Host "$($output.OutputKey): $($output.OutputValue)" -ForegroundColor White
}

# Update API key if provided
if ($AnthropicApiKey) {
    Write-Host ""
    Write-Host "Setting Anthropic API key in SSM..." -ForegroundColor Yellow

    aws ssm put-parameter `
        --name "/agent-hub/$Environment/anthropic-api-key" `
        --value $AnthropicApiKey `
        --type SecureString `
        --overwrite `
        --region $Region

    Write-Host "API key stored securely in SSM" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Next Steps" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Add these environment variables to Vercel:" -ForegroundColor White
Write-Host ""

$subnetId = ($outputs | Where-Object { $_.OutputKey -eq "SubnetId" }).OutputValue
$sgId = ($outputs | Where-Object { $_.OutputKey -eq "SecurityGroupId" }).OutputValue
$profileName = ($outputs | Where-Object { $_.OutputKey -eq "InstanceProfileName" }).OutputValue

Write-Host "   AWS_REGION=$Region" -ForegroundColor Yellow
Write-Host "   AWS_SUBNET_ID=$subnetId" -ForegroundColor Yellow
Write-Host "   AWS_SECURITY_GROUP_ID=$sgId" -ForegroundColor Yellow
Write-Host "   AWS_IAM_INSTANCE_PROFILE=$profileName" -ForegroundColor Yellow
Write-Host ""
Write-Host "2. Test VM provisioning:" -ForegroundColor White
Write-Host "   curl -X POST https://agent-coord-mcp.vercel.app/api/aws-vms?action=provision -d '{\"size\":\"small\"}'" -ForegroundColor Yellow
Write-Host ""
Write-Host "Done!" -ForegroundColor Green
