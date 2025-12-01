# Piston Labs Command Center - Test Suite
# Tests all major features and posts results

param(
    [switch]$Verbose,
    [string]$HubUrl = "https://agent-coord-mcp.vercel.app"
)

$results = @()
$passed = 0
$failed = 0

function Test-Feature {
    param(
        [string]$Name,
        [scriptblock]$Test
    )
    
    Write-Host "Testing: $Name..." -NoNewline
    try {
        $result = & $Test
        if ($result) {
            Write-Host " PASS" -ForegroundColor Green
            $script:passed++
            return @{ name = $Name; status = "PASS"; result = $result }
        } else {
            Write-Host " FAIL" -ForegroundColor Red
            $script:failed++
            return @{ name = $Name; status = "FAIL"; result = "No result" }
        }
    } catch {
        Write-Host " ERROR: $_" -ForegroundColor Red
        $script:failed++
        return @{ name = $Name; status = "ERROR"; result = $_.ToString() }
    }
}

Write-Host "=== PISTON LABS COMMAND CENTER TEST SUITE ===" -ForegroundColor Cyan
Write-Host "Hub: $HubUrl"
Write-Host "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ""

# Test 1: Health Check
$results += Test-Feature "Health Endpoint" {
    $r = Invoke-RestMethod -Uri "$HubUrl/api/health" -Method GET
    return $r.status -eq "ok"
}

# Test 2: Piston Context API - List Clusters
$results += Test-Feature "Piston Context - List Clusters" {
    $r = Invoke-RestMethod -Uri "$HubUrl/api/piston-context?cluster=technical" -Method GET
    return $r.cluster -eq "technical" -and $r.topics.Count -gt 0
}

# Test 3: Piston Context - Get Topic
$results += Test-Feature "Piston Context - Get Topic" {
    $r = Invoke-RestMethod -Uri "$HubUrl/api/piston-context?cluster=technical&topic=devices" -Method GET
    return $r.summary -match "Teltonika"
}

# Test 4: AWS Status API
$results += Test-Feature "AWS Status API" {
    $r = Invoke-RestMethod -Uri "$HubUrl/api/aws-status?service=all" -Method GET
    return $r.lambda.state -eq "Active"
}

# Test 5: Generate Doc API
$results += Test-Feature "Generate Doc - Pitch" {
    $body = @{ type = "pitch"; target = "shop-owner"; shopName = "Test Shop" } | ConvertTo-Json
    $r = Invoke-RestMethod -Uri "$HubUrl/api/generate-doc" -Method POST -Body $body -ContentType "application/json"
    return $r.success -eq $true -and $r.document.sections.Count -gt 0
}

# Test 6: Chat API - Post
$results += Test-Feature "Chat API - Post Message" {
    $body = @{ author = "test-runner"; authorType = "agent"; message = "Test message from automated suite" } | ConvertTo-Json
    $r = Invoke-RestMethod -Uri "$HubUrl/api/chat" -Method POST -Body $body -ContentType "application/json"
    return $r.success -eq $true
}

# Test 7: Chat API - Get
$results += Test-Feature "Chat API - Get Messages" {
    $r = Invoke-RestMethod -Uri "$HubUrl/api/chat?limit=5" -Method GET
    return $r.messages.Count -gt 0
}

# Test 8: Agents API
$results += Test-Feature "Agents API" {
    $r = Invoke-RestMethod -Uri "$HubUrl/api/agents" -Method GET
    return $r -ne $null
}

# Test 9: Alerts API
$results += Test-Feature "Alerts API - List" {
    $r = Invoke-RestMethod -Uri "$HubUrl/api/alerts" -Method GET
    return $r -ne $null
}

# Test 10: External Agents API
$results += Test-Feature "External Agents API" {
    $r = Invoke-RestMethod -Uri "$HubUrl/api/external-agents" -Method GET
    return $r -ne $null
}

# Summary
Write-Host ""
Write-Host "=== TEST RESULTS ===" -ForegroundColor Cyan
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host "Total: $($passed + $failed)"

# Post results to chat
$testSummary = "**Automated Test Results** - $passed/$($passed + $failed) passed"
$details = $results | ForEach-Object { "- $($_.name): $($_.status)" }
$fullMessage = "$testSummary`n`n$($details -join "`n")"

$chatBody = @{
    author = "test-runner"
    authorType = "agent"  
    message = $fullMessage
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "$HubUrl/api/chat" -Method POST -Body $chatBody -ContentType "application/json" | Out-Null
    Write-Host "`nResults posted to hub chat!" -ForegroundColor Green
} catch {
    Write-Host "`nFailed to post results: $_" -ForegroundColor Yellow
}

Write-Host "`nDone!" -ForegroundColor Green
