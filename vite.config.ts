import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    base: "/",
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'robots.txt', 'DecodeField.png'],
        manifest: {
          name: 'FalconForge',
          short_name: 'FalconForge',
          description: 'Manage your FTC robotics team - sprint planning, scouting, match planning, and more',
          theme_color: '#ea580c',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'any',
          scope: '/',
          start_url: '/',
          icons: [
            {
              src: 'icon-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Workbox emits its own sourcemaps (sw.js.map, workbox-*.js.map) independently
          // of Vite's `build.sourcemap`. Both are currently published on falcon-forge.com.
          sourcemap: false,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      }
    },
    build: {
      // `false`, not `'hidden'`. Hidden still WRITES the .map files -- it only stops the
      // bundle referencing them -- so they would still be published and downloadable by
      // anyone who guesses the filename. The whole source of the app is currently
      // readable from falcon-forge.com this way.
      //
      // When error reporting is added later (Sentry, plan item H1), switch this to
      // 'hidden' and upload the maps to Sentry from CI, then delete them from dist/
      // before publishing. Until then, not generating them is the simple correct answer.
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            charts: ['d3'],
          },
        },
      },
    },
  };
});
