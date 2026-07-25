param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
$port = 1010

if (Test-Path -LiteralPath $envFile) {
  $portLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*PORT\s*=\s*\d+\s*$' } | Select-Object -Last 1
  if ($portLine -match '=\s*(\d+)') { $port = [int]$Matches[1] }
}

$dashboard = "http://localhost:$port/control"
$healthUrl = "http://127.0.0.1:$port/health"
$dataDirectory = Join-Path $root "data"
$pidFile = Join-Path $dataDirectory "server.pid"
$outputLog = Join-Path $dataDirectory "server-output.log"
$errorLog = Join-Path $dataDirectory "server-error.log"

function Show-ServerLogs {
  if (Test-Path -LiteralPath $errorLog) {
    $errors = Get-Content -LiteralPath $errorLog -Tail 30
    if ($errors) { Write-Host "`nServer errors:" -ForegroundColor Red; $errors | Write-Host }
  }
  if (Test-Path -LiteralPath $outputLog) {
    $output = Get-Content -LiteralPath $outputLog -Tail 15
    if ($output) { Write-Host "`nServer output:"; $output | Write-Host }
  }
}

function Open-Dashboard {
  if (-not $NoBrowser) { Start-Process $dashboard }
}

try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
  if ($health.ok) {
    Open-Dashboard
    Write-Host "Letter Chatters is already running. Dashboard opened."
    exit 0
  }
} catch {
  # Expected when the server is not running yet.
}

New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
if (Test-Path -LiteralPath $pidFile) {
  $stalePid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
  if (-not (Get-Process -Id $stalePid -ErrorAction SilentlyContinue)) {
    Remove-Item -LiteralPath $pidFile -Force
  }
}

$node = (Get-Command node -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
Set-Location $root

if (-not (Test-Path (Join-Path $root "node_modules"))) {
  Write-Host "Installing Letter Chatters dependencies..."
  & $npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
}

Write-Host "Building Letter Chatters..."
& $npm run build
if ($LASTEXITCODE -ne 0) { throw "The Letter Chatters build failed." }

$serverFile = Join-Path $root "dist\src\server.js"
$process = Start-Process -FilePath $node -ArgumentList @($serverFile) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog -PassThru
Set-Content -LiteralPath $pidFile -Value $process.Id

# A Raspberry Pi or a cold Windows virus-scanner cache may need time to load the dictionary.
for ($attempt = 0; $attempt -lt 120; $attempt++) {
  $process.Refresh()
  if ($process.HasExited) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Show-ServerLogs
    throw "The server exited during startup with code $($process.ExitCode)."
  }
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.ok) {
      Open-Dashboard
      Write-Host "Letter Chatters is running. Dashboard opened."
      exit 0
    }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Show-ServerLogs
throw "The server did not become ready on port $port within 60 seconds."
