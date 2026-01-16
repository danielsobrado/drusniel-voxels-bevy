<#
.SYNOPSIS
    Converts grass .blend assets in temp to GLB files for Bevy props.
.DESCRIPTION
    Finds *.blend under temp and exports GLB assets to assets/models/plants/custom.
.NOTES
    Run from project root: .\scripts\convert-grass-assets.ps1
#>

param(
    [string]$BlenderPath = "blender",
    [string]$InputDir = "temp",
    [string]$OutputDir = "assets/models/plants/custom",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

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

function Resolve-BlenderPath {
    param([string]$Path)

    if (Test-Path $Path) {
        return (Resolve-Path $Path).Path
    }

    $cmd = Get-Command $Path -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    return $null
}

Write-Header "Converting grass .blend assets to GLB"

$blender = Resolve-BlenderPath $BlenderPath
if (-not $blender) {
    Write-Error "Blender not found. Set -BlenderPath to blender.exe or add Blender to PATH."
}

if (!(Test-Path $InputDir)) {
    Write-Error "Input directory not found: $InputDir"
}

if (!(Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    Write-Step "Created output directory: $OutputDir"
}

$blendFiles = Get-ChildItem -Path $InputDir -Recurse -Filter *.blend -File
if ($blendFiles.Count -eq 0) {
    Write-Error "No .blend files found under: $InputDir"
}

foreach ($blend in $blendFiles) {
    $outPath = Join-Path $OutputDir ($blend.BaseName + ".glb")
    if ((Test-Path $outPath) -and -not $Force) {
        Write-Warning "Skipping existing: $outPath (use -Force to overwrite)"
        continue
    }

    $pyOut = ($outPath -replace "\\\\", "/")
    $py = @'
import bpy

keep = []
for obj in bpy.data.objects:
    if obj.type != 'MESH':
        continue
    name = obj.name
    if name.endswith('_LOD0') and 'geometry_nodes' not in name:
        keep.append(obj)

geonodes = [o for o in keep if 'geonodes' in o.name]
if geonodes:
    keep = geonodes

if not keep:
    keep = [o for o in bpy.data.objects if o.type == 'MESH']

for obj in bpy.data.objects:
    obj.select_set(False)

for obj in list(bpy.data.objects):
    if obj not in keep:
        obj.select_set(True)

if bpy.context.selected_objects:
    bpy.ops.object.delete()

out_path = r"__OUT__"
bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_apply=True, export_image_format='AUTO')
'@
    $py = $py.Replace('__OUT__', $pyOut)

    Write-Step "Exporting: $($blend.FullName) -> $outPath"
    $tmpFile = New-TemporaryFile
    Set-Content -Path $tmpFile.FullName -Value $py -Encoding ASCII
    try {
        & $blender -b $blend.FullName --python $tmpFile.FullName
    } finally {
        Remove-Item -Path $tmpFile.FullName -Force -ErrorAction SilentlyContinue
    }
}

Write-Success "Conversion complete"
