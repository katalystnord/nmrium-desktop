# Contributing to NMRium Desktop

Thanks for your interest in contributing. This document covers everything you
need to get a working build and open a pull request.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Git | any | with submodule support |
| Node.js | **24+** | see below — NMRium's build toolchain requires it |
| npm | bundled with Node | |

### Node 24 via nvm

The system Node is likely too old. Install the correct version with
[nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 24
```

`scripts/build-nmrium.sh` refuses to run on anything older rather than failing
halfway through with a confusing error.

## Getting started

```bash
# Clone with the NMRium submodule
git clone --recurse-submodules https://github.com/katalystnord/nmrium-desktop.git
cd nmrium-desktop

# If you forgot --recurse-submodules
git submodule update --init --recursive

# Install the wrapper's dependencies, then NMRium's
npm install
npm run build:nmrium

# Launch
npm start
```

## Build commands

| Command | What it does |
|---|---|
| `npm start` | Build the renderer and launch the app (dev mode, no packaging) |
| `npm run build:nmrium` | Install the NMRium submodule's dependencies |
| `npm run build:renderer` | Build the renderer bundle only |
| `npm run dist` | Full build: renderer + electron-builder packages + sample-data packages |
| `npm run update-nmrium` | Bump the submodule to an upstream tag and sync the version |
| `npm test` | Wrapper test suite (Node's built-in runner, no dependencies) |
| `npm run test:mutation` | Mutation gate — fails if any wrapper test is vacuous |
| `npm run smoke` | Launch the real app and exercise load/export/security (needs a display) |
| `npm run test:nmrium` | NMRium's own unit tests, against the pinned submodule |
| `npm run check-version` | Assert the wrapper version matches the bundled NMRium |
| `npm run sync-version` | Set the wrapper version from the bundled NMRium |

## Why NMRium is a pinned submodule

NMRium is vendored as a git submodule rather than consumed as an npm package,
and the submodule records one exact upstream commit. That is deliberate, and it
is not the same thing as ignoring upstream:

- **A release is reproducible.** Every tag here corresponds to one NMRium
  commit. Checking out `v2.5.0` a year from now rebuilds the same app, which is
  the whole point when the output is a scientific tool someone cited results
  from.
- **The version number means something.** `2.5.0` says *NMRium 2.5.0 is inside*.
  Nothing else needs to be looked up.
- **Upgrades are tested, not silent.** An upstream change that breaks the
  NMRiumRefAPI, the workspace ids, or the sample catalog shows up as a failing
  build on a bump commit, not as a broken app in a user's hands.

Tracking upstream is handled by *moving* the pin, not by removing it. The
**Sync NMRium** workflow bumps the submodule to each new upstream release, syncs
the version, and pushes a tag — which trips the Build workflow into a draft
release.

**Its daily schedule is currently paused.** It needs a `GH_PAT` repository
secret with `contents: write`, because a tag pushed with the default
`GITHUB_TOKEN` does not trigger the build workflow, and that secret is not set
up yet. Left scheduled it would fail every morning, so the `schedule` block is
commented out in `.github/workflows/sync-nmrium.yml`; `workflow_dispatch` still
works. To enable it: add the secret, uncomment the block, and confirm with one
manual run.

Until then, upstream tracking is manual: `npm run update-nmrium` does the same
work, and is also what you want when moving early or landing on an untagged
commit.

## Versioning

**NMRium Desktop carries the exact version of the NMRium release it wraps.** If
the submodule is at NMRium `v2.5.0`, `package.json` says `2.5.0` and the release
tag is `v2.5.0`. Nothing else. The version number answers one question — *which
NMRium is inside?* — and users should be able to read it that way without a
translation table.

The version is never edited by hand. It is derived from the submodule:

```bash
npm run sync-version    # reads nmrium/package.json
```

`npm run update-nmrium` does this for you, and the daily Sync NMRium workflow
does it in CI. `npm run check-version` asserts the two agree and runs
automatically before `build`, `dist` and `pack`, and as its own step in both CI
workflows, so a drifted version cannot ship.

**Desktop-only changes do not get their own version.** A menu fix or a
packaging change with no upstream bump behind it waits and ships with the next
NMRium sync. This is a deliberate trade-off: appending a wrapper-local suffix is
what breaks the correspondence, and the confusion costs more than shipping a few
days later. If a desktop-only fix is urgent enough to need a release of its own,
raise it as a decision rather than reaching for a suffix.

## Testing

`npm test` runs the wrapper suite with Node's built-in test runner. It has no
dependencies and does not need the submodule checked out, so it is fast enough
to run on every save.

What it covers, and why each one is there:

| Suite | Guards against |
|---|---|
| `check-version.test.mjs` | The version drifting from the bundled NMRium |
| `appimage-wrap.test.mjs` | Regressions in the Linux launcher shim — the `--no-sandbox` flag, the `readlink -f` path resolution that makes `.deb` installs launchable by name, and the removal of `libffmpeg.so`, which looks optional and is not |
| `sample-catalog.test.mjs` | Sample entries that silently do nothing: a group missing from `SAMPLE_MENU_GROUPS`, a file the build scripts never package, a workspace id NMRium no longer defines |

These are the failure modes that do not announce themselves. A broken sample
entry is a menu item that does nothing when clicked; a stale workspace id
silently falls back to the default. Both shipped at least once.

### Mutation testing

`npm run test:mutation` is a gate, not a report. Stryker introduces one
deliberate defect at a time into the mutated files and requires a test to fail;
a surviving mutant is a line the suite executes but does not actually pin. The
threshold is set to **break below 100%**, so a survivor fails CI rather than
quietly lowering a number nobody reads.

`stryker.conf.mjs` mutates `scripts/*.cjs` by glob rather than a hand-kept
list, so a newly added script is covered by default — adding one means writing
tests for it, or excluding it there with a stated reason. `generate-icons.cjs`
is the one exclusion: it runs under Electron for `nativeImage` and does its work
at import time, so it cannot easily be unit tested.

Be clear-eyed about scope. It covers the wrapper scripts, which is a small
fraction of the code that ships; `electron/main.js` has no unit tests, so it
produces no mutants and does not affect the score. A 100% result means *the
tests that exist are honest*, not that the app is well tested.

`npm run test:nmrium` runs NMRium's own vitest suite against the pinned
submodule. Be aware of what that is and is not: as of v2.5.0 it is 13 tests
across 7 files, covering peak-picking and range utilities. It catches an
upstream bump that breaks those, and nothing else. Most of upstream's real
coverage lives in their Playwright suite, which we do not run — it needs a full
demo build and a browser, and it exercises upstream's demo app rather than this
wrapper.

It deliberately does not run upstream's full `test` script either, which adds
their lint, type-check, prettier, stylelint and knip gates. Those are upstream's
gates on upstream's tree and say nothing about whether this wrapper ships a
working app.

So an upstream bump is still not safe on CI alone. Smoke-test the built app —
open a spectrum, open a sample, switch workspaces, export — before promoting the
draft release. That is the real gate, and automating it is the obvious next
piece of work here.

`npm run smoke` drives the real packaged-code paths through Playwright: it
launches the app, loads a spectrum the same way File → Open does, exports it as
SVG through the actual IPC, and asserts the hardening is live — sandbox on,
context isolation on, CSP present and blocking remote script, and `app://`
traversal rejected. It needs a display, and it is the check to run before
shipping an Electron or NMRium bump; the unit suite cannot see any of this.

### Security posture

The app renders untrusted files, so the shell is deliberately locked down, and
`scripts/smoke.mjs` asserts each of these rather than trusting the source:

- **`app://` requests are contained.** `electron/url-paths.cjs` resolves and
  then verifies the result is inside the root. `new URL()` normalises literal
  `../` away but leaves percent-encoded `../` intact, so decoding reintroduces
  traversal after the parser has "cleaned" the path — this really did read
  `/etc/passwd` before the fix.
- **CSP** in `renderer/index.html`, `default-src 'none'`. NMRium makes no
  external requests at runtime, so this is achievable rather than aspirational.
- **No navigation away from `app://`.** `will-navigate` and
  `setWindowOpenHandler` send real links to the user's browser instead; the
  preload, and `window.electronAPI` with it, must never follow the page to
  another origin.
- **`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.**
- **IPC handlers verify the sender** and sanitise the filename they put in a
  save dialog.

There is still no automated UI test. For anything visual, use `npm start`: open
a spectrum, open a sample, switch workspaces, and export.

## Project structure

```
nmrium-desktop/
├── electron/
│   ├── main.js        # Main process: app:// protocol, menus, dialogs, IPC
│   └── preload.js     # Exposes the renderer bridge
├── renderer/          # Thin Vite entry point importing NMRium's component
├── scripts/
│   ├── build-nmrium.sh          # Installs the submodule's dependencies
│   ├── update-nmrium.sh         # Bumps the submodule and syncs the version
│   ├── check-version.cjs        # Version-drift guard
│   ├── appimage-wrap.cjs        # afterPack hook: launcher shim, strip dead weight
│   ├── appimage-runtime.cjs     # afterAllArtifactBuild hook: FUSE-free AppImage runtime
│   ├── smoke.mjs                # Drives the real app; run before shipping a bump
│   ├── generate-icons.cjs       # hicolor icon size set
│   └── build-samples-*.sh       # Optional sample-data companion packages
├── sample-data/       # Our own samples, merged with NMRium's catalog at runtime
├── tests/             # Wrapper test suite (node --test)
└── nmrium/            # Git submodule → github.com/cheminfo/nmrium
```

## Submitting a pull request

1. Fork the repo and create a branch from `master`.
2. Make your changes and verify the app still launches with `npm start`.
3. Run `npm test`.
4. If you changed the packaging config, do a full `npm run dist` and check the
   AppImage runs.
5. Open a pull request — describe what changed and why.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](./LICENSE).
