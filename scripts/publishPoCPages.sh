#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
POC_DIR="$ROOT/tools/clod-poc"
DIST_DIR="$POC_DIR/dist"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-gh-pages}"

usage() {
  cat <<'EOF'
Usage: scripts/publishPoCPages.sh [--skip-tests]

Build and publish tools/clod-poc/dist to the gh-pages branch for GitHub Pages.

Environment:
  REMOTE   Git remote to push to. Default: origin
  BRANCH   Pages branch to force-update. Default: gh-pages
EOF
}

SKIP_TESTS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-tests)
      SKIP_TESTS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "$POC_DIR/package.json" ]]; then
  echo "Could not find tools/clod-poc/package.json from $ROOT" >&2
  exit 1
fi

REMOTE_URL="$(git -C "$ROOT" remote get-url "$REMOTE")"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Installing CLOD PoC dependencies..."
(
  cd "$POC_DIR"
  npm install
)

if [[ "$SKIP_TESTS" -eq 0 ]]; then
  echo "Running CLOD PoC tests and typecheck..."
  (
    cd "$POC_DIR"
    npm test
    npm run typecheck
  )
else
  echo "Skipping tests and typecheck."
fi

echo "Building CLOD PoC..."
(
  cd "$POC_DIR"
  npm run build
)

if [[ ! -f "$DIST_DIR/index.html" ]]; then
  echo "Build did not produce $DIST_DIR/index.html" >&2
  exit 1
fi

echo "Preparing $BRANCH contents in a temporary repository..."
cp -a "$DIST_DIR"/. "$TMP_DIR"/
touch "$TMP_DIR/.nojekyll"

(
  cd "$TMP_DIR"
  git init -q
  git checkout -q -b "$BRANCH"
  git add .
  git -c user.name="GitHub Pages Deploy" \
    -c user.email="pages-deploy@users.noreply.github.com" \
    commit -q -m "Deploy CLOD PoC to GitHub Pages"
  git remote add "$REMOTE" "$REMOTE_URL"
  git push "$REMOTE" "$BRANCH:$BRANCH" --force
)

echo "Published tools/clod-poc/dist to $REMOTE/$BRANCH."
