# Handoff — Sprint 1: Purge & critical fixes

*(Paste everything below this line into a fresh Opus 5 session running in `C:\Claude\falconforge`.)*

---

You are executing **Sprint 1** of the FalconForge V2 rework. FalconForge is an offline-first
FTC robotics team-management PWA (React 18 + Vite + TypeScript, Supabase, Dexie sync queue,
Zustand, deployed to gh-pages at falcon-forge.com).

**Read these two files completely before touching anything:**
1. `FALCONFORGE_V2_PLAN.md` — especially §4 (current-state assessment), §5 (engineering rules —
   these are binding), and §6 Sprint 1 (your scope).
2. `docs/ai-features-reference.md` — the AI-removal checklist you will execute.

## Setup

- Merge `refactor/data-layer` into `main` first (it is clean and ahead of main), then create
  your sprint branch `v2/sprint-1-purge` off `main`.
- Verify the baseline is green before changing anything: `npm run lint && npm run test:run &&
  npm run test:integration && npm run build`. If the baseline is already red, stop and report
  before proceeding.

## Scope (do all of it, nothing more)

1. **Remove the AI features** exactly per the checklist in `docs/ai-features-reference.md`:
   delete `geminiService`, `PortfolioAI`, the `gemini-proxy` edge function, all UI entry points
   (App routes, Sidebar desktop + mobile nav blocks, DashboardHome quick actions, Landing
   marketing bullet), the `AI_FEATURES_ENABLED` flag, store state
   (`portfolioHistory`/`geminiApiKey` + actions), types (`PortfolioEntry`/`Flashcard`), the
   orphaned `portfolio_entries` case in `src/lib/sync.ts`, the dead `define` block in
   `vite.config.ts`, `VITE_GEMINI_API_KEY` in `vite-env.d.ts`/README, AI mentions in README and
   `metadata.json` (including the vestigial `"microphone"` frame permission), and the
   dependencies `@google/genai` and `pdfjs-dist`. Update/remove the associated tests.
   Watch for newly-unused icon imports (`Sparkles`, `BookOpen`) breaking `tsc`.
   Note in your report that Kevin must manually undeploy the `gemini-proxy` function and delete
   the `GEMINI_API_KEY` secret in the Supabase dashboard — you cannot.
2. **Fix the Tailwind production defect (C1).** The app currently loads Tailwind from
   `https://cdn.tailwindcss.com` via a `<script>` in `index.html`, with the theme config in an
   inline script — nothing is bundled, and the PWA is unstyled offline. Install Tailwind as a
   real build dependency (Tailwind + PostCSS, or `@tailwindcss/vite` if you pick v4 — your call,
   justify it), port the inline theme (darkMode `class`, custom `slate-750/850/950`, etc.) into
   proper config, add the `@tailwind` directives to `src/index.css`, remove the CDN script, and
   confirm the generated CSS is precached by the Workbox config in `vite.config.ts`. Prove it:
   build, serve `dist`, load once, go offline in DevTools, reload — fully styled.
3. **Fix the invalid hook call (C2)** — `src/pages/Onboarding.tsx:180` calls `useAuth()` inside
   an async click handler. Hoist the hook to the component body. Add a test that exercises the
   "Complete Setup" path.
4. **Single QueryClient (C4)** — delete the dead outer client in `src/main.tsx` (or the inner
   `QueryProvider`, whichever leaves one provider with intentional config) and document the
   chosen staleTime.
5. **Dead-code sweep:** `src/components/TeamRosterManager.tsx` (zero importers — verify, then
   delete), the `setTasks` bridge prop threaded from `App.tsx` into `SprintPlanning`, the
   unreachable duplicate `isLoading` block in `Onboarding.tsx` (~lines 281-290), unused
   attestation helpers (`getMissingAttestations`/`recordAttestations`) — verify unused first,
   the unused `.pwa-install-prompt`/`.offline-banner` CSS classes, and the `role === 'demo'`
   branch in `member-utils.ts`.
6. **Deduplicate:** (a) sign-out logic — `App.tsx:64-108` and `Onboarding.tsx:132-172` are
   verbatim copies; extract one helper with a test. (b) display-name/initials — six
   implementations exist (`member-utils.ts` is canonical; also in `user-context.tsx`,
   `SprintPlanning.tsx`, `SprintTaskActivity.tsx`, `PreMatchChecklist.tsx`,
   `MemberManager.tsx`); route all six through `member-utils.ts`.
7. **CI/test truth (C8, C9):** make `.github/workflows/deploy.yml` run the integration suite
   before deploying (it currently deploys on unit tests only). Delete the tautological
   `src/lib/__tests__/data-transform.integration.test.ts` and replace it with real tests that
   import `transformToSupabaseSchema` from `src/lib/sync.ts` and assert actual transforms.
   Add coverage thresholds to `vitest.config.ts` at the current *honest* levels (run coverage
   first, set thresholds just below actuals — a ratchet, not an aspiration) and add the
   `json-summary` reporter.

## Binding rules (from FALCONFORGE_V2_PLAN.md §5)

- Every behavior change ships with a test that fails without it. No `describe.skip`. Never
  delete a failing test to get green (the tautological file in scope item 7 is the explicit,
  planned exception — it asserts nothing).
- No new `as any`. Do not touch `sync.ts`/`offline-db.ts`/`entity-registry.ts` beyond the
  orphaned `portfolio_entries` removal — the sync engine's B1–B18 regression tests must stay green.
- Conventional commits, small and topical (suggested sequence: AI removal → Tailwind → hook fix →
  QueryClient → dead code → dedupe → CI/tests). End each commit message with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Do NOT push or open a PR. Local commits on `v2/sprint-1-purge` only.

## The Gate (run before declaring done; paste real output)

```
npm run lint
npm run test:run
npm run test:integration
npm run build
```

## Exit criteria (verify each adversarially before reporting)

- [ ] Gate fully green.
- [ ] `grep -r "cdn.tailwindcss" dist/ src/ index.html` → no hits; offline reload of built app is styled.
- [ ] `grep -ri "gemini\|GoogleGenAI\|pdfjs" src/ index.html vite.config.ts` → no hits;
      `@google/genai` and `pdfjs-dist` absent from `package.json` and the lockfile.
- [ ] Bundle size before/after recorded (main JS chunk + total precache).
- [ ] Onboarding "Complete Setup" flow has a passing test.
- [ ] Coverage thresholds active (prove by temporarily lowering — no, by showing the config and a
      passing coverage run); `deploy.yml` diff shows integration step.
- [ ] Sprint report written: what changed, Gate output, this checklist, manual follow-ups for
      Kevin (Supabase dashboard cleanup), and anything discovered out-of-scope appended to
      FALCONFORGE_V2_PLAN.md §8 "Discovered / parking lot" + one row added to the Progress log.
