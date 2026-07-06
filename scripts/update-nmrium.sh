#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

TAG="${1:-}"
CURRENT_TAG="$(cd nmrium && git describe --tags --exact-match 2>/dev/null || echo "unknown")"

cd nmrium
git fetch --tags origin

if [ -z "$TAG" ]; then
  TAG="$(git tag --list 'v*' --sort=-v:refname | head -n1)"
  echo "No tag given, using latest: $TAG"
fi

if [ "$TAG" = "$CURRENT_TAG" ]; then
  echo "Already at $TAG — nothing to do."
  exit 0
fi

echo "NMRium: $CURRENT_TAG -> $TAG"
git checkout "$TAG"
cd ..

git add nmrium

# The wrapper's own version has tracked NMRium's tag 1:1 so far (both at
# 2.3.0) — keep that convention so the pin is visible at a glance without
# opening .gitmodules.
NEW_VERSION="${TAG#v}"
npm pkg set version="$NEW_VERSION"
git add package.json package-lock.json 2>/dev/null || git add package.json

cat <<EOF

Submodule pointer staged at $TAG, wrapper version set to $NEW_VERSION.
Next steps (manual, on purpose — see CLAUDE.md):
  1. npm run build:nmrium && npm run dist
  2. Smoke-test the rebuilt app for real (open a spectrum, check for
     upstream breaking changes in NMRiumRefAPI/menus/workspaces).
  3. git commit -m "Update NMRium to $TAG"
  4. git tag $TAG && git push origin master $TAG
EOF
