# Count lines of code in this repo, grouped by file extension.
# Usage: scripts/loc.ps1 [-Save]
#   -Save  Append a timestamped row to scripts/loc-history.csv
[CmdletBinding()]
param(
    [switch]$Save
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$excludes = @(
    '.git', '.history', 'target', 'bench-runs', 'perf-dumps', 'temp',
    'node_modules', 'patches', 'editor\frontend\src-tauri\target',
    'editor\frontend\src-tauri\gen', 'editor\frontend\dist',
    'editor\frontend\node_modules', 'tools\clod-poc\node_modules',
    'tools\clod-poc\dist',
    'tools\clod-poc\config\custom_prop_placements_20000.yaml',
    'tools\clod-poc\config\custom_prop_placements_5000.yaml',
    'tools\clod-poc\config\custom_prop_placements_500.yaml',
    'editor\frontend\pnpm-lock.yaml',
    'saves', 'image', 'assets\textures', 'assets\models', 'assets\audio',
    'debug', 'docs\reference', '.agent', '.claude', '.cargo'
)
$excludePatterns = $excludes | ForEach-Object {
    [regex]::Escape((Join-Path $repoRoot $_)) + '($|\\)'
}

$extensions = @(
    'rs', 'wgsl', 'toml', 'py', 'ps1', 'sh', 'md', 'html', 'css',
    'js', 'ts', 'tsx', 'jsx', 'vue', 'json', 'yaml', 'yml'
)

$results = [ordered]@{}
$totalFiles = 0
$totalLines = 0

foreach ($ext in $extensions) {
    $files = Get-ChildItem -Path $repoRoot -Recurse -File -Filter "*.$ext" -ErrorAction SilentlyContinue |
        Where-Object {
            $path = $_.FullName
            -not ($excludePatterns | Where-Object { $path -match $_ })
        }

    $lineCount = 0
    foreach ($f in $files) {
        try {
            $lineCount += [System.IO.File]::ReadAllLines($f.FullName).Length
        } catch {
            # Skip unreadable/binary files silently
        }
    }
    $results[$ext] = [pscustomobject]@{
        Files = $files.Count
        Lines = $lineCount
    }
    $totalFiles += $files.Count
    $totalLines += $lineCount
}

"{0,-8} {1,10} {2,10}" -f 'EXT', 'FILES', 'LINES'
"{0,-8} {1,10} {2,10}" -f '---', '-----', '-----'
foreach ($ext in $extensions) {
    $r = $results[$ext]
    if ($r.Files -gt 0) {
        "{0,-8} {1,10} {2,10}" -f $ext, $r.Files, $r.Lines
    }
}
"{0,-8} {1,10} {2,10}" -f '---', '-----', '-----'
"{0,-8} {1,10} {2,10}" -f 'TOTAL', $totalFiles, $totalLines

if ($Save) {
    $historyFile = Join-Path $repoRoot 'scripts\loc-history.csv'
    if (-not (Test-Path -LiteralPath $historyFile)) {
        $header = @('timestamp', 'total_files', 'total_lines')
        foreach ($ext in $extensions) { $header += "${ext}_files"; $header += "${ext}_lines" }
        ($header -join ',') | Out-File -LiteralPath $historyFile -Encoding utf8
    }
    $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $row = @($ts, $totalFiles, $totalLines)
    foreach ($ext in $extensions) {
        $row += $results[$ext].Files
        $row += $results[$ext].Lines
    }
    ($row -join ',') | Add-Content -LiteralPath $historyFile -Encoding utf8
    Write-Output "Saved snapshot to scripts\loc-history.csv"
}
