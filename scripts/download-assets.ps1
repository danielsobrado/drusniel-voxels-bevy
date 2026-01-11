<#
.SYNOPSIS
    Downloads free foliage assets for voxel-builder project.
.DESCRIPTION
    Downloads CC0 licensed assets from Quaternius and Kenney.
    Extracts and organizes them to match props.yaml configuration.
.NOTES
    Run from project root: .\scripts\download-assets.ps1
#>

param(
    [switch]$Force,
    [string]$AssetsDir = "assets/models"
)

$ErrorActionPreference = "Stop"

# URLs for asset packs
$Downloads = @{
    "quaternius_nature" = @{
        Url = "https://quaternius.com/packs/stylizednature.html"
        DirectUrl = "https://dl.dropbox.com/scl/fi/6kl1gj8k0nh4h8l9k0k0j/Stylized_Nature_MegaKit.zip?rlkey=stylizednature"
        # Quaternius uses Dropbox - we'll try the Poly Pizza mirror
        AltUrl = "https://poly.pizza/bundle/Stylized-Nature-Mega-Kit-1"
    }
    "kenney_nature" = @{
        Url = "https://kenney.nl/assets/nature-kit"
        DirectUrl = "https://kenney.nl/media/pages/assets/nature-kit/8334871c74-1677698939/kenney_nature-kit.zip"
    }
    "kenney_holiday" = @{
        Url = "https://kenney.nl/assets/holiday-kit"  
        DirectUrl = "https://kenney.nl/media/pages/assets/holiday-kit/a0f0c0e0f0-1733920108/kenney_holiday-kit.zip"
    }
}

# File mappings: source pattern -> destination
$FileMappings = @{
    # Trees
    "Pine_1.glb" = "trees/pine_large.glb"
    "Pine_2.glb" = "trees/pine_small.glb"
    "PineTree*.glb" = "trees/pine_large.glb"
    "Tree_1.glb" = "trees/oak.glb"
    "Tree_Oak*.glb" = "trees/oak.glb"
    "Tree_Birch*.glb" = "trees/birch.glb"
    "Birch*.glb" = "trees/birch.glb"
    
    # Rocks
    "Rock_1.glb" = "rocks/boulder_large.glb"
    "Rock_2.glb" = "rocks/boulder_small.glb"
    "Rock_3.glb" = "rocks/rock_flat.glb"
    "Boulder*.glb" = "rocks/boulder_large.glb"
    "Stone*.glb" = "rocks/boulder_small.glb"
    
    # Plants
    "Bush_1.glb" = "plants/bush_green.glb"
    "Bush*.glb" = "plants/bush_green.glb"
    "Fern*.glb" = "plants/fern.glb"
    "Plant_Fern*.glb" = "plants/fern.glb"
    "Shrub*.glb" = "plants/shrub.glb"
    
    # Flowers
    "Flower_1.glb" = "plants/flower_red.glb"
    "Flower_2.glb" = "plants/flower_yellow.glb"
    "Flower_Red*.glb" = "plants/flower_red.glb"
    "Flower_Yellow*.glb" = "plants/flower_yellow.glb"
    "Mushroom*.glb" = "plants/mushroom.glb"
}

function Write-Header($text) {
    Write-Host ""
    Write-Host ("=" * 60) -ForegroundColor Cyan
    Write-Host (" " + $text) -ForegroundColor Cyan
    Write-Host ("=" * 60) -ForegroundColor Cyan
}

function Write-Step($text) {
    Write-Host "  -> $text" -ForegroundColor Yellow
}

function Write-Success($text) {
    Write-Host "  OK $text" -ForegroundColor Green
}

function Write-Warning($text) {
    Write-Host "  WARN $text" -ForegroundColor DarkYellow
}

function Write-Error($text) {
    Write-Host "  ERR $text" -ForegroundColor Red
}

# Create directories
function Initialize-Directories {
    Write-Header "Initializing directories"
    
    $dirs = @(
        "$AssetsDir/trees",
        "$AssetsDir/rocks", 
        "$AssetsDir/plants",
        "temp/downloads"
    )
    
    foreach ($dir in $dirs) {
        if (!(Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Write-Step "Created: $dir"
        }
    }
    Write-Success "Directories ready"
}

# Download file with progress
function Get-AssetPack {
    param(
        [string]$Name,
        [string]$Url,
        [string]$OutputPath
    )
    
    if ((Test-Path $OutputPath) -and !$Force) {
        Write-Warning "$Name already downloaded. Use -Force to re-download."
        return $true
    }
    
    Write-Step "Downloading $Name..."
    
    try {
        $webClient = New-Object System.Net.WebClient
        $webClient.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        $webClient.DownloadFile($Url, $OutputPath)
        Write-Success "Downloaded: $Name"
        return $true
    }
    catch {
        Write-Error "Failed to download $Name : $_"
        return $false
    }
}

# Extract ZIP
function Expand-AssetPack {
    param(
        [string]$ZipPath,
        [string]$ExtractPath
    )
    
    if (!(Test-Path $ZipPath)) {
        Write-Error "ZIP not found: $ZipPath"
        return $false
    }
    
    Write-Step "Extracting $(Split-Path $ZipPath -Leaf)..."
    
    try {
        if (Test-Path $ExtractPath) {
            Remove-Item -Recurse -Force $ExtractPath
        }
        Expand-Archive -Path $ZipPath -DestinationPath $ExtractPath -Force
        Write-Success "Extracted to: $ExtractPath"
        return $true
    }
    catch {
        Write-Error "Failed to extract: $_"
        return $false
    }
}

# Find and copy matching files
function Copy-MappedAssets {
    param(
        [string]$SourceDir
    )
    
    Write-Step "Mapping assets to project structure..."
    
    $copied = 0
    $glbFiles = Get-ChildItem -Path $SourceDir -Recurse -Filter "*.glb" -ErrorAction SilentlyContinue
    
    foreach ($file in $glbFiles) {
        foreach ($pattern in $FileMappings.Keys) {
            if ($file.Name -like $pattern) {
                $destPath = Join-Path $AssetsDir $FileMappings[$pattern]
                $destDir = Split-Path $destPath -Parent
                
                if (!(Test-Path $destDir)) {
                    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
                }
                
                # Don't overwrite if exists (first match wins)
                if (!(Test-Path $destPath)) {
                    Copy-Item $file.FullName $destPath -Force
                    Write-Step "  $($file.Name) → $($FileMappings[$pattern])"
                    $copied++
                }
                break
            }
        }
    }
    
    # Also check for FBX and convert note
    $fbxFiles = Get-ChildItem -Path $SourceDir -Recurse -Filter "*.fbx" -ErrorAction SilentlyContinue
    if ($fbxFiles.Count -gt 0 -and $copied -eq 0) {
        Write-Warning "Found $($fbxFiles.Count) FBX files. Manual conversion to GLB required."
        Write-Warning "Use Blender: File → Import FBX → Export glTF 2.0 (.glb)"
    }
    
    return $copied
}

# Download from Kenney (reliable direct links)
function Get-KenneyAssets {
    Write-Header "Downloading Kenney Assets"
    
    $kenneyUrl = "https://kenney.nl/media/pages/assets/nature-kit/8334871c74-1677698939/kenney_nature-kit.zip"
    $zipPath = "temp/downloads/kenney_nature.zip"
    $extractPath = "temp/kenney_nature"
    
    if (Get-AssetPack -Name "Kenney Nature Kit" -Url $kenneyUrl -OutputPath $zipPath) {
        if (Expand-AssetPack -ZipPath $zipPath -ExtractPath $extractPath) {
            return Copy-MappedAssets -SourceDir $extractPath
        }
    }
    return 0
}

# Download from Quaternius via alternative sources
function Get-QuaterniusAssets {
    Write-Header "Downloading Quaternius Assets"
    
    Write-Warning "Quaternius uses Dropbox links that may expire."
    Write-Warning "If download fails, manually download from:"
    Write-Host "    https://quaternius.com/packs/stylizednature.html" -ForegroundColor White
    Write-Host "    https://poly.pizza/bundle/Stylized-Nature-Mega-Kit-1" -ForegroundColor White
    Write-Host ""
    
    # Try Poly Pizza API (aggregates Quaternius)
    $polyPizzaModels = @(
        @{ Name = "Pine Tree"; Id = "dGRxMPGSg2"; Dest = "trees/pine_large.glb" }
        @{ Name = "Oak Tree"; Id = "4vgRXzuzMl"; Dest = "trees/oak.glb" }
        @{ Name = "Birch Tree"; Id = "dGrT1BaSq1"; Dest = "trees/birch.glb" }
        @{ Name = "Rock Large"; Id = "3QAPN1KBDV"; Dest = "rocks/boulder_large.glb" }
        @{ Name = "Bush"; Id = "e5FVnZCBxN"; Dest = "plants/bush_green.glb" }
        @{ Name = "Fern"; Id = "1pKpTxY0"; Dest = "plants/fern.glb" }
        @{ Name = "Mushroom"; Id = "C7z5bCUkIK"; Dest = "plants/mushroom.glb" }
    )
    
    $downloaded = 0
    foreach ($model in $polyPizzaModels) {
        $destPath = Join-Path $AssetsDir $model.Dest
        if ((Test-Path $destPath) -and !$Force) {
            continue
        }
        
        $url = "https://models.poly.pizza/$($model.Id).glb"
        Write-Step "Trying: $($model.Name)..."
        
        try {
            $destDir = Split-Path $destPath -Parent
            if (!(Test-Path $destDir)) {
                New-Item -ItemType Directory -Path $destDir -Force | Out-Null
            }
            
            Invoke-WebRequest -Uri $url -OutFile $destPath -UseBasicParsing -ErrorAction Stop
            Write-Success "$($model.Name) → $($model.Dest)"
            $downloaded++
        }
        catch {
            Write-Warning "Could not download $($model.Name)"
        }
    }
    
    return $downloaded
}

# Generate placeholder models if downloads fail
function New-PlaceholderAssets {
    Write-Header "Checking for missing assets"
    
    $required = @(
        "trees/pine_large.glb",
        "trees/pine_small.glb",
        "trees/oak.glb",
        "rocks/boulder_large.glb",
        "rocks/boulder_small.glb",
        "plants/bush_green.glb",
        "plants/fern.glb",
        "plants/mushroom.glb"
    )
    
    $missing = @()
    foreach ($asset in $required) {
        $path = Join-Path $AssetsDir $asset
        if (!(Test-Path $path)) {
            $missing += $asset
        }
    }
    
    if ($missing.Count -eq 0) {
        Write-Success "All required assets present"
        return
    }
    
    Write-Warning "Missing $($missing.Count) assets:"
    foreach ($m in $missing) {
        Write-Host "    - $m" -ForegroundColor DarkYellow
    }
    
    Write-Host ""
    Write-Host "Manual download options:" -ForegroundColor White
    Write-Host "  1. Quaternius: https://quaternius.com/packs/stylizednature.html" -ForegroundColor Gray
    Write-Host "  2. Poly Pizza: https://poly.pizza/explore/Nature" -ForegroundColor Gray
    Write-Host "  3. Kenney: https://kenney.nl/assets/nature-kit" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Place GLB files in: $AssetsDir/<category>/" -ForegroundColor Gray
}

# Cleanup temp files
function Remove-TempFiles {
    if (Test-Path "temp") {
        Remove-Item -Recurse -Force "temp" -ErrorAction SilentlyContinue
    }
}

# Main execution
function Main {
    Write-Host ""
    Write-Host ("-" * 60) -ForegroundColor Magenta
    Write-Host "  VOXEL BUILDER - Asset Downloader" -ForegroundColor Magenta
    Write-Host "  Downloads CC0 foliage for Valheim/Skyrim look" -ForegroundColor Magenta
    Write-Host ("-" * 60) -ForegroundColor Magenta

    Initialize-Directories
    $totalAssets = 0
    
    # Try Kenney first (most reliable)
    $totalAssets += Get-KenneyAssets
    
    # Try Quaternius/Poly Pizza
    $totalAssets += Get-QuaterniusAssets
    
    # Check what's missing
    New-PlaceholderAssets
    
    # Cleanup
    Write-Header "Cleanup"
    Remove-TempFiles
    Write-Success "Temporary files removed"
    
    # Summary
    Write-Header "Summary"
    Write-Host "  Assets copied: $totalAssets" -ForegroundColor White
    Write-Host "  Location: $AssetsDir" -ForegroundColor White
    Write-Host ""
    
    if ($totalAssets -gt 0) {
        Write-Success "Ready to run: cargo run"
    }
    else {
        Write-Warning "No assets downloaded. See manual options above."
    }
    
    Write-Host ""
}

# Run
Main
