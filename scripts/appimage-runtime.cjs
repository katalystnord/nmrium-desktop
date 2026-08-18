// electron-builder afterAllArtifactBuild hook (Linux only).
//
// Replaces the AppImage runtime with AppImage's modern statically-linked one.
//
// electron-builder ships an AppImageKit runtime that dlopen()s libfuse.so.2.
// Ubuntu 24.04+, Debian 13+ and current Fedora ship only FUSE 3, so on a modern
// desktop the AppImage exits immediately with:
//
//     dlopen(): error loading libfuse.so.2
//
// — a message naming a shared library, shown to an audience of chemists who
// downloaded a spectrum viewer. The `.deb` avoids it, but the AppImage is the
// portable option people reach for first.
//
// The type2-runtime build links FUSE statically, so it needs no libfuse at all.
// Verified with strace: the old runtime makes one openat() for libfuse.so.2,
// the new one makes none.
//
// An AppImage is just [ELF runtime][squashfs payload]. Swapping the runtime is
// a byte-level concatenation: take everything past the old runtime's ELF image
// and append it to the new one, which finds the payload the same way.
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');
const os = require('node:os');

// Pinned by content hash, not by tag. The upstream release is tagged
// "continuous" and its asset is replaced in place, so a bare download would
// make builds non-reproducible — the same source could produce AppImages with
// different runtimes. A mismatch fails the build loudly and updating the
// runtime becomes a deliberate, reviewed change, matching how the NMRium
// submodule is pinned.
const RUNTIME_URL =
  'https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64';
const RUNTIME_SHA256 =
  '1cc49bcf1e2ccd593c379adb17c9f85a36d619088296504de95b1d06215aebbf';

/**
 * Size of the ELF image in `header` — where the appended payload begins.
 *
 * Computed from the ELF section-header table rather than by executing the
 * AppImage with --appimage-offset, so it works without running the artifact.
 */
function elfImageSize(header) {
  if (header.length < 64) throw new Error('Not an ELF file: header too short');
  if (header.toString('latin1', 0, 4) !== '\x7fELF') {
    throw new Error('Not an ELF file: bad magic');
  }
  if (header[4] !== 2) throw new Error('Not a 64-bit ELF file');

  const sectionHeaderOffset = Number(header.readBigUInt64LE(0x28));
  const sectionHeaderEntrySize = header.readUInt16LE(0x3a);
  const sectionHeaderCount = header.readUInt16LE(0x3c);
  return sectionHeaderOffset + sectionHeaderEntrySize * sectionHeaderCount;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * The pinned runtime, from cache or downloaded once and cached.
 *
 * `fetchImpl` is injectable so this is testable without network access.
 */
function defaultCacheDir() {
  return path.join(os.homedir(), '.cache', 'nmrium-desktop', 'appimage-runtime');
}

async function ensureRuntime({
  cacheDir = defaultCacheDir(),
  url = RUNTIME_URL,
  expectedSha256 = RUNTIME_SHA256,
  fetchImpl = globalThis.fetch,
} = {}) {
  const cached = path.join(cacheDir, `${expectedSha256}.runtime`);
  try {
    const buffer = await fs.readFile(cached);
    // Re-verify: a truncated or tampered cache entry must not silently ship.
    if (sha256(buffer) === expectedSha256) return buffer;
  } catch {
    // Not cached yet.
  }

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Could not download AppImage runtime: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  const actual = sha256(buffer);
  if (actual !== expectedSha256) {
    throw new Error(
      `AppImage runtime hash mismatch.\n` +
        `  expected: ${expectedSha256}\n` +
        `  actual:   ${actual}\n` +
        `The upstream "continuous" release was rebuilt. Verify the new runtime, ` +
        `then update RUNTIME_SHA256 in scripts/appimage-runtime.cjs.`,
    );
  }

  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cached, buffer);
  return buffer;
}

/** Rewrite `appImagePath` with `runtime` in place of its current runtime. */
async function swapRuntime(appImagePath, runtime) {
  const existing = await fs.readFile(appImagePath);
  const payloadOffset = elfImageSize(existing.subarray(0, 64));
  if (payloadOffset >= existing.length) {
    throw new Error(`${appImagePath} has no payload after its runtime`);
  }

  const payload = existing.subarray(payloadOffset);
  await fs.writeFile(appImagePath, Buffer.concat([runtime, payload]));
  await fs.chmod(appImagePath, 0o755);
  return { payloadOffset, oldRuntimeSize: payloadOffset, newRuntimeSize: runtime.length };
}

function isAppImage(artifactPath) {
  return artifactPath.toLowerCase().endsWith('.appimage');
}

/**
 * electron-builder calls this once, after every artifact is written.
 *
 * NOTE: it leaves dist/latest-linux.yml's checksum stale. That file is not
 * published (the CI workflow uploads only the installers) and auto-update is
 * not configured — see CLAUDE.md, "Not in scope for v1". If auto-update is ever
 * added, this hook has to regenerate that metadata after the swap.
 */
async function afterAllArtifactBuild(context, deps = {}) {
  const { ensureRuntime: getRuntime = ensureRuntime, log = console.log } = deps;
  // Stryker disable next-line ArrayDeclaration: an equivalent mutant. The
  // fallback is immediately filtered by isAppImage, so its contents cannot
  // affect behaviour and no test can distinguish them.
  const appImages = (context.artifactPaths ?? []).filter(isAppImage);
  if (appImages.length === 0) return [];

  const runtime = await getRuntime();
  for (const artifact of appImages) {
    const { oldRuntimeSize, newRuntimeSize } = await swapRuntime(artifact, runtime);
    log(
      `  • replaced AppImage runtime (${oldRuntimeSize} -> ${newRuntimeSize} bytes, ` +
        `no libfuse2 dependency) file=${path.basename(artifact)}`,
    );
  }
  return [];
}

module.exports = afterAllArtifactBuild;
module.exports.elfImageSize = elfImageSize;
module.exports.ensureRuntime = ensureRuntime;
module.exports.swapRuntime = swapRuntime;
module.exports.isAppImage = isAppImage;
module.exports.defaultCacheDir = defaultCacheDir;
module.exports.afterAllArtifactBuild = afterAllArtifactBuild;
module.exports.RUNTIME_URL = RUNTIME_URL;
module.exports.RUNTIME_SHA256 = RUNTIME_SHA256;
