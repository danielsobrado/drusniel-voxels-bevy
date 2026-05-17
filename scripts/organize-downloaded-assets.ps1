<#
.SYNOPSIS
    Simple asset organizer for manual downloads.
.DESCRIPTION
    Scans Downloads for ZIPs, extracts, and sorts into assets/models.
.NOTES
    Run from project root: .\scripts\organize-downloaded-assets.ps1
#>

param(
    [string]$TargetDir = ".\\assets\\models",
    [string]$DownloadsFolder = "$env:USERPROFILE\\Downloads"
)

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

Write-Host ""
Write-ColorOutput "----------------------------------------" "Cyan"
Write-ColorOutput "  Asset Organizer - Manual Mode" "Cyan"
Write-ColorOutput "----------------------------------------" "Cyan"
Write-Host ""

$assetMap = @{
    "*nature*mega*" = @{
        Name = "Quaternius Nature MEGAKIT"
        Dest = "$TargetDir"
    }
    "*forest*" = @{
        Name = "KayKit Forest Pack"
        Dest = "$TargetDir"
    }
    "*nature*kit*" = @{
        Name = "Kenney Nature Kit"
        Dest = "$TargetDir"
    }
    "*crop*" = @{
        Name = "Quaternius Crops"
        Dest = "$TargetDir/vegetation/crops/quaternius"
    }
    "*resource*" = @{
        Name = "KayKit Resources"
        Dest = "$TargetDir/props/resources/kaykit"
    }
}

Write-ColorOutput "Creating directory structure..." "Yellow"
$directories = @(
    "$TargetDir/rocks/quaternius",
    "$TargetDir/rocks/kaykit",
    "$TargetDir/rocks/kenney",
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
    }
}
Write-ColorOutput "Directories created" "Green"
Write-Host ""

Write-ColorOutput "Scanning Downloads folder: $DownloadsFolder" "Yellow"
Write-Host ""

$foundZips = Get-ChildItem -Path $DownloadsFolder -Filter "*.zip" -File -ErrorAction SilentlyContinue

if ($foundZips.Count -eq 0) {
    Write-ColorOutput "No ZIP files found in Downloads folder" "Red"
    Write-Host ""
    Write-ColorOutput "Please download these assets first:" "Cyan"
    Write-Host "  1. Quaternius Nature MEGAKIT: https://quaternius.itch.io/stylized-nature-megakit"
    Write-Host "  2. KayKit Forest Pack: https://kaylousberg.itch.io/kaykit-forest"
    Write-Host "  3. Kenney Nature Kit: https://kenney.nl/assets/nature-kit"
    Write-Host ""
    Write-Host "After downloading, run this script again."
    exit
}

Write-ColorOutput "Found $($foundZips.Count) ZIP files:" "Green"
foreach ($zip in $foundZips) {
    $sizeMB = [math]::Round($zip.Length / 1MB, 2)
    Write-Host "  - $($zip.Name) ($sizeMB MB)"
}
Write-Host ""

$organized = 0

foreach ($zip in $foundZips) {
    $matched = $false

    foreach ($pattern in $assetMap.Keys) {
        if ($zip.Name -like $pattern) {
            $asset = $assetMap[$pattern]
            Write-ColorOutput "Processing: $($asset.Name)" "Cyan"
            Write-Host "  Source: $($zip.Name)"
            Write-Host "  Destination: $($asset.Dest)"

            $targetZip = "$TargetDir/_downloads/$($zip.Name)"
            Copy-Item -Path $zip.FullName -Destination $targetZip -Force

            try {
                Add-Type -AssemblyName System.IO.Compression.FileSystem
                [System.IO.Compression.ZipFile]::ExtractToDirectory($targetZip, $asset.Dest)
                Write-ColorOutput "  Extracted successfully" "Green"
                $organized++
                $matched = $true
                break
            }
            catch {
                Write-ColorOutput "  Extraction failed: $_" "Red"
            }

            Write-Host ""
        }
    }

    if (-not $matched) {
        Write-ColorOutput "Unknown ZIP: $($zip.Name)" "Yellow"
        Write-Host "  To manually organize, extract to: $TargetDir"
        Write-Host ""
    }
}

Write-ColorOutput "Organizing assets by type..." "Yellow"

$kenneyExtracted = Get-ChildItem -Path $TargetDir -Directory -Filter "*kenney*" -Recurse -ErrorAction SilentlyContinue
foreach ($kenneyDir in $kenneyExtracted) {
    $objFiles = Get-ChildItem -Path $kenneyDir.FullName -Filter "*.obj" -Recurse
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
            Copy-Item -Path $obj.FullName -Destination $destPath -Force -ErrorAction SilentlyContinue
        }
    }
}

$quaterniusDirs = Get-ChildItem -Path $TargetDir -Directory -Filter "*quaternius*" -Recurse -ErrorAction SilentlyContinue
foreach ($qDir in $quaterniusDirs) {
    $subfolders = Get-ChildItem -Path $qDir.FullName -Directory -ErrorAction SilentlyContinue
    foreach ($folder in $subfolders) {
        $folderName = $folder.Name.ToLower()
        if ($folderName -match "rock") {
            Copy-Item -Path "$($folder.FullName)\\*" -Destination "$TargetDir/rocks/quaternius" -Recurse -Force -ErrorAction SilentlyContinue
        }
        elseif ($folderName -match "tree") {
            Copy-Item -Path "$($folder.FullName)\\*" -Destination "$TargetDir/vegetation/trees/quaternius" -Recurse -Force -ErrorAction SilentlyContinue
        }
        elseif ($folderName -match "plant|flower") {
            Copy-Item -Path "$($folder.FullName)\\*" -Destination "$TargetDir/vegetation/plants_flowers/quaternius" -Recurse -Force -ErrorAction SilentlyContinue
        }
        elseif ($folderName -match "grass|bush") {
            Copy-Item -Path "$($folder.FullName)\\*" -Destination "$TargetDir/vegetation/grass_bushes/quaternius" -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

$kaykitDirs = Get-ChildItem -Path $TargetDir -Directory -Filter "*kaykit*" -Recurse -ErrorAction SilentlyContinue
foreach ($kDir in $kaykitDirs) {
    $modelFolders = Get-ChildItem -Path $kDir.FullName -Directory -Filter "*odel*" -Recurse -ErrorAction SilentlyContinue
    foreach ($modelsFolder in $modelFolders) {
        $files = Get-ChildItem -Path $modelsFolder.FullName -File -ErrorAction SilentlyContinue
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
                Copy-Item -Path $file.FullName -Destination $destPath -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Write-ColorOutput "Organization complete" "Green"
Write-Host ""

Write-ColorOutput "Generating asset inventory..." "Yellow"

$inventory = @"
# Nature Assets Inventory
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

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

$totalCount = 0

foreach ($category in $categories) {
    if (Test-Path $category.Path) {
        $count = (Get-ChildItem -Path $category.Path -File -Recurse | Where-Object { $_.Extension -match "\.(fbx|obj|gltf|glb)$" }).Count
        $inventory += "`n### $($category.Name): $count models"
        $totalCount += $count
        $sources = Get-ChildItem -Path $category.Path -Directory -ErrorAction SilentlyContinue
        foreach ($source in $sources) {
            $sourceCount = (Get-ChildItem -Path $source.FullName -File -Recurse | Where-Object { $_.Extension -match "\.(fbx|obj|gltf|glb)$" }).Count
            if ($sourceCount -gt 0) {
                $inventory += "`n- $($source.Name): $sourceCount"
            }
        }
    }
}

$inventoryPath = "$TargetDir/asset-inventory.md"
Set-Content -Path $inventoryPath -Value $inventory

Write-ColorOutput "Inventory saved to: asset-inventory.md" "Green"
Write-Host ""

Write-ColorOutput "----------------------------------------" "Cyan"
Write-ColorOutput "  Summary" "Cyan"
Write-ColorOutput "----------------------------------------" "Cyan"
Write-Host ""
Write-ColorOutput "ZIPs processed: $organized" "Green"
Write-ColorOutput "Total models found: $totalCount" "Green"
Write-ColorOutput "Organized into: $TargetDir" "Green"
Write-Host ""

if ($organized -lt 3) {
    Write-ColorOutput "Missing some essential packs" "Yellow"
    Write-Host ""
    Write-ColorOutput "Recommended downloads:" "Cyan"
    Write-Host "  Priority 1 (essential):"
    Write-Host "    - Quaternius Nature MEGAKIT: https://quaternius.itch.io/stylized-nature-megakit"
    Write-Host "    - KayKit Forest Pack: https://kaylousberg.itch.io/kaykit-forest"
    Write-Host "    - Kenney Nature Kit: https://kenney.nl/assets/nature-kit"
    Write-Host ""
    Write-Host "After downloading, run this script again."
    Write-Host ""
}

Write-ColorOutput "Next steps:" "Cyan"
Write-Host "  1. Review inventory: Get-Content $inventoryPath"
Write-Host "  2. Check assets in: $TargetDir"
Write-Host "  3. Start integrating into Bevy"
Write-Host ""
