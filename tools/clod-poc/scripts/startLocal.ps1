param(
    [switch]$SkipBuild,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PackageJson = Join-Path $RepoRoot "package.json"
$NodeModules = Join-Path $RepoRoot "node_modules"
$Port = 5180
$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $NpmCommand) {
    $NpmCommand = Get-Command npm -ErrorAction Stop
}
$Npm = $NpmCommand.Source

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

function Stop-ProcessTree {
    param([int]$ProcessId)
    $Children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
    foreach ($Child in $Children) {
        Stop-ProcessTree -ProcessId $Child.ProcessId
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

while (Test-PortInUse -Port $Port) {
    $Port += 1
}

$Url = "http://127.0.0.1:$Port/"

Push-Location -LiteralPath $RepoRoot
try {
    if (-not (Test-Path -LiteralPath $NodeModules -PathType Container)) {
        Write-Host "Installing dependencies..."
        & $Npm install
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    if (-not $SkipBuild) {
        Write-Host "Building CLOD Pages..."
        & $Npm run build
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    Write-Host "Starting CLOD Pages at $Url"
    $Server = Start-Process -FilePath $Npm -ArgumentList @(
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
        if ($Server.ExitCode -ne 0) {
            exit $Server.ExitCode
        }
    } finally {
        if (-not $Server.HasExited) {
            Stop-ProcessTree -ProcessId $Server.Id
        }
    }
} finally {
    Pop-Location
}
