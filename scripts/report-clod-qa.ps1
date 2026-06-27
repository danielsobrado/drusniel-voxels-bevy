param(
    [string]$RunDir = "bench-runs/clod-full-parity-latest",
    [string]$OutMarkdown = "",
    [string]$OutJson = ""
)

if ($OutMarkdown -eq "") {
    $OutMarkdown = Join-Path $RunDir "clod-qa-report.md"
}
if ($OutJson -eq "") {
    $OutJson = Join-Path $RunDir "clod-qa-report.json"
}

cargo run --bin clod_qa_report -- `
    --run-dir $RunDir `
    --out-md $OutMarkdown `
    --out-json $OutJson
