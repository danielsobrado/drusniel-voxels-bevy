#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
editor_root="$repo_root/editor/frontend"

stop_windows_processes() {
  local names=(
    "voxel_builder.exe"
    "drusniel-editor-runtime-x86_64-pc-windows-msvc.exe"
    "drusniel_voxels_editor.exe"
  )

  for name in "${names[@]}"; do
    taskkill.exe /IM "$name" /T /F >/dev/null 2>&1 || true
  done
}

stop_unix_processes() {
  pkill -f "voxel_builder" >/dev/null 2>&1 || true
  pkill -f "drusniel-editor-runtime" >/dev/null 2>&1 || true
  pkill -f "drusniel_voxels_editor" >/dev/null 2>&1 || true
  pkill -f "$editor_root.*tauri dev" >/dev/null 2>&1 || true
  pkill -f "$editor_root.*vite" >/dev/null 2>&1 || true
}

clear_runtime_lock() {
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command '$p = Join-Path ([System.IO.Path]::GetTempPath()) "drusniel-voxels\runtime.lock"; if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }'
  else
    rm -f "${TMPDIR:-/tmp}/drusniel-voxels/runtime.lock"
  fi
}

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) stop_windows_processes ;;
  *) stop_unix_processes ;;
esac

clear_runtime_lock
cd "$editor_root"
rtk npm run build:runtime
exec rtk npm run dev:desktop
