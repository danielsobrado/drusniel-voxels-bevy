$ErrorActionPreference = "Stop"

# Complete CLOD parity QA runner for Windows PowerShell.
#
# Mirrors scripts/run-clod-complete-qa.sh so native Windows runs cover the
# scripted-edit, authoritative-hook, collider-refresh, runtime, and report
# artifacts with the same guard chain.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $RootDir

$RunId = if ($env:CLOD_PARITY_RUN_ID) { $env:CLOD_PARITY_RUN_ID } else { (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ") }
$RunDir = if ($env:CLOD_QA_RUN_DIR) {
  $env:CLOD_QA_RUN_DIR
} elseif ($env:CLOD_PARITY_RUN_DIR) {
  $env:CLOD_PARITY_RUN_DIR
} else {
  "bench-runs/clod-complete-$RunId"
}
$PlanScene = if ($env:CLOD_PARITY_PLAN_SCENE) { $env:CLOD_PARITY_PLAN_SCENE } else { "bench/scenes/terrain/clod-edit-stress.toml" }
$BenchScene = if ($env:CLOD_PARITY_BENCH_SCENE) { $env:CLOD_PARITY_BENCH_SCENE } else { "bench/scenes/terrain/clod-parity-stress.toml" }
$Profile = if ($env:CLOD_QA_PROFILE) { $env:CLOD_QA_PROFILE } else { "release" }
$Fast = if ($env:VOXEL_CLOD_QA_FAST) { $env:VOXEL_CLOD_QA_FAST } else { "0" }

$PlanCsv = Join-Path $RunDir "clod-edit-plan.csv"
$EventsCsv = Join-Path $RunDir "clod-edit-events.csv"
$DispatchCsv = Join-Path $RunDir "clod-edit-dispatch.csv"
$DryRunCsv = Join-Path $RunDir "clod-edit-dry-run.csv"
$MutationRequestsCsv = Join-Path $RunDir "clod-edit-mutation-requests.csv"
$MutationSinkCsv = Join-Path $RunDir "clod-edit-mutation-sink.csv"
$AuthoritativeHookCsv = Join-Path $RunDir "clod-edit-authoritative-hook.csv"
$ColliderRefreshCsv = Join-Path $RunDir "clod-collider-refresh.csv"
$SelectionCsv = Join-Path $RunDir "clod-selection-runtime.csv"
$RebuildCsv = Join-Path $RunDir "clod-rebuild-observer.csv"
$CrossfadeCsv = Join-Path $RunDir "clod-crossfade-runtime.csv"
$CutFreezeCsv = Join-Path $RunDir "clod-cut-freeze.csv"
$BorderLockCsv = Join-Path $RunDir "clod-border-locks.csv"
$TopologyCsv = Join-Path $RunDir "clod-topology.csv"
$SimplifyCsv = Join-Path $RunDir "clod-simplify.csv"
$WeldCsv = Join-Path $RunDir "clod-weld.csv"

function Step([string]$Message) {
  Write-Host ""
  Write-Host "[CLOD complete QA] $Message"
}

function Require-Artifact([string]$Path) {
  if (!(Test-Path $Path) -or ((Get-Item $Path).Length -eq 0)) {
    throw "[CLOD complete QA] missing or empty artifact: $Path"
  }
}

New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

Step "run dir: $RunDir"
Step "validating edit plan schema: $PlanScene"
cargo run --bin clod_edit_plan_guard -- --require-edits $PlanScene

Step "exporting edit plan: $PlanCsv"
scripts/export-clod-edit-plan.ps1 -Out $PlanCsv -Scene $PlanScene

Step "exporting scripted edit events: $EventsCsv"
scripts/export-clod-edit-events.ps1 -Out $EventsCsv -Scene $PlanScene

Step "exporting scripted edit dispatch: $DispatchCsv"
scripts/export-clod-edit-dispatch.ps1 -InputCsv $EventsCsv -OutputCsv $DispatchCsv

Step "exporting dry-run edit audit: $DryRunCsv"
scripts/export-clod-edit-dry-run.ps1 -InputCsv $DispatchCsv -OutputCsv $DryRunCsv

Step "exporting mutation requests: $MutationRequestsCsv"
scripts/export-clod-edit-mutation-requests.ps1 -InputCsv $DryRunCsv -OutputCsv $MutationRequestsCsv

Step "exporting mutation sink audit: $MutationSinkCsv"
scripts/export-clod-edit-mutation-sink.ps1 -InputCsv $MutationRequestsCsv -OutputCsv $MutationSinkCsv

Step "exporting authoritative hook audit: $AuthoritativeHookCsv"
scripts/export-clod-edit-authoritative-hook.ps1 -InputCsv $MutationRequestsCsv -OutputCsv $AuthoritativeHookCsv

Step "exporting collider refresh audit: $ColliderRefreshCsv"
scripts/export-clod-collider-refresh.ps1 -InputCsv $AuthoritativeHookCsv -OutputCsv $ColliderRefreshCsv

@(
  $PlanCsv,
  $EventsCsv,
  $DispatchCsv,
  $DryRunCsv,
  $MutationRequestsCsv,
  $MutationSinkCsv,
  $AuthoritativeHookCsv,
  $ColliderRefreshCsv
) | ForEach-Object { Require-Artifact $_ }

Step "guarding scripted edit events"
scripts/guard-clod-edit-events.ps1 -Csv $EventsCsv

Step "guarding dry-run edit audit"
scripts/guard-clod-edit-dry-run.ps1 -Csv $DryRunCsv

Step "guarding mutation requests"
scripts/guard-clod-edit-mutation-requests.ps1 -Csv $MutationRequestsCsv

Step "guarding mutation sink audit"
scripts/guard-clod-edit-mutation-sink.ps1 -Csv $MutationSinkCsv

Step "guarding authoritative hook audit"
scripts/guard-clod-edit-authoritative-hook.ps1 -Csv $AuthoritativeHookCsv

Step "guarding collider refresh audit"
scripts/guard-clod-collider-refresh.ps1 -Csv $ColliderRefreshCsv

Step "guarding apply mode"
scripts/guard-clod-apply-mode.ps1 -RunDir $RunDir

if ($Fast -eq "1") {
  Step "skipping runtime bench and runtime guards because VOXEL_CLOD_QA_FAST=1"
} else {
  Remove-Item -ErrorAction SilentlyContinue `
    $SelectionCsv, `
    $RebuildCsv, `
    $CrossfadeCsv, `
    $CutFreezeCsv, `
    $BorderLockCsv, `
    $TopologyCsv, `
    $SimplifyCsv, `
    $WeldCsv

  $env:CLOD_PAGES = "1"
  $env:VOXEL_CLOD_STATS_CSV = "1"
  $env:VOXEL_CLOD_STATS_CSV_PATH = $SelectionCsv
  $env:VOXEL_CLOD_REBUILD_CSV = "1"
  $env:VOXEL_CLOD_REBUILD_CSV_PATH = $RebuildCsv
  $env:VOXEL_CLOD_CROSSFADE_BRIDGE = "1"
  $env:VOXEL_CLOD_CROSSFADE_MATERIAL = "1"
  $env:VOXEL_CLOD_CROSSFADE_STATS_CSV = "1"
  $env:VOXEL_CLOD_CROSSFADE_STATS_CSV_PATH = $CrossfadeCsv
  $env:VOXEL_CLOD_CUT_FREEZE_CSV = "1"
  $env:VOXEL_CLOD_CUT_FREEZE_CSV_PATH = $CutFreezeCsv
  $env:VOXEL_CLOD_BORDER_LOCK_CSV = "1"
  $env:VOXEL_CLOD_BORDER_LOCK_CSV_PATH = $BorderLockCsv
  $env:VOXEL_CLOD_TOPOLOGY_CSV = "1"
  $env:VOXEL_CLOD_TOPOLOGY_CSV_PATH = $TopologyCsv
  $env:VOXEL_CLOD_SIMPLIFY_CSV = "1"
  $env:VOXEL_CLOD_SIMPLIFY_CSV_PATH = $SimplifyCsv
  $env:VOXEL_CLOD_WELD_CSV = "1"
  $env:VOXEL_CLOD_WELD_CSV_PATH = $WeldCsv

  Step "running runtime CLOD bench: $BenchScene"
  if ($Profile -eq "release") {
    cargo run --release -- --bench $BenchScene
  } else {
    cargo run -- --bench $BenchScene
  }

  @(
    $SelectionCsv,
    $RebuildCsv,
    $CrossfadeCsv,
    $CutFreezeCsv,
    $BorderLockCsv,
    $TopologyCsv,
    $SimplifyCsv,
    $WeldCsv
  ) | ForEach-Object { Require-Artifact $_ }

  Step "guarding selection stats"
  $SelectionConfig = if ($env:CLOD_STATS_GUARD_CONFIG) { $env:CLOD_STATS_GUARD_CONFIG } else { "assets/config/clod_stats_guard.toml" }
  cargo run --bin clod_stats_guard -- $SelectionCsv --config $SelectionConfig

  Step "guarding rebuild stats"
  $RebuildConfig = if ($env:CLOD_REBUILD_GUARD_CONFIG) { $env:CLOD_REBUILD_GUARD_CONFIG } else { "assets/config/clod_rebuild_guard.toml" }
  cargo run --bin clod_rebuild_guard -- $RebuildCsv --config $RebuildConfig

  Step "guarding crossfade stats"
  scripts/guard-clod-crossfade.ps1 -Csv $CrossfadeCsv

  Step "guarding cut-freeze stats"
  scripts/guard-clod-cut-freeze.ps1 -Csv $CutFreezeCsv

  Step "guarding visual parity integration"
  scripts/guard-clod-visual-parity.ps1 -SelectionCsv $SelectionCsv -CrossfadeCsv $CrossfadeCsv -CutFreezeCsv $CutFreezeCsv

  Step "guarding border locks"
  scripts/guard-clod-border-locks.ps1 -Csv $BorderLockCsv

  Step "guarding topology"
  scripts/guard-clod-topology.ps1 -Csv $TopologyCsv

  Step "guarding simplification"
  scripts/guard-clod-simplify.ps1 -Csv $SimplifyCsv

  Step "guarding welds"
  scripts/guard-clod-welds.ps1 -Csv $WeldCsv

  if ($env:VOXEL_CLOD_RUN_EDIT_REBUILD_GUARD -eq "1") {
    Step "guarding edit plan against rebuild telemetry"
    scripts/guard-clod-edit-rebuild.ps1 -PlanCsv $PlanCsv -RebuildCsv $RebuildCsv
  } else {
    Step "skipping edit-vs-rebuild guard; set VOXEL_CLOD_RUN_EDIT_REBUILD_GUARD=1 after scripted edit execution is wired"
  }
}

Step "writing aggregate report"
scripts/report-clod-qa.ps1 -RunDir $RunDir

$Readme = @"
# CLOD complete QA run $RunId

Generated by ``scripts/run-clod-complete-qa.ps1``.

## Inputs

- plan scene: ``$PlanScene``
- bench scene: ``$BenchScene``
- fast mode: ``$Fast``

## Scripted edit artifacts

- ``clod-edit-plan.csv``
- ``clod-edit-events.csv``
- ``clod-edit-dispatch.csv``
- ``clod-edit-dry-run.csv``
- ``clod-edit-mutation-requests.csv``
- ``clod-edit-mutation-sink.csv``
- ``clod-edit-authoritative-hook.csv``
- ``clod-collider-refresh.csv``
- ``clod-qa-report.md``
- ``clod-qa-report.json``

## Runtime artifacts

These are generated only when ``VOXEL_CLOD_QA_FAST`` is not ``1``:

- ``clod-selection-runtime.csv``
- ``clod-rebuild-observer.csv``
- ``clod-crossfade-runtime.csv``
- ``clod-cut-freeze.csv``
- ``clod-border-locks.csv``
- ``clod-topology.csv``
- ``clod-simplify.csv``
- ``clod-weld.csv``

Real authoritative terrain mutation remains pending. The scripted edit artifacts
prove dry-run planning, mutation requests, sink readiness, authoritative-hook
readiness, and collider-refresh audit coverage.
"@
Set-Content -Path (Join-Path $RunDir "README.md") -Value $Readme

Step "complete: $RunDir"
