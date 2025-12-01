# Piston Labs AWS Status Updater
param(
    [switch]$Verbose,
    [switch]$PostToHub
)

$aws = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
$hubUrl = "https://agent-coord-mcp.vercel.app"

Write-Host "=== Piston Labs AWS Status Check ===" -ForegroundColor Cyan
Write-Host "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

# Lambda Status
Write-Host "`n[Lambda Function Status]" -ForegroundColor Yellow
$lambdaInfo = & $aws lambda get-function --function-name parse-teltonika-data --query "Configuration.{Name:FunctionName,Runtime:Runtime,LastModified:LastModified,State:State}" --output json | ConvertFrom-Json

Write-Host "  Function: $($lambdaInfo.Name)"
Write-Host "  Runtime: $($lambdaInfo.Runtime)"
Write-Host "  State: $($lambdaInfo.State)"
Write-Host "  Last Modified: $($lambdaInfo.LastModified)"

# Lambda Metrics
$endTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$startTime = (Get-Date).AddHours(-1).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$invocations = & $aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Invocations --dimensions Name=FunctionName,Value=parse-teltonika-data --start-time $startTime --end-time $endTime --period 3600 --statistics Sum --output json | ConvertFrom-Json
$errors = & $aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Errors --dimensions Name=FunctionName,Value=parse-teltonika-data --start-time $startTime --end-time $endTime --period 3600 --statistics Sum --output json | ConvertFrom-Json

$invocationCount = 0
$errorCount = 0
if ($invocations.Datapoints) { 
    $invocationCount = [int]($invocations.Datapoints | Measure-Object -Property Sum -Sum).Sum 
}
if ($errors.Datapoints) { 
    $errorCount = [int]($errors.Datapoints | Measure-Object -Property Sum -Sum).Sum 
}
$errorRate = 0
if ($invocationCount -gt 0) { 
    $errorRate = [math]::Round(($errorCount / $invocationCount) * 100, 2) 
}

Write-Host "  Invocations (1h): $invocationCount"
Write-Host "  Errors (1h): $errorCount"
Write-Host "  Error Rate: $errorRate percent"

# IoT Things
Write-Host "`n[IoT Devices]" -ForegroundColor Yellow
$things = & $aws iot list-things --query "things[].thingName" --output json | ConvertFrom-Json
Write-Host "  Total Devices: $($things.Count)"
foreach ($thing in $things) {
    Write-Host "    - $thing"
}

# Summary
Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
$overallStatus = "HEALTHY"
if ($lambdaInfo.State -ne "Active" -or $errorRate -ge 5) {
    $overallStatus = "DEGRADED"
}
Write-Host "Overall Status: $overallStatus"
Write-Host "Lambda: $($lambdaInfo.State), $invocationCount invocations/hr"
Write-Host "IoT: $($things.Count) devices registered"

# Post to chat if requested
if ($PostToHub) {
    Write-Host "`nPosting to hub chat..." -ForegroundColor Yellow
    
    $msgText = "**AWS Status Update** - Lambda: $($lambdaInfo.State), $invocationCount inv/hr, $errorRate pct errors - IoT: $($things.Count) devices - Overall: $overallStatus"
    
    $chatBody = @{
        author = "aws-monitor"
        authorType = "agent"
        message = $msgText
    } | ConvertTo-Json
    
    try {
        Invoke-RestMethod -Uri "$hubUrl/api/chat" -Method POST -Body $chatBody -ContentType "application/json" | Out-Null
        Write-Host "  Posted to chat!" -ForegroundColor Green
    } catch {
        Write-Host "  Failed: $_" -ForegroundColor Red
    }
}

Write-Host "`nDone!" -ForegroundColor Green
