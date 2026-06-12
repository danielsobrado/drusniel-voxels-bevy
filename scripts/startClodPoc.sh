#!/usr/bin/env bash
set -euo pipefail

if command -v rtk >/dev/null 2>&1; then
  rtk_cmd=(rtk)
elif [[ -x /mnt/c/RTK/rtk.exe ]]; then
  rtk_cmd=(/mnt/c/RTK/rtk.exe)
else
  echo "Could not find rtk or /mnt/c/RTK/rtk.exe." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
poc_dir="$repo_root/tools/clod-poc"
url="http://127.0.0.1:5173/drusniel-voxels-bevy/"
skip_build=0
open_browser=1

usage() {
  cat <<'EOF'
Usage: scripts/startClodPoc.sh [--skip-build] [--no-browser]

Build and start the Three.js CLOD PoC. In WSL, the viewer opens in the Windows browser.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) skip_build=1 ;;
    --no-browser) open_browser=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ ! -f "$poc_dir/package.json" ]]; then
  echo "Could not find tools/clod-poc/package.json from $repo_root" >&2
  exit 1
fi

cd "$poc_dir"
if [[ ! -d node_modules ]]; then
  echo "Installing CLOD PoC dependencies..."
  "${rtk_cmd[@]}" npm install
fi

if [[ "$skip_build" -eq 0 ]]; then
  echo "Building CLOD PoC..."
  "${rtk_cmd[@]}" npm run build
fi

echo "Starting CLOD PoC at $url"
"${rtk_cmd[@]}" npm run dev -- --host 0.0.0.0 &
server_pid=$!
cleanup() {
  kill "$server_pid" >/dev/null 2>&1 || true
  wait "$server_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

ready=0
for _ in {1..120}; do
  if ! kill -0 "$server_pid" >/dev/null 2>&1; then
    echo "Vite exited before the viewer became ready." >&2
    exit 1
  fi
  if "${rtk_cmd[@]}" curl -fsS "$url" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done

if [[ "$ready" -ne 1 ]]; then
  echo "Timed out waiting for $url" >&2
  exit 1
fi

if [[ "$open_browser" -eq 1 ]]; then
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "Start-Process '$url'" >/dev/null
  elif command -v wslview >/dev/null 2>&1; then
    wslview "$url" >/dev/null 2>&1
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1
  else
    echo "No browser opener found; open $url manually."
  fi
fi

echo "Press Ctrl+C to stop the server."
wait "$server_pid"
