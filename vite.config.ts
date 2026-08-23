import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  /*
   * WHICH COMMIT THIS BUNDLE IS (OPS-03).
   *
   * `feedback.ts` used to label every build `0.1.0` — a package version unchanged since
   * January, carried by eighteen production deploys — under a comment saying the id exists so
   * a report is attached to a version rather than to "last Tuesday".
   *
   * `GITHUB_SHA` is set by every GitHub Actions run, so a deployed bundle names the commit it
   * was built from. A local build says `local` rather than inventing something version-shaped:
   * see `src/lib/build-id.ts` for why an obviously partial answer beats a plausible wrong one.
   */
  const buildId = process.env.GITHUB_SHA?.slice(0, 7) || 'local';

  return {
    base: "/",
    define: {
      __BUILD_ID__: JSON.stringify(buildId),
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      VitePWA({
        /*
         * `prompt`, not `autoUpdate`, and `injectRegister: null` because the app registers the
         * worker itself in src/lib/pwa-update.ts.
         *
         * autoUpdate ships skipWaiting + clientsClaim, so a freshly deployed worker takes
         * control of an already-open page. Every feature here is behind React.lazy and chunk
         * names change per build, so a tab open since before the deploy then asks for a chunk
         * the new precache does not have -- "Failed to fetch dynamically imported module", on
         * the next nav click, at whatever moment happens to be inconvenient. For a team at a
         * competition that is a bad trade. The new worker now waits and the user chooses.
         */
        registerType: 'prompt',
        injectRegister: null,
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
          /*
           * The two halves of `autoUpdate`, separated -- which is the point of using `prompt`.
           *
           * clientsClaim: an ACTIVATED worker takes control of already-open pages. On a first
           * visit there is no previous worker, so this is pure benefit -- the coach who opens
           * FalconForge for the first time and then loses the venue wifi is covered during
           * that same session. Without it, `prompt` leaves the FIRST session entirely
           * uncontrolled, which the offline smoke test caught the moment autoUpdate was
           * dropped.
           *
           * skipWaiting false: a worker replacing an EXISTING one waits for the user instead.
           * That is the hazard being avoided -- chunk names change per build, so a worker that
           * seizes an open tab makes the next nav click fail to fetch its lazy chunk.
           */
          clientsClaim: true,
          skipWaiting: false,
          // Workbox emits its own sourcemaps (sw.js.map, workbox-*.js.map) independently
          // of Vite's `build.sourcemap`. Both are currently published on falcon-forge.com.
          sourcemap: false,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          // No `runtimeCaching` entries. The two that used to be here cached
          // fonts.googleapis.com and fonts.gstatic.com CacheFirst — a runtime cache is only
          // ever a mitigation for a cross-origin dependency, and it does nothing on the
          // first load, which is precisely the load that happens at a venue. Inter is
          // bundled now (src/styles/fonts.css) and precached by the `woff2` glob above,
          // so there is no third-party origin left to cache.
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
