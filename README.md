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
│   └── update-nmrium.sh
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
