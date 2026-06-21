<#
.SYNOPSIS
Sync non-markdown files from drusniel-voxels-bevy into mapped destination repos.

.DESCRIPTION
Copies source files outside of markdown/docs into the Rust destination repo and
copies tools/clod-poc files into the web destination repo. Deletions are mirrored
for mapped target files. This script is safe to preview with -WhatIf.

.PARAMETER RustDest
Path to the Rust destination repo. Defaults to a sibling drusniel-voxels repo.

.PARAMETER WebDest
Path to the web destination repo. Defaults to a sibling drusniel-voxels-web repo.

.EXAMPLE
.\scripts\sync-dest.ps1

.EXAMPLE
.\scripts\sync-dest.ps1 -RustDest 'F:\Repos\drusniel-voxels' -WebDest 'F:\Repos\drusniel-voxels-web'

.EXAMPLE
.\scripts\sync-dest.ps1 -WhatIf
</#>[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Low')]
param(
    [string]$RustDest = 'F:\\Development\\workspace\\GitHub\\drusniel-voxels',
    [string]$WebDest = 'F:\\Development\\workspace\\GitHub\\drusniel-voxels-web'
)

$ErrorActionPreference = 'Stop'

function Resolve-RepoRoot {
    $repoRoot = (& rtk git rev-parse --show-toplevel).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
        throw 'Could not determine the repository root with git.'
    }
    return (Get-Item -LiteralPath $repoRoot).FullName
}

function Should-ExcludePath {
    param([string]$Path)
    if ($Path -like '*.md') { return $true }
    if ($Path -in @('AGENTS.md', 'CLAUDE.md')) { return $true }
    if ($Path -like 'docs/reference/*') { return $true }
    if ($Path -like 'node_modules/*') { return $true }
    if ($Path -eq 'scripts/sync-dest.ps1') { return $true }
    return $false
}

function Copy-SourceFile {
    param(
        [string]$Source,
        [string]$Dest
    )
    $destDir = Split-Path -Parent $Dest
    if (-not (Test-Path -LiteralPath $destDir -PathType Container)) {
        if ($PSCmdlet.ShouldProcess($destDir, 'Create destination directory')) {
            New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        }
    }
    if ($PSCmdlet.ShouldProcess($Source, "Copy to $Dest")) {
        Copy-Item -Force -LiteralPath $Source -Destination $Dest
    }
}

function Remove-DestFile {
    param([string]$Dest)
    if (Test-Path -LiteralPath $Dest -PathType Leaf) {
        if ($PSCmdlet.ShouldProcess($Dest, 'Remove destination file')) {
            Remove-Item -Force -LiteralPath $Dest
        }
    }
}

$SourceRoot = Resolve-RepoRoot
$RustDestRoot = (Get-Item -LiteralPath $RustDest).FullName
$WebDestRoot = (Get-Item -LiteralPath $WebDest).FullName

$StatusOutput = & git status --porcelain=1 -z -M --untracked-files=all 2>$null
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to read git status from the source repository.'
}

$Entries = if ([string]::IsNullOrEmpty($StatusOutput)) { @() } else { $StatusOutput -split "`0" }
$Copied = @()
$Deleted = @()

function Process-PathEntry {
    param(
        [string]$Path
    )
    if (Should-ExcludePath -Path $Path) { return }

    $sourceFile = Join-Path $SourceRoot $Path
    $destRoot = if ($Path -like 'tools/clod-poc/*') { $WebDestRoot } else { $RustDestRoot }
    $destRel = if ($Path -like 'tools/clod-poc/*') { $Path.Substring('tools/clod-poc/'.Length) } else { $Path }
    $destFile = Join-Path $destRoot $destRel

    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
        Remove-DestFile -Dest $destFile
        $Deleted += $destRel
        return
    }

    Copy-SourceFile -Source $sourceFile -Dest $destFile
    $Copied += $destRel
}

for ($i = 0; $i -lt $Entries.Count; $i++) {
    $entry = $Entries[$i]
    if ([string]::IsNullOrEmpty($entry)) { continue }

    $status = $entry.Substring(0, 2)
    if ($status.StartsWith('R') -or $status.StartsWith('C')) {
        $oldPath = $entry.Substring(3)
        $i++
        if ($i -ge $Entries.Count) { break }
        $newPath = $Entries[$i]
        if (-not [string]::IsNullOrEmpty($newPath)) {
            if (-not (Should-ExcludePath -Path $oldPath) -and -not (Should-ExcludePath -Path $newPath)) {
                $oldDestRoot = if ($oldPath -like 'tools/clod-poc/*') { $WebDestRoot } else { $RustDestRoot }
                $newDestRoot = if ($newPath -like 'tools/clod-poc/*') { $WebDestRoot } else { $RustDestRoot }
                $oldDestRel = if ($oldPath -like 'tools/clod-poc/*') { $oldPath.Substring('tools/clod-poc/'.Length) } else { $oldPath }
                $newDestRel = if ($newPath -like 'tools/clod-poc/*') { $newPath.Substring('tools/clod-poc/'.Length) } else { $newPath }
                Remove-DestFile -Dest (Join-Path $oldDestRoot $oldDestRel)
                $Deleted += $oldDestRel
                Process-PathEntry -Path $newPath
            }
        }
        continue
    }

    $path = $entry.Substring(3)
    Process-PathEntry -Path $path
}

Write-Host '---'
Write-Host 'Copied files:'
if ($Copied.Count -gt 0) { $Copied | Sort-Object | Get-Unique | ForEach-Object { Write-Host "  $_" } } else { Write-Host '  none' }
Write-Host 'Deleted files:'
if ($Deleted.Count -gt 0) { $Deleted | Sort-Object | Get-Unique | ForEach-Object { Write-Host "  $_" } } else { Write-Host '  none' }
Write-Host '---'

Write-Host 'Rust destination status:'
Push-Location -LiteralPath $RustDestRoot
try { & git status --short --untracked-files=all } finally { Pop-Location }
Write-Host '---'
Write-Host 'Web destination status:'
Push-Location -LiteralPath $WebDestRoot
try { & git status --short --untracked-files=all } finally { Pop-Location }
