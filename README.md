# NMRium Desktop

An Electron desktop wrapper around [NMRium](https://www.nmrium.org)
(cheminfo/nmrium), giving chemists a native install-and-open app — Start
Menu / Applications entry, a File → Open dialog, `.dx`/`.jdx` file
associations, and persistent local files — instead of a browser PWA install
flow.

## Features

- Native File → Open dialog and `.dx`/`.jdx` file-association double-click,
  wired into NMRium's own file-loading pipeline unmodified.
- NMRium's own drag-and-drop still works as-is.
- A native File → Open Sample menu (once the optional sample data is
  installed, see below) replaces NMRium's own in-app demo dataset picker.
- No changes to NMRium's processing/rendering logic — it's built from source
  as a pinned git submodule. We render just the `<NMRium>` library
  component itself (via our own thin renderer, `renderer/`), not NMRium's
  demo/docs-site app — that app's routes, sample-picker sidebar, etc. are
  demo-site chrome we don't need and don't ship.

## Requirements

- Node.js **24** (see `.nvmrc`) — matches the Node version NMRium itself
  pins via its own `.nvmrc`/Volta config.
- git (needed for the submodule).

## Getting started

```sh
git clone --recurse-submodules <this-repo-url>
cd nmrium-desktop
npm install
npm run build:nmrium   # installs the pinned NMRium submodule's own dependencies
npm start               # builds renderer/ then launches Electron
```

If you already cloned without `--recurse-submodules`:

```sh
git submodule update --init
```

## Building a packaged app

Local builds only target Linux (AppImage + deb) — that's what this machine
can run and test directly. Windows (nsis) and macOS (dmg) builds happen in
CI (GitHub Actions), not locally.

```sh
npm run dist
```

`package.json`'s `build.compression` is deliberately `"normal"`, not
`"maximum"` — do not "optimize" this back. AppImage mounts its payload as a
FUSE-backed squashfs at launch, and `"maximum"` (xz) compression measured
~60s to get a window on screen on a cold cache, vs. ~12s at `"normal"`,
for ~20MB more on disk. `.deb` installs are unaffected either way (dpkg
extracts to disk once at install time, no runtime decompression), so this
tradeoff only concerns the AppImage.

## Sample / teaching data (optional)

The packaged app ships without NMRium's own demo sample catalog (Cytisine,
ethylbenzene, teaching exercises, etc. — `nmrium/public/data` and
`/exercises`, ~250MB) since it's demo content for the public web app, not
something you need to open your own spectra. This is most of why the
installer is small.

If you want it anyway (e.g. for the native File → Open Sample menu), there
are two ways to get it — either works, no reinstall of the main app needed,
just reopen it after:

**Debian/Ubuntu — companion `.deb` (recommended on Linux):**

```sh
npm run build:samples-deb          # writes dist/nmrium-desktop-samples_<version>_all.deb
sudo apt install ./dist/nmrium-desktop-samples_2.3.0_all.deb
```

Installs system-wide to `/usr/share/nmrium-desktop/samples`, which the app
checks automatically.

**Any OS — zip, extracted per-user:**

```sh
npm run build:samples-archive      # writes dist/nmrium-samples.zip
unzip dist/nmrium-samples.zip -d ~/.config/nmrium-desktop/samples   # Linux
```

(On macOS: `~/Library/Application Support/nmrium-desktop/samples`; on
Windows: `%APPDATA%\nmrium-desktop\samples`.) The app checks the per-user
copy first, then the system-wide `.deb` install, then falls back to the
(missing) bundled copy.

## Updating NMRium

```sh
npm run update-nmrium            # checks out the latest vX.Y.Z tag
# or: npm run update-nmrium -- v2.4.0
npm run build:nmrium             # rebuild and smoke-test before committing
git commit -am "chore: update NMRium to vX.Y.Z"
```

Upgrades are a deliberate, tested step — the submodule pointer is a commit
SHA, not a tracked branch.

## Architecture

```
nmrium-desktop/
├── electron/
│   ├── main.js      # BrowserWindow, app:// protocol, native menu, file-open IPC
│   └── preload.js   # feeds opened files into NMRium's own file input
├── renderer/
│   ├── index.html
│   └── src/index.tsx   # mounts <NMRium> directly — no demo-app chrome
├── vite.config.js       # builds renderer/ against nmrium/src/component/main
├── scripts/
│   ├── build-nmrium.sh             # npm install inside nmrium/ (no build — see below)
│   ├── update-nmrium.sh
│   ├── build-samples-archive.sh   # optional nmrium-samples.zip (see below)
│   ├── build-samples-deb.sh       # optional nmrium-desktop-samples .deb (see below)
│   └── appimage-wrap.cjs          # afterPack: force --no-sandbox on Linux
├── build/
│   └── icon.png     # app icon — NMRium's own brand mark (from nmrium.com/brand), electron-builder generates .ico/.icns from this
├── nmrium/          # git submodule -> github.com/cheminfo/nmrium, pinned to v2.3.0
└── package.json     # electron-builder config lives here
```

`renderer/` is our own minimal Vite app: it imports the `NMRium` component
directly from `nmrium/src/component/main` (the actual library source, not
NMRium's demo/docs-site build) and mounts it with no other chrome. This
means `npm run build:nmrium` only needs to install the submodule's
dependencies — its own `npm run build` (which builds the demo app: routing,
sample-picker sidebar, etc.) is never invoked. `vite.config.js` sets
`resolve.dedupe` for react/react-dom/blueprint/react-science so our renderer
entry and NMRium's internals share a single copy of each, since the
submodule's own `node_modules` also carries them (as its devDependencies
for building its demo app).

The renderer build output (`renderer/dist`) is served through a custom
`app://` protocol rather than `file://`, for secure-context treatment
consistent with what NMRium expects. Native File → Open (and File → Open
Sample, once sample data is installed) reads the file in the main process
and delivers it to NMRium's existing hidden file input (the same one its
own drag-and-drop UI uses), rather than modifying NMRium's source.

## Development

```sh
npm start
```

Reload with the View menu / devtools for debugging the loaded NMRium build.

## License

MIT, matching upstream NMRium. NMRium is developed by
[Zakodium](https://www.zakodium.com)/cheminfo (with EU Horizon 2020 grant
funding) — see [nmrium/LICENSE](nmrium/LICENSE) and
https://github.com/cheminfo/nmrium for the upstream project.

The packaged app omits Chromium's own bundled `LICENSES.chromium.html`
(~12MB, purely informational, not read at runtime) to keep install size
down — see https://www.chromium.org/Home for upstream Chromium's own
third-party license notices if needed.
