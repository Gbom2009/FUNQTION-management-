import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// Relative base so the same build runs on GitHub Pages (sub-path),
// inside the Tauri desktop/iOS shell, and from any self-hosted server.
export default defineConfig({
  base: './',
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173, strictPort: true },
  // Maps: MapLibre 6 resolves its worker relative to its own module; pre-bundling breaks that.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  worker: { format: 'es' },
  plugins: [
    react(),
    // Tailwind v4, used only by the Maps app (src/apps/maps/maps.css, scoped to .fq-maps).
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Funqtion',
        short_name: 'Funqtion',
        description: 'Team Funqtion business suite - FEEL THE MUSIQ',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#040404',
        theme_color: '#040404',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        // OCR engine + language data (~14 MB) are cached on first use, not at install.
        // Maps: the voice runtime (onnx wasm, ~10 MB+), glyph fonts and data files are cached on use.
        globIgnores: ['ocr/**', 'maps/**', '**/ort-wasm*'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          { urlPattern: /\/ocr\//, handler: 'CacheFirst', options: { cacheName: 'funqtion-ocr', expiration: { maxEntries: 10 } } },
          { urlPattern: /\/maps\/(fonts|data)\//, handler: 'CacheFirst', options: { cacheName: 'funqtion-maps-static', expiration: { maxEntries: 400 } } },
          { urlPattern: /ort-wasm.*\.wasm$/, handler: 'CacheFirst', options: { cacheName: 'funqtion-maps-voice', expiration: { maxEntries: 4 } } },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
  },
});
