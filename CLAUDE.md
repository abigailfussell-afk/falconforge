# FalconForge — agent guide

Offline-first PWA for FTC robotics teams ("Hudl for FTC"): roster/roles, agile sprint planning,
scouting, match planning, checklists, meetings/attendance. React 18 + Vite + TS, Supabase
(Postgres/Auth/Realtime/Edge Functions), Dexie sync queue, Zustand, Tailwind, gh-pages +
falcon-forge.com (HashRouter). Solo maintainer (Kevin). SaaS: per named user, per team (team =
tenant), Stripe later; one 18+ primary admin per team; under-13s use guardian-managed profiles
(COPPA, guardian owns the login).

**Before any non-trivial work, read `FALCONFORGE_V2_PLAN.md`.** It is the source of truth for
scope, sprint order, locked decisions, and the current-state assessment. Append discoveries to
its §8 parking lot instead of fixing out-of-scope things. `docs/ai-features-reference.md`
records the removed AI features — do not reintroduce AI calls without reading it.

## Non-negotiable principles

1. **Offline-first.** Venue WiFi is unreliable. Every feature must work offline and sync on
   reconnect. No feature ships that only works online.
2. **Never weaken the sync engine.** `src/lib/sync.ts`, `src/lib/offline-db.ts`, and
   `src/lib/entity-registry.ts` are hardened against 18 documented bugs (B1–B18) with regression
   tests. Those tests stay green; new sync behavior gets new regression tests. Failed sync work
   is never silently dropped (retry → dead-letter → user-visible retry).
3. **One data path.** All entities go through `entity-registry.ts` (`toRemote`/`fromRemote`,
   round-trip tested). No ad-hoc transforms. Every server read must honor
   `getPendingRecordIds()` — a refetch must never clobber un-synced local edits.
4. **RLS is the security boundary, default deny.** Every table: RLS + policies + a behavioral
   cross-tenant isolation test in the same change. Client-side role checks are UX, not security.
   Never put secrets in client code or `VITE_*` vars — the only backend is Supabase.
5. **Seasons are fresh starts.** New season = clean planner/scouting/plans/checklist, sub-team
   *structure* optionally cloned (never member assignments); prior seasons read-only. All
   season-scoped data carries a NOT NULL `season_id`.
6. **Test truth over green checkmarks.** Every behavior change ships with a test that fails
   without it; bug fixes get named regression tests. No `describe.skip`, no deleting failing
   tests to pass, no tautological tests, no lowering coverage thresholds. Verify adversarially:
   run the app for UI work, not just the suite.
7. **No new `as any`** — the count only goes down.
8. **Keep the brand** (logo, orange forge palette, dark mode); design goals are compact density
   and desktop/tablet/mobile parity. Use tokens from the Tailwind config, no ad-hoc
   `text-[10px]`-style values.

## The Gate — run before any commit is "done"; report real output

```bash
npm run lint && npm run test:run && npm run test:integration && npm run build
```

Plus when `supabase/` is touched: `npm run db:verify` (needs Docker) and `npm run test:rls`
(once it exists). After schema changes, regenerate types with `npm run db:types`.

## Workflow

- Sprint work happens on `v2/sprint-<n>-<slug>` off `main`. Conventional commits, small and
  topical. Do not push, open PRs, or deploy unless Kevin asks. `main` deploys to production.
- Schema is greenfield only until the Sprint 3 freeze; after beta teams onboard (Sept 2026),
  forward migrations only.
- Update the plan's Progress log (§8) and keep README accurate as part of each sprint.
