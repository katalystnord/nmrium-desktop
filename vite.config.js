import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// NMRium's own node_modules (populated by `npm run build:nmrium`) also
// carries its own copies of react/react-dom/blueprint, since those are its
// devDependencies for building its own demo app. Without `dedupe`, our
// renderer entry and NMRium's internals would each resolve to a different
// copy of React, breaking hooks/context across the tree.
export default defineConfig({
  root: path.join(__dirname, 'renderer'),
  base: './',
  build: {
    outDir: path.join(__dirname, 'renderer', 'dist'),
    emptyOutDir: true,
  },
  plugins: [react()],
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'react-science',
      '@blueprintjs/core',
      '@blueprintjs/icons',
      '@blueprintjs/select',
    ],
  },
});
