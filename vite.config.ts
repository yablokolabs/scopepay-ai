/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The client lives in app/, the server and domain code in server/ and lib/.
 * Tests always run from the repository root over tests/**.
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
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
});
