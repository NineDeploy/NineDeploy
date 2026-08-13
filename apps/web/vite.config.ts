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
});
