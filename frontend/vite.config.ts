/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
// Dev-server proxy: forward every /api/* and /health request to the FastAPI
// backend. This way the frontend can call relative paths and we don't rely on
// VITE_API_URL being set, don't fight CORS, and the whole flow works out of
// the box with `uvicorn ... --port 8000` on the side.
export default defineConfig(({ mode }) => {
  // loadEnv reads .env files from the project root (cwd) without needing
  // Node's `process` typings in this config file.
  const env = loadEnv(mode, '.', '');
  const BACKEND = env.VITE_BACKEND_URL ?? 'http://localhost:8000';

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': { target: BACKEND, changeOrigin: true },
        '/health': { target: BACKEND, changeOrigin: true },
      },
    },
    // CSS Modules work out of the box in Vite (any *.module.css file is scoped).
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.ts'],
      css: true,
    },
  };
});
