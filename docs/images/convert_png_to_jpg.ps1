# Convert PNG to JPG script
# Requires ImageMagick to be installed (https://imagemagick.org/)
# Run: .\convert_png_to_jpg.ps1

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

function Get-ImageMagickPath {
    # Prefer ImageMagick's "magick" binary. "convert" on Windows can be the system utility.
    $magickCmd = Get-Command magick -CommandType Application -ErrorAction SilentlyContinue
    $convertCmd = Get-Command convert -CommandType Application -ErrorAction SilentlyContinue

    if ($magickCmd) {
        return $magickCmd.Path
    }

    if ($convertCmd) {
        if (-not $IsWindows -or $convertCmd.Path -notlike "*\\System32\\convert.exe") {
            return $convertCmd.Path
        }
    }

    return $null
}

$convertPath = Get-ImageMagickPath

if (-not $convertPath) {
    Write-Host "ImageMagick not found." -ForegroundColor Yellow
    $installChoice = Read-Host "Install ImageMagick now? (Y/N)"

    if ($installChoice -match "^(y|yes)$") {
        $installed = $false

        if (Get-Command winget -ErrorAction SilentlyContinue) {
            & winget install --id ImageMagick.ImageMagick -e --accept-package-agreements --accept-source-agreements
            if ($LASTEXITCODE -eq 0) { $installed = $true }
        } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
            & choco install imagemagick -y
            if ($LASTEXITCODE -eq 0) { $installed = $true }
        } elseif (Get-Command scoop -ErrorAction SilentlyContinue) {
            & scoop install imagemagick
            if ($LASTEXITCODE -eq 0) { $installed = $true }
        } else {
            Write-Host "No supported package manager found. Please install from https://imagemagick.org/" -ForegroundColor Red
            exit 1
        }

        if (-not $installed) {
            Write-Host "ImageMagick installation failed. Please install manually." -ForegroundColor Red
            exit 1
        }

        $convertPath = Get-ImageMagickPath
        if (-not $convertPath) {
            Write-Host "ImageMagick still not available after install. Please check your PATH." -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "Install cancelled." -ForegroundColor Red
        exit 1
    }
}

$pngFiles = Get-ChildItem -Path . -File | Where-Object { $_.Extension -ieq ".png" }

if (-not $pngFiles) {
    Write-Host "No PNG files found in $scriptDir"
    exit 0
}

$pngList = @($pngFiles)
Write-Host "Found $($pngList.Count) PNG file(s) to convert..."

$converted = 0
$failed = 0

foreach ($png in $pngList) {
    $jpgName = [System.IO.Path]::ChangeExtension($png.Name, ".jpg")
    $jpgPath = Join-Path $scriptDir $jpgName

    Write-Host "Converting: $($png.Name) -> $jpgName"

    try {
        $result = & $convertPath $png.FullName -quality 90 $jpgPath 2>&1

        if ($LASTEXITCODE -eq 0 -and (Test-Path $jpgPath)) {
            # Verify the JPG was created and has content
            $jpgFile = Get-Item $jpgPath
            if ($jpgFile.Length -gt 0) {
                Remove-Item $png.FullName -Force
                Write-Host "  Success! Deleted $($png.Name)" -ForegroundColor Green
                $converted++
            } else {
                Write-Host "  Error: JPG file is empty, keeping PNG" -ForegroundColor Red
                Remove-Item $jpgPath -Force -ErrorAction SilentlyContinue
                $failed++
            }
        } else {
            Write-Host "  Error: Conversion failed - $result" -ForegroundColor Red
            $failed++
        }
    }
    catch {
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  Make sure ImageMagick is installed: https://imagemagick.org/" -ForegroundColor Yellow
        $failed++
    }
}

Write-Host ""
Write-Host "Conversion complete: $converted succeeded, $failed failed"
