# Changelog

All notable changes to NMRium Desktop will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Version numbers match the bundled NMRium release exactly — see
[CONTRIBUTING.md → Versioning](CONTRIBUTING.md#versioning).

---

## [Unreleased]

Wrapper-only work, so it carries no version of its own; it ships with the next
NMRium sync (see [CONTRIBUTING.md → Versioning](CONTRIBUTING.md#versioning)).

## [2.6.0] - 2026-09-14

### Changed

- NMRium updated to **v2.6.0**. Upstream highlights: 2D alignment promoted to
  a stable tool, ph0/ph1 phase calculation, a live preview while editing
  processings, a nucleus selector shown when no spectrum is loaded, versioned
  custom workspaces, and peak absolute/relative shape area display. Fixes
  include baseline-correction anchors no longer reverting to their defaults,
  correct removal of signal assignments, typed-array handling when loading
  old `.nmrium` files, and a crash/negative-input bug in the export form.
- The wrapper's own `react-science` dependency bumped from `^20.2.0` to
  `^23.0.1` to match what this NMRium release now imports. `vite.config.js`
  dedupes `react-science` to one resolved copy shared between the wrapper and
  the submodule, so the two must stay compatible; without the bump the
  renderer build fails on a missing `coerceNumberInput` export.
- Upgraded to **Electron 43** and **electron-builder 26**. Verified with
  `npm run smoke` on both the old and new toolchain: clipboard write/read,
  `OffscreenCanvas` export, and SVG export all still work, byte-equivalent on
  export. Required one migration: electron-builder 26 rejects a flat
  `linux.desktop` map and needs the entries nested under `entry`.
- `scripts/build-nmrium.sh` installs the submodule with `npm ci` instead of
  `npm install`. `npm install` re-resolves against `package.json` and can
  rewrite the lockfile, so two builds from the same submodule pin could
  differ, which defeats the point of pinning it. `npm ci` installs exactly the
  committed lockfile.
- `npm run update-nmrium` now derives the version through `sync-version` and
  verifies it with `check-version`, rather than computing it from the tag
  string, and its next-steps output points at the test suite.
- CI's Windows leg now skips the POSIX file-mode assertion in the AppImage
  `afterPack` test: `chmod` cannot set POSIX bits on NTFS, so Windows reported
  its own defaults regardless of what the hook requested. The other eight
  assertions in that file are platform-independent and still run there.
- Documented upstream's real test coverage: 46 Playwright end-to-end tests
  across 13 files, run against three browsers against real Bruker fid data,
  plus type-check, eslint, prettier, stylelint, knip and cspell, on top of the
  vitest suite this repo's CI actually runs. The point sharpens rather than
  softens: this wrapper's CI covers the smaller half of upstream's testing, so
  an upstream bump is not safe on CI alone; `npm run smoke` plus a manual
  check of the built app is still the gate that matters.

### Added

- **A test suite** (`npm test`), using Node's built-in runner with no
  dependencies and no need for the submodule, so it runs in seconds:
  - `check-version.test.mjs`: the version-drift guard.
  - `appimage-wrap.test.mjs`: the Linux launcher shim. Covers the
    `--no-sandbox` flag, the `readlink -f` resolution that keeps `.deb`
    installs launchable by typed name, the removal of `chrome-sandbox` and
    Chromium's 12 MB licence dump, and, the one that would hurt,
    `libffmpeg.so` *not* being removed, since it looks like an optional codec
    and is actually a hard link dependency of the Electron binary.
  - `sample-catalog.test.mjs`: the ways a sample entry can silently do
    nothing: a group missing from `SAMPLE_MENU_GROUPS` never renders, a
    directory the build scripts do not package produces a menu item that
    fails on click, and a workspace id NMRium has renamed falls back to the
    default without a word. Each of these has shipped at least once.
- **`npm run test:nmrium`**: NMRium's own vitest suite against the pinned
  submodule, run in CI on every push. Its real size is worth stating plainly:
  13 tests across 7 files, covering peak-picking and range utilities. It is a
  tripwire on an upstream bump, not a safety net; upstream's real coverage is
  the 46-test Playwright suite noted above, which tests their demo app rather
  than this wrapper.
- **`scripts/check-version.cjs`**: fails the build if `package.json` and the
  bundled NMRium disagree on the version. Runs before `build`, `dist` and
  `pack`, and as its own step in both CI workflows, so a drifted version
  cannot ship. `npm run sync-version` is the fix.
- **`CONTRIBUTING.md`**: prerequisites, build commands, the versioning
  policy, and why NMRium is a pinned submodule rather than a tracked branch.
- **`LICENSE`** (MIT) and **`THIRD_PARTY_LICENSES`**, crediting Zakodium /
  cheminfo and the EU Horizon 2020 grant funding behind NMRium, with its MIT
  text verbatim from the pinned checkout.
- **A daily *Sync NMRium* workflow**, currently paused (see below): it would
  check `cheminfo/nmrium` for a new release, move the submodule pin, sync the
  version, and push a tag to trip the build workflow into a draft release.
  Manual bumps via `npm run update-nmrium` stay available either way.
- **A mutation gate** (`npm run test:mutation`, Stryker): introduces one
  defect at a time and requires a test to fail, rather than trusting a
  passing suite as proof a broken change would be caught. 100% mutation score
  (28/28 mutants) across `check-version.cjs` and `appimage-wrap.cjs`, with the
  gate mutating `scripts/*.cjs` by glob so new scripts are covered by
  default; the threshold breaks CI below 100.
- **This changelog.**

### Fixed

- **A path traversal vulnerability** in the `app://` renderer protocol
  handler: `decodeURIComponent` ran after `new URL().pathname`, so a literal
  `../` was normalised away while a percent-encoded `../` survived and was
  decoded afterward, letting a crafted request resolve outside the renderer
  root (confirmed against the running app:
  `app://bundle/%2e%2e%2f...%2fetc/passwd` returned `/etc/passwd`). Fixed in
  `electron/url-paths.cjs`, which now resolves and verifies containment and
  fails closed instead of clamping. Covered by 19 test cases: encoded,
  double-encoded, backslash, absolute, prefix-collision, NUL and malformed
  input.
- **Electron shell hardening**: a real CSP (`default-src 'none'`, achievable
  since NMRium makes no external requests at runtime); `will-navigate` and
  `setWindowOpenHandler` locked to `app://`; `sandbox: true` on the preload;
  IPC sender verification; save dialogs restricted to a basename-only
  filename; and unhandled rejections caught around every fire-and-forget call
  site.
- **Export failures no longer fail silently.** NMRium's `getBlob` dereferences
  an optional-chained `querySelector` with no null guard, so a miss threw out
  of an async handler and the export menu item did nothing: no file, no
  dialog. Both export handlers now report the failure.
- **AppImage launch failure on modern Linux.** electron-builder's bundled
  AppImage runtime `dlopen()`s `libfuse.so.2`, which Ubuntu 24.04+, Debian
  13+ and current Fedora no longer ship, so the AppImage died with a message
  naming a shared library instead of saying what to do.
  `scripts/appimage-runtime.cjs` now swaps in AppImage's statically-linked
  type2 runtime, pinned by sha256. The README leads with the `.deb` for
  Debian/Ubuntu and documents both workarounds (`libfuse2t64`, or
  `--appimage-extract-and-run`) for the AppImage.

## [2.5.0] - 2026-07-21

### Changed

- NMRium updated to **v2.5.0**, which also brings in everything from v2.4.0 —
  the desktop wrapper skipped that release, so both land here. Upstream
  highlights: a new processings panel for experimental spectra operations;
  manually adding a multiplet signal in 1D and adding a signal to a range from
  2D; the crosshair now reflects the selected tool, with a green dotted guide
  while placing a signal and no crosshair in add/move signal mode; custom tick
  and axis label styles in preferences; the peak limit removed from optimization
  and auto peak-picking parameters adjusted. Fixes include the save-as modal's
  uncontrolled input, brush label position, and a deep-clone of immer drafts.

### Added

- **Close All Spectra** (File menu). NMRium's ref API has no "clear loaded
  spectra" call, so there was no way back to a blank slate short of quitting.
  Confirms first — it is a full reload, and there is no undo.
- **LNFP III sample data** — six 500 MHz Bruker experiments (1D ¹H, three
  TOCSY at 20/40/80 ms mixing, HSQC, HMBC) for the milk oligosaccharide
  lacto-*N*-fucopentaose III, from the 2007 EuroCarbDB/CCPN sample CD. Ships in
  both sample-data companion packages and appears in File → Open Sample.
- **GitHub Pages landing page.**

### Fixed

- **Open Sample menu.** Entries pointing at NMRium's demo pointer objects and
  entries pointing at plain spectrum files need different load paths; the menu
  used one for both, so half of it did nothing.

### Changed (build)

- `npm run update-nmrium` turned into a real bump-and-test helper rather than a
  bare submodule checkout.
- The submodule is marked `ignore = dirty`, so a built NMRium checkout stops
  reporting the superproject as modified.

## [2.3.0] — 2026-07-06

First release. An Electron wrapper around NMRium v2.3.0, for people who expect
install-and-open software with a Start Menu entry and a File → Open dialog
rather than a PWA install flow.

### Added

- Electron shell around NMRium v2.3.0, rendering NMRium's library component
  directly from the pinned submodule.
- Native **File → Open** with filters for JCAMP-DX (`.dx`, `.jdx`, `.jcamp`),
  JEOL Delta (`.jdf`), NMRium archives (`.nmrium`) and zipped Bruker/Varian
  experiment folders, plus **Import Molecule** for `.mol` and `.sdf`.
- **Save As** and **Export as SVG**, driven from the native menu through the
  renderer's NMRium ref API.
- **View → Workspace** — NMRium's own built-in presets (1D Processing,
  Prediction, Assignment, Simulation, Exercise, Embedded), which are
  undiscoverable from inside the app itself.
- File associations for `.dx` and `.jdx`, so double-clicking a spectrum opens
  it.
- App icon derived from NMRium's own brand mark, generated into the full
  hicolor size set.
- Optional sample-data companion packages — `nmrium-samples.zip` and a
  `nmrium-desktop-samples` `.deb` — carrying NMRium's demo and teaching
  dataset.
- CI workflow building Linux, Windows and macOS packages, with tag pushes
  creating a draft release.

### Fixed

- AppImage and `.deb` launches crashing on Chromium's SUID sandbox, which no
  AppImage install and few Linux desktops can satisfy. The packaged binary is
  wrapped in a launcher passing `--no-sandbox`; the app only ever loads local
  bundled content.
- Slow AppImage startup.
- Missing `MimeType` in the generated `.desktop` file.
- Dead Undo/Redo menu entries — NMRium has no working undo of its own, so the
  generic roles acted on the browser's text-undo stack and did nothing useful.
  Removed rather than left looking functional.
- Linux taskbar and alt-tab falling back to Electron's generic icon.

### Changed

- Package size cut by roughly 65% by excluding NMRium's demo sample data from
  the main install and offering it as the companion packages above.
