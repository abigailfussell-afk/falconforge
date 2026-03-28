# FalconForge — Production Checklist

> **Last updated:** 2026-03-28
> **Status:** 1 / 18 items complete

Work through these items top-to-bottom. Each item includes what to do, how to verify, and files involved. Mark items `[x]` when done, `[/]` when in progress.

---

## 🔴 Critical (Must fix before any public use)

### 1. [x] Rotate DB Password & Remove Secrets from Git

**Problem:** Supabase DB password is committed in plaintext in `.agent/scaling-remaining-items.md` line 15. Backup scripts and SQL dumps are also tracked in git. The repo is on GitHub.

**Steps:**
1. Rotate the Supabase database password (Dashboard → Settings → Database)
2. Add these to `.gitignore`:
   ```
   backup-full.mjs
   backup-database.mjs
   backup_*.sql
   backup-*/
   auth_test_out.txt
   .agent/scaling-remaining-items.md
   ```
3. Remove from git tracking: `git rm --cached backup-full.mjs backup-database.mjs "backup_*.sql" auth_test_out.txt`
4. Remove the password from `.agent/scaling-remaining-items.md` (replace with `$env:SUPABASE_DB_PASSWORD="<your-password>"; node backup-full.mjs`)
5. Commit and push

**Verify:** `git ls-files backup-full.mjs backup-database.mjs auth_test_out.txt` returns empty. The old password no longer works.

**Files:** `.gitignore`, `.agent/scaling-remaining-items.md`

---

### 2. [ ] Replace Tailwind CDN with Build-Time Compilation

**Problem:** `index.html` loads Tailwind via `<script src="https://cdn.tailwindcss.com">` — a ~300KB runtime JIT compiler not meant for production. Breaks offline PWA, hurts performance.

**Steps:**
1. Install Tailwind as a Vite plugin: `npm install -D tailwindcss @tailwindcss/vite`
2. Add the plugin to `vite.config.ts`
3. Add `@import "tailwindcss"` to `src/index.css`
4. Remove the `<script src="https://cdn.tailwindcss.com">` tag and the inline `tailwind.config` script block from `index.html`
5. Move the custom color extensions (slate-750, etc.) into `tailwind.config` or CSS `@theme` block
6. Run `npm run build` to verify styles compile correctly
7. Test the built app with `npm run preview`

**Verify:** `npm run build` succeeds. `grep -r "cdn.tailwindcss" index.html` returns nothing. App looks correct at `localhost:4173`.

**Files:** `index.html`, `vite.config.ts`, `src/index.css`

---

### 3. [ ] Fix Duplicate theme-color Meta Tag

**Problem:** `index.html` has two `<meta name="theme-color">` tags with different values (`#ea580c` on line 7, `#f97316` on line 11).

**Steps:**
1. Remove one of the two meta tags (keep `#ea580c` to match the PWA manifest)

**Verify:** Only one `theme-color` meta tag exists in `index.html`.

**Files:** `index.html`

---

## 🟠 High Priority (Before real users)

### 4. [ ] Add React Error Boundary

**Problem:** No error boundary exists. Any render error crashes the entire app to a white screen.

**Steps:**
1. Create `src/components/ErrorBoundary.tsx` — a class component that catches errors
2. Show a friendly "Something went wrong" screen with a reload button
3. Wrap `<App />` in `<ErrorBoundary>` in `src/main.tsx`
4. Add a test in `src/components/__tests__/ErrorBoundary.test.tsx`

**Verify:** `npm run test:run` passes. Temporarily throw an error in a component — the error boundary catches it instead of showing a white screen.

**Files:** `src/components/ErrorBoundary.tsx` (new), `src/main.tsx`

---

### 5. [ ] Add Basic Error Reporting

**Problem:** No way to know when users hit errors in production. Zero observability.

**Steps:**
1. Choose an approach: Sentry free tier (recommended) OR a simple Supabase `error_logs` table
2. Create `src/lib/error-reporting.ts` with an `reportError(error, context)` function
3. Add `window.onerror` and `window.onunhandledrejection` handlers in `main.tsx`
4. Wire the Error Boundary (item #4) to call `reportError`
5. Replace key `console.error` calls in `sync.ts` and `store.ts` with `reportError`

**Verify:** Trigger a deliberate error. Confirm it appears in Sentry dashboard or the Supabase table.

**Files:** `src/lib/error-reporting.ts` (new), `src/main.tsx`, `src/lib/sync.ts`, `src/lib/store.ts`

---

### 6. [ ] Resize & Optimize PWA Icons

**Problem:** All 4 icon files are the same ~800KB PNG. They should be properly sized.

**Steps:**
1. Resize `icon-192.png` to 192×192px (target: ~5-15KB)
2. Resize `icon-512.png` to 512×512px (target: ~30-50KB)
3. Resize `logo.png` (apple-touch-icon) to 180×180px
4. Keep `falcon_logo.png` as the high-res original
5. Consider running through an optimizer (tinypng.com or `sharp`)

**Verify:** File sizes are significantly smaller. PWA install still shows correct icons. `lighthouse` PWA audit passes.

**Files:** `public/icon-192.png`, `public/icon-512.png`, `public/logo.png`

---

### 7. [ ] Evaluate HashRouter → BrowserRouter

**Problem:** `HashRouter` produces URLs like `falcon-forge.com/#/dashboard` which aren't SEO-friendly and look unprofessional in shared links.

**Steps:**
1. Determine hosting platform capabilities (does it support SPA fallback routing?)
2. If yes: change `HashRouter` to `BrowserRouter` in `main.tsx`
3. Configure hosting to serve `index.html` for all routes (e.g., `_redirects` for Netlify, `vercel.json` for Vercel)
4. Update `vite.config.ts` `base` if needed
5. Test all deep links: `/login`, `/join/CODE`, `/onboarding`, `/dashboard`
6. If deploying to GitHub Pages only: keep HashRouter (GH Pages doesn't support SPA routing natively)

**Verify:** All routes load correctly on direct navigation (not just clicking links). Page refresh on `/dashboard` doesn't 404.

**Files:** `src/main.tsx`, hosting config file (varies by platform)

---

### 8. [ ] Break Up Largest Components (Phase 1 — SprintPlanning)

**Problem:** `SprintPlanning.tsx` is ~800 lines (32KB), far exceeding the 300-line component limit.

**Steps:**
1. Read `.agent/skills/component-decomposition/SKILL.md` for the decomposition guide
2. Extract the task creation form into `SprintTaskForm.tsx`
3. Extract the task detail/edit modal into `SprintTaskDetail.tsx`
4. Extract filter/sort controls into `SprintFilters.tsx`
5. Keep `SprintPlanning.tsx` as the orchestrator (~200-300 lines)
6. Update any tests in `__tests__/SprintPlanning.test.tsx`

**Verify:** `npm run test:run` passes. All Sprint Planning features work in the browser. No component exceeds ~300 lines.

**Files:** `src/components/SprintPlanning.tsx`, new extracted components

---

### 9. [ ] Break Up Largest Components (Phase 2 — ScoutingReports & MatchPlanner)

**Problem:** `ScoutingReports.tsx` (~600 lines) and `MatchPlanner.tsx` (~500 lines) exceed limits.

**Steps:**
1. ScoutingReports: extract report form, report card, stats/analysis view
2. MatchPlanner: extract drawing canvas, plan list, plan form
3. Update corresponding test files

**Verify:** `npm run test:run` passes. All features work in browser. Each file ≤ ~300 lines.

**Files:** `src/components/ScoutingReports.tsx`, `src/components/MatchPlanner.tsx`, new extracted components

---

### 10. [ ] Break Up Largest Components (Phase 3 — Sidebar, Landing, Login)

**Problem:** `Sidebar.tsx` (500 lines), `Landing.tsx` (1500 lines), `Login.tsx` (500 lines), `Onboarding.tsx` (600 lines).

**Steps:**
1. Sidebar: extract navigation items, team switcher, season selector
2. Landing: extract hero section, feature sections, pricing, footer into sub-components
3. Login: extract form logic, OAuth buttons, signup form
4. Onboarding: extract team selection step, profile setup step

**Verify:** `npm run test:run` passes. All features work in browser. Each file ≤ ~300 lines.

**Files:** `src/components/Sidebar.tsx`, `src/pages/Landing.tsx`, `src/pages/Login.tsx`, `src/pages/Onboarding.tsx`, new extracted components

---

## 🟡 Medium Priority (Production hardening)

### 11. [ ] Fix Production `as any` Type Casts

**Problem:** ~30+ `as any` casts in production code (not tests) reduce type safety.

**Steps:**
1. Update `src/lib/database.types.ts` to include RPC function types for `create_team_as_coach`, `join_team_with_invite`, `update_user_age_classification`
2. Fix `supabase.rpc as any` calls in `JoinTeam.tsx` and `CreateTeam.tsx`
3. Fix `supabase.from(tableName) as any` in `sync.ts` with a discriminated union or generic helper
4. Fix `as any` in `auth.tsx` upsert calls

**Verify:** `npm run lint` passes with no new errors. `npm run test:run` passes.

**Files:** `src/lib/database.types.ts`, `src/pages/JoinTeam.tsx`, `src/pages/CreateTeam.tsx`, `src/lib/sync.ts`, `src/lib/auth.tsx`

---

### 12. [ ] Add Debouncing to Checklist Sync

**Problem:** Every checklist toggle immediately queues a full blob sync. Rapid toggles create many redundant queue entries.

**Steps:**
1. Add a debounce helper (or use a lightweight library)
2. In `store.ts`, debounce checklist `queueForSync` calls (300-500ms window)
3. Coalesce multiple toggles into a single sync entry
4. Update checklist tests to account for debouncing

**Verify:** `npm run test:run` passes. Toggle 5 checklist items rapidly — only 1 sync entry appears in IndexedDB.

**Files:** `src/lib/store.ts` (checklist actions)

---

### 13. [ ] Clean Unused Dependencies

**Problem:** Several dependencies are unused or miscategorized.

**Steps:**
1. Move `supabase` CLI package from `dependencies` to `devDependencies`
2. If AI features remain disabled, consider removing `@google/genai` or keep it behind the flag
3. Either use `@tanstack/react-query` properly or remove the scaffolding if not ready
4. Run `npm run build` to confirm no breakage

**Verify:** `npm run build` succeeds. Bundle size decreases (check with `npx vite-bundle-visualizer`).

**Files:** `package.json`

---

### 14. [ ] Replace console.warn/error with Structured Logger

**Problem:** ~30+ `console.warn`/`console.error` calls in production code expose internals in browser dev tools.

**Steps:**
1. Create `src/lib/logger.ts` with `logger.warn()`, `logger.error()`, `logger.info()` methods
2. In production mode, route errors to the error reporting service (item #5)
3. In development mode, pass through to `console` normally
4. Replace `console.warn`/`console.error` calls in `sync.ts`, `store.ts`, `auth.tsx`, `realtime.ts`

**Verify:** `npm run test:run` passes. In production build, no `console.warn` calls appear in browser for normal operations.

**Files:** `src/lib/logger.ts` (new), `src/lib/sync.ts`, `src/lib/store.ts`, `src/lib/auth.tsx`, `src/lib/realtime.ts`

---

### 15. [ ] Accessibility Audit & Fixes

**Problem:** Missing aria labels on icon buttons, no skip navigation, keyboard accessibility gaps.

**Steps:**
1. Add `aria-label` to all icon-only buttons (Sidebar toggle, theme toggle, close buttons)
2. Add a skip navigation link at the top of the app
3. Ensure all form inputs have associated labels
4. Run Lighthouse accessibility audit and fix any flagged issues
5. Test keyboard navigation through main flows

**Verify:** Lighthouse accessibility score ≥ 90. Tab navigation works through all main features.

**Files:** Various component files

---

## 🟢 Lower Priority (Polish)

### 16. [ ] Disable Production Source Maps

**Steps:** Change `sourcemap: true` to `sourcemap: false` (or `'hidden'`) in `vite.config.ts`.

**Verify:** `npm run build` produces no `.map` files in `dist/assets/` (or only hidden ones).

**Files:** `vite.config.ts`

---

### 17. [ ] Clean Up Repo Root

**Steps:**
1. Add to `.gitignore`: `dev-dist/`, `coverage/`, `test-results/`, `*.log`, `vitest_output*.txt`, `test-results.json`, `metadata.json`, `supabase_schema.txt`, `reorder.cjs`, `updateLanding.cjs`, `updateLanding.js`
2. `git rm --cached` any that are currently tracked
3. Delete local files that are no longer needed

**Verify:** `git status` is clean. Root directory contains only essential project files.

**Files:** `.gitignore`

---

### 18. [ ] Add robots.txt and CSP Headers

**Steps:**
1. Create `public/robots.txt` with appropriate rules
2. Add Content Security Policy headers via hosting config or a `<meta>` tag
3. Allow scripts from your domain, Supabase, and Google Fonts CDNs

**Verify:** `curl falcon-forge.com/robots.txt` returns content. CSP header appears in response headers.

**Files:** `public/robots.txt` (new), hosting config or `index.html`

---

## Completion Log

| Date | Item # | Summary | Verified |
|------|--------|---------|----------|
| 2026-03-28 | #1 | Redacted DB password from `.agent/scaling-remaining-items.md`, added backup files/scripts/SQL dumps/auth output to `.gitignore`, ran `git rm --cached` on 60 tracked files (backup dirs, scripts, SQL dump, auth output, scaling doc). All 223 tests pass. **User must still rotate the Supabase DB password via Dashboard → Settings → Database** since the old password exists in git history. | ✅ Tests pass, `git ls-files` confirms files untracked, `grep` confirms no password in repo |
