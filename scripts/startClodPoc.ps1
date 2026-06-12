param(
    [switch]$SkipBuild,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$RepoRoot = (& rtk git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($RepoRoot)) {
    throw "Could not determine the repository root."
}

$PocDir = Join-Path $RepoRoot "tools\clod-poc"
$PackageJson = Join-Path $PocDir "package.json"
$NodeModules = Join-Path $PocDir "node_modules"
$Url = "http://127.0.0.1:5173/drusniel-voxels-bevy/"

if (-not (Test-Path -LiteralPath $PackageJson -PathType Leaf)) {
    throw "Could not find tools/clod-poc/package.json from $RepoRoot"
}

Push-Location -LiteralPath $PocDir
try {
    if (-not (Test-Path -LiteralPath $NodeModules -PathType Container)) {
        Write-Host "Installing CLOD PoC dependencies..."
        & rtk npm install
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }

    if (-not $SkipBuild) {
        Write-Host "Building CLOD PoC..."
        & rtk npm run build
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }

    Write-Host "Starting CLOD PoC at $Url"
    $Server = Start-Process -FilePath "rtk" -ArgumentList @(
        "npm", "run", "dev", "--", "--host", "127.0.0.1"
    ) -WorkingDirectory $PocDir -NoNewWindow -PassThru

    try {
        $Deadline = (Get-Date).AddSeconds(30)
        do {
            if ($Server.HasExited) {
                throw "Vite exited before the viewer became ready."
            }
            Start-Sleep -Milliseconds 250
            try {
                $Ready = (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200
            } catch {
                $Ready = $false
            }
        } until ($Ready -or (Get-Date) -ge $Deadline)

        if (-not $Ready) {
            throw "Timed out waiting for $Url"
        }

        if (-not $NoBrowser) {
            Start-Process $Url
        }
        Write-Host "Press Ctrl+C to stop the server."
        Wait-Process -Id $Server.Id
    } finally {
        if (-not $Server.HasExited) {
            Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue
        }
    }
} finally {
    Pop-Location
}
