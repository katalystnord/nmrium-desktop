import { createRoot } from 'react-dom/client';

import { NMRium } from '../../nmrium/src/component/main';

import 'modern-normalize/modern-normalize.css';
import 'react-science/styles/preflight.css';
import '@blueprintjs/core/lib/css/blueprint.css';
import './blueprint-icons-woff2.css';
import '@blueprintjs/select/lib/css/blueprint-select.css';

const rootElement = document.querySelector('#root');
if (!rootElement) {
  throw new Error('#root element not found');
}

createRoot(rootElement).render(<NMRium />);
