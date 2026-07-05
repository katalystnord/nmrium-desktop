import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { NMRium } from '../../nmrium/src/component/main';
import type { NMRiumRefAPI } from '../../nmrium/src/component/main/NMRiumRefAPI';

import 'modern-normalize/modern-normalize.css';
import 'react-science/styles/preflight.css';
import '@blueprintjs/core/lib/css/blueprint.css';
import './blueprint-icons-woff2.css';
import '@blueprintjs/select/lib/css/blueprint-select.css';

function App() {
  const nmriumRef = useRef<NMRiumRefAPI>(null);
  const [workspace, setWorkspace] = useState<string | undefined>(undefined);

  useEffect(() => {
    window.electronAPI.onSetWorkspace(setWorkspace);

    window.electronAPI.onTriggerSaveAs(async (options) => {
      const api = nmriumRef.current;
      if (!api) return;
      const blob = await api.getNMRiumFile(options);
      const buffer = await blob.arrayBuffer();
      window.electronAPI.sendNmriumFileData(buffer, 'experiment.nmrium');
    });

    window.electronAPI.onTriggerExportSvg(async () => {
      const api = nmriumRef.current;
      if (!api) return;
      const result = api.getSpectraViewerAsBlob();
      if (!result) {
        window.electronAPI.sendActionError(
          'Nothing to export yet — load a spectrum first.',
        );
        return;
      }
      const buffer = await result.blob.arrayBuffer();
      window.electronAPI.sendNmriumSvgData(buffer, 'spectrum.svg');
    });
  }, []);

  return <NMRium ref={nmriumRef} workspace={workspace} />;
}

const rootElement = document.querySelector('#root');
if (!rootElement) {
  throw new Error('#root element not found');
}

createRoot(rootElement).render(<App />);
