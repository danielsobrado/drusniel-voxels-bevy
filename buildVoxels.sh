#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

clear_runtime_lock() {
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command '$p = Join-Path ([System.IO.Path]::GetTempPath()) "drusniel-voxels\runtime.lock"; if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }'
  else
    rm -f "${TMPDIR:-/tmp}/drusniel-voxels/runtime.lock"
  fi
}

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) taskkill.exe /IM "voxel_builder.exe" /T /F >/dev/null 2>&1 || true ;;
  *) pkill -f "voxel_builder" >/dev/null 2>&1 || true ;;
esac

clear_runtime_lock
cd "$repo_root"
exec rtk cargo build --release
