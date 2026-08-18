#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

REQUIRED_NODE_MAJOR=24
NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"

if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  echo "NMRium requires Node ${REQUIRED_NODE_MAJOR}+ (found $(node -v)). Switch with nvm/volta and retry." >&2
  exit 1
fi

cd nmrium
# `npm ci`, not `npm install`: it installs exactly the committed lockfile and
# never rewrites it. `npm install` re-resolves against package.json, so a build
# from a given pin could silently differ from the one CI produced from the same
# pin — which defeats the point of pinning the submodule in the first place.
npm ci
# No `npm run build` here on purpose: that command builds NMRium's own
# demo/docs-site app. Our renderer (../vite.config.js) instead builds a
# thin entry point importing the NMRium library component directly from
# this submodule's source, so all we need from it is its node_modules.
