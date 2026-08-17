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

**Before writing tests or claiming a sprint is done, read `docs/failure-modes.md`.** It is the
mined record of what has actually gone wrong across eight sprints — thirteen recurring classes,
each with the commits. The headline: of the 34 fix commits in this repo, **13 were found by
running the app, 3 by CI, 2 by reading a diff, 1 by production forensics, and approximately
zero by the 592-test suite.** A green Gate is a precondition for being done. It is not evidence.

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
7. **No new `as any`** — the count only goes down. Enforced by
   `src/test/__tests__/harness-invariants.test.ts`, which also counts it one agreed way; three
   different greps used to give three different answers.
8. **Keep the brand** (logo, orange forge palette, dark mode); design goals are compact density
   and desktop/tablet/mobile parity. Use tokens from the Tailwind config, no ad-hoc
   `text-[10px]`-style values (also ratcheted, currently 2).
9. **One implementation per concept.** This is the most frequent defect class in the project's
   history — seven display-name implementations, three copies of sign-out, three server read
   paths, five overlapping SELECT policies, two entire Sidebars. Each copy is correct the day
   it is written and nothing compares them afterwards. Before adding a second way to do
   something, delete the first. And treat deduplication as defect-finding, not tidying: **every
   dedup pass in this project has uncovered a behavioural bug** — `"JUNDEFINED"` initials,
   ScoutingReports never filtering by season at all, a rename that did not propagate, a
   sign-out missing its realtime teardown.

## The Gate — run before any commit is "done"; report real output

```bash
npm run gate
```

That is `lint` (now `tsc --noEmit && eslint src`) → unit → integration → build, and it is the
**only** definition of the Gate. Do not restate it as a chain of separate scripts: it used to be
written out in three places that had quietly drifted apart, and the copy an agent read was not
the copy CI ran.

When `supabase/` is touched, use `npm run gate:db` instead — the Gate plus `db:verify` (needs
Docker), `test:db` and `test:rls`. After schema changes, regenerate types with `npm run db:types`.

## Verification — the part the Gate cannot do

The suite is strong on the sync engine and on new logic, and it has never once caught a defect
that reached a user. These have, repeatedly, so budget for them:

- **Run the app.** A real build (not the dev server — it has no service worker), in a browser,
  at 375px, as every role the feature touches.
- **Watch each new test fail.** Comment out the fix, see it go red, put it back. Eight of the
  documented defects survived behind tests that were structurally incapable of failing.
- **Measure geometry for anything visual.** jsdom applies no stylesheet, so it renders the
  broken and fixed versions of a layout identically.
- **Ask of every verification step: what would make this fail?** If there is no answer it is
  decoration. At least eight steps in this repo's history had quietly stopped verifying.

## Workflow

- Sprint work happens on `v2/sprint-<n>-<slug>` off `main`. Conventional commits, small and
  topical. Do not push, open PRs, or deploy unless Kevin asks. `main` deploys to production.
- Schema is greenfield only until the Sprint 3 freeze; after beta teams onboard (Sept 2026),
  forward migrations only.
- Update the plan's Progress log (§8) and keep README accurate as part of each sprint.
