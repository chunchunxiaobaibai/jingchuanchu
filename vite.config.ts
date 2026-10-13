import { defineConfig } from 'vite';

export default defineConfig({
  root: 'apps/client',
  server: { host: '0.0.0.0', port: 5173, strictPort: true, proxy: { '/ws': { target: 'ws://127.0.0.1:3001', ws: true } } },
  build: { outDir: '../../dist/client', emptyOutDir: true },
});
