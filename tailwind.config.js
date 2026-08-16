/** @type {import('tailwindcss').Config} */

/*
 * FalconForge design tokens (Sprint 5).
 *
 * Sprint 1 ported the CDN's inline config here byte-for-byte and left a note saying design
 * tokens land in Sprint 5. This is that. What changed and why:
 *
 * THE TYPE SCALE IS RETUNED, NOT EXTENDED. `text-sm` is 13px and `text-base` is 14px, where
 * Tailwind's defaults are 14 and 16. Retuning the existing names rather than adding a
 * parallel set of dense-* names is what makes the density pass reach every view: the app has
 * ~1500 existing type utilities and a scale nobody has to opt into is a scale that applies
 * everywhere on the first render. The named steps stay in the same order and the same
 * relative proportions, so nothing needs reflowing — text just stops being sized for a
 * marketing page in a tool that shows a sprint board on a phone at a competition.
 *
 * `text-2xs` (11px) is the new step BELOW `text-xs`. It exists because there wasn't one:
 * 15 arbitrary `text-[10px]`/`text-[11px]` values had accumulated in its place, each one
 * chosen independently, and they were drifting. Rule 8 forbids more of them; this is the
 * token that makes obeying it possible.
 *
 * BEWARE OF SHRINKING FORM CONTROLS. iOS Safari zooms the viewport when a focused input has
 * a computed font-size below 16px, and that zoom does not undo itself. A 14px `text-base`
 * would therefore have made every text field on an iPhone yank the layout sideways — at a
 * competition, with the keyboard open, which is the exact scenario this app is for. The
 * coarse-pointer block in index.css floors form controls at 16px, and that pairing is
 * load-bearing: do not remove one without the other.
 *
 * Tailwind stays on v3 (Kevin's call, 2026-08-15). v4 renames or drops utilities this markup
 * is authored against and changes the default border colour and ring width, which is a
 * framework migration rather than a token pass. It is back in the plan's parking lot,
 * retargeted post-beta.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        /*
         * Inter, finally.
         *
         * `index.css` has set Inter on `body` since V1, and `App.tsx`'s `font-sans` has
         * re-applied Tailwind's default system stack over it ever since — so `font-sans`
         * has never once resolved to Inter, and the Google Fonts <link> in index.html was
         * downloading a webfont on every cold load that nothing rendered in. Both halves
         * are fixed: the font is self-hosted (see src/styles/fonts.css) and the token below
         * is what `font-sans` now resolves to.
         *
         * Self-hosted rather than CDN for the same reason Sprint 1 deleted the Tailwind CDN
         * script: a cross-origin request is not precached, so the PWA rendered in a fallback
         * font on a cold offline start. Venue WiFi is the whole premise.
         */
        sans: [
          'Inter Variable',
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },

      fontSize: {
        // [size, line-height]. Line heights are explicit at every step: the default
        // `leading-normal` (1.5) is loose enough at 11-13px to undo the density it buys.
        '2xs': ['0.6875rem', { lineHeight: '0.875rem' }], // 11px — replaces text-[10px]/[11px]
        xs: ['0.75rem', { lineHeight: '1rem' }],          // 12px
        sm: ['0.8125rem', { lineHeight: '1.125rem' }],    // 13px — was 14
        base: ['0.875rem', { lineHeight: '1.25rem' }],    // 14px — was 16 (the dense base)
        lg: ['1rem', { lineHeight: '1.5rem' }],           // 16px — was 18
        xl: ['1.125rem', { lineHeight: '1.625rem' }],     // 18px — was 20
        '2xl': ['1.375rem', { lineHeight: '1.75rem' }],   // 22px — was 24
        '3xl': ['1.75rem', { lineHeight: '2.125rem' }],   // 28px — was 30
        '4xl': ['2.125rem', { lineHeight: '2.5rem' }],    // 34px — was 36
        '5xl': ['2.75rem', { lineHeight: '1.1' }],        // 44px — was 48
        '6xl': ['3.5rem', { lineHeight: '1.05' }],        // 56px — was 60
        '7xl': ['4.25rem', { lineHeight: '1' }],          // 68px — was 72
      },

      colors: {
        /*
         * `extend` merges into the default slate ramp, so 50-900 are untouched and these
         * three are added/overridden — same as the CDN config did. Note 950 intentionally
         * resolves to Tailwind's slate-900 value rather than the v3 default #020617; that
         * is what the app has always rendered.
         */
        slate: {
          750: '#2d3748',
          850: '#1a202c',
          950: '#0f172a',
        },
        /*
         * The forge palette, named. These are the exact `orange-*` values the brand is
         * already built from — this is an alias that gives the identity a name, not a
         * recolour. New work should reach for `forge-*`; existing `orange-*` usages render
         * identically and were left alone deliberately, because a global rename would have
         * made this sprint's diff unreviewable for zero visual change.
         */
        forge: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c', // the brand orange — theme-color, focus ring, active nav
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
          950: '#431407',
        },
      },

      /*
       * Container widths, named by what they hold rather than by how wide they are.
       *
       * Ten `max-w-[600px]`-class values had accumulated across Landing, the modals and the
       * sprint list, all meaning some version of "a readable column" or "a dialog", none of
       * them agreeing. Naming them is what makes "consistent container widths" checkable.
       */
      letterSpacing: {
        /*
         * Two steps wider than Tailwind's `tracking-widest` (0.1em), which is not wide enough
         * for either job below. Named for the job rather than the number, so a third caller
         * has something to pick rather than inventing a third value.
         */
        code: '0.15em',   // the four-digit check-in code, spaced to be read aloud
        poster: '0.2em',  // an all-caps label above a heading (SCAN TO CHECK IN)
      },

      gridAutoRows: {
        /** A month-grid cell: tall enough for two events, growing for more. */
        'calendar-month': 'minmax(5.5rem, auto)',
        /** A week-grid cell, which has one seventh of the events and room to show them. */
        'calendar-week': 'minmax(11rem, auto)',
      },

      gridTemplateColumns: {
        /** The event manager's row: when | event | attendance | id | actions. */
        schedule: '9rem 1fr 11rem 6rem 5rem',
        /** Event detail: the live feed, and the QR panel beside it. */
        'event-detail': '1fr 20rem',
      },

      maxWidth: {
        /** US Letter minus half an inch each side — what the printable poster is laid out to. */
        letter: '7.5in',
        prose: '38rem',   // 608px — a readable paragraph column
        panel: '31.25rem', // 500px — a form or a settings panel
        dialog: '36rem',   // 576px — a modal
        wide: '50rem',     // 800px — a hero or a full-width section
        app: '90rem',      // 1440px — the outermost content stop on a large desktop
      },

      minHeight: {
        // The WCAG 2.5.5 / iOS HIG touch target. Applied per component via `touch-target`
        // rather than by the blanket attribute-substring selector index.css used to carry.
        touch: '2.75rem', // 44px
        /** A drawing/field surface that must stay usable before the layout goes two-column. */
        canvas: '25rem', // 400px — was min-h-[500px]; 500 pushed the notes panel off a phone
      },
      minWidth: {
        touch: '2.75rem',
        /** A wide data table's floor, below which it scrolls horizontally instead of crushing. */
        table: '36rem',
      },
      maxHeight: {
        /** A modal's body. Leaves room for the browser chrome and a phone's URL bar. */
        modal: '85vh',
        /** A scrollable list inside a panel, before it takes over the page. */
        panel: '30rem',
      },
      /*
       * Landing's decorative geometry. In `spacing` rather than in `width`/`height` so the
       * `w-` and `h-` of each pair are guaranteed to stay the same number — the blurred
       * glow behind the hero is a CIRCLE, and it stopped being one the moment somebody
       * changed one of `w-[800px] h-[800px]` and not the other.
       */
      spacing: {
        4.5: '1.125rem',
        13: '3.25rem',
        header: '3.5rem',
        /** Overhangs the viewport on both sides so a rotated band still reaches the corners. */
        band: '150vw',
        /** The blurred glow behind a section heading. */
        orb: '37.5rem',
        /** The larger glow behind the hero. */
        'orb-lg': '50rem',
      },

      zIndex: {
        /**
         * Above a modal.
         *
         * `ConfirmDialog` is opened FROM modals — "delete this match plan?" is raised by the
         * plan list, which is itself a `z-50` overlay — so it needs to sit above the thing
         * that opened it or the confirmation renders behind its own trigger.
         */
        dialog: '60',
      },
      dropShadow: {
        /** The orange glow on Landing's headline art and its live-status dots. */
        forge: '0 0 15px rgb(249 115 22 / 0.4)',
        'forge-dot': '0 0 8px rgb(249 115 22 / 0.8)',
        'gold-dot': '0 0 8px rgb(234 179 8 / 0.8)',
      },

      borderRadius: {
        // Tightened one notch across the board. The app leans on `rounded-xl` for cards and
        // buttons alike, and 12px reads as a consumer app rather than a dense tool.
        lg: '0.5rem',    // 8px  (unchanged)
        xl: '0.625rem',  // 10px — was 12
        '2xl': '0.875rem', // 14px — was 16
        '3xl': '1.25rem',  // 20px — was 24
      },

      boxShadow: {
        /*
         * Elevation, in three named steps. Tailwind's default shadow scale is sized for
         * white cards on a white page; these are tuned to read on both the light slate-50
         * ground and the dark slate-900 one, which is why they are more spread and less
         * opaque than the defaults.
         */
        card: '0 1px 2px 0 rgb(15 23 42 / 0.06), 0 1px 3px 0 rgb(15 23 42 / 0.08)',
        raised: '0 2px 4px -1px rgb(15 23 42 / 0.08), 0 4px 12px -2px rgb(15 23 42 / 0.10)',
        overlay: '0 8px 16px -4px rgb(15 23 42 / 0.14), 0 16px 40px -8px rgb(15 23 42 / 0.20)',
        /** The orange glow the Landing page uses on its primary calls to action. */
        forge: '0 0 15px rgb(249 115 22 / 0.4)',
      },
    },
  },
  plugins: [],
};
