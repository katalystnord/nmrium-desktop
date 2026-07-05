// electron-builder does NOT auto-generate a multi-size Linux icon set from a
// single source PNG the way it does for Windows .ico/macOS .icns — it just
// uses the one file as-is at its native resolution. Without this, the app's
// icon in application menus/launchers only exists at 1024x1024 and has to be
// downscaled by whatever's rendering it, which some icon-theme lookups don't
// do cleanly. Generate the standard hicolor theme size set instead, using
// Electron's own nativeImage (already a devDependency, no extra tooling).
const path = require('node:path');
const fs = require('node:fs');
const { nativeImage } = require('electron');

const SOURCE = path.join(__dirname, '..', 'build', 'icon.png');
const OUT_DIR = path.join(__dirname, '..', 'build', 'icons');
const SIZES = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024];

const source = nativeImage.createFromPath(SOURCE);
if (source.isEmpty()) {
  throw new Error(`Could not load source icon: ${SOURCE}`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const size of SIZES) {
  const resized = source.resize({ width: size, height: size, quality: 'best' });
  fs.writeFileSync(path.join(OUT_DIR, `${size}x${size}.png`), resized.toPNG());
}

console.log(`Wrote ${SIZES.length} icon sizes to ${OUT_DIR}`);
process.exit(0);
