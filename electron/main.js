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

// Packaged: electron-builder's extraResources copies nmrium/build -> nmrium-dist
// Dev: use the submodule's own build output directly.
const NMRIUM_DIST = app.isPackaged
  ? path.join(process.resourcesPath, 'nmrium-dist')
  : path.join(__dirname, '..', 'nmrium', 'build');

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

function resolveRequestedFile(pathname) {
  let relativePath = decodeURIComponent(pathname);
  if (relativePath === '' || relativePath === '/') {
    relativePath = '/index.html';
  }
  return path.join(NMRIUM_DIST, relativePath);
}

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    const filePath = resolveRequestedFile(url.pathname);
    return net.fetch(`file://${filePath}`);
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

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => handleOpenDialog(),
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

  app.whenReady().then(() => {
    registerAppProtocol();
    buildMenu();
    createWindow();

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
