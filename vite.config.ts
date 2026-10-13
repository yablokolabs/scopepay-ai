import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The client lives in app/ and talks to the Hono server on 8787.
 * Test configuration is separate: see vitest.config.ts.
 */
export default defineConfig({
  plugins: [react()],
  root: 'app',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/health': { target: 'http://localhost:8787', changeOrigin: true }
    }
  }
});
