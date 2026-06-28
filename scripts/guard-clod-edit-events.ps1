param(
    [string]$Csv = "bench-runs/latest/clod-edit-events.csv",
    [string]$Config = $(if ($env:CLOD_EDIT_EVENTS_GUARD_CONFIG) { $env:CLOD_EDIT_EVENTS_GUARD_CONFIG } else { "assets/config/clod_edit_events_guard.toml" })
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $RootDir

cargo run --bin clod_edit_events_guard -- $Csv --config $Config
