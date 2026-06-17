param(
    [switch]$SkipTests,
    [string]$Remote = $(if ($env:REMOTE) { $env:REMOTE } else { "origin" }),
    [string]$Branch = $(if ($env:BRANCH) { $env:BRANCH } else { "gh-pages" })
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DistDir = Join-Path $RepoRoot "dist"
$PackageJson = Join-Path $RepoRoot "package.json"

if (-not (Test-Path -LiteralPath $PackageJson -PathType Leaf)) {
    throw "Could not find package.json from $RepoRoot"
}

$RemoteUrl = (& git -C $RepoRoot remote get-url $Remote).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($RemoteUrl)) {
    throw "Could not read remote '$Remote'."
}

$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("clod-pages-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TmpDir | Out-Null

try {
    Push-Location -LiteralPath $RepoRoot
    try {
        Write-Host "Installing dependencies..."
        & npm install
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

        if (-not $SkipTests) {
            Write-Host "Running tests and typecheck..."
            & npm test
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
            & npm run typecheck
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        } else {
            Write-Host "Skipping tests and typecheck."
        }

        Write-Host "Building CLOD Pages..."
        & npm run build
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }

    $IndexHtml = Join-Path $DistDir "index.html"
    if (-not (Test-Path -LiteralPath $IndexHtml -PathType Leaf)) {
        throw "Build did not produce $IndexHtml"
    }

    Write-Host "Preparing $Branch contents in a temporary repository..."
    Copy-Item -Path (Join-Path $DistDir "*") -Destination $TmpDir -Recurse -Force
    New-Item -Path (Join-Path $TmpDir ".nojekyll") -ItemType File -Force | Out-Null

    Push-Location -LiteralPath $TmpDir
    try {
        & git init -q
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & git checkout -q -b $Branch
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & git add .
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & git -c user.name="GitHub Pages Deploy" -c user.email="pages-deploy@users.noreply.github.com" commit -q -m "Deploy CLOD Pages to GitHub Pages"
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & git remote add $Remote $RemoteUrl
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & git push $Remote "$Branch`:$Branch" --force
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }

    Write-Host "Published dist to $Remote/$Branch."
} finally {
    Remove-Item -LiteralPath $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
