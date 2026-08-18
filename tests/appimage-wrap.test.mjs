import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { makeTempDir, REPO_ROOT } from './helpers.mjs';

const afterPack = createRequire(import.meta.url)(
  path.join(REPO_ROOT, 'scripts/appimage-wrap.cjs'),
);

const EXE = 'nmrium-desktop';

/** A packed app directory as electron-builder hands it to the hook. */
function packedApp(platform) {
  const appOutDir = makeTempDir();
  fs.writeFileSync(path.join(appOutDir, EXE), 'ELF: the real electron binary');
  fs.writeFileSync(path.join(appOutDir, 'chrome-sandbox'), 'suid helper');
  fs.writeFileSync(path.join(appOutDir, 'LICENSES.chromium.html'), 'x'.repeat(1024));
  fs.writeFileSync(path.join(appOutDir, 'libffmpeg.so'), 'shared library');
  return {
    appOutDir,
    electronPlatformName: platform,
    packager: { executableName: EXE },
  };
}

const read = (ctx, name) => fs.readFileSync(path.join(ctx.appOutDir, name), 'utf8');
const has = (ctx, name) => fs.existsSync(path.join(ctx.appOutDir, name));

test('moves the real binary aside and puts a launcher in its place', async () => {
  const ctx = packedApp('linux');
  await afterPack(ctx);
  assert.equal(read(ctx, `${EXE}.bin`), 'ELF: the real electron binary');
  assert.match(read(ctx, EXE), /^#!\/bin\/sh/);
});

test('the launcher passes --no-sandbox as a real argv flag', async () => {
  // Chromium checks for a root-owned mode-4755 chrome-sandbox during native
  // startup, before any of main.js runs, so this cannot be set at runtime.
  const ctx = packedApp('linux');
  await afterPack(ctx);
  assert.match(read(ctx, EXE), /--no-sandbox/);
});

test('the launcher resolves symlinks before taking dirname', async () => {
  // A .deb installs /usr/bin/<name> -> /etc/alternatives/<name> -> /opt/<app>/<name>.
  // Plain `dirname "$0"` gives /usr/bin, which has no <name>.bin next to it, so
  // launching by typed command name breaks while the .desktop file still works.
  const ctx = packedApp('linux');
  await afterPack(ctx);
  const launcher = read(ctx, EXE);
  assert.match(launcher, /readlink -f/);
  assert.match(launcher, new RegExp(`${EXE}\\.bin`));
  assert.match(launcher, /"\$@"/);
});

test('the launcher is executable', async () => {
  const ctx = packedApp('linux');
  await afterPack(ctx);
  const mode = fs.statSync(path.join(ctx.appOutDir, EXE)).mode & 0o777;
  assert.equal(mode, 0o755);
});

test('drops the SUID sandbox helper and Chromium licence dump', async () => {
  const ctx = packedApp('linux');
  await afterPack(ctx);
  assert.equal(has(ctx, 'chrome-sandbox'), false);
  assert.equal(has(ctx, 'LICENSES.chromium.html'), false);
});

test('keeps libffmpeg.so', async () => {
  // It looks like an optional codec plugin but is a DT_NEEDED dependency of the
  // Electron binary. Removing it makes every launch fail with "error while
  // loading shared libraries", regardless of NMRium having no audio or video.
  const ctx = packedApp('linux');
  await afterPack(ctx);
  assert.equal(has(ctx, 'libffmpeg.so'), true);
});

test('tolerates a pack that has already been stripped of both files', async () => {
  const ctx = packedApp('linux');
  fs.rmSync(path.join(ctx.appOutDir, 'chrome-sandbox'));
  fs.rmSync(path.join(ctx.appOutDir, 'LICENSES.chromium.html'));
  await afterPack(ctx);
  assert.match(read(ctx, EXE), /--no-sandbox/);
});

for (const platform of ['win32', 'darwin']) {
  test(`does nothing on ${platform}`, async () => {
    const ctx = packedApp(platform);
    await afterPack(ctx);
    assert.equal(read(ctx, EXE), 'ELF: the real electron binary');
    assert.equal(has(ctx, `${EXE}.bin`), false);
    assert.equal(has(ctx, 'chrome-sandbox'), true);
  });
}
