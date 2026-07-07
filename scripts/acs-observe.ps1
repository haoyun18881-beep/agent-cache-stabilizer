# acs-observe.ps1 — ACS 轻量观察脚本
# 用途：快速查看 ACS / scSidecar 健康状态、MAIN 水位、最近 SUB 活动
# 不主动派兵，不触发 DeepSeek 调用
# 用法：powershell -File acs-observe.ps1
# 可选：-AcsBaseUrl http://127.0.0.1:18801 -SidecarBaseUrl http://127.0.0.1:18792

param(
    [string]$AcsBaseUrl = $(if ($env:ACS_BASE_URL) { $env:ACS_BASE_URL } else { "http://127.0.0.1:18801" }),
    [string]$SidecarBaseUrl = $(if ($env:SC_SIDECAR_BASE_URL) { $env:SC_SIDECAR_BASE_URL } else { "http://127.0.0.1:18792" }),
    [string]$AcsLogDir = $(if ($env:ACS_LOG_DIR) { $env:ACS_LOG_DIR } else { Join-Path $env:USERPROFILE ".openclaw\workspace\plugins\agent-cache-stabilizer\logs" }),
    [string]$TaskDir = $(if ($env:SC_TASK_DIR) { $env:SC_TASK_DIR } else { Join-Path $env:USERPROFILE ".openclaw\workspace\plugins\sc\tools\sidecar\tasks" })
)

$ErrorActionPreference = "SilentlyContinue"

Write-Host "=== ACS 健康 ($(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) ==="

# 1. 服务状态
try { $acs = Invoke-RestMethod -Uri "$AcsBaseUrl/health" -TimeoutSec 3 }
catch { $acs = $null }
try { $side = Invoke-RestMethod -Uri "$SidecarBaseUrl/health" -TimeoutSec 3 }
catch { $side = $null }

Write-Host "ACS($AcsBaseUrl): $(if($acs.ok){'OK'}else{'DOWN'})  Sidecar($SidecarBaseUrl): $(if($side.status -eq 'ok'){'OK'}else{'DOWN'})"

# 2. ACS STATE
try { $state = (Invoke-RestMethod -Uri "$AcsBaseUrl/state" -TimeoutSec 3).state }
catch { $state = $null }
if ($state) {
    Write-Host "`n--- MAIN 水箱 ---"
    Write-Host "messages: $($state.messages)  waterTotalTokens: $($state.waterTotalTokens)  trimCount: $($state.trimCount)"
    Write-Host "archiveTokens: $($state.archiveTokens)  recentTokens: $($state.recentTokens)"
    Write-Host "lastRequestTime: $([DateTime]::new(1970,1,1,0,0,0,0).AddMilliseconds($state.lastRequestTime).ToLocalTime())"
}

# 3. 最近 ACS 日志（简化）
$logFile = Join-Path $AcsLogDir "acs.out.log"
if (Test-Path $logFile) {
    $recent = Get-Content $logFile -Tail 30
    $subCount = ($recent | Select-String "\[SUB:" | Measure-Object).Count
    $mainCount = ($recent | Select-String "\[MAIN\]" | Measure-Object).Count
    Write-Host "`n--- 最近30行日志 ---"
    Write-Host "[MAIN]: $mainCount  [SUB]: $subCount"
    if ($subCount -gt 0) {
        Write-Host "最近 SUB 条目:"
        $recent | Select-String "\[SUB:" | Select-Object -Last 5 | ForEach-Object { "  $($_.Line.Substring(0,[Math]::Min(160,$_.Line.Length)))" }
    }
}

# 4. sidecar 运行中任务
if ($side -and $side.runningTasks) {
    Write-Host "`n--- Sidecar 运行中任务: $($side.runningTasks) ---"
}

# 5. 最近 task 文件
if (Test-Path $TaskDir) {
    $recentTasks = Get-ChildItem $TaskDir -File -Filter "sa-*.json" | Sort-Object LastWriteTime -Descending | Select-Object -First 10
    Write-Host "`n--- 最近10个 task ---"
    foreach ($t in $recentTasks) {
        try {
            $tc = Get-Content $t.FullName -Raw | ConvertFrom-Json
            Write-Host "$($tc.id): $($tc.status) batch=$($tc.batchName) name=$($tc.name) group=$($tc.groupName)"
        } catch { Write-Host "$($t.Name): parse error" }
    }
}

Write-Host "`n=== 观察完成（未派兵，未调用 DeepSeek）==="
