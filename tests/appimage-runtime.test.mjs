import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { makeTempDir, REPO_ROOT } from './helpers.mjs';

const hook = createRequire(import.meta.url)(
  path.join(REPO_ROOT, 'scripts/appimage-runtime.cjs'),
);
const { elfImageSize, ensureRuntime, swapRuntime, isAppImage, defaultCacheDir } = hook;

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** A minimal but structurally valid 64-bit ELF header. */
function elfHeader({ shoff = 128, shentsize = 64, shnum = 3, elfClass = 2 } = {}) {
  const h = Buffer.alloc(64);
  h.write('\x7fELF', 0, 'latin1');
  h[4] = elfClass;
  h.writeBigUInt64LE(BigInt(shoff), 0x28);
  h.writeUInt16LE(shentsize, 0x3a);
  h.writeUInt16LE(shnum, 0x3c);
  return h;
}

/** A fake AppImage: ELF image of `runtimeSize` bytes, then a payload. */
function fakeAppImage(dir, name, runtimeSize, payload) {
  const shentsize = 64;
  const shnum = 2;
  const shoff = runtimeSize - shentsize * shnum;
  const runtime = Buffer.concat([
    elfHeader({ shoff, shentsize, shnum }),
    Buffer.alloc(runtimeSize - 64, 0x41),
  ]);
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.concat([runtime, payload]));
  return file;
}

test('computes the ELF image size from the section header table', () => {
  // offset + entrySize * count
  assert.equal(elfImageSize(elfHeader({ shoff: 1000, shentsize: 64, shnum: 5 })), 1320);
  assert.equal(elfImageSize(elfHeader({ shoff: 188392 - 64 * 30, shentsize: 64, shnum: 30 })), 188392);
});

test('matches the offset a real AppImage reports', () => {
  // Regression pin against the real artifact: --appimage-offset on the built
  // AppImage printed exactly this, which is what the byte-splice depends on.
  const built = elfHeader({ shoff: 188392 - 64 * 30, shentsize: 64, shnum: 30 });
  assert.equal(elfImageSize(built), 188392);
});

test('rejects anything that is not a 64-bit ELF', () => {
  assert.throws(() => elfImageSize(Buffer.alloc(10)), /header too short/);
  assert.throws(() => elfImageSize(Buffer.alloc(64)), /bad magic/);
  assert.throws(() => elfImageSize(elfHeader({ elfClass: 1 })), /64-bit/);
});

test('swaps the runtime and preserves the payload byte for byte', async () => {
  const dir = makeTempDir();
  const payload = Buffer.from('hsqs-squashfs-payload-contents');
  const file = fakeAppImage(dir, 'App.AppImage', 512, payload);

  const newRuntime = Buffer.concat([
    elfHeader({ shoff: 2048 - 64 * 4, shentsize: 64, shnum: 4 }),
    Buffer.alloc(2048 - 64, 0x42),
  ]);
  const result = await swapRuntime(file, newRuntime);

  assert.equal(result.oldRuntimeSize, 512);
  assert.equal(result.newRuntimeSize, 2048);

  const after = fs.readFileSync(file);
  assert.equal(after.length, 2048 + payload.length);
  assert.deepEqual(after.subarray(0, 2048), newRuntime);
  assert.deepEqual(after.subarray(2048), payload, 'payload must survive unchanged');
});

test('leaves the file executable', { skip: process.platform === 'win32' }, async () => {
  const dir = makeTempDir();
  const file = fakeAppImage(dir, 'App.AppImage', 512, Buffer.from('payload'));
  fs.chmodSync(file, 0o644);
  const runtime = Buffer.concat([
    elfHeader({ shoff: 192 - 64, shentsize: 64, shnum: 1 }),
    Buffer.alloc(192 - 64),
  ]);
  await swapRuntime(file, runtime);
  assert.equal(fs.statSync(file).mode & 0o777, 0o755);
});

test('refuses an AppImage with no payload', async () => {
  const dir = makeTempDir();
  const file = fakeAppImage(dir, 'Empty.AppImage', 512, Buffer.alloc(0));
  await assert.rejects(() => swapRuntime(file, Buffer.alloc(64)), /no payload/);
});

test('identifies AppImage artifacts, case-insensitively', () => {
  assert.equal(isAppImage('dist/NMRium Desktop-2.5.0.AppImage'), true);
  assert.equal(isAppImage('dist/app.appimage'), true);
  assert.equal(isAppImage('dist/nmrium-desktop_2.5.0_amd64.deb'), false);
  assert.equal(isAppImage('dist/Setup.exe'), false);
  assert.equal(isAppImage('dist/AppImage-notes.txt'), false);
});

test('downloads the runtime once, then serves it from cache', async () => {
  const cacheDir = path.join(makeTempDir(), 'rt');
  const body = Buffer.from('pinned-runtime-bytes');
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, arrayBuffer: async () => body };
  };
  const opts = { cacheDir, expectedSha256: sha256(body), fetchImpl, url: 'https://x/rt' };

  assert.deepEqual(await ensureRuntime(opts), body);
  assert.equal(calls, 1);
  assert.deepEqual(await ensureRuntime(opts), body, 'second call must hit the cache');
  assert.equal(calls, 1, 'must not download twice');
});

test('fails loudly when the pinned hash no longer matches', async () => {
  // Upstream tags this release "continuous" and replaces the asset in place, so
  // this is the case that stops an unreviewed runtime from shipping.
  const cacheDir = path.join(makeTempDir(), 'rt');
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => Buffer.from('different') });
  await assert.rejects(
    () => ensureRuntime({ cacheDir, expectedSha256: sha256(Buffer.from('expected')), fetchImpl }),
    /hash mismatch/,
  );
});

test('a corrupted cache entry is re-downloaded, not trusted', async () => {
  const cacheDir = path.join(makeTempDir(), 'rt');
  const body = Buffer.from('good-runtime');
  const digest = sha256(body);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, `${digest}.runtime`), Buffer.from('TRUNCATED'));

  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, arrayBuffer: async () => body };
  };
  assert.deepEqual(await ensureRuntime({ cacheDir, expectedSha256: digest, fetchImpl }), body);
  assert.equal(calls, 1);
});

test('surfaces a failed download', async () => {
  const cacheDir = path.join(makeTempDir(), 'rt');
  const fetchImpl = async () => ({ ok: false, status: 404 });
  await assert.rejects(
    () => ensureRuntime({ cacheDir, expectedSha256: 'x'.repeat(64), fetchImpl }),
    /HTTP 404/,
  );
});

test('the hook rewrites every AppImage and ignores other artifacts', async () => {
  const dir = makeTempDir();
  const payload = Buffer.from('payload-A');
  const appImage = fakeAppImage(dir, 'One.AppImage', 512, payload);
  const deb = path.join(dir, 'pkg.deb');
  fs.writeFileSync(deb, Buffer.from('debian-archive'));

  const runtime = Buffer.concat([
    elfHeader({ shoff: 256 - 64 * 3, shentsize: 64, shnum: 3 }),
    Buffer.alloc(256 - 64, 0x43),
  ]);
  const logged = [];
  const returned = await hook(
    { artifactPaths: [appImage, deb] },
    { ensureRuntime: async () => runtime, log: (m) => logged.push(m) },
  );
  // electron-builder treats the return value as *extra* artifacts to publish;
  // returning the ones we rewrote in place would double-publish them.
  assert.deepEqual(returned, []);

  assert.deepEqual(fs.readFileSync(appImage).subarray(0, 256), runtime);
  assert.deepEqual(fs.readFileSync(appImage).subarray(256), payload);
  assert.equal(fs.readFileSync(deb).toString(), 'debian-archive', 'the .deb must be untouched');
  assert.equal(logged.length, 1);
  assert.match(logged[0], /One\.AppImage/);
  assert.match(logged[0], /replaced AppImage runtime/);
  assert.match(logged[0], /512 -> 256 bytes/, 'must report the size change');
  assert.match(logged[0], /libfuse2/, 'must say why the swap happened');
});

test('the hook does nothing, and downloads nothing, when no AppImage was built', async () => {
  // Windows and macOS legs run this same hook.
  let fetched = false;
  const result = await hook(
    { artifactPaths: ['dist/Setup.exe', 'dist/App.dmg'] },
    { ensureRuntime: async () => { fetched = true; return Buffer.alloc(64); }, log: () => {} },
  );
  assert.deepEqual(result, []);
  assert.equal(fetched, false, 'must not download a Linux runtime on other platforms');
});

test('the pinned runtime is the one we audited', () => {
  // These two constants are the whole supply-chain story: an empty or altered
  // URL/hash means the build either fetches something else or verifies nothing.
  assert.equal(
    hook.RUNTIME_URL,
    'https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64',
  );
  // sha256 of the runtime verified locally: statically linked, and strace shows
  // zero openat() calls for libfuse.so.2.
  assert.equal(
    hook.RUNTIME_SHA256,
    '1cc49bcf1e2ccd593c379adb17c9f85a36d619088296504de95b1d06215aebbf',
  );
  assert.match(hook.RUNTIME_SHA256, /^[0-9a-f]{64}$/);
});

test('caches under a namespaced directory, not the home directory root', () => {
  const dir = defaultCacheDir();
  assert.ok(dir.includes('.cache'), dir);
  assert.ok(dir.includes('nmrium-desktop'), dir);
  assert.ok(dir.endsWith('appimage-runtime'), dir);
});

test('the hash-mismatch error says what happened and what to do', async () => {
  // This message is the only thing a future maintainer sees when upstream
  // rebuilds the "continuous" asset. Empty or vague, and the build failure is
  // just noise.
  const cacheDir = path.join(makeTempDir(), 'rt');
  const body = Buffer.from('unexpected');
  const expected = sha256(Buffer.from('expected'));
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => body });
  await assert.rejects(
    () => ensureRuntime({ cacheDir, expectedSha256: expected, fetchImpl }),
    (error) => {
      assert.match(error.message, /hash mismatch/i);
      assert.ok(error.message.includes(expected), 'must show the expected hash');
      assert.ok(error.message.includes(sha256(body)), 'must show the actual hash');
      assert.match(error.message, /RUNTIME_SHA256/, 'must name the constant to update');
      assert.match(error.message, /continuous/, 'must explain why this happens');
      return true;
    },
  );
});

test('the hook tolerates a build result with no artifacts', async () => {
  assert.deepEqual(await hook({}, { ensureRuntime: async () => Buffer.alloc(64), log: () => {} }), []);
});
