#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist_dir="$repo_root/dist"
remote="${REMOTE:-origin}"
branch="${BRANCH:-gh-pages}"

usage() {
  cat <<'EOF'
Usage: scripts/publishPages.sh [--skip-tests]

Build and publish dist to the gh-pages branch for GitHub Pages.

Environment:
  REMOTE   Git remote to push to. Default: origin
  BRANCH   Pages branch to force-update. Default: gh-pages
EOF
}

skip_tests=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-tests) skip_tests=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ ! -f "$repo_root/package.json" ]]; then
  echo "Could not find package.json from $repo_root" >&2
  exit 1
fi

remote_url="$(git -C "$repo_root" remote get-url "$remote")"
tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

echo "Installing dependencies..."
(
  cd "$repo_root"
  npm install
)

if [[ "$skip_tests" -eq 0 ]]; then
  echo "Running tests and typecheck..."
  (
    cd "$repo_root"
    npm test
    npm run typecheck
  )
else
  echo "Skipping tests and typecheck."
fi

echo "Building CLOD Pages..."
(
  cd "$repo_root"
  npm run build
)

if [[ ! -f "$dist_dir/index.html" ]]; then
  echo "Build did not produce $dist_dir/index.html" >&2
  exit 1
fi

echo "Preparing $branch contents in a temporary repository..."
cp -a "$dist_dir"/. "$tmp_dir"/
touch "$tmp_dir/.nojekyll"

(
  cd "$tmp_dir"
  git init -q
  git checkout -q -b "$branch"
  git add .
  git -c user.name="GitHub Pages Deploy" \
    -c user.email="pages-deploy@users.noreply.github.com" \
    commit -q -m "Deploy CLOD Pages to GitHub Pages"
  git remote add "$remote" "$remote_url"
  git push "$remote" "$branch:$branch" --force
)

echo "Published dist to $remote/$branch."
