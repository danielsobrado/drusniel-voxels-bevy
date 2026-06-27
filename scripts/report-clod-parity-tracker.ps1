param(
    [string]$Output = $(if ($env:CLOD_PARITY_TRACKER_OUTPUT) { $env:CLOD_PARITY_TRACKER_OUTPUT } else { "perf-dumps/clod-parity-tracker.md" }),
    [string]$Config = $(if ($env:CLOD_PARITY_TRACKER_CONFIG) { $env:CLOD_PARITY_TRACKER_CONFIG } else { "assets/config/clod_parity_tracker.toml" })
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $RootDir

$Parent = Split-Path -Parent $Output
if ($Parent) {
    New-Item -ItemType Directory -Force -Path $Parent | Out-Null
}

$Args = @($Config, $Output)
if ($env:CLOD_PARITY_TRACKER_FAIL_ON_MISSING -eq "1") {
    $Args += "--fail-on-missing"
}
if ($env:CLOD_PARITY_TRACKER_FAIL_ON_PLANNED -eq "1") {
    $Args += "--fail-on-planned"
}

cargo run --bin clod_parity_tracker -- @Args
Write-Host "[CLOD parity tracker] wrote $Output"
