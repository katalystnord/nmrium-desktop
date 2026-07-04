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
- No changes to NMRium's processing/rendering logic — it's built from source
  as a pinned git submodule and served as-is.

## Requirements

- Node.js **24** (see `.nvmrc`) — matches the Node version NMRium itself
  pins via its own `.nvmrc`/Volta config.
- git (needed for the submodule).

## Getting started

```sh
git clone --recurse-submodules <this-repo-url>
cd nmrium-desktop
npm install
npm run build:nmrium   # builds the pinned NMRium submodule (nmrium/build)
npm start
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

## Sample / teaching data (optional)

The packaged app ships without NMRium's own demo sample catalog (Cytisine,
ethylbenzene, teaching exercises, etc. — `nmrium/build/data` and
`/exercises`, ~250MB) since it's demo content for the public web app, not
something you need to open your own spectra. This is most of why the
installer is small.

If you want it anyway (e.g. for the built-in "Samples"/"Exercises" sidebar
browsing), there are two ways to get it — either works, no reinstall of the
main app needed, just reopen it after:

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
├── scripts/
│   ├── build-nmrium.sh
│   ├── update-nmrium.sh
│   ├── build-samples-archive.sh   # optional nmrium-samples.zip (see below)
│   ├── build-samples-deb.sh       # optional nmrium-desktop-samples .deb (see below)
│   └── appimage-wrap.cjs          # afterPack: force --no-sandbox on Linux
├── build/
│   └── icon.png     # app icon — NMRium's own brand mark (from nmrium.com/brand), electron-builder generates .ico/.icns from this
├── nmrium/          # git submodule -> github.com/cheminfo/nmrium, pinned to v2.3.0
└── package.json     # electron-builder config lives here
```

NMRium's build output (`nmrium/build`) is served through a custom `app://`
protocol rather than `file://`, for secure-context treatment consistent with
what the built SPA expects. Native File → Open reads the file in the main
process and delivers it to NMRium's existing hidden file input (the same one
its own drag-and-drop UI uses), rather than modifying NMRium's source.

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
