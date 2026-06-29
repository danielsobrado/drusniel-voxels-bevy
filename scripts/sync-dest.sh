#!/usr/bin/env bash
set -euo pipefail

# Sync non-markdown files from drusniel-voxels-bevy into mapped destination repos.
#
# Usage:
#   scripts/sync-dest.sh [rust_dest] [web_dest]
#
# Defaults:
#   rust_dest = ../drusniel-voxels
#   web_dest  = ../drusniel-voxels-web
#
# This script mirrors deletions and skips markdown/docs, AGENTS.md, CLAUDE.md,
# node_modules, and its own helper scripts.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
base_root="$(dirname "$repo_root")"
rust_dest="${1:-$base_root/drusniel-voxels}"
web_dest="${2:-$base_root/drusniel-voxels-web}"

usage() {
  cat <<'EOF'
Usage: scripts/sync-dest.sh [rust_dest] [web_dest]

Sync non-markdown source files from drusniel-voxels-bevy into the mapped destination repos.
Defaults are siblings:
  drusniel-voxels
  drusniel-voxels-web
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

should_exclude_path() {
  local path="$1"
  case "$path" in
    *.md|AGENTS.md|CLAUDE.md) return 0 ;; 
    docs/reference/*|node_modules/*|scripts/sync-dest.sh|scripts/sync-dest.ps1) return 0 ;;
    *) return 1 ;;
  esac
}

copy_source_file() {
  local source="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  cp -f -- "$source" "$dest"
}

remove_dest_file() {
  local dest="$1"
  if [[ -f "$dest" ]]; then
    rm -f -- "$dest"
  fi
}

if ! git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: source directory is not a git repo: $repo_root" >&2
  exit 1
fi

if ! git -C "$rust_dest" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: rust destination is not a git repo: $rust_dest" >&2
  exit 1
fi

if ! git -C "$web_dest" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: web destination is not a git repo: $web_dest" >&2
  exit 1
fi

copied=()
deleted=()

while IFS= read -r -d '' token; do
  status="${token:0:2}"
  if [[ "$status" =~ ^[RC] ]]; then
    old_path="${token:3}"
    if ! IFS= read -r -d '' new_path; then
      echo "Error: malformed rename entry in git status" >&2
      exit 1
    fi
    if should_exclude_path "$old_path" || should_exclude_path "$new_path"; then
      continue
    fi
    if [[ "$old_path" == tools/clod-poc/* ]]; then
      old_rel="${old_path#tools/clod-poc/}"
      old_dest="$web_dest/$old_rel"
    else
      old_rel="$old_path"
      old_dest="$rust_dest/$old_rel"
    fi
    remove_dest_file "$old_dest"
    deleted+=("$old_rel")
    if [[ "$new_path" == tools/clod-poc/* ]]; then
      new_rel="${new_path#tools/clod-poc/}"
      new_dest="$web_dest/$new_rel"
    else
      new_rel="$new_path"
      new_dest="$rust_dest/$new_rel"
    fi
    if [[ -f "$repo_root/$new_path" ]]; then
      copy_source_file "$repo_root/$new_path" "$new_dest"
      copied+=("$new_rel")
    fi
    continue
  fi

  path="${token:3}"
  if should_exclude_path "$path"; then
    continue
  fi

  if [[ "$path" == tools/clod-poc/* ]]; then
    rel="${path#tools/clod-poc/}"
    dest="$web_dest/$rel"
  else
    rel="$path"
    dest="$rust_dest/$rel"
  fi

  if [[ -f "$repo_root/$path" ]]; then
    copy_source_file "$repo_root/$path" "$dest"
    copied+=("$rel")
  else
    remove_dest_file "$dest"
    deleted+=("$rel")
  fi

done < <(git -C "$repo_root" status --porcelain=1 -z -M --untracked-files=all)

printf '%s
' '---'
printf '%s
' 'Copied files:'
if [[ ${#copied[@]} -eq 0 ]]; then
  printf '  none
'
else
  printf '  %s
' "${copied[@]}" | sort -u
fi
printf '%s
' 'Deleted files:'
if [[ ${#deleted[@]} -eq 0 ]]; then
  printf '  none
'
else
  printf '  %s
' "${deleted[@]}" | sort -u
fi
printf '%s
' '---'

printf '%s
' 'Rust destination status:'
git -C "$rust_dest" status --short --untracked-files=all
printf '%s
' '---'

printf '%s
' 'Web destination status:'
git -C "$web_dest" status --short --untracked-files=all
