param(
  [string]$RunDir = "bench-runs/local",
  [string]$Config = "assets/config/clod_qa_gate.toml"
)
$ErrorActionPreference = "Stop"
cargo run --quiet --bin clod_qa_gate -- $RunDir $Config
