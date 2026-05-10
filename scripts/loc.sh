#!/usr/bin/env bash
# Count lines of code in this repo, grouped by file extension.
# Usage: scripts/loc.sh [--save]
#   --save  Append a timestamped row to scripts/loc-history.csv
set -euo pipefail

cd "$(dirname "$0")/.."

EXCLUDES=(
  ".git" ".history" "target" "bench-runs" "perf-dumps" "temp"
  "node_modules" "patches" "editor/frontend/src-tauri/target"
  "editor/frontend/src-tauri/gen" "editor/frontend/dist"
  "editor/frontend/node_modules"
  "saves" "image" "assets/textures" "assets/models" "assets/audio"
  "debug" "references" ".agent" ".claude" ".cargo"
)

EXTENSIONS=(rs wgsl toml py ps1 sh md html css js ts tsx jsx vue json yaml yml)

prune_args=()
for d in "${EXCLUDES[@]}"; do
  prune_args+=( -path "./$d" -prune -o )
done

declare -A counts=()
declare -A files=()
total_lines=0
total_files=0

for ext in "${EXTENSIONS[@]}"; do
  lines=0
  count=0
  while IFS= read -r -d '' f; do
    n=$(wc -l < "$f")
    lines=$((lines + n))
    count=$((count + 1))
  done < <(find . "${prune_args[@]}" -type f -name "*.${ext}" -print0)
  counts[$ext]=$lines
  files[$ext]=$count
  total_lines=$((total_lines + lines))
  total_files=$((total_files + count))
done

printf '%-8s %10s %10s\n' "EXT" "FILES" "LINES"
printf '%-8s %10s %10s\n' "---" "-----" "-----"
for ext in "${EXTENSIONS[@]}"; do
  if [[ "${files[$ext]}" -gt 0 ]]; then
    printf '%-8s %10d %10d\n' "$ext" "${files[$ext]}" "${counts[$ext]}"
  fi
done
printf '%-8s %10s %10s\n' "---" "-----" "-----"
printf '%-8s %10d %10d\n' "TOTAL" "$total_files" "$total_lines"

if [[ "${1:-}" == "--save" ]]; then
  history_file="scripts/loc-history.csv"
  if [[ ! -f "$history_file" ]]; then
    {
      printf 'timestamp,total_files,total_lines'
      for ext in "${EXTENSIONS[@]}"; do printf ',%s_files,%s_lines' "$ext" "$ext"; done
      printf '\n'
    } > "$history_file"
  fi
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  {
    printf '%s,%d,%d' "$ts" "$total_files" "$total_lines"
    for ext in "${EXTENSIONS[@]}"; do
      printf ',%d,%d' "${files[$ext]:-0}" "${counts[$ext]:-0}"
    done
    printf '\n'
  } >> "$history_file"
  echo "Saved snapshot to $history_file"
fi
