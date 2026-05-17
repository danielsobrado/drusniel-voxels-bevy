#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
editor_root="$repo_root/editor/frontend"

clear_runtime_lock() {
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command '$p = Join-Path ([System.IO.Path]::GetTempPath()) "drusniel-voxels\runtime.lock"; if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }'
  else
    rm -f "${TMPDIR:-/tmp}/drusniel-voxels/runtime.lock"
  fi
}

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    taskkill.exe /IM "drusniel-editor-runtime-x86_64-pc-windows-msvc.exe" /T /F >/dev/null 2>&1 || true
    taskkill.exe /IM "drusniel_voxels_editor.exe" /T /F >/dev/null 2>&1 || true
    ;;
  *)
    pkill -f "drusniel-editor-runtime" >/dev/null 2>&1 || true
    pkill -f "drusniel_voxels_editor" >/dev/null 2>&1 || true
    ;;
esac

clear_runtime_lock
cd "$editor_root"
rtk npm run build:runtime
exec rtk npm run build:desktop
