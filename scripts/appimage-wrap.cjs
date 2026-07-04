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
  fs.writeFileSync(
    exePath,
    `#!/bin/sh\nexec "$(dirname "$0")/${exeName}.bin" --no-sandbox "$@"\n`,
  );
  fs.chmodSync(exePath, 0o755);
};
