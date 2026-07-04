#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -d nmrium/build/data ] || [ ! -d nmrium/build/exercises ]; then
  echo "nmrium/build/data or nmrium/build/exercises missing — run 'npm run build:nmrium' first." >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
STAGING="dist/samples-deb-root"
INSTALL_DIR="usr/share/nmrium-desktop/samples"
OUT="dist/nmrium-desktop-samples_${VERSION}_all.deb"

rm -rf "$STAGING"
mkdir -p "$STAGING/DEBIAN" "$STAGING/$INSTALL_DIR"

cp -r nmrium/build/data "$STAGING/$INSTALL_DIR/"
cp -r nmrium/build/exercises "$STAGING/$INSTALL_DIR/"

cat > "$STAGING/DEBIAN/control" <<EOF
Package: nmrium-desktop-samples
Version: ${VERSION}
Section: science
Priority: optional
Architecture: all
Recommends: nmrium-desktop (>= ${VERSION})
Maintainer: David <david@katalystnord.com>
Description: Sample and teaching NMR spectra for NMRium Desktop
 Optional companion package providing NMRium's own demo sample and
 teaching dataset (Cytisine, ethylbenzene, exercises, etc.) for the
 built-in Samples / Exercises sidebar. Not required to open your own
 spectrum files — nmrium-desktop works fully without this package.
EOF

mkdir -p dist
rm -f "$OUT"
dpkg-deb --build --root-owner-group "$STAGING" "$OUT"
rm -rf "$STAGING"

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
