import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'apps/client',
  resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: { '/ws': { target: 'ws://127.0.0.1:3001', ws: true } },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        game: resolve('apps/client/index.html'),
        singleplayer: resolve('apps/client/singleplayer/index.html'),
      },
    },
  },
});
