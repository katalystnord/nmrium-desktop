const path = require('node:path');
const fs = require('node:fs/promises');
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

function resolveRequestedPath(pathname) {
  let relativePath = decodeURIComponent(pathname);
  if (relativePath === '' || relativePath === '/') {
    relativePath = '/index.html';
  }
  return relativePath;
}

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
    // samples.json's sample objects reference sibling data with paths like
    // "data/cytisine/1H_Cytisin_600MHz-R+I.dx", resolved client-side
    // relative to the page URL (see renderer's onOpenSample) — matching
    // that convention here means /data/... and /exercises/... requests
    // need to come from the installed samples directory, not RENDERER_DIST.
    if (relativePath.startsWith('/data/') || relativePath.startsWith('/exercises/')) {
      const samplesRoot = await findSamplesRoot();
      if (samplesRoot) {
        return net.fetch(`file://${path.join(samplesRoot, relativePath)}`);
      }
    }
    return net.fetch(`file://${path.join(RENDERER_DIST, relativePath)}`);
  });
}

async function sendFileToRenderer(filePath) {
  if (!mainWindow) {
    pendingOpenPath = filePath;
    return;
  }
  const data = await fs.readFile(filePath);
  mainWindow.webContents.send('open-file', {
    name: path.basename(filePath),
    data: new Uint8Array(data),
  });
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
function registerExportIpcHandlers() {
  ipcMain.on('nmrium-file-data', async (_event, { buffer, fileName }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save NMRium experiment',
      defaultPath: fileName,
      filters: [{ name: 'NMRium archive', extensions: ['nmrium'] }],
    });
    if (result.canceled || !result.filePath) return;
    await fs.writeFile(result.filePath, Buffer.from(buffer));
  });

  ipcMain.on('nmrium-svg-data', async (_event, { buffer, fileName }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export spectrum as SVG',
      defaultPath: fileName,
      filters: [{ name: 'SVG image', extensions: ['svg'] }],
    });
    if (result.canceled || !result.filePath) return;
    await fs.writeFile(result.filePath, Buffer.from(buffer));
  });

  ipcMain.on('nmrium-action-error', (_event, message) => {
    if (!mainWindow) return;
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Nothing to export',
      message,
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
            : () => sendFileToRenderer(path.join(samplesRoot, relPath)),
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
          click: () => handleOpenDialog(),
        },
        {
          label: 'Open Sample',
          submenu: openSampleSubmenu,
        },
        {
          label: 'Import Molecule…',
          click: () => handleImportMoleculeDialog(),
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
          click: () => handleCloseAll(),
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
      sandbox: false,
    },
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
      sendFileToRenderer(filePath);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Windows/Linux: file-association double-click passes the path as an argv entry.
function pathFromArgv(argv) {
  return argv.find(
    (arg) => arg.endsWith('.dx') || arg.endsWith('.jdx') || arg.endsWith('.nmrium'),
  );
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = pathFromArgv(argv);
    if (filePath) sendFileToRenderer(filePath);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // macOS: file-association double-click.
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    sendFileToRenderer(filePath);
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
