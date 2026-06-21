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
$Port = 5180
$Url = "http://127.0.0.1:$Port/"
$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $NpmCommand) {
    $NpmCommand = Get-Command npm -ErrorAction Stop
}
$Npm = $NpmCommand.Source

if (-not (Test-Path -LiteralPath $PackageJson -PathType Leaf)) {
    throw "Could not find tools/clod-poc/package.json from $RepoRoot"
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

function Get-ListeningProcessIds {
    param([int]$Port)
    $Connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return @($Connections | Where-Object { $_.OwningProcess -gt 0 } | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Stop-ProcessesUsingPort {
    param([int]$Port)
    $ProcessIds = @(Get-ListeningProcessIds -Port $Port)
    if ($ProcessIds.Count -eq 0) {
        throw "Port $Port is already in use, but Windows did not report an owning process."
    }

    $NormalizedPocDir = [System.IO.Path]::GetFullPath($PocDir).TrimEnd("\")
    foreach ($ProcessId in $ProcessIds) {
        $Process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        $ProcessName = if ($Process) { $Process.ProcessName } else { "unknown" }
        $ProcessDetails = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
        $Fingerprint = "$($ProcessDetails.ExecutablePath) $($ProcessDetails.CommandLine)".Replace("/", "\")
        if ($Fingerprint.IndexOf($NormalizedPocDir, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
            throw "Port $Port is owned by PID $ProcessId ($ProcessName), which does not look like this CLOD PoC. Stop it manually or free the port before launching."
        }

        Write-Host "Stopping existing CLOD PoC listener on port $Port (PID $ProcessId, $ProcessName)..."
        Stop-ProcessTree -ProcessId $ProcessId
    }

    $Deadline = (Get-Date).AddSeconds(10)
    while ((Test-PortInUse -Port $Port) -and (Get-Date) -lt $Deadline) {
        Start-Sleep -Milliseconds 250
    }

    if (Test-PortInUse -Port $Port) {
        throw "Port $Port is still in use after stopping the previous listener."
    }
}

Push-Location -LiteralPath $PocDir
try {
    if (-not (Test-Path -LiteralPath $NodeModules -PathType Container)) {
        Write-Host "Installing CLOD PoC dependencies..."
        & $Npm install
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }

    if (-not $SkipBuild) {
        Write-Host "Building CLOD PoC..."
        & $Npm run build
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }

    if (Test-PortInUse -Port $Port) {
        Stop-ProcessesUsingPort -Port $Port
    }

    Write-Host "Starting CLOD PoC at $Url"
    $Server = Start-Process -FilePath $Npm -ArgumentList @(
        "run", "dev", "--", "--host", "127.0.0.1", "--port", "$Port", "--strictPort"
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
