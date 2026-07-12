#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -d nmrium/public/data ] || [ ! -d nmrium/public/exercises ]; then
  echo "nmrium/public/data or nmrium/public/exercises missing — check the submodule checkout." >&2
  exit 1
fi

mkdir -p dist
OUT="$(pwd)/dist/nmrium-samples.zip"
rm -f "$OUT"

cd nmrium/public
# Excluded the same way NMRium's own build does (see its build-clean script):
# large raw duplicates of data already covered by the processed .json samples.
zip -rq "$OUT" data exercises \
  -x 'data/cytisine/2d/HMBC_Cytisin_RI+FT.dx' \
  -x 'data/cytisine/2d/HSQC_Cytisin_RI+FT.dx'
cd - > /dev/null

# Our own (non-submodule) sample additions live alongside `data`/`exercises`
# at the same archive root, e.g. sample-data/lnfp3 -> <root>/lnfp3, so
# catalog-extra.json's "./lnfp3/..." paths resolve the same way NMRium's own
# "./data/..." paths do.
cd sample-data
zip -rq "$OUT" lnfp3
cd - > /dev/null

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
echo "Extract into the app's user-data 'samples' directory to enable it, e.g. on Linux:"
echo "  unzip $OUT -d ~/.config/nmrium-desktop/samples"
