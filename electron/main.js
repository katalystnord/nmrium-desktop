const path = require('node:path');
const fs = require('node:fs/promises');
const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  protocol,
  net,
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
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    {
      label: 'View',
      submenu: [
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
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
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
