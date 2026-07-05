const { contextBridge, ipcRenderer } = require('electron');

// NMRium's own DropZone (react-dropzone) already renders a hidden
// `<input type="file">` wired to its normal file-loading pipeline. Rather
// than modifying NMRium's source, we feed native "File -> Open" selections
// into that same input, exactly as a manual drag-drop or browse click would.
// The clipboard-paste fallback UI also renders an `<input type="file">`, but
// gives it name="file" and only mounts on demand, so excluding it is enough
// to disambiguate the two in the common case.
function findDropzoneInput() {
  const inputs = document.querySelectorAll('input[type="file"]');
  for (const input of inputs) {
    if (input.name !== 'file') return input;
  }
  return null;
}

function waitForDropzoneInput(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const existing = findDropzoneInput();
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const input = findDropzoneInput();
      if (input) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(input);
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error('Timed out waiting for NMRium file input to mount'));
    }, timeoutMs);
  });
}

async function deliverFile(name, bytes) {
  const input = await waitForDropzoneInput();
  const file = new File([bytes], name);
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

ipcRenderer.on('open-file', (_event, { name, data }) => {
  deliverFile(name, data).catch((error) => {
    console.error('Failed to deliver opened file to NMRium:', error);
  });
});

// Native menu actions (Save/Export/Workspace) need real access to the
// mounted <NMRium> component's ref API — unlike file-open, there's no DOM
// element to drive from outside, so this goes through a proper
// contextBridge API instead of a simulated DOM event.
contextBridge.exposeInMainWorld('electronAPI', {
  onTriggerSaveAs: (callback) =>
    ipcRenderer.on('trigger-save-as', (_event, options) => callback(options)),
  onTriggerExportSvg: (callback) =>
    ipcRenderer.on('trigger-export-svg', () => callback()),
  onSetWorkspace: (callback) =>
    ipcRenderer.on('set-workspace', (_event, workspace) => callback(workspace)),
  sendNmriumFileData: (buffer, fileName) =>
    ipcRenderer.send('nmrium-file-data', { buffer, fileName }),
  sendNmriumSvgData: (buffer, fileName) =>
    ipcRenderer.send('nmrium-svg-data', { buffer, fileName }),
  sendActionError: (message) => ipcRenderer.send('nmrium-action-error', message),
});
