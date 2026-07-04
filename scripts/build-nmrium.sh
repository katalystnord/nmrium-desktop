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
npm install
npm run build
