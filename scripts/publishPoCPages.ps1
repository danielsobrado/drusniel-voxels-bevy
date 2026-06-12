param(
    [switch]$SkipTests,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

function Show-Usage {
    Write-Host @"
Usage: scripts/publishPoCPages.ps1 [-SkipTests]

Build and publish tools/clod-poc/dist to the gh-pages branch for GitHub Pages.

Environment:
  REMOTE   Git remote to push to. Default: origin
  BRANCH   Pages branch to force-update. Default: gh-pages
"@
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & rtk $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command exited with code $LASTEXITCODE"
    }
}

if ($Help) {
    Show-Usage
    exit 0
}

$RepoRoot = (& rtk git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($RepoRoot)) {
    throw "Could not determine the repository root."
}

$PocDir = Join-Path $RepoRoot "tools\clod-poc"
$DistDir = Join-Path $PocDir "dist"
$RemoteName = if ($env:REMOTE) { $env:REMOTE } else { "origin" }
$BranchName = if ($env:BRANCH) { $env:BRANCH } else { "gh-pages" }
$PackageJson = Join-Path $PocDir "package.json"

if (-not (Test-Path -LiteralPath $PackageJson -PathType Leaf)) {
    throw "Could not find tools/clod-poc/package.json from $RepoRoot"
}

$RemoteUrl = (& rtk git -C $RepoRoot remote get-url $RemoteName).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($RemoteUrl)) {
    throw "Could not resolve Git remote '$RemoteName'."
}

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("drusniel-clod-pages-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $TempDir | Out-Null

try {
    Write-Host "Installing CLOD PoC dependencies..."
    Push-Location -LiteralPath $PocDir
    try {
        Invoke-Native npm install

        if (-not $SkipTests) {
            Write-Host "Running CLOD PoC tests and typecheck..."
            Invoke-Native npm test
            Invoke-Native npm run typecheck
        } else {
            Write-Host "Skipping tests and typecheck."
        }

        Write-Host "Building CLOD PoC..."
        Invoke-Native npm run build
    } finally {
        Pop-Location
    }

    $IndexHtml = Join-Path $DistDir "index.html"
    if (-not (Test-Path -LiteralPath $IndexHtml -PathType Leaf)) {
        throw "Build did not produce $IndexHtml"
    }

    Write-Host "Preparing $BranchName contents in a temporary repository..."
    Copy-Item -Path (Join-Path $DistDir "*") -Destination $TempDir -Recurse -Force
    New-Item -ItemType File -Path (Join-Path $TempDir ".nojekyll") -Force | Out-Null

    Push-Location -LiteralPath $TempDir
    try {
        Invoke-Native git init -q
        Invoke-Native git checkout -q -b $BranchName
        Invoke-Native git add .
        Invoke-Native -Command git -Arguments @(
            "-c", "user.name=GitHub Pages Deploy",
            "-c", "user.email=pages-deploy@users.noreply.github.com",
            "commit", "-q", "-m", "Deploy CLOD PoC to GitHub Pages"
        )
        Invoke-Native git remote add $RemoteName $RemoteUrl
        Invoke-Native git push $RemoteName "${BranchName}:${BranchName}" --force
    } finally {
        Pop-Location
    }

    Write-Host "Published tools/clod-poc/dist to $RemoteName/$BranchName."
} finally {
    if (Test-Path -LiteralPath $TempDir) {
        Remove-Item -LiteralPath $TempDir -Recurse -Force
    }
}
