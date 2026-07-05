$runDir = "F:\Development\workspace\GitHub\drusniel-voxels-bevy\tools\clod-poc"
$logFile = Join-Path $runDir "acceptance-output.log"
$proc = Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "run accept:infinite-islands" -WorkingDirectory $runDir -RedirectStandardOutput $logFile -RedirectStandardError "${logFile}.err" -PassThru
Write-Host "Started PID: $($proc.Id)"
$deadline = (Get-Date).AddMinutes(45)
$reportFound = $false
while ((Get-Date) -lt $deadline -and $reportFound -eq $false) {
  Start-Sleep -Seconds 30
  $reports = Get-ChildItem -Path (Join-Path $runDir "acceptance-runs\infinite-islands") -Directory | Sort-Object Name -Descending
  if ($reports.Count -gt 0) {
    $latest = $reports[0].FullName
    $reportJson = Join-Path $latest "report.json"
    if (Test-Path $reportJson) {
      Write-Host "report.json found at $reportJson"
      $reportFound = $true
    }
  }
  $lastLines = Get-Content $logFile -Tail 3 -ErrorAction SilentlyContinue
  Write-Host "Last output lines:"
  $lastLines | ForEach-Object { Write-Host "  $_" }
}
if (-not $reportFound) {
  Write-Host "TIMEOUT: report.json not found within 45 minutes"
  Write-Host "Killing process PID $($proc.Id)"
  Stop-Process -Id $proc.Id -Force
}
Write-Host "DONE"
