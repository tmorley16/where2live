/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The built site may only talk to the services it uses. The user's routing key lives in this browser,
 * so allowing no other hosts (and no third-party scripts) is its main protection. Build only: the dev
 * server needs inline scripts and a websocket.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tiles.openfreemap.org",
  // data: is the image layer's placeholder, fetched by MapLibre; it never leaves the browser.
  "connect-src 'self' data: https://api.heigit.org https://photon.komoot.io https://tiles.openfreemap.org",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'w2l-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

export default defineConfig({
  // GitHub Pages serves the site from /where2live/; the deploy workflow sets BASE_PATH. Local builds stay at the root.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), csp()],
  worker: { format: 'es' },
  // MapLibre is about 1 MB on its own; it's lazy-loaded, so the warning is noise.
  build: { chunkSizeWarningLimit: 1200 },
  // Saved scenarios and the travel-time cache belong to the page's origin (scheme + host + port),
  // so a port that silently changed would make everything look lost. Keep them fixed.
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
