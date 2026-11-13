import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const require = createRequire(import.meta.url);

// Public origin of the app (APP_ORIGIN in the root .env). Used for absolute URLs
// in Open Graph tags, canonical link and sitemap. Must not end with a slash.
function appOrigin(): string {
  const raw = process.env.VITE_APP_ORIGIN ?? 'https://localhost';
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error(`VITE_APP_ORIGIN must use https: ${raw}`);
  }
  return url.origin;
}

// Replaces %APP_ORIGIN% in index.html and emits robots.txt and sitemap.xml at build time.
// Only the landing is meant to be indexed; Caddy adds X-Robots-Tag: noindex elsewhere.
function seo(origin: string): Plugin {
  return {
    name: 'estudio-seo',
    transformIndexHtml: (html) => html.replaceAll('%APP_ORIGIN%', origin),
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *
Disallow: /api/
Disallow: /s3/
Allow: /

Sitemap: ${origin}/sitemap.xml
`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/</loc></url>
</urlset>
`,
      });
    },
  };
}

// In `vite --mode mock` serves MSW's service worker straight from node_modules,
// so the file never lands in public/ (and never ships in a production build).
function mswWorker(): Plugin {
  const file = require.resolve('msw/mockServiceWorker.js');
  return {
    name: 'estudio-msw-worker',
    configureServer(server) {
      server.middlewares.use('/mockServiceWorker.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(file));
      });
    },
  };
}

// Dev proxy to the Caddy of the local stack. The API checks Origin == APP_ORIGIN,
// so the proxy rewrites it to the target.
const STACK = process.env.ESTUDIO_DEV_TARGET ?? 'https://localhost';
const proxy = {
  target: STACK,
  changeOrigin: true,
  secure: false,
  configure: (p: {
    on: (event: 'proxyReq', cb: (req: { setHeader: (k: string, v: string) => void }) => void) => void;
  }) => {
    p.on('proxyReq', (req) => req.setHeader('origin', STACK));
  },
};

export default defineConfig(({ mode }) => {
  const origin = appOrigin();
  return {
    plugins: [
      react(),
      seo(origin),
      mode === 'mock' ? mswWorker() : null,
      VitePWA({
        strategies: 'generateSW',
        registerType: 'prompt',
        injectRegister: null,
        filename: 'sw.js',
        manifestFilename: 'manifest.webmanifest',
        manifest: {
          name: 'NethStore Estúdio',
          short_name: 'Estúdio',
          description: 'Carimba preço e tamanho em grupos de fotos da NethStore.',
          lang: 'pt-AO',
          start_url: '/estudio',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#0E0D0C',
          theme_color: '#0E0D0C',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Only the app shell: scripts, styles, html, fonts and icons. No photos, no API.
          globPatterns: ['**/*.{js,css,html,woff2}', 'icons/*.png', 'favicon.svg'],
          globIgnores: ['**/og-image.jpg'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/s3\//],
          runtimeCaching: [],
          cleanupOutdatedCaches: true,
        },
        devOptions: { enabled: false },
      }),
    ],
    build: {
      target: 'es2022',
      // Never inline assets as data: URIs (fonts would break font-src 'self').
      assetsInlineLimit: 0,
      sourcemap: false,
    },
    worker: { format: 'es' },
    server: {
      proxy: mode === 'mock' ? undefined : { '/api': proxy, '/s3': proxy },
    },
  };
});
