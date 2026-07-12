// electron-builder afterPack hook (Linux only).
//
// Most Linux desktops — and every AppImage install, since AppImage has no
// privileged install step — never get chrome-sandbox chowned to root with
// mode 4755, which Chromium's SUID sandbox requires. Electron aborts on
// launch rather than silently run unsandboxed. The sandbox check happens in
// native Chromium startup, before any of our JS runs, so `--no-sandbox` has
// to be an actual argv flag on the real binary, not something set at
// runtime in main.js.
//
// This app only ever loads local, bundled content (never arbitrary remote
// pages), so forcing --no-sandbox is an accepted tradeoff here — same
// precedent as ketcher-desktop's afterPack hook.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;

  const exeName = context.packager.executableName;
  const exePath = path.join(context.appOutDir, exeName);
  const realExePath = path.join(context.appOutDir, `${exeName}.bin`);

  fs.renameSync(exePath, realExePath);
  // `readlink -f` resolves the symlink chain .deb installs create
  // (/usr/bin/<name> -> /etc/alternatives/<name> -> /opt/<app>/<name>)
  // before taking dirname — plain `dirname "$0"` would resolve to /usr/bin
  // when launched by typed command name / from PATH, which has no .bin
  // next to it. Launching via the .desktop file's absolute Exec= path
  // works either way, which is why this only breaks from a terminal.
  fs.writeFileSync(
    exePath,
    `#!/bin/sh\nexec "$(dirname "$(readlink -f "$0")")/${exeName}.bin" --no-sandbox "$@"\n`,
  );
  fs.chmodSync(exePath, 0o755);

  // Chromium's SUID sandbox helper is unreachable code now that we always
  // pass --no-sandbox above (the sandbox check happens before the helper
  // would ever run), so it's dead weight in every install.
  const sandboxHelper = path.join(context.appOutDir, 'chrome-sandbox');
  if (fs.existsSync(sandboxHelper)) fs.rmSync(sandboxHelper);

  // Chromium's aggregated third-party OSS license text (~12MB) — purely
  // informational, never read at runtime. License compliance for this app
  // is handled via THIRD_PARTY_LICENSES/README instead of bundling this
  // generated file in every install; see Chromium's own project page for
  // its upstream license notices if needed.
  const chromiumLicenses = path.join(context.appOutDir, 'LICENSES.chromium.html');
  if (fs.existsSync(chromiumLicenses)) fs.rmSync(chromiumLicenses);

  // NOTE: libffmpeg.so looks like an optional codec plugin but is actually
  // a hard dynamic-link dependency of the Electron binary (DT_NEEDED, not
  // dlopen'd) — removing it makes every launch fail immediately with
  // "error while loading shared libraries". Confirmed by testing; do not
  // remove despite NMRium having no <audio>/<video> usage.
};
