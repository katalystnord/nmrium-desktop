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

async function handleOpenDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open spectrum',
    properties: ['openFile'],
    filters: [
      { name: 'JCAMP-DX', extensions: ['dx', 'jdx'] },
      { name: 'NMRium archive', extensions: ['nmrium'] },
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
  return catalog
    .filter((group) => SAMPLE_MENU_GROUPS.includes(group.groupName))
    .map((group) => ({
      label: group.groupName,
      submenu: group.children.map((child) => ({
        label: child.title,
        click: () => sendFileToRenderer(path.join(samplesRoot, child.file.replace(/^\.\//, ''))),
      })),
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
