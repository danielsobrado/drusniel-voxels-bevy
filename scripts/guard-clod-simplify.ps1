param(
  [Parameter(Mandatory=$true)]
  [string]$CsvPath,
  [string]$ConfigPath = "assets/config/clod_simplify_guard.toml"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $CsvPath)) {
  throw "CLOD simplify CSV not found: $CsvPath"
}

if (!(Test-Path $ConfigPath)) {
  throw "CLOD simplify guard config not found: $ConfigPath"
}

cargo run --bin clod_simplify_guard -- `
  --config $ConfigPath `
  $CsvPath

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
