$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root "data\server.pid"

if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Host "No Letter Chatters launcher process was found."
  exit 0
}

$serverPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
$process = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if (-not $process) {
  Remove-Item -LiteralPath $pidFile -Force
  Write-Host "Letter Chatters was already stopped."
  exit 0
}

$details = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid"
if ($process.ProcessName -ne "node" -or $details.CommandLine -notlike "*dist*src*server.js*") {
  throw "PID $serverPid does not look like the Letter Chatters server; it was not stopped."
}

Stop-Process -Id $serverPid
Remove-Item -LiteralPath $pidFile -Force
Write-Host "Letter Chatters stopped."
