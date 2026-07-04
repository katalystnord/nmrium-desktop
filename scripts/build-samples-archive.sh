#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -d nmrium/build/data ] || [ ! -d nmrium/build/exercises ]; then
  echo "nmrium/build/data or nmrium/build/exercises missing — run 'npm run build:nmrium' first." >&2
  exit 1
fi

mkdir -p dist
OUT="$(pwd)/dist/nmrium-samples.zip"
rm -f "$OUT"

cd nmrium/build
zip -rq "$OUT" data exercises
cd - > /dev/null

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
echo "Extract into the app's user-data 'samples' directory to enable it, e.g. on Linux:"
echo "  unzip $OUT -d ~/.config/nmrium-desktop/samples"
