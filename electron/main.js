const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const {
  resolveRequestedPath,
  resolveWithinRoot,
  pathFromArgv,
} = require('./url-paths.cjs');
const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  protocol,
  net,
  ipcMain,
  shell,
  nativeImage,
} = require('electron');

const APP_SCHEME = 'app';

// Packaged: electron-builder's extraResources copies renderer/dist -> renderer-dist.
// Dev: use our own Vite build output directly (`npm run build:renderer`).
const RENDERER_DIST = app.isPackaged
  ? path.join(process.resourcesPath, 'renderer-dist')
  : path.join(__dirname, '..', 'renderer', 'dist');

const SAMPLES_CATALOG_FILE = app.isPackaged
  ? path.join(process.resourcesPath, 'samples-catalog.json')
  : path.join(__dirname, '..', 'nmrium', 'src', 'demo', 'samples.json');

// Our own sample additions (not part of the submodule, so not in
// samples.json) get their own small catalog fragment, merged with NMRium's
// at menu-build time rather than editing the pinned submodule file.
const EXTRA_SAMPLES_CATALOG_FILE = app.isPackaged
  ? path.join(process.resourcesPath, 'samples-catalog-extra.json')
  : path.join(__dirname, '..', 'sample-data', 'catalog-extra.json');

// electron-builder's own generated OS icons (installer/.desktop/icon-theme)
// aren't visible to our own running process at a predictable path, and
// BrowserWindow needs an explicit `icon` to get a correct _NET_WM_ICON on
// Linux — without it, the taskbar/alt-tab icon falls back to Electron's own
// generic icon. Ship our own copy as a resource so this works everywhere.
const ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.png')
  : path.join(__dirname, '..', 'build', 'icon.png');
// A raw path string handed to BrowserWindow's `icon` option has proven
// unreliable for setting _NET_WM_ICON on Linux (X11/XWayland) — loading it
// through nativeImage first is the reliable form.
const ICON_IMAGE = nativeImage.createFromPath(ICON_PATH);

// The packaged app ships without NMRium's own demo sample/teaching data
// (~250MB of the upstream demo's sample catalog, not useful for opening your
// own real spectra) to keep install size down. Users who want that data
// anyway can either extract nmrium-samples.zip (build-samples-archive.sh)
// into their per-user data dir, or install the nmrium-desktop-samples .deb
// (build-samples-deb.sh), which drops it system-wide. The per-user copy
// wins if both are present.
const SAMPLES_SEARCH_DIRS = [
  path.join(app.getPath('userData'), 'samples'),
  '/usr/share/nmrium-desktop/samples',
];

// Sample-catalog groups that just load a plain spectrum/state file: safe to
// surface as a native "Open Sample" submenu. Other groups in samples.json
// (Workspaces, Props debug, Snapshot, Plugin UI) drive NMRium's demo-only
// React views (guided exercises, callback tests, plugin harnesses) that
// have no native equivalent, so they're intentionally left out.
const SAMPLE_MENU_GROUPS = [
  'Cytisine',
  'Simple spectra',
  'Multiple spectra',
  'Various formats',
  'Simulation',
  'LNFP III (EuroCarbDB)',
];

// NMRium's own built-in workspace presets (nmrium/src/component/main/types.ts)
// — each reconfigures which panels/toolbar buttons are shown for a given
// task. Undiscoverable from inside the app itself, so surfaced as a native
// View > Workspace menu instead.
const WORKSPACES = [
  { id: 'default', label: 'Default' },
  { id: 'process1D', label: '1D Processing' },
  { id: 'prediction', label: 'Prediction' },
  { id: 'assignment', label: 'Assignment' },
  { id: 'simulation', label: 'Simulation' },
  { id: 'exercise', label: 'Exercise' },
  { id: 'embedded', label: 'Embedded (minimal UI)' },
];

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow = null;
let pendingOpenPath = null;
let currentWorkspace = 'default';

async function pathExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const relativePath = resolveRequestedPath(new URL(request.url).pathname);
    if (relativePath === null) return new Response('Bad request', { status: 400 });

    // samples.json's sample objects reference sibling data with paths like
    // "data/cytisine/1H_Cytisin_600MHz-R+I.dx", resolved client-side
    // relative to the page URL (see renderer's onOpenSample) — matching
    // that convention here means /data/... and /exercises/... requests
    // need to come from the installed samples directory, not RENDERER_DIST.
    let root = RENDERER_DIST;
    if (relativePath.startsWith('/data/') || relativePath.startsWith('/exercises/')) {
      const samplesRoot = await findSamplesRoot();
      if (samplesRoot) root = samplesRoot;
    }

    // Containment is enforced here rather than trusted: `new URL()` normalises
    // literal ../ away but leaves percent-encoded ../ intact, so decoding can
    // reintroduce traversal after the parser has already "cleaned" the path.
    // resolveWithinRoot returns null instead of clamping, so a request that
    // tried to leave the root fails visibly rather than silently serving
    // something else. See tests/url-paths.test.mjs.
    const target = resolveWithinRoot(root, relativePath);
    if (target === null) return new Response('Forbidden', { status: 403 });

    // pathToFileURL, not string concatenation: a path containing # or ? would
    // otherwise be parsed as a fragment or query and resolve to the wrong file.
    return net.fetch(pathToFileURL(target).toString());
  });
}

// Never rejects: it is called from menu clicks and app events that have no
// error handling of their own, where an unhandled rejection would leave the
// user staring at a menu item that silently did nothing.
async function sendFileToRenderer(filePath) {
  if (!mainWindow) {
    pendingOpenPath = filePath;
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    mainWindow.webContents.send('open-file', {
      name: path.basename(filePath),
      data: new Uint8Array(data),
    });
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Could not open file',
      message: `Could not open ${path.basename(filePath)}`,
      detail: String(error?.message ?? error),
    });
  }
}

// samples.json entries (unlike a dropped .zip/.dx/.nmrium file) are pointer
// objects, not spectra themselves — the renderer has to fetch and resolve
// them via NMRium's own core.readNMRiumObject, not the drop-zone input.
function handleOpenSample(relPath) {
  if (!mainWindow) return;
  mainWindow.webContents.send('open-sample', {
    url: `${APP_SCHEME}://bundle/${relPath}`,
  });
}

async function handleOpenDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open spectrum',
    properties: ['openFile'],
    filters: [
      {
        name: 'All supported spectra',
        extensions: ['dx', 'jdx', 'jcamp', 'jdf', 'nmrium', 'zip'],
      },
      { name: 'JCAMP-DX', extensions: ['dx', 'jdx', 'jcamp'] },
      { name: 'JEOL Delta', extensions: ['jdf'] },
      { name: 'NMRium archive', extensions: ['nmrium'] },
      { name: 'Zip archive (Bruker / Varian experiment)', extensions: ['zip'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  await sendFileToRenderer(result.filePaths[0]);
}

// A molecule (e.g. exported from Ketcher) goes through the exact same
// drop-zone delivery path as a spectrum file — NMRium's own file loader
// already recognizes .mol/.sdf as a first-class input alongside spectra —
// this just gives it its own discoverable menu entry instead of only being
// reachable via Open…'s "All files" filter.
async function handleImportMoleculeDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import molecule',
    properties: ['openFile'],
    filters: [
      { name: 'Molecule', extensions: ['mol', 'sdf'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  await sendFileToRenderer(result.filePaths[0]);
}

function handleSaveAs() {
  if (!mainWindow) return;
  mainWindow.webContents.send('trigger-save-as', {
    settings: true,
    view: true,
    dataType: 'SELF_CONTAINED',
  });
}

function handleExportSvg() {
  if (!mainWindow) return;
  mainWindow.webContents.send('trigger-export-svg');
}

// NMRium's own ref API has no "clear loaded spectra" call (only
// loadFiles/loadFileCollection, which add), so there's no in-app way back
// to a blank slate short of quitting — a full reload is the only reset
// available. It's destructive and has no undo, hence the confirmation.
async function handleCloseAll() {
  if (!mainWindow) return;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Cancel', 'Close All'],
    defaultId: 0,
    cancelId: 0,
    message: 'Close all loaded spectra?',
    detail: 'This clears everything in the current session. Unsaved changes will be lost.',
  });
  if (result.response !== 1) return;
  mainWindow.webContents.reload();
}

// The renderer computes the export up front (it's the only side that can
// call NMRium's ref API) and hands the bytes back here; we only prompt for
// a destination once we actually have something to write.
// Only our own renderer may drive these. Without the check any frame that
// ended up in this webContents could ask the main process to write a file.
function isTrustedSender(event) {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith(`${APP_SCHEME}://`);
}

// A renderer-supplied filename becomes the save dialog's default path, so it
// must not be able to steer that to another directory — the user still
// confirms, but the prompt should not arrive pre-aimed somewhere unexpected.
function safeDefaultName(fileName, fallback) {
  if (typeof fileName !== 'string' || fileName.length === 0) return fallback;
  const base = path.basename(fileName);
  return base === '' || base === '.' || base === '..' ? fallback : base;
}

function registerExportIpcHandlers() {
  ipcMain.on('nmrium-file-data', async (event, { buffer, fileName }) => {
    if (!isTrustedSender(event)) return;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save NMRium experiment',
      defaultPath: safeDefaultName(fileName, 'experiment.nmrium'),
      filters: [{ name: 'NMRium archive', extensions: ['nmrium'] }],
    });
    if (result.canceled || !result.filePath) return;
    await fs.writeFile(result.filePath, Buffer.from(buffer));
  });

  ipcMain.on('nmrium-svg-data', async (event, { buffer, fileName }) => {
    if (!isTrustedSender(event)) return;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export spectrum as SVG',
      defaultPath: safeDefaultName(fileName, 'spectrum.svg'),
      filters: [{ name: 'SVG image', extensions: ['svg'] }],
    });
    if (result.canceled || !result.filePath) return;
    await fs.writeFile(result.filePath, Buffer.from(buffer));
  });

  ipcMain.on('nmrium-action-error', (event, message) => {
    if (!isTrustedSender(event) || !mainWindow) return;
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Nothing to export',
      // Coerced and capped: this string is rendered in a native dialog, and a
      // renderer should not be able to fill the screen with one.
      message: String(message).slice(0, 500),
    });
  });
}

async function findSamplesRoot() {
  for (const dir of SAMPLES_SEARCH_DIRS) {
    if (await pathExists(path.join(dir, 'data'))) return dir;
  }
  return null;
}

async function buildOpenSampleSubmenu() {
  const samplesRoot = await findSamplesRoot();
  if (!samplesRoot) {
    return [
      {
        label: 'Install sample data to enable…',
        enabled: false,
      },
    ];
  }

  const catalog = JSON.parse(await fs.readFile(SAMPLES_CATALOG_FILE, 'utf8'));
  let extraCatalog = [];
  if (await pathExists(EXTRA_SAMPLES_CATALOG_FILE)) {
    extraCatalog = JSON.parse(
      await fs.readFile(EXTRA_SAMPLES_CATALOG_FILE, 'utf8'),
    );
  }
  return [...catalog, ...extraCatalog]
    .filter((group) => SAMPLE_MENU_GROUPS.includes(group.groupName))
    .map((group) => ({
      label: group.groupName,
      submenu: group.children.map((child) => {
        const relPath = child.file.replace(/^\.\//, '');
        return {
          label: child.title,
          // .json entries are NMRium demo-style pointer objects (see
          // handleOpenSample); everything else (our own .zip samples) is a
          // self-contained spectrum file, same as a native Open dialog pick.
          click: relPath.endsWith('.json')
            ? () => handleOpenSample(relPath)
            : () => void sendFileToRenderer(path.join(samplesRoot, relPath)),
        };
      }),
    }));
}

function configureAboutPanel() {
  const { version } = require('../package.json');
  app.setAboutPanelOptions({
    applicationName: 'NMRium Desktop',
    applicationVersion: version,
    iconPath: ICON_PATH,
    copyright: 'NMRium © Zakodium/cheminfo (MIT). Electron wrapper by David.',
    credits:
      'NMRium is developed by Zakodium/cheminfo, with support from EU ' +
      'Horizon 2020 grant funding. https://www.nmrium.org',
    website: 'https://www.nmrium.org',
  });
}

async function buildMenu() {
  const openSampleSubmenu = await buildOpenSampleSubmenu();
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => void handleOpenDialog(),
        },
        {
          label: 'Open Sample',
          submenu: openSampleSubmenu,
        },
        {
          label: 'Import Molecule…',
          click: () => void handleImportMoleculeDialog(),
        },
        { type: 'separator' },
        {
          label: 'Save As…',
          click: () => handleSaveAs(),
        },
        {
          label: 'Export as SVG…',
          click: () => handleExportSvg(),
        },
        { type: 'separator' },
        {
          label: 'Close All Spectra',
          click: () => void handleCloseAll(),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      // No Undo/Redo here on purpose: NMRium has no working undo/redo of
      // its own (even internally — it's dead scaffolding upstream), so
      // Electron's generic role-based Undo/Redo would just act on the
      // browser's contentEditable text-undo stack and do nothing useful.
      label: 'Edit',
      submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Workspace',
          submenu: WORKSPACES.map((workspace) => ({
            label: workspace.label,
            type: 'radio',
            checked: currentWorkspace === workspace.id,
            click: () => {
              currentWorkspace = workspace.id;
              mainWindow?.webContents.send('set-workspace', workspace.id);
              buildMenu();
            },
          })),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About NMRium Desktop', click: () => app.showAboutPanel() },
        {
          label: 'NMRium Documentation',
          click: () => shell.openExternal('https://docs.nmrium.org'),
        },
        {
          label: 'NMRium Desktop on GitHub',
          click: () =>
            shell.openExternal('https://github.com/katalystnord/nmrium-desktop'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: ICON_IMAGE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload only uses contextBridge, ipcRenderer and standard DOM APIs,
      // all of which work in a sandboxed preload — so there is nothing to buy
      // by turning this off. It matters most on Windows and macOS; on Linux the
      // AppImage launcher forces --no-sandbox process-wide anyway (see
      // scripts/appimage-wrap.cjs), so this is the only layer left there.
      sandbox: true,
    },
  });

  // This app renders untrusted files. Nothing should ever navigate the window
  // away from app://, because the preload — and with it window.electronAPI —
  // would follow it to whatever origin it landed on.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).protocol !== `${APP_SCHEME}:`) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  // Likewise for window.open and target=_blank: never open a second
  // BrowserWindow, hand genuine http(s) links to the user's real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  mainWindow.loadURL(`${APP_SCHEME}://bundle/index.html`);

  mainWindow.webContents.on('did-finish-load', () => {
    // A reload (whether from View > Reload or Close All) restarts the
    // renderer's React state from scratch, so the workspace picked via the
    // View menu — main-process state, not persisted anywhere on the
    // renderer side — needs to be handed back or it silently reverts to
    // "Simple NMR analysis".
    mainWindow.webContents.send('set-workspace', currentWorkspace);
    if (pendingOpenPath) {
      const filePath = pendingOpenPath;
      pendingOpenPath = null;
      void sendFileToRenderer(filePath);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = pathFromArgv(argv);
    if (filePath) void sendFileToRenderer(filePath);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // macOS: file-association double-click.
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    void sendFileToRenderer(filePath);
  });

  app.whenReady().then(async () => {
    registerAppProtocol();
    registerExportIpcHandlers();
    configureAboutPanel();
    createWindow();
    await buildMenu();

    const argvFile = pathFromArgv(process.argv);
    if (argvFile) pendingOpenPath = argvFile;

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
