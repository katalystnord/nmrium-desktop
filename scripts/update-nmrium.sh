#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

TAG="${1:-}"

cd nmrium
git fetch --tags origin

if [ -z "$TAG" ]; then
  TAG="$(git tag --list 'v*' --sort=-v:refname | head -n1)"
  echo "No tag given, using latest: $TAG"
fi

git checkout "$TAG"
cd ..

git add nmrium
echo "Submodule pointer staged at $TAG. Review, rebuild (npm run build:nmrium), retest, then commit."
