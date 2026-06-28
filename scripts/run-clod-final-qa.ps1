param([string]$RunDir = $(if ($env:CLOD_QA_RUN_DIR) { $env:CLOD_QA_RUN_DIR } else { "bench-runs/local" }))
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
if (Test-Path "scripts/run-clod-complete-qa.ps1") { & "scripts/run-clod-complete-qa.ps1" }
& "scripts/export-clod-collider-refresh.ps1" "$RunDir/clod-edit-authoritative-hook.csv" "$RunDir/clod-collider-refresh.csv"
& "scripts/guard-clod-collider-refresh.ps1" "$RunDir/clod-collider-refresh.csv"
& "scripts/guard-clod-apply-mode.ps1" "$RunDir"
if (Test-Path "scripts/report-clod-qa.ps1") { & "scripts/report-clod-qa.ps1" "$RunDir" }
if (Test-Path "scripts/guard-clod-qa-gate.ps1") { & "scripts/guard-clod-qa-gate.ps1" "$RunDir" }
Write-Host "[CLOD FINAL QA] OK: $RunDir"
