import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { NMRium } from '../../nmrium/src/component/main';
import type { NMRiumRefAPI } from '../../nmrium/src/component/main/NMRiumRefAPI';
// Reused as-is from NMRium's own demo app: samples.json's entries are
// "pointer" objects (sourceSelector.files referencing sibling data by
// relative path, resolved via fetch against `baseURL`), not self-contained
// files — this is the same core.readNMRiumObject() call the demo's own
// sample views (Teaching.tsx, Exam.tsx, etc.) use to resolve them, since
// feeding the pointer JSON's raw bytes into the drop-zone input (like every
// other Open action here) can't follow those references.
import { demoCore } from '../../nmrium/src/demo/utility/core.ts';

import 'modern-normalize/modern-normalize.css';
import 'react-science/styles/preflight.css';
import '@blueprintjs/core/lib/css/blueprint.css';
import './blueprint-icons-woff2.css';
import '@blueprintjs/select/lib/css/blueprint-select.css';

function App() {
  const nmriumRef = useRef<NMRiumRefAPI>(null);
  const [workspace, setWorkspace] = useState<string | undefined>(undefined);
  const [sampleData, setSampleData] =
    useState<Awaited<ReturnType<typeof demoCore.readNMRiumObject>>>();

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

    window.electronAPI.onOpenSample(async ({ url }) => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} — ${response.statusText}`);
        }
        const nmriumObject = await response.json();
        // Matches the demo's own convention (View.helpers.ts): relative
        // refs inside the sample object are resolved against the *page's*
        // URL, not the sample file's own — samples.json's "./data/..."
        // paths are already root-relative, same as our app:// protocol
        // routes them.
        const result = await demoCore.readNMRiumObject(nmriumObject, undefined, {
          baseURL: window.location.href,
        });
        setSampleData(result);
      } catch (error) {
        window.electronAPI.sendActionError(
          `Couldn't load sample: ${(error as Error).message}`,
        );
      }
    });
  }, []);

  return (
    <NMRium
      ref={nmriumRef}
      workspace={workspace}
      state={sampleData?.state}
      aggregator={sampleData?.aggregator}
    />
  );
}

const rootElement = document.querySelector('#root');
if (!rootElement) {
  throw new Error('#root element not found');
}

createRoot(rootElement).render(<App />);
