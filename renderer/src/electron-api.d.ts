import type { SaveIncludeOptions } from '../../nmrium/src/component/hooks/useExport';

export interface ElectronAPI {
  onTriggerSaveAs: (callback: (options: SaveIncludeOptions) => void) => void;
  onTriggerExportSvg: (callback: () => void) => void;
  onSetWorkspace: (callback: (workspace: string) => void) => void;
  onOpenSample: (callback: (payload: { url: string }) => void) => void;
  sendNmriumFileData: (buffer: ArrayBuffer, fileName: string) => void;
  sendNmriumSvgData: (buffer: ArrayBuffer, fileName: string) => void;
  sendActionError: (message: string) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
