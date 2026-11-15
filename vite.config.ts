import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  publicDir: '../../public',
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: { port: 5173, host: true, proxy: { '/socket.io': { target: 'http://localhost:3000', ws: true }, '/healthz': 'http://localhost:3000' } },
  test: { root: '.', include: ['tests/**/*.test.ts'], testTimeout: 30000 },
} as any);
