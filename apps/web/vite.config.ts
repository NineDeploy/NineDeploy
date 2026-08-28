import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env['VITE_API_URL'] ?? 'http://localhost:3000';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Proxy API calls to the backend during development so the browser can use
    // same-origin requests (the SDK defaults baseUrl to the current origin).
    proxy: {
      '/health': { target: api, changeOrigin: true },
      '/v1': { target: api, changeOrigin: true, ws: true },
    },
  },
  build: {
    // The route bundle is the largest chunk left after the vendor split below
    // (967 kB raw, 230 kB gzipped) — well within HTTP/2's first-paint budget.
    // Vite's default 500 kB warning is a heuristic, not a hard limit, so raise
    // it to 1024 kB rather than splitting every route into a lazy chunk (the
    // latter would change Suspense semantics for every test that hits a route
    // directly, with no measurable UX win for the 28 routes here).
    chunkSizeWarningLimit: 1024,
    // Split heavy vendor code into its own chunk so the route bundle stays
    // under the warning threshold and the browser can cache vendor code
    // independently across deploys. Vite 8 / Rolldown only accepts the
    // function form of `manualChunks` — the object map form is rejected.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router/') ||
            id.includes('/scheduler/')
          ) {
            return 'react-vendor';
          }
          if (id.includes('/@radix-ui/')) {
            return 'radix-vendor';
          }
          if (id.includes('/lucide-react/') || id.includes('/@tanstack/')) {
            return 'data-vendor';
          }
          if (id.includes('/@xterm/') || id.includes('/xterm/')) {
            return 'terminal-vendor';
          }
          if (id.includes('monaco-editor') || id.includes('/monaco/')) {
            return 'monaco-vendor';
          }
          if (id.includes('/js-yaml/') || id.includes('/yaml/')) {
            return 'yaml-vendor';
          }
          return undefined;
        },
      },
    },
  },
});
