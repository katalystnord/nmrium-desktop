# nmrium-desktop

## Problem statement

NMRium (https://www.nmrium.org, by Zakodium/cheminfo) is a React component for
displaying and processing NMR spectra. It's distributed as a web component and
runnable as a PWA, but the target audience for this wrapper — chemists,
chemistry students, and older-generation scientists — expect install-and-open
software with a Start Menu / Applications entry, a File → Open dialog, and
persistent local files. PWA install flows (hidden address-bar icons on
Chrome, undiscoverable Share → Add to Home Screen on Safari/iOS, inconsistent
session/storage persistence) are a real adoption barrier for this group, not
a nice-to-have. This project wraps NMRium in Electron to match the mental
model this audience already has for scientific desktop software (TopSpin,
MNova, etc.), consistent with the rest of the katalystnord desktop-tools
suite (ketcher-desktop, plot-digitizer, tlc-digitizer-fiji).

## What's wrapped vs. what's original

- **Wrapped, not modified:** the upstream NMRium repo (cheminfo/nmrium,
  MIT license, currently v2.x), pulled in as a **git submodule** — same
  pattern as ketcher-desktop's submodule of the Ketcher repo. We build NMRium
  from source rather than consuming it as a prebuilt npm package, so the
  submodule pointer records exactly which upstream commit/tag this wrapper
  ships, and upgrades are a deliberate `git submodule update` + retest rather
  than a silent npm bump. No changes to NMRium's own processing/rendering
  logic.
- **Original work in this repo:** the Electron shell — main process, window
  management, native file open/save dialogs, file-association handling for
  `.dx` / `.jdx` (JCAMP-DX) and other NMRium-supported formats, auto-updater
  config, installer packaging.

## License / attribution

- NMRium is MIT licensed. Confirm current license text at
  https://github.com/cheminfo/nmrium before packaging and include it verbatim
  in this repo's `THIRD_PARTY_LICENSES` file.
- Credit Zakodium/cheminfo (and note EU Horizon 2020 grant funding, per their
  repo) in the About dialog and README — same pattern as ketcher-desktop's
  EPAM/Ketcher attribution.
- This wrapper itself: pick a license (suggest MIT to match, for consistency
  across the desktop-tools line) — confirm with David before publishing.
- Follow the shared README template (problem statement / what's wrapped vs
  original / license & attribution / build & run / screenshot) once it exists,
  so this repo reads as one coherent body of work with the others.

## Prerequisites (one-time, machine-level)

Nothing exotic — same as ketcher-desktop:

- **Node.js LTS** (v20 or v22) + npm. Check with `node -v` / `npm -v`; if not
  installed, get it from https://nodejs.org or via your package manager /
  nvm.
- **git** (you'll already have this — needed for the submodule).
- Everything else (Electron, electron-builder, and NMRium's own build
  dependencies) installs via `npm install` inside the project and the
  submodule — no separate downloads.
- **Only if cross-building Windows installers from Linux/macOS:** Wine is
  needed by electron-builder. Not needed if you build each platform's
  installer on that platform (recommended to start).
- **Only if you want code-signing:** a code-signing certificate (Windows) or
  Apple Developer ID (macOS). Skip this for now — unsigned builds are fine
  for internal/early use, just expect an OS security warning on first run.

## Tech stack

- Electron (latest stable)
- electron-builder for packaging/installers (matches ketcher-desktop)
- cheminfo/nmrium pulled in as a **git submodule**, built from source using
  NMRium's own build tooling (it builds with Vite — `npm run build` inside
  the submodule produces the `build/` output, per its package.json). Confirm
  the exact build script name/output path against whatever commit you pin,
  since these can change between versions.
- React 18+ (NMRium's own peer dependency — check the submodule's
  package.json for the exact version it expects)
- Note: NMRium depends on `openchemlib/full`. If the Electron shell itself
  also imports openchemlib anywhere, import from `openchemlib/full` there
  too, to avoid bundling duplicate OCL versions.

## Task: verify against the real ketcher-desktop repo

Repo: https://github.com/katalystnord/ketcher-desktop (public)

Several items above were written as "confirm/check" placeholders because I
didn't have direct visibility into ketcher-desktop's actual structure. Now
that it's public, pull it up and settle these directly rather than guessing:

- [ ] Exact submodule path convention (`vendor/`, `third_party/`, or other) —
      match it exactly for `vendor/nmrium` (or whatever it turns out to be).
- [ ] Whether the submodule build is wired into a `postinstall`/`prebuild`
      script, or done manually — replicate whichever it is.
- [ ] The `.gitmodules` file and pinning convention (tag vs. commit SHA) it
      uses for Ketcher — mirror it for the NMRium pin.
- [ ] `.github/workflows/*.yml` — confirm trigger (tag push vs. merge to
      main), the electron-builder invocation, and whether it's a build
      matrix or separate jobs per OS. Copy this near-verbatim rather than
      writing a new one.
- [ ] Release process — how build artifacts from local (AppImage/deb) and CI
      (nsis/dmg) end up attached to the same GitHub Release per tag.
- [ ] README structure — once the shared README template exists, confirm
      ketcher-desktop's actual README matches it (or use ketcher-desktop's
      current README as the template source if the template doesn't exist
      yet).
- [ ] License/attribution file format (`THIRD_PARTY_LICENSES` or similar) —
      match naming and structure for the NMRium/Zakodium credit.

## Build targets

- **Local builds (this machine, Linux/Stockholm home infra):** AppImage and
  `.deb` only, via `electron-builder --linux AppImage deb`. No Wine, no
  cross-compilation — build what you can run and test directly.
- **Windows (nsis) and macOS (dmg):** not built locally. Handled by GitHub
  Actions on push/tag, matching whatever workflow ketcher-desktop already
  uses (worth reusing that `.yml` almost verbatim — check its matrix strategy
  and electron-builder invocation before writing a new one from scratch).
  Signing/notarization for macOS can stay unconfigured for now (unsigned
  builds trigger a Gatekeeper warning but are fine for early use) — revisit
  once there's real external distribution.
- Release artifacts (AppImage/deb from local build, nsis/dmg from CI) should
  land in the same GitHub Releases entry per tag, again mirroring
  ketcher-desktop's release process rather than inventing a new one.

## Bootstrap steps

1. `git init` this folder (if not already), then add NMRium as a submodule,
   same as ketcher-desktop's pattern:
   `git submodule add https://github.com/cheminfo/nmrium vendor/nmrium`
   (confirm the actual path convention ketcher-desktop uses — `vendor/`,
   `third_party/`, or similar — and match it exactly for consistency across
   the suite.)
   Pin to a specific tag/commit rather than tracking `main`, and record which
   one in the README, so upgrades are a deliberate, tested step.
2. Inside `vendor/nmrium`: `npm install` then `npm run build` (check the
   submodule's own `package.json` scripts — confirm the exact build command
   for whatever commit you pinned; NMRium's scripts have changed across
   versions).
3. `npm init -y` at the wrapper's root, then set up the Electron + Vite +
   React scaffold — reuse ketcher-desktop's scaffold directly if it's
   structurally reusable, so the two wrappers stay consistent.
4. `npm install electron electron-builder --save-dev` at the wrapper root.
5. Wire the renderer to load NMRium's built output from `vendor/nmrium/build`
   (or wherever its build script places it) rather than importing it as an
   npm package — confirm whether NMRium's build output is consumable directly
   or needs to be re-exposed as a local component import; this depends on how
   its `exports` field in package.json is set up.
6. Electron main process: single `BrowserWindow`, native menu with File →
   Open / Save, `dialog.showOpenDialog` wired to however NMRium expects a
   file handed to it (drag-drop vs. programmatic load — check the submodule's
   own demo/source for the actual mechanism rather than assuming).
7. Register file associations for `.dx` / `.jdx` in `electron-builder` config
   (`fileAssociations` field) so double-clicking a spectrum file opens it in
   the app.
8. `electron-builder` config with a `linux` target of `AppImage` and `deb` —
   this is what you'll actually build and test locally. Add `win` (nsis) and
   `mac` (dmg) targets to the same config so CI can invoke the same command
   with `--win`/`--mac` flags rather than needing a separate config.
9. Set up (or copy) the GitHub Actions workflow that runs the Windows and
   macOS builds on CI — check ketcher-desktop's `.github/workflows/` for the
   existing pattern rather than writing one from scratch.
10. Smoke test: open a sample `.dx` file (NMRium's own repo has sample data
    under its build folder) end to end before touching packaging.
11. Add `.gitmodules` and confirm `git clone --recurse-submodules` (or
    `git submodule update --init`) is documented in the README build/run
    section, since a plain clone won't pull the submodule content.

## Open questions to resolve early (don't guess — check the pinned NMRium commit directly)

- Which commit/tag to pin the submodule to, and whether that version's build
  output is structured in a way the Electron renderer can consume directly
  (check `exports` in its package.json for the pinned commit).
- How that version expects file loading to be wired (drag-drop vs.
  programmatic load API) — affects how the native File → Open menu talks to
  the built component.
- Whether NMRium ships its own service worker / PWA assets in its build
  output that need to be stripped or disabled inside the Electron build to
  avoid conflicts.
- Whether ketcher-desktop's submodule is built as part of this repo's own
  build script (e.g. a `postinstall` or `prebuild` step that runs the
  submodule's build automatically) — replicate that pattern here rather than
  requiring a manual build step, for consistency.

## Not in scope for v1

- Cloud sync, nmrXiv integration, or the Docker-based `nmrium-react-wrapper`
  (that's NFDI4Chem's separate iframe integration approach — not what we're
  doing here).
- Auto-update infrastructure — get a working local build first.
