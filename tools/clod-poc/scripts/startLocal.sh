#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
base_path="/drusniel-voxels-web/"
port=5173
skip_build=0
open_browser=1

usage() {
  cat <<'EOF'
Usage: scripts/startLocal.sh [--skip-build] [--no-browser]

Build and start the local CLOD Pages viewer. In WSL, the viewer opens in the Windows browser.
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

if [[ ! -f "$repo_root/package.json" ]]; then
  echo "Could not find package.json from $repo_root" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Could not find npm. Install Node.js/npm first." >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "Could not find curl." >&2
  exit 1
fi

cd "$repo_root"

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install
fi

node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
if [[ "$node_major" -ge 20 ]]; then
  node_cmd=(node)
elif [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
  nvm use 22.13.0 >/dev/null 2>&1 || nvm use 22 >/dev/null
  node_cmd=(node)
else
  if ! command -v npx >/dev/null 2>&1; then
    echo "CLOD Pages needs Node 20+, and npx is unavailable to run node@22." >&2
    exit 1
  fi
  echo "Using node@22 via npx because local node is $(node --version 2>/dev/null || echo missing)."
  node_cmd=(npx -y node@22)
fi

port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$1" | grep -q LISTEN
  else
    (echo >/dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1
  fi
}

while port_in_use "$port"; do
  port=$((port + 1))
done
url="http://127.0.0.1:${port}${base_path}"

if [[ "$skip_build" -eq 0 ]]; then
  echo "Building CLOD Pages..."
  "${node_cmd[@]}" node_modules/vite/bin/vite.js build
fi

echo "Starting CLOD Pages at $url"
"${node_cmd[@]}" node_modules/vite/bin/vite.js --host 0.0.0.0 --port "$port" --strictPort &
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
  if curl -fsS "$url" >/dev/null 2>&1; then
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
