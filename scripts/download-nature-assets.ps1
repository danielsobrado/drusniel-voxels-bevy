<#
.SYNOPSIS
    Free nature assets downloader for voxel game (semi-automated).
.DESCRIPTION
    Opens download pages, waits for ZIPs in Downloads, then extracts and organizes.
    This avoids direct scraping of sites that require sessions/cookies.
.NOTES
    Run from project root: .\scripts\download-nature-assets.ps1
#>

param(
    [string]$TargetDir = ".\\assets\\models",
    [string]$DownloadsFolder = "$env:USERPROFILE\\Downloads",
    [switch]$SkipExisting = $true,
    [switch]$WatchMode = $false,
    [switch]$OpenBrowser = $true
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ColorMap = @{
    Reset = "`e[0m"
    Green = "`e[32m"
    Yellow = "`e[33m"
    Blue = "`e[34m"
    Red = "`e[31m"
    Cyan = "`e[36m"
}

function Write-ColorOutput {
    param([string]$Message, [string]$Color = "Reset")
    Write-Host "$($ColorMap[$Color])$Message$($ColorMap.Reset)"
}

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-ColorOutput "========================================" "Cyan"
    Write-ColorOutput "  $Title" "Cyan"
    Write-ColorOutput "========================================" "Cyan"
}

function Open-BrowserUrl {
    param([string]$Url, [string]$Description)

    if ($OpenBrowser) {
        Write-ColorOutput "Opening: $Description" "Cyan"
        Start-Process $Url
        Start-Sleep -Seconds 2
    }
}

function Find-NewDownload {
    param(
        [string]$Pattern,
        [string]$FolderPath = $DownloadsFolder
    )

    $files = Get-ChildItem -Path $FolderPath -Filter $Pattern -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    return $files
}

function Wait-ForDownload {
    param(
        [string]$Pattern,
        [int]$TimeoutSeconds = 300,
        [string]$Description
    )

    Write-ColorOutput "Waiting for download: $Description" "Yellow"
    Write-Host "  Looking for: $Pattern in $DownloadsFolder"
    Write-Host "  Timeout: $TimeoutSeconds seconds"

    $elapsed = 0
    while ($elapsed -lt $TimeoutSeconds) {
        $file = Find-NewDownload -Pattern $Pattern

        if ($file) {
            Start-Sleep -Seconds 2
            $size1 = $file.Length
            Start-Sleep -Seconds 1
            $file = Get-Item $file.FullName
            $size2 = $file.Length

            if ($size1 -eq $size2) {
                Write-ColorOutput "  Found: $($file.Name)" "Green"
                return $file.FullName
            }
        }

        Start-Sleep -Seconds 2
        $elapsed += 2

        if ($elapsed % 10 -eq 0) {
            Write-Host "  Still waiting... ($elapsed/$TimeoutSeconds seconds)"
        }
    }

    Write-ColorOutput "  Timeout - download not detected" "Red"
    return $null
}

function Extract-ZipFile {
    param(
        [string]$ZipPath,
        [string]$DestPath,
        [string]$Description
    )

    try {
        Write-ColorOutput "Extracting: $Description" "Yellow"

        if (-not (Test-Path $ZipPath)) {
            Write-ColorOutput "  ZIP file not found: $ZipPath" "Red"
            return $false
        }

        if (-not (Test-Path $DestPath)) {
            New-Item -ItemType Directory -Force -Path $DestPath | Out-Null
        }

        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $DestPath)

        Write-ColorOutput "  Extraction complete" "Green"
        return $true
    }
    catch {
        Write-ColorOutput "  Extraction failed: $_" "Red"
        return $false
    }
}

Write-Section "Free Nature Assets Downloader"
Write-Host "Target Directory: $TargetDir"
Write-Host "Skip Existing: $SkipExisting"
Write-Host ""

Write-Section "Creating Directory Structure"

$directories = @(
    "$TargetDir/rocks/quaternius",
    "$TargetDir/rocks/kaykit",
    "$TargetDir/rocks/kenney",
    "$TargetDir/rocks/polypizza",
    "$TargetDir/vegetation/trees/quaternius",
    "$TargetDir/vegetation/trees/kaykit",
    "$TargetDir/vegetation/trees/kenney",
    "$TargetDir/vegetation/plants_flowers/quaternius",
    "$TargetDir/vegetation/grass_bushes/quaternius",
    "$TargetDir/vegetation/grass_bushes/kaykit",
    "$TargetDir/vegetation/crops/quaternius",
    "$TargetDir/props/resources/kaykit",
    "$TargetDir/props/camping/kenney",
    "$TargetDir/_downloads"
)

foreach ($dir in $directories) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Write-ColorOutput "Created: $dir" "Green"
    } else {
        Write-ColorOutput "Already exists: $dir" "Blue"
    }
}

Write-Section "Asset Download Configuration"

$assetManifest = @{
    "Quaternius_NatureMegakit" = @{
        BrowserUrl = "https://quaternius.itch.io/stylized-nature-megakit"
        ExpectedFileName = "*nature*mega*.zip"
        TargetFileName = "quaternius_nature_megakit.zip"
        Dest = "$TargetDir"
        Description = "Quaternius Stylized Nature MEGAKIT"
        Priority = 1
        Instructions = @"
1. Click 'Download Now'
2. Enter $0 (or pay what you want)
3. Click 'No thanks, just take me to the downloads'
4. Download the ZIP (glTF or FBX)
"@
    }

    "KayKit_Forest" = @{
        BrowserUrl = "https://kaylousberg.itch.io/kaykit-forest"
        ExpectedFileName = "*forest*.zip"
        TargetFileName = "kaykit_forest.zip"
        Dest = "$TargetDir"
        Description = "KayKit Forest Nature Pack"
        Priority = 1
        Instructions = @"
1. Scroll to 'Download Now'
2. Click 'No thanks, just take me to the downloads'
3. Download the free version
"@
    }

    "Kenney_NatureKit" = @{
        BrowserUrl = "https://kenney.nl/assets/nature-kit"
        ExpectedFileName = "*nature*kit*.zip"
        TargetFileName = "kenney_nature_kit.zip"
        Dest = "$TargetDir"
        Description = "Kenney Nature Kit"
        Priority = 1
        Instructions = @"
1. Click 'Download this package'
2. Click 'Continue without donating'
3. Download the ZIP
"@
    }

    "Quaternius_Crops" = @{
        BrowserUrl = "https://poly.pizza/m/Ro6K0Yg7mx"
        ExpectedFileName = "*crop*.zip"
        TargetFileName = "quaternius_crops.zip"
        Dest = "$TargetDir/vegetation/crops/quaternius"
        Description = "Quaternius Crops Pack"
        Priority = 2
        Instructions = @"
1. Click the download button
2. Choose glTF format
3. Download the ZIP
"@
    }

    "KayKit_Resources" = @{
        BrowserUrl = "https://kaylousberg.itch.io/resource-bits"
        ExpectedFileName = "*resource*.zip"
        TargetFileName = "kaykit_resources.zip"
        Dest = "$TargetDir/props/resources/kaykit"
        Description = "KayKit Resource Bits"
        Priority = 2
        Instructions = @"
1. Scroll to 'Download Now'
2. Click 'No thanks, just take me to the downloads'
3. Download the free version
"@
    }
}

$sortedAssets = $assetManifest.GetEnumerator() | Sort-Object { $_.Value.Priority }

Write-Section "Semi-Automated Download Process"

Write-Host ""
Write-ColorOutput "This script will:" "Cyan"
Write-Host "  1. Open each download page in your browser"
Write-Host "  2. Show you exactly what to click"
Write-Host "  3. Watch your Downloads folder for the ZIP"
Write-Host "  4. Auto-extract and organize when it appears"
Write-Host ""

$downloadedAssets = @()
$satisfiedAssets = @()

foreach ($assetEntry in $sortedAssets) {
    $asset = $assetEntry.Value
    $assetKey = $assetEntry.Key

    Write-Host ""
    Write-ColorOutput "----------------------------------------" "Blue"
    Write-ColorOutput "$($asset.Description)" "Cyan"
    Write-ColorOutput "----------------------------------------" "Blue"
    Write-Host ""

    if ($assetKey -eq "Quaternius_Crops") {
        $cropsGlb = Join-Path $TargetDir "vegetation/crops/quaternius/Crops.glb"
        if (Test-Path $cropsGlb) {
            Write-ColorOutput "Crops.glb already present - skipping ZIP download" "Green"
            $satisfiedAssets += $assetKey
            continue
        }
    }

    $targetPath = "$TargetDir/_downloads/$($asset.TargetFileName)"
    if ((Test-Path $targetPath) -and $SkipExisting) {
        Write-ColorOutput "Already downloaded: $($asset.TargetFileName)" "Green"
        $downloadedAssets += @{
            Path = $targetPath
            Dest = $asset.Dest
            Description = $asset.Description
        }
        continue
    }

    Write-ColorOutput "Instructions:" "Yellow"
    Write-Host $asset.Instructions
    Write-Host ""

    $proceed = Read-Host "Press ENTER to open browser, or 's' to skip"
    if ($proceed -eq 's' -or $proceed -eq 'S') {
        Write-ColorOutput "Skipped" "Yellow"
        continue
    }

    Open-BrowserUrl -Url $asset.BrowserUrl -Description $asset.Description

    Write-Host ""
    Write-ColorOutput "Options:" "Cyan"
    Write-Host "  1. Wait for automatic detection (recommended)"
    Write-Host "  2. Skip to next (download manually later)"
    Write-Host "  3. I already downloaded it (specify path)"
    Write-Host ""

    $option = Read-Host "Choose option (1/2/3)"

    switch ($option) {
        "1" {
            $downloadedFile = Wait-ForDownload -Pattern $asset.ExpectedFileName -Description $asset.Description
            if ($downloadedFile) {
                Move-Item -Path $downloadedFile -Destination $targetPath -Force
                Write-ColorOutput "Moved to: $targetPath" "Green"
                $downloadedAssets += @{
                    Path = $targetPath
                    Dest = $asset.Dest
                    Description = $asset.Description
                }
            } else {
                Write-ColorOutput "Download not detected - you can manually organize later" "Yellow"
            }
        }
        "2" {
            Write-ColorOutput "Skipped - continue when ready" "Yellow"
        }
        "3" {
            $manualPath = Read-Host "Enter the full path to the downloaded ZIP"
            if (Test-Path $manualPath) {
                Copy-Item -Path $manualPath -Destination $targetPath -Force
                Write-ColorOutput "Copied to: $targetPath" "Green"
                $downloadedAssets += @{
                    Path = $targetPath
                    Dest = $asset.Dest
                    Description = $asset.Description
                }
            } else {
                Write-ColorOutput "File not found: $manualPath" "Red"
            }
        }
        default {
            Write-ColorOutput "Invalid option - skipping" "Yellow"
        }
    }
}

Write-Section "Extracting Downloaded Assets"

if ($downloadedAssets.Count -eq 0) {
    Write-ColorOutput "No assets to extract. Run again after downloading." "Yellow"
} else {
    foreach ($asset in $downloadedAssets) {
        if (Test-Path $asset.Path) {
            Extract-ZipFile -ZipPath $asset.Path -DestPath $asset.Dest -Description $asset.Description
        }
    }
}

Write-Section "Organizing Kenney Assets"

$kenneyExtracted = "$TargetDir/_downloads/kenney_nature_kit"
if (Test-Path $kenneyExtracted) {
    Write-ColorOutput "Organizing Kenney Nature Kit assets..." "Yellow"
    $objFiles = Get-ChildItem -Path $kenneyExtracted -Filter "*.obj" -Recurse
    foreach ($obj in $objFiles) {
        $name = $obj.BaseName.ToLower()
        $destPath = ""
        if ($name -match "rock|stone|boulder") {
            $destPath = "$TargetDir/rocks/kenney"
        }
        elseif ($name -match "tree|pine|oak|birch") {
            $destPath = "$TargetDir/vegetation/trees/kenney"
        }
        elseif ($name -match "plant|flower|bush|grass") {
            $destPath = "$TargetDir/vegetation/grass_bushes/kenney"
        }
        elseif ($name -match "tent|camp|fire") {
            $destPath = "$TargetDir/props/camping/kenney"
        }
        if ($destPath) {
            Copy-Item -Path $obj.FullName -Destination $destPath -Force
            Write-ColorOutput "  Moved: $($obj.Name) to $destPath" "Green"
        }
    }
}

Write-Section "Organizing Quaternius Assets"

$quaterniusExtracted = "$TargetDir/_downloads/quaternius_nature_megakit"
if (Test-Path $quaterniusExtracted) {
    Write-ColorOutput "Organizing Quaternius Nature MEGAKIT..." "Yellow"
    $subfolders = Get-ChildItem -Path $quaterniusExtracted -Directory
    foreach ($folder in $subfolders) {
        $folderName = $folder.Name.ToLower()
        if ($folderName -match "rock") {
            Copy-Item -Path "$($folder.FullName)\\*" -Destination "$TargetDir/rocks/quaternius" -Recurse -Force
            Write-ColorOutput "  Copied rocks from $($folder.Name)" "Green"
        }
        elseif ($folderName -match "tree") {
            Copy-Item -Path "$($folder.FullName)\\*" -Destination "$TargetDir/vegetation/trees/quaternius" -Recurse -Force
            Write-ColorOutput "  Copied trees from $($folder.Name)" "Green"
        }
        elseif ($folderName -match "plant|flower") {
            Copy-Item -Path "$($folder.FullName)\\*" -Destination "$TargetDir/vegetation/plants_flowers/quaternius" -Recurse -Force
            Write-ColorOutput "  Copied plants from $($folder.Name)" "Green"
        }
        elseif ($folderName -match "grass|bush") {
            Copy-Item -Path "$($folder.FullName)\\*" -Destination "$TargetDir/vegetation/grass_bushes/quaternius" -Recurse -Force
            Write-ColorOutput "  Copied grass/bushes from $($folder.Name)" "Green"
        }
    }
}

Write-Section "Organizing KayKit Assets"

$kaykitExtracted = "$TargetDir/_downloads/kaykit_forest"
if (Test-Path $kaykitExtracted) {
    Write-ColorOutput "Organizing KayKit Forest Pack..." "Yellow"
    $modelFolders = Get-ChildItem -Path $kaykitExtracted -Directory -Filter "*odel*" -Recurse
    foreach ($modelsFolder in $modelFolders) {
        $files = Get-ChildItem -Path $modelsFolder.FullName -File
        foreach ($file in $files) {
            $name = $file.BaseName.ToLower()
            $destPath = ""
            if ($name -match "rock|stone") {
                $destPath = "$TargetDir/rocks/kaykit"
            }
            elseif ($name -match "tree") {
                $destPath = "$TargetDir/vegetation/trees/kaykit"
            }
            elseif ($name -match "plant|flower|bush|grass") {
                $destPath = "$TargetDir/vegetation/grass_bushes/kaykit"
            }
            if ($destPath) {
                Copy-Item -Path $file.FullName -Destination $destPath -Force
            }
        }
    }
    Write-ColorOutput "  KayKit assets organized" "Green"
}

Write-Section "Generating Asset Inventory"

$inventoryPath = "$TargetDir/ASSET_INVENTORY.md"
$inventory = @"
# Nature Assets Inventory
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

## Directory Structure

```
assets/models/
|-- rocks/
|   |-- quaternius/
|   |-- kaykit/
|   |-- kenney/
|   `-- polypizza/
|
|-- vegetation/
|   |-- trees/
|   |   |-- quaternius/
|   |   |-- kaykit/
|   |   `-- kenney/
|   |
|   |-- plants_flowers/
|   |   `-- quaternius/
|   |
|   |-- grass_bushes/
|   |   |-- quaternius/
|   |   `-- kaykit/
|   |
|   `-- crops/
|       `-- quaternius/
|
`-- props/
    |-- resources/
    |   `-- kaykit/
    `-- camping/
        `-- kenney/
```

## Asset Counts
"@

$categories = @(
    @{Path = "$TargetDir/rocks"; Name = "Rocks"}
    @{Path = "$TargetDir/vegetation/trees"; Name = "Trees"}
    @{Path = "$TargetDir/vegetation/plants_flowers"; Name = "Plants & Flowers"}
    @{Path = "$TargetDir/vegetation/grass_bushes"; Name = "Grass & Bushes"}
    @{Path = "$TargetDir/vegetation/crops"; Name = "Crops"}
    @{Path = "$TargetDir/props"; Name = "Props"}
)

foreach ($category in $categories) {
    if (Test-Path $category.Path) {
        $count = (Get-ChildItem -Path $category.Path -File -Recurse | Where-Object { $_.Extension -match "\.(fbx|obj|gltf|glb)$" }).Count
        $inventory += "`n### $($category.Name): $count models"
        $sources = Get-ChildItem -Path $category.Path -Directory
        foreach ($source in $sources) {
            $sourceCount = (Get-ChildItem -Path $source.FullName -File -Recurse | Where-Object { $_.Extension -match "\.(fbx|obj|gltf|glb)$" }).Count
            $inventory += "`n- $($source.Name): $sourceCount"
        }
    }
}

$inventory += @"

## Sources & Licenses

- Quaternius: https://quaternius.com/ (CC0)
- Kay Lousberg (KayKit): https://kaylousberg.com/game-assets (CC0)
- Kenney: https://kenney.nl/ (CC0)
- Poly.pizza: https://poly.pizza/ (varies)
"@

Set-Content -Path $inventoryPath -Value $inventory
Write-ColorOutput "Inventory saved to: $inventoryPath" "Green"

Write-Section "Process Complete"

Write-Host ""
$processedCount = $downloadedAssets.Count + $satisfiedAssets.Count
Write-ColorOutput "Assets processed: $processedCount" "Green"
Write-ColorOutput "Directory structure created" "Green"
Write-ColorOutput "Asset inventory generated: $inventoryPath" "Green"

if ($processedCount -lt $assetManifest.Count) {
    $remaining = $assetManifest.Count - $processedCount
    Write-Host ""
    Write-ColorOutput "$remaining assets not yet downloaded" "Yellow"
    Write-Host "Run this script again after downloading remaining assets."
}

Write-Host ""
Write-ColorOutput "Next steps:" "Cyan"
Write-Host "  1. Review inventory: Get-Content $inventoryPath"
Write-Host "  2. Check assets in: $TargetDir"
Write-Host "  3. Start integrating into Bevy"
Write-Host ""
