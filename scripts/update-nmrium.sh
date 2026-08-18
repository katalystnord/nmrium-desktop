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

# The wrapper's version is derived from the submodule, never hand-written —
# see CONTRIBUTING.md → Versioning. sync-version reads it out of the freshly
# checked-out nmrium/package.json; check-version then asserts the two agree,
# which is the same gate the build and CI run.
npm run sync-version
npm run check-version
git add package.json package-lock.json 2>/dev/null || git add package.json

NEW_VERSION="$(node -p "require('./package.json').version")"

cat <<MSG

Submodule pointer staged at $TAG, wrapper version set to $NEW_VERSION.

The daily Sync NMRium workflow does all of the above unattended for tagged
upstream releases; run this by hand when you want to move early, land on an
untagged commit, or test a bump before CI does.

Next steps (manual, on purpose — see CONTRIBUTING.md):
  1. npm test && npm run test:nmrium
  2. npm run build:nmrium && npm run dist
  3. Smoke-test the rebuilt app for real (open a spectrum, check for
     upstream breaking changes in NMRiumRefAPI/menus/workspaces).
  4. Add a CHANGELOG.md entry for $NEW_VERSION.
  5. git commit -m "chore: update NMRium to $TAG"
  6. git tag v$NEW_VERSION && git push origin master --follow-tags
MSG
