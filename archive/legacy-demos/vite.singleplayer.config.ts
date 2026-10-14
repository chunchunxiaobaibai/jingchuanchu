import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'apps/client/singleplayer',
  resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
  server: { host: '0.0.0.0', port: 5174, strictPort: true, fs: { allow: [resolve('.')] } },
  build: { outDir: '../../../dist/singleplayer', emptyOutDir: true },
});
