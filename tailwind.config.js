/** @type {import('tailwindcss').Config} */
export default {
  // Ported verbatim from the inline `tailwind.config` <script> that used to sit next to the
  // cdn.tailwindcss.com Play script in index.html. Keeping it byte-for-byte equivalent is
  // deliberate: the whole app's markup was authored against these exact values, and Sprint 1
  // is a stabilization sprint, not a redesign. Design tokens land in Sprint 5.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // `extend` merges into the default slate ramp, so 50-900 are untouched and these three
        // are added/overridden — same as the CDN config did. Note 950 intentionally resolves to
        // Tailwind's slate-900 value rather than the v3 default #020617; that is what the app
        // has always rendered.
        slate: {
          750: '#2d3748',
          850: '#1a202c',
          950: '#0f172a',
        },
      },
    },
  },
  plugins: [],
};
