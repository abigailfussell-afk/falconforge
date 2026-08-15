# FalconForge V2 — Master Plan

**Owner:** Kevin (jkfussell@gmail.com) · **Planner:** Claude Fable 5 · **Executors:** Opus 5 agents, one sprint per agent
**Written:** 2026-08-15 · **Beta target:** FTC kickoff, early September 2026 (~3–4 weeks out)

---

## 1. Product vision

FalconForge is the FTC team's companion and central hub — "Hudl for FTC". Feature pillars:

1. **Team management** — roster, roles, sub-teams, invites.
2. **Task management & agile planning** — sprint planner that also *teaches* agile methodology.
3. **Competition readiness** — match planning, scouting reports, pre-match checklists.
4. **Meetings** — schedules with attendance attestation/tracking *(new feature)*.
5. **Onboarding & training** *(future)* — new-member orientation to FTC, skills evaluation for
   build, programming, media, and outreach roles.

**The Season concept is central.** Each year FTC releases a new game; teams get a fresh start.
When an admin adds a new season: new sub-team assignments, clean sprint planner, clean
competition data — but all prior-season work remains browsable read-only. "Fresh start forward,
full history backward."

**Offline-first is non-negotiable.** Venue WiFi is unreliable; the app must keep working offline
and sync when connectivity returns. This already works via Dexie + a sync queue and is the most
battle-tested part of the codebase — protect it.

## 2. Business model

- **SaaS, licensed per named user, per team, monthly billing via Stripe.** Each team is its own
  tenant for data and billing separation. A user on two teams = two licenses.
- **One primary administrator per team** — registers and licenses the team, must be 18+, attests
  to the terms, accepts responsibility for the team's platform use. Solely handles billing, team
  invites, and license assignment.
- **Roles:** admin (primary, one per team), coach (18+), mentor (18+), student (no age floor for
  accounts, but **under-13s may not hold their own account** — a guardian (18+) manages a student
  profile for them; COPPA).
- **Low support overhead:** Stripe Checkout + Stripe Customer Portal (self-serve card updates,
  cancellation, invoices). Refunds are issued manually from the Stripe dashboard when needed
  (Stripe supports full/partial refunds on any charge — this covers the "angry customer" case).
- **Terms of service must state:** no uptime/availability guarantee; the service may be
  discontinued at any time without liability; refunds at operator's discretion. *(Have a lawyer
  review before charging real money — templates in this repo are drafts, not legal advice.)*
- **Gifting:** the platform operator can grant any team free access for a set period (e.g. 6
  months). Beta teams run entirely on gifted licenses.
- **Data portability (future):** team admin can bulk-export all team data if they leave.

## 3. Decisions locked in (2026-08-15)

| Decision | Choice |
|---|---|
| Billing scope for beta | **Entitlements now, Stripe later.** Build the license/seat/gifting model + admin UI; beta teams get gifted licenses. Stripe (Checkout, webhooks via Supabase Edge Functions, Customer Portal) is a post-beta sprint. |
| COPPA model | **Guardian owns the login.** Guardian account holds "managed student profiles"; the child never has credentials. Schema lands pre-beta, full UI post-beta. |
| Schema freedom | **Greenfield.** No production data to preserve. Squash/rewrite migrations freely until the schema freeze (end of Sprint 3). After beta teams onboard, all changes are forward migrations. |
| Beta deadline | **FTC kickoff, early September.** Stability, sync reliability, seasons, roles, and UI polish ship first; attendance UI, guardian UI, and Stripe land during the season. |
| AI features | **Removed** to eliminate the per-use cost component. Full record of what they did + rebuild guidance: `docs/ai-features-reference.md`. |
| Hosting | gh-pages + custom domain (falcon-forge.com), Supabase free tier, HashRouter. Upgrade only if beta succeeds. The only backend is Supabase (Postgres/Auth/Realtime/Edge Functions). |
| Brand | Keep the logo and orange "forge" palette. The problem is scale/density, not identity. |

## 4. Current-state assessment (audited 2026-08-15)

### What's genuinely good — protect it
- **Sync engine** (`src/lib/sync.ts`, `src/lib/offline-db.ts`, `src/lib/entity-registry.ts`):
  queue coalescing, strictly-ordered timestamps, retry → dead-letter (never silently drops work),
  server-timestamp cursors, delta pull + periodic full reconciliation, pending-write protection,
  cooperative cancellation. Documented against 18 numbered bugs (B1–B18) with real regression tests.
- **Entity registry**: one definition per entity (`toRemote`/`fromRemote` round-trip
  property-tested). All new entities MUST go through it.
- **CI schema job**: proves migrations alone rebuild the DB; `schema_assertions.sql` checks RLS
  enabled, delta-sync columns, replica identity.
- Deploy gates: CNAME check, no-sourcemaps check.

### Critical defects (fix first)
| # | Defect | Where |
|---|---|---|
| C1 | **Tailwind loads from the Play CDN at runtime** — no tailwind dependency, no config file; theme lives in an inline `<script>` in `index.html`. Ships a ~300 KB runtime compiler and the PWA is **unstyled offline** (cross-origin, not precached). | `index.html` |
| C2 | **Invalid hook call** — `useAuth()` invoked inside an async click handler; the forced age-profile "Complete Setup" button will throw. | `src/pages/Onboarding.tsx:180` |
| C3 | **Three competing read paths; two clobber pending offline work.** `store.fetchTeamData()` and the `queries.ts` React Query hooks overwrite the store wholesale; only `sync.pullChangesFromServer()` consults `getPendingRecordIds()`. A background refetch can silently discard un-synced local edits — the exact data-loss class (B3) the sync engine was hardened against. | `src/lib/store.ts:164-309`, `src/lib/queries.ts` |
| C4 | **Two nested QueryClientProviders** — the outer client (`main.tsx`) is dead weight with misleading config. | `src/main.tsx`, `src/components/QueryProvider.tsx`, `App.tsx` |
| C5 | **Non-UUID seed IDs** (`'season-2025-2026'`, `'subteam-programming'`) dead-letter on sync (Postgres uuid cast fails). | `src/lib/store.ts:41`, `src/constants.ts:13-19` |
| C6 | **Checklist season bug**: `checklists.season_id` is NOT NULL but the transform writes `seasonId || null` → push with no current season dead-letters. Checklist is also not season-scoped at all (one blob per team). | `src/lib/sync.ts:328-338` |
| C7 | **Zero behavioral tenant-isolation tests.** Nothing proves Team A can't read Team B's rows; only "a policy exists" is asserted. The repo's own history includes a real invite-exposure RLS hole. | `supabase/tests/` |
| C8 | **Deploy workflow skips the integration suite** — the tests holding every sync data-loss regression can be red while production deploys green. No coverage thresholds anywhere. | `.github/workflows/deploy.yml`, vitest configs |
| C9 | **Tautological test file** — `data-transform.integration.test.ts` (11 tests, 319 lines) compares its own literals to each other; it cannot fail. False assurance over the transform layer. | `src/lib/__tests__/data-transform.integration.test.ts` |

### Structural debt (fix during the rework)
- **Season model is filter-only**: five duplicated `!x.seasonId || x.seasonId === currentSeasonId`
  filters (null seasonId leaks into every season); `addSeason` creates nothing (no sub-teams, no
  checklist); no fresh-start rollover; `create_team_as_coach` hardcodes a `'Demo Season'`.
- **Dashboard is one route with `useState` tab switching** — no deep links, no back button, no
  code splitting (`App.tsx`).
- **`store.ts` god file** (593 lines): 3 slices extracted, ~6 domains still inline; `fetchTeamData`
  is 145 lines of 7 copy-pasted try/catch blocks; checklist actions are 6 near-identical copies.
- **Role model is aspirational**: schema has 4 roles, UI exposes 3 (mentor unreachable), code
  branches on exactly 1 (`isCoach`).
- **Duplication**: Sidebar fully duplicated desktop/mobile; display-name logic implemented 6×
  (canonical `member-utils.ts` used by one file); sign-out duplicated verbatim in two files.
- **Dead code**: `TeamRosterManager.tsx` (295 lines, zero importers), `summarizeMeeting`,
  unused attestation helpers, `setTasks` bridge prop, unreachable loading block in Onboarding,
  unused CSS classes, dead vite `define`s.
- **Auth/COPPA**: under-13 flow dead-ends at "have your guardian contact the coach"; no guardian
  entity. Age classification has a documented dual source of truth (user_metadata + users table).
- **`team_members` has 5 overlapping SELECT policies** — consolidate during schema rework.
- **Test truth**: coverage report excludes the integration suite and uninstrumented files
  (real numbers are worse than reported); global mocks stub the entire data layer for unit tests;
  the integration setup still contains the drifted hand-rolled Supabase mock; `auth.tsx` at 25%
  branch coverage; `user-context.tsx`, `queries.ts`, `Onboarding.tsx` untested.
- **README is stale and misleading** (documents a schema that doesn't exist).

## 5. Engineering rules (every sprint, every agent)

1. **Branch per sprint**: `v2/sprint-<n>-<slug>` off `main`. Merge `refactor/data-layer` to
   `main` before Sprint 1 starts (it's clean and ahead).
2. **The Gate** — all must pass before any commit is considered done; paste real output in the
   sprint report, never claim green without running:
   ```
   npm run lint            # tsc --noEmit
   npm run test:run        # unit
   npm run test:integration
   npm run build
   npm run db:verify       # whenever supabase/ is touched (requires Docker)
   npm run test:rls        # once it exists (Sprint 2+), whenever schema or policies change
   ```
3. **Test before commit**: every behavior change ships with a test that fails without it.
   Bug fixes get a regression test named for the bug. No `describe.skip` additions. Never delete
   a failing test to get green — fix or explicitly justify in the report.
4. **No new `as any`** (current count must only go down). Slices get typed `set`/`get`.
5. **All entities go through `entity-registry.ts`** — no ad-hoc transforms, no second read path.
6. **Never weaken the sync engine.** Any change touching `sync.ts`/`offline-db.ts`/
   `entity-registry.ts` must keep the B1–B18 regression tests green and add new ones for new
   behavior.
7. **RLS: default deny.** Every new table gets RLS + policies + a behavioral isolation test in
   the same sprint. Client-side checks are UX, never security.
8. **Docs current**: each sprint updates README/plan progress log as part of the work.
9. **Conventional commits**, small and topical. End commit messages with the standard
   Co-Authored-By line. Do not push or open PRs unless Kevin asks.
10. **Verification is adversarial**: before reporting done, re-read the sprint's exit criteria
    and actively try to falsify each one (run the app, not just the tests, for UI work).

---

## 6. Sprint plan

### Phase A — Stabilize (week of Aug 17)

#### Sprint 1 — Purge & critical fixes
**Goal:** the app builds clean, styled offline, with no dead AI weight and no known crashers.
- Remove all AI features per the checklist in `docs/ai-features-reference.md` (deps
  `@google/genai` + `pdfjs-dist` gone; remind Kevin to undeploy `gemini-proxy` and delete the
  `GEMINI_API_KEY` secret in the Supabase dashboard — agent can't do that part).
- **C1**: install Tailwind properly (`tailwindcss` + PostCSS or the Vite plugin), move the inline
  theme to `tailwind.config`, delete the CDN `<script>`, confirm the built CSS is precached by
  Workbox → styled offline.
- **C2** invalid hook call; **C4** single QueryClient; dead-code sweep (`TeamRosterManager`,
  `setTasks` bridge, unreachable Onboarding block, unused attestation helpers, dead CSS, dead
  vite `define`s).
- **C8/C9**: deploy.yml runs the integration suite; delete the tautological
  `data-transform.integration.test.ts` and replace with real assertions against
  `transformToSupabaseSchema` (it *is* exported); add coverage thresholds at current honest
  levels (ratchet, don't aspire); add `json-summary` reporter.
- Deduplicate sign-out into one helper; deduplicate display-name onto `member-utils.ts` (6 copies → 1).
**Exit criteria:** Gate green; `dist/` contains no `cdn.tailwindcss.com` reference and no Gemini
code; app runs fully styled with DevTools offline; bundle size reported before/after.

#### Sprint 2 — Data-layer unification & test truth
**Goal:** one read path that can never clobber offline work; the data layer is tested against a
real database.
- **C3**: collapse `store.fetchTeamData` and `queries.ts` onto the registry-driven pull
  (`pullChangesFromServer` or a shared helper) so *every* server read honors
  `getPendingRecordIds()`. Regression test: edit offline → trigger refetch → edit survives.
- Stand up the local-Postgres integration harness (the prior plan's unfinished "A2"): integration
  tests run against `supabase start`'s stack, not hand-rolled mocks; delete the drifted query-builder
  mock in `setup-integration.ts`; narrow the global unit-test mocks to per-file opt-in.
- **C7**: create `npm run test:rls` — behavioral multi-user suite (two teams, all four roles +
  anon) asserting cross-tenant SELECT/INSERT/UPDATE/DELETE all fail on every table. Wire into CI.
- Test the sync drain loop itself (`processSyncItem`, pull with real rows, partial failure
  mid-drain, retry → dead-letter escalation, cancellation) against the real local stack.
- Auth tests: session restore, `onAuthStateChange`, sign-out cleanup (cursors/dead-letters cleared).
- **C5**: all seed/default IDs become real UUIDs.
**Exit criteria:** Gate + `test:rls` green in CI; `sync.ts` branch coverage materially up from 13%
(report the number); a documented "how data flows" section in README (one write path, one read
path, realtime as enhancement).

### Phase B — The V2 model (week of Aug 24)

#### Sprint 3 — V2 schema: tenancy, roles, licensing, guardians, meetings
**Goal:** the greenfield schema rework. **Schema freeze at sprint end** — after this, forward
migrations only.
- Squash migrations to a clean baseline (archive the old ones). Consolidate the 5 overlapping
  `team_members` policies.
- **Roles**: `admin | coach | mentor | student`. Exactly one admin per team (constraint), 18+
  attestation for admin/coach/mentor enforced at role grant. Server-side authorization functions
  per capability (billing, roster, content) instead of the single `is_team_coach`.
- **Licensing/entitlements**: `license_grants` (team-scoped: source `gift|stripe`, seat count or
  per-member grants, `valid_from`/`valid_until`, created_by, notes) + a `team_entitlement` view
  answering "is this team active and how many seats". Platform-operator gifting path (you) and
  seat assignment by the team admin. Expiry behavior: read-only grace mode, never data deletion.
- **Guardian model (schema only)**: `managed_profiles` owned by a guardian `auth.users` account;
  team membership references either a real user or a managed profile; consent/attestation records.
- **Meetings/attendance (schema only)**: `meetings` (team+season scoped, schedule fields) and
  `meeting_attendance` (member, status, attested_by/attested_at).
- **Season scoping**: `season_id NOT NULL` on all season-scoped tables (tasks, sub_teams,
  scouting_reports, match_plans, checklists — checklist becomes per-season, fixing C6);
  remove the `'Demo Season'` hardcode from `create_team_as_coach`.
- Regenerate `database.types.ts`; extend the entity registry; update `schema_assertions.sql`;
  extend the RLS behavioral suite to every new table (including managed-profile access and
  "expired team is read-only").
**Exit criteria:** Gate + db:verify + test:rls green; an ERD/markdown schema doc committed;
`!x.seasonId ||` escape hatches deleted (NOT NULL makes them dead).

#### Sprint 4 — Season lifecycle
**Goal:** "new season = fresh start" is real.
- New-season wizard (admin/coach): name + game title; choose to clone sub-team *structure*
  (never member assignments); fresh checklist (optionally from a team template); empty sprint
  board/scouting/match plans. Roster persists at team level; sub-team assignments reset.
- Prior seasons: read-only browsing mode (clear "archived season" UI state; no edit/queue writes).
- Season deletion parity: local cascade matches the server `ON DELETE CASCADE` (no orphaned
  local records with dead seasonIds).
- Single `useSeasonScope()` selector replaces the five duplicated filters.
**Exit criteria:** Gate green; rollover integration test (create season 2 → board empty, sub-team
structure cloned w/o members, season 1 intact and read-only, checklist fresh); works offline
(rollover queued and syncs cleanly).

### Phase C — Experience (week of Aug 31)

#### Sprint 5 — UI system, density, and real navigation
**Goal:** the app feels modern, compact, and native on desktop/tablet/mobile — keeps the orange
forge identity.
- Design tokens in `tailwind.config`: type scale (13–14px base for data-dense views), spacing
  scale, radii, elevation; kill ad-hoc `text-[10px]`-style arbitrary values.
- Density pass on every view (target: sprint board and scouting usable on a phone at a
  competition; dashboard not "blown up" on desktop). Consistent container widths; fix the
  scrollbar-gutter hack; make the coarse-pointer 44px rule opt-in per component instead of the
  broad attribute-substring selector.
- One responsive `Sidebar` (single nav definition rendering rail/drawer) — deletes the full
  desktop/mobile duplication.
- Replace tab-state with real hash routes (`#/app/board`, `#/app/scouting`, …): deep links, back
  button, `React.lazy` per feature.
- Split remaining store domains into typed slices while touching each feature (checklist actions
  collapse to one `updateChecklist(fn)` helper); merge `user-context` into the auth context
  (one profile source, one cache).
**Exit criteria:** Gate green; screenshots at 375px / 768px / 1280px for every main view attached
to the report; Kevin reviews look & feel before merge; route deep-link test; no duplicated nav.

#### Sprint 6 — Licensing & admin console + legal
**Goal:** a team admin can run their whole tenant from one place; you can gift access.
- Admin console: roster & roles (mentor finally assignable), license/seat assignment, invite
  management, team settings, entitlement status ("12 of 15 seats, gifted until 2027-02-15").
- Operator gifting flow (SQL function + minimal UI gated to platform operator) for "free 6
  months" grants.
- Enforcement UX: unlicensed member → clear lock screen; expired team → read-only banner.
- Registration flow updates: admin (18+) registers team → attests to ToS/responsibility →
  invites members; under-13 self-signup still blocked with guardian messaging.
- Legal pages rewritten: ToS (no uptime guarantee, discontinuation at any time, license terms,
  refund discretion), privacy (COPPA posture), acceptable use. Versioned attestations re-required
  on change. Mark drafts "pending legal review".
**Exit criteria:** Gate + test:rls green (enforcement is server-side, not just UI); end-to-end
manual walkthrough: register team → gift license → invite each role → verify capabilities.

### Phase D — Beta launch (week of Sep 7)

#### Sprint 7 — Beta hardening & launch
**Goal:** confidence to hand real teams the URL at kickoff.
- PWA: visible update prompt (`workbox-window` is already a dep), offline banner wired to real
  connectivity state, verify full offline session → reconnect → sync at a "venue simulation"
  (DevTools offline + throttling).
- Error boundaries per route; dead-letter UI reviewed (a coach can understand and retry).
- Playwright smoke pack (5–8 flows: register, invite/join, create task offline→sync, new season,
  scouting entry, checklist) run in CI against the local stack.
- README rewritten to match reality; `.agent/` folder pruned (aspirational skill docs deleted or
  marked); seed script for a demo team so beta coaches see a populated example.
- Beta ops: simple feedback link in-app, error logging story (even just structured console +
  Supabase log review cadence), backup: scheduled `pg_dump` of the free-tier DB documented.
**Exit criteria:** full Gate + RLS + smoke pack green in CI; venue simulation passes; Kevin does
the final walkthrough and tags `v2.0.0-beta`.

### Post-beta backlog (during the season, in rough order)
- **Sprint 8 — Meetings & attendance UI** (schema already live): schedule, recurring meetings,
  attendance attestation flows, attendance reports. Offline-capable like everything else.
- **Sprint 9 — Guardian accounts UI**: guardian signup, managed student profiles, profile
  switching, consent records surfaced.
- **Sprint 10 — Stripe billing**: Edge Functions (Checkout session, webhook → license_grants,
  Customer Portal link), per-seat monthly subscription with quantity = licensed members, dunning
  via Stripe defaults, refund runbook. Entitlement checks already exist — this sprint only swaps
  the grant source.
- **Sprint 11 — Team data export**: admin bulk export (JSON + CSVs, client-generated from a full
  pull) for offboarding.
- **Later**: onboarding/orientation curriculum, training & skills evaluation per role
  (build/programming/media/outreach), AI features return per `docs/ai-features-reference.md`
  (server-side, metered, priced in).

---

## 7. Orchestration protocol (how Kevin runs this)

1. One Opus 5 agent per sprint, fresh session, in `C:\Claude\falconforge`. Open with the handoff
   prompt (`HANDOFF_SPRINT_1.md` for Sprint 1; for later sprints: "Read FALCONFORGE_V2_PLAN.md
   §5 and §6 Sprint N, then execute Sprint N under those rules").
2. The agent must **plan → implement → run the Gate → self-review against exit criteria →
   commit** on the sprint branch, then produce a sprint report (what changed, Gate output,
   exit-criteria checklist, anything deferred, anything discovered for the backlog).
3. Kevin reviews (UI sprints: look at screenshots/run it), then merges to `main`. `main` deploys
   to falcon-forge.com — until Sprint 7 hardening is done, consider keeping deploys manual.
4. Append one line per sprint to the Progress log below. If an agent discovers work outside its
   sprint scope, it records it here under "Discovered", not fixes it.
5. Optional but recommended: after each sprint, run an independent review pass (`/code-review`)
   on the sprint branch before merging.

## 8. Progress log

| Date | Sprint | Branch | Result |
|---|---|---|---|
| 2026-08-15 | Plan written; AI feature reference captured (`docs/ai-features-reference.md`) | — | — |
| 2026-08-15 | Sprint 1 — Purge & critical fixes (AI removal, C1, C2, C4, C8, C9, dead code, dedupe) | `v2/sprint-1-purge` | **Complete.** Gate green (lint / 257 unit / 80 integration / build). Main JS 882 → 385 kB; precache 5172 → 4737 KiB. Offline styling verified with the server killed. `as any` 95 → 82. Coverage thresholds active at 55/53/53/57. |
| 2026-08-15 | Sprint 2 — Data-layer unification & test truth (C3, C5, C7, local-Postgres harness, drain/auth tests, mock narrowing) | `v2/sprint-2-data-layer` | **Complete, merged to `main`.** Gate + `db:verify` + `test:rls` green (lint / 272 unit / 83 integration / 211 db / build). Three read paths → one (`server-pull.ts`). 180-assertion tenant-isolation suite against real Postgres. `sync.ts` branch coverage **13% → 84.6%**; merged coverage now measures all three suites (68.5/63.7/64.9/70.7). Global unit mocks → per-file opt-in. `as any` 82 → 66. C3 verified in the browser end-to-end. |
| 2026-08-15 | Follow-on fixes: **B19** failed pushes never retried automatically; **B20** a new team's seeded checklist wiped on first load | `v2/sync-retry-schedule` | **Complete, merged to `main`.** Both found by running the app / reviewing the diff rather than by the suite. B19: self-re-arming backoff schedule (3s/15s/60s/3m/5m) reading the queue instead of React state; offline periods consume no retry attempts. B20: zero checklist rows now leaves local state alone — an emptied checklist still propagates as a row with `items: []`. Six regression tests against real Postgres; each verified to fail without its fix. Gate green (217 db tests). |
| 2026-08-15 | **Missing API-role grants** — migrations rebuilt a database PostgREST could not use | `main` | **Complete, pushed.** Found when the new `test:db` CI step went red on first push: `permission denied for table teams` from the service-role client. Not a CI defect — the migrations genuinely produced an unusable schema, invisible to `schema_assertions.sql` because those run as `postgres`. Added the grants migration + default privileges, a schema assertion guarding it, and pinned the local CLI to CI's version. CI and Deploy green; falcon-forge.com serving. **See the parking lot before squashing migrations.** |

**Discovered / parking lot:**

*From Sprint 2:*
- **🔴 READ BEFORE SQUASHING MIGRATIONS (Sprint 3).** Our migrations create tables with **no
  DML grants for the API roles**. Supabase used to configure default privileges so anything
  created in `public` was granted to `anon`/`authenticated`/`service_role` automatically;
  newer stack versions do not, so tables came out with only REFERENCES/TRIGGER/TRUNCATE and
  PostgREST answered every request with `permission denied for table …`. Rebuilding from
  `supabase/migrations/` produced a database the app could not read a single row of. The
  hosted project predates the change and has the grants, so nothing was visibly broken —
  the gap was only ever in a rebuild, which is exactly what the Sprint 3 squash is.
  Fixed by `20260815000000_api_role_grants.sql`; **that file's contents must survive the
  squash**, including the `ALTER DEFAULT PRIVILEGES` half, or every table Sprint 3 adds
  will have the same problem. Assertion 6 in `schema_assertions.sql` now fails if any
  public table is missing SELECT/INSERT/UPDATE/DELETE for any of the three roles.
  Note the coupling: granting DML to `anon` is safe *only* because RLS is enabled
  everywhere and default-deny (assertion 1, plus the anon block of the RLS suite). Do not
  keep one and drop the other.
- **The Supabase CLI is pinned to the version CI installs** (2.114). Developing against an
  older local stack than CI runs is what hid the grants gap until it reached `main`. If you
  bump `supabase/setup-cli` in `ci.yml`, bump the devDependency with it.
- **✅ FIXED** — was: `Onboarding.test.tsx` flaky under load. Testing Library's 1s default
  `findBy*` timeout was too tight for a component that starts async work on mount; it failed
  twice in eleven full-suite runs, always under load. `src/test/setup.ts` now configures a
  5s `asyncUtilTimeout`.
- **✅ FIXED on `v2/sync-retry-schedule`** — was: **A failed push is never retried
  automatically (found in the browser, not the suite).**
  `useSync`'s auto-sync effect is `useEffect(..., [authReady, isOnline, pendingChanges,
  syncStatus])` and only fires when a dep *changes*. An item that fails to push is caught
  inside `drainSyncQueue`, so `sync()` still resolves and `syncStatus` returns to `'idle'`
  while `pendingChanges` stays at the same number. Nothing changes, so the effect never
  re-runs. Reproduced end-to-end: a task created with the network blocked stayed queued for
  60+ seconds after connectivity returned, across several `online` events, and only pushed
  when the sync indicator was clicked. (`online` events do not help — `isOnline` and
  `syncStatus` are already `true`/`'idle'`, so React bails out of both `setState` calls.)
  At a venue this reads as "my scouting report never uploaded" long after the WiFi came
  back. Fixed as B19 by a self-re-arming backoff schedule (3s/15s/60s/3m/5m) that reads the
  queue rather than React state; genuine offline periods do not consume retry attempts.
  Verified in the browser: the same scenario now heals itself in ~20s with no interaction.
- **`update` on a non-checklist table pushes with no `WITH CHECK` awareness.** Not a hole
  (Postgres applies SELECT policies to rows an UPDATE's WHERE touches, verified), but worth
  knowing when Sprint 3 consolidates policies: SELECT is the load-bearing policy on every
  table, and an over-permissive DELETE policy alone is not exploitable.
- **`sync.integration.test.ts` still hand-rolls a query-builder mock** (missing `.order()`,
  so pulls log warnings). Left in place: it tests the `useSync` hook's offline/auth gating,
  which needs a stub, and it is per-file and visible rather than a hidden global. The real
  drain and pull are covered against Postgres now. Worth deleting when the hook's scheduling
  is reworked for the retry bug above.
- **`team_members` has no `updated_at`,** so it can never take part in delta pulls and is
  deliberately excluded from the background sync loop — the roster only refreshes on team
  switch. Add the column in Sprint 3 if live roster updates are wanted.
- **`transformers.ts` is now a thin shim** over the registry with two remaining callers'
  worth of value. Delete it when Sprint 5 touches the components that import it.
- **The demo/dev flow needs a seed script.** Setting up a local team to click through took a
  hand-written script; Sprint 7 already plans one, and the fixtures in `src/test/db/` are
  most of it.
- **A stale service worker serves the previous build indefinitely** on `npm run preview`
  during local testing (cost ~20 minutes here: the app was silently running an old bundle
  pointed at the *hosted production* project). Sprint 7's "visible update prompt" work
  should cover the user-facing half; a `preview` that unregisters the SW would help devs.

*From Sprint 1:*
- **`main` had unrelated history.** The local `main` branch was a single stale "Initial commit"
  with the pre-refactor root-level layout and *no merge base* with `refactor/data-layer`.
  `origin/main` was already correct. Resolved by resetting local `main` to `origin/main` and
  merging; the stale commit is preserved as tag `archive/local-main-stub` and can be deleted.
- **`tsconfig.json` includes `components` and `services`** — root-level directories that no
  longer exist in this layout. Harmless but misleading; clean up when convenient.
- **`font-sans` never resolves to Inter.** `index.css` sets Inter on `body`, but `App.tsx`'s
  `font-sans` re-applies Tailwind's default system stack over it. Pre-existing (the CDN behaved
  identically) and deliberately not changed in Sprint 1 to avoid visual drift — belongs in the
  Sprint 5 token pass, along with whether to add Inter to `tailwind.config`.
- **Tailwind v4 deferred.** Sprint 1 installed v3 to preserve the exact class semantics the
  markup was authored against. v4 renames/drops utilities in use (`shadow-sm`, `outline-none`,
  `bg-opacity-*`, `flex-shrink`) and changes the default border colour and ring width. Weigh v4
  in Sprint 5 where the design tokens are being reworked anyway and visual diffs are expected.
- **Unused attestation constants.** `SIGNUP_REQUIRED_ATTESTATIONS`, `COACH_REQUIRED_ATTESTATIONS`
  and `MEMBER_REQUIRED_ATTESTATIONS` in `lib/attestations.ts` have no consumers now that
  `getMissingAttestations` is gone. Left in place as they look forward to the Sprint 6
  registration flow — delete them there if that flow does not use them.
- **Unused CSS survives:** `.calendar-grid` and `.transition-smooth` in `index.css` have no
  consumers. Left alone as they were outside the named Sprint 1 sweep list.
- **`vite build` warns the main chunk is >500 kB** and that `offline-db.ts` is both statically
  and dynamically imported, defeating its own code-split. Sprint 5's `React.lazy` routing work
  is the natural fix.
- **`.claude/launch.json` added** with a `preview` config on port 4188 (4173 was occupied), used
  to prove the offline-styling fix. Harmless to keep or delete.
