import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const daemon = process.env.ORCH_URL ?? 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    proxy: {
      '/api': daemon,
      '/ws': { target: daemon.replace(/^http/, 'ws'), ws: true },
    },
  },
});
