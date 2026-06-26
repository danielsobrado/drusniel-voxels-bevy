$modelDir = "F:\Development\workspace\GitHub\drusniel-voxels-bevy\tools\clod-poc\public\assets\construction\quaternius\rpg_items\models"
$iconSource = "F:\Development\workspace\GitHub\drusniel-voxels-bevy\tools\clod-poc\public\tmp\icons_temp\Icons"
$iconDest = "F:\Development\workspace\GitHub\drusniel-voxels-bevy\tools\clod-poc\public\assets\construction\quaternius\rpg_items\icons"

if (-not (Test-Path $iconDest)) { New-Item -ItemType Directory -Path $iconDest -Force | Out-Null }

$models = Get-ChildItem $modelDir -Filter "*.glb" | ForEach-Object { [System.IO.Path]::GetFileNameWithoutExtension($_.Name) }
$icons = Get-ChildItem $iconSource -Filter "*.png"

$copied = 0
foreach ($model in $models) {
  $modelClean = $model -replace '[_ ]', ''
  $found = $icons | Where-Object { ($_.BaseName -replace '[_ ]', '') -eq $modelClean } | Select-Object -First 1
  if (-not $found) {
    $found = $icons | Where-Object { $modelClean -like "*$($_.BaseName -replace '[_ ]', '')*" -or $_.BaseName -replace '[_ ]', '' -like "*$modelClean*" } | Select-Object -First 1
  }
  if ($found) {
    $destName = "$model.png"
    Copy-Item $found.FullName (Join-Path $iconDest $destName) -Force
    Write-Host "OK: $($found.Name) -> $destName"
    $copied++
  } else {
    Write-Host "MISS: $model"
  }
}
Write-Host "Done. Copied $copied icons."
