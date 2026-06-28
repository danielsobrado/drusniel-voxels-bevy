param(
    [Parameter(Mandatory=$true)]
    [string]$Csv,

    [string]$Config = "assets/config/clod_topology_guard.toml"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (!(Test-Path $Csv)) {
    throw "CLOD topology CSV not found: $Csv"
}

if (!(Test-Path $Config)) {
    throw "CLOD topology guard config not found: $Config"
}

cargo run --bin clod_topology_guard -- $Csv $Config
