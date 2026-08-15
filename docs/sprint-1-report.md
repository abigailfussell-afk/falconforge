# Sprint 1 — Purge & critical fixes · Report

**Branch:** `v2/sprint-1-purge` (8 commits, local only — not pushed, no PR)
**Date:** 2026-08-15
**Baseline:** verified green before any change (lint, 262 unit, 67 integration, build).

---

## Setup note — `main` had unrelated history

The local `main` branch was a single stale `Initial commit` carrying the pre-refactor
root-level layout (`components/`, `services/`, `types.ts` at the repo root) with **no merge
base** against `refactor/data-layer`. A literal merge would have resurrected all of that
alongside the current `src/` tree.

`origin/main` was already correct — it contained `refactor/data-layer` through PR #2. Local
`main` was reset to `origin/main`, then `refactor/data-layer` merged in (bringing the one
newer commit, the SprintPlanning split). The stale commit is preserved as tag
`archive/local-main-stub` in case Kevin wants it; it is otherwise safe to delete.

---

## What changed

### 1. AI features removed
Executed the checklist in `docs/ai-features-reference.md` in full. Everything was already dead
behind `AI_FEATURES_ENABLED = false`, so nothing user-visible changed.

Deleted `geminiService` (+ test), `PortfolioAI` (+ test), `supabase/functions/gemini-proxy/`,
the `AI_FEATURES_ENABLED` flag, `portfolioHistory`/`geminiApiKey` store state and their three
actions, the `PortfolioEntry`/`Flashcard` types, the orphaned `portfolio_entries` case in
`sync.ts`, the dead `process.env.API_KEY` `define` block in `vite.config.ts`,
`VITE_GEMINI_API_KEY`, and the pdfjs `DOMMatrix` test shim. Entry points removed from App
routes, Sidebar (desktop + mobile), DashboardHome quick actions, the Landing marketing bullet,
README, and `metadata.json` including the vestigial `"microphone"` frame permission.
`@google/genai` and `pdfjs-dist` uninstalled.

The newly-orphaned icon imports the brief warned about (`Sparkles`, `BookOpen`, and also
`GraduationCap`) were removed; `tsc` has `noUnusedLocals` on and would have failed otherwise.

The Dashboard nav test kept its assertions that "Portfolio Helper" and "Judging Prep" never
render — they now serve as a reintroduction guard rather than a feature-flag check.

### 2. C1 — Tailwind bundled instead of CDN
The app loaded `https://cdn.tailwindcss.com` from a `<script>` with the theme in an adjacent
inline script. Nothing was bundled, so the PWA rendered **completely unstyled offline** (the
CDN is cross-origin and never entered the precache), and every visitor downloaded a ~300 KB
runtime compiler.

Installed `tailwindcss` + `postcss` + `autoprefixer` as build dependencies, ported the inline
theme verbatim into `tailwind.config.js` (`darkMode: 'class'`, the `slate-750/850/950`
overrides), added the `@tailwind` directives at the top of `src/index.css` so the existing
reset still wins over preflight, and deleted both scripts from `index.html`.

**Why v3 and not v4:** every class in the codebase was authored against v3 Play CDN semantics.
v4 renames or drops utilities the app uses (`shadow-sm`, `outline-none`, `bg-opacity-*`,
`flex-shrink`) and changes the default border colour and ring width — silent visual drift
across ~40 components with no visual test coverage. Sprint 5 owns the design-token pass and is
the right place to weigh v4. Recorded in the parking lot.

### 3. C2 — invalid hook call in Onboarding
`handleProfileComplete` called `useAuth()` inside an async click handler. React's dispatcher is
null outside render, so the call threw; the surrounding `try/catch` swallowed it and a user
forced through age-profile completion saw a generic error instead of their profile saving, with
no way forward. `updateAgeClassification` now comes from the hook call already in the component
body.

### 4. C4 — single QueryClient
`main.tsx` built a `QueryClient` with a 5-minute `staleTime` and wrapped the tree in a second
`QueryClientProvider`. Because the providers nested, every `useQuery` resolved against the
inner one (`QueryProvider`, inside App) and the outer config never applied to anything while
reading as though it did. Deleted the outer client; verified nothing outside App consumes React
Query. The surviving 30s `staleTime` is now documented on `QueryProvider` and pinned by a test.

### 5. Dead-code sweep
Each target verified unreferenced first: `TeamRosterManager.tsx` (295 lines, zero importers);
`getMissingAttestations`/`recordAttestations` (only their own tests called them — the singular
`recordAttestation`, which `CreateTeam` uses, stays); the `setTasks` bridge prop and its 20-line
adapter in App; the second unreachable `isLoading` block in Onboarding; the `role === 'demo'`
branches in `member-utils` (no such role exists in the schema — reachable only by casting, which
the tests did); `.pwa-install-prompt`, `.offline-banner` and the `slideUp` keyframes; and the
3D card-flip utilities whose only consumer was the deleted flashcard UI.

### 6. Deduplication
**Sign-out** existed as two verbatim copies. It is the one path where a missed step leaks the
previous user's data into the next session on a shared team laptop. Both now call
`performSignOut` in `lib/sign-out.ts`, which keeps the time-boxed best-effort shape (local
teardown never waits on a network that may not exist at a venue; the redirect runs from
`finally`). Onboarding gains the realtime teardown only App used to do.

**Display name / initials** had **seven** implementations, not the six on the sprint list —
`SprintTaskDetail.tsx` had one the brief didn't name. They disagreed in two ways:

| | fallback for no name | name split |
|---|---|---|
| `member-utils` (nominally canonical) | whole email address | single space |
| the other six | email local part | `/\s+/` (three of them) |

So the same person could appear under two different names on two screens. `member-utils` is now
the only implementation and adopts both majority behaviours. The `/\s+/` split also fixes a real
defect: with a single-space split, a trailing space in a full name (`"Jane "`) produced the
initials **`"JUNDEFINED"`**. The functions now take a structural `{fullName, email}` plus an
optional fallback, so the `currentUser` record (`Guest`/`G`) and snake_case pending-invite rows
go through the same code instead of being cast.

*Behaviour change worth Kevin's eye:* AdminSettings/SubTeamManager member chips now show the
email local part rather than the full address, matching every other screen.

### 7. C8 / C9 — CI and test truth
`deploy.yml` gated on typecheck and unit tests only, so the integration suite holding every sync
data-loss regression (B1–B18) could be red while production deployed green. It now runs before
the build.

`data-transform.integration.test.ts` was 319 lines and 11 tests that never called the transform.
It built a camelCase literal and a snake_case literal by hand and asserted the two matched:

```js
expect(expectedSupabaseFormat.team_id).toBe(localTask.teamId);
```

That cannot fail — `transformToSupabaseSchema` could have been deleted outright and the suite
stayed green, over the layer deciding what reaches the database. Replaced with 24 tests that
import the real exported function: field mapping, epoch→ISO conversion, server-assigned columns
being omitted, the legacy `subTeamId` spelling, null-vs-empty-string for unassigned tasks, the
jsonb nesting for scouting reports, `match_number` null-not-zero (B18) with a genuine 0 still
distinguishable from absent, the partner flags once read but never written (B9), the blob-synced
checklist shape, both naming conventions resolving to one definition, unknown-table
pass-through, and that `portfolio_entries` no longer has a special case.

Coverage thresholds added at the honest measured levels, plus the `json-summary` reporter.

---

## Gate output

```
$ npm run lint
> tsc --noEmit
(clean)

$ npm run test:run
 Test Files  27 passed (27)
      Tests  257 passed | 2 skipped (259)

$ npm run test:integration
 Test Files  8 passed (8)
      Tests  80 passed (80)

$ npm run build
dist/index.html                 1.66 kB │ gzip:  0.75 kB
dist/assets/index-Cz8TYvAH.css 55.27 kB │ gzip:  9.58 kB
dist/assets/charts-*.js        41.18 kB │ gzip: 14.01 kB
dist/assets/vendor-*.js       162.72 kB │ gzip: 53.12 kB
dist/assets/supabase-*.js     171.11 kB │ gzip: 44.20 kB
dist/assets/index-Ci1mMyTn.js 384.69 kB │ gzip: 97.68 kB
✓ built in 8.91s

PWA v0.17.5 — precache 17 entries (4736.75 KiB)
```

The 2 skipped tests are pre-existing in `MatchPlanner.test.tsx` (present in the baseline); no
`describe.skip` was added.

`npm run db:verify` was not run — `supabase/` was touched only by deleting the `gemini-proxy`
edge function, which is not part of the schema.

---

## Bundle size, before → after

| | Before | After | Δ |
|---|---|---|---|
| Main JS chunk | 882.12 kB (gzip 243.76) | **384.69 kB** (gzip 97.68) | **−497 kB / −56%** |
| CSS | 2.63 kB (gzip 1.20) | 55.27 kB (gzip 9.58) | +52.6 kB |
| vendor / supabase / charts | 162.72 / 171.11 / 41.18 | unchanged | — |
| Workbox precache | 5171.58 KiB | **4736.75 KiB** | **−434.8 KiB** |

CSS grows because Tailwind is now compiled into the bundle rather than fetched from a CDN — the
CDN's ~300 KB runtime compiler used to sit in the JS chunk and is gone. Net: less shipped, and
what ships now works offline.

---

## Exit criteria

- [x] **Gate fully green** — output above, all four commands.
- [x] **`grep -r "cdn.tailwindcss" dist/ src/ index.html` → no hits.** Offline reload verified
      for real, not simulated: built, served `dist`, loaded once, killed the preview server
      (`curl` → `000`), forced a reload. The page rendered from the service worker with 699 CSS
      rules from `assets/index-*.css`, `body` background `rgb(15,23,42)`, the landing `h1` at
      72px/800 weight, and zero console errors. `assets/index-*.css` is in the Workbox precache
      manifest in `dist/sw.js`.
- [x] **`grep -ri "gemini\|GoogleGenAI\|pdfjs" src/ index.html vite.config.ts` → no hits.**
      `@google/genai` and `pdfjs-dist` absent from `package.json` and `package-lock.json`
      (0 matches each). `supabase/functions/` no longer exists.
- [x] **Bundle size recorded** — table above.
- [x] **Onboarding "Complete Setup" has a passing test** — 4 tests in
      `src/pages/__tests__/Onboarding.test.tsx`. Verified adversarially: reintroducing the
      `useAuth()` call fails 2 of the 4 with *"Invalid hook call"*. The auth mock in that file is
      deliberately a real hook (it calls `useContext`, as production `useAuth` does) — a plain
      `vi.fn()` returns happily from an async handler and would have passed against the bug.
- [x] **Coverage thresholds active** — `vitest.config.ts` sets statements 55 / branches 53 /
      functions 53 / lines 57, just under the measured 55.62 / 53.66 / 53.82 / 57.66. A ratchet,
      not an aspiration. `npm run test:coverage` passes (exit 0); confirmed genuinely enforced by
      temporarily raising `lines` to 99, which exits 1. `json-summary` reporter added and
      `coverage/coverage-summary.json` verified written.
- [x] **`deploy.yml` diff shows the integration step** — `Integration tests: npm run
      test:integration`, between the unit tests and the build.
- [x] **Sprint report written** — this file; plan §8 progress log and parking lot updated.

Binding rules held: no `describe.skip` added; no new `as any` (**95 → 82** across `src/`); the
only sync-engine change was deleting the orphaned `portfolio_entries` case, and the B1–B18
regression tests stay green (80 integration tests, up from 67).

---

## Action required from Kevin — Supabase dashboard

I cannot do these; the code is removed but the deployed backend is not:

1. **Undeploy the `gemini-proxy` edge function.** It is still live and reachable. Note the
   reference doc records two known holes in it: the `list_models` action was callable without
   auth, and the function interpolated payloads without the client-side prompt sanitiser.
2. **Delete the `GEMINI_API_KEY` secret** from the project's Edge Function secrets.

Worth doing promptly — an orphaned, unauthenticated, billable endpoint is the least good thing
left over from this sprint.

## Also for review

- The AdminSettings/SubTeamManager display-name change described in §6.
- `tag archive/local-main-stub` — delete if you don't want the old stub commit kept.
- `.claude/launch.json` was added (preview on port 4188) to prove the offline fix. Keep or drop.
- Everything discovered outside scope is in `FALCONFORGE_V2_PLAN.md` §8, not fixed here.

---

## Commits

```
df8b983 docs: add V2 master plan, agent guide, and AI feature reference
7d785d7 feat: remove the Gemini AI features
fc7532b fix(build): bundle Tailwind instead of loading the Play CDN (C1)
caaf187 fix(onboarding): hoist useAuth out of the submit handler (C2)
8ff32b0 refactor(query): collapse onto a single QueryClient (C4)
d814d11 refactor: sweep out dead code
aad3846 refactor: deduplicate sign-out and display-name logic
e5ce77a test: run integration in deploy, replace the tautological transform tests (C8, C9)
```
