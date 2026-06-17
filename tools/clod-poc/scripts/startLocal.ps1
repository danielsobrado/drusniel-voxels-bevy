param(
    [switch]$SkipBuild,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PackageJson = Join-Path $RepoRoot "package.json"
$NodeModules = Join-Path $RepoRoot "node_modules"
$BasePath = "/drusniel-voxels-web/"
$Port = 5173

if (-not (Test-Path -LiteralPath $PackageJson -PathType Leaf)) {
    throw "Could not find package.json from $RepoRoot"
}

function Test-PortInUse {
    param([int]$Port)
    try {
        $Client = [System.Net.Sockets.TcpClient]::new()
        $Async = $Client.BeginConnect("127.0.0.1", $Port, $null, $null)
        $Ready = $Async.AsyncWaitHandle.WaitOne(150)
        if ($Ready) {
            $Client.EndConnect($Async)
            return $true
        }
        return $false
    } catch {
        return $false
    } finally {
        if ($Client) { $Client.Dispose() }
    }
}

while (Test-PortInUse -Port $Port) {
    $Port += 1
}

$Url = "http://127.0.0.1:$Port$BasePath"

Push-Location -LiteralPath $RepoRoot
try {
    if (-not (Test-Path -LiteralPath $NodeModules -PathType Container)) {
        Write-Host "Installing dependencies..."
        & npm install
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    if (-not $SkipBuild) {
        Write-Host "Building CLOD Pages..."
        & npm run build
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    Write-Host "Starting CLOD Pages at $Url"
    $Server = Start-Process -FilePath "npm" -ArgumentList @(
        "run", "dev", "--", "--host", "127.0.0.1", "--port", "$Port", "--strictPort"
    ) -WorkingDirectory $RepoRoot -NoNewWindow -PassThru

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
