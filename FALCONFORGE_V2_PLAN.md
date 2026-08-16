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
  - **It also owns SCREENSHOT CAPTURE, and should be the first thing built in the sprint.**
    Decided with Kevin at Sprint 6's close. Sprint 5 and Sprint 6 both have "screenshots at
    375 / 768 / 1280" in their exit criteria and both satisfied it by hand; Sprint 6 could not
    satisfy it at all. The Browser pane has two distinct failure modes: it cannot capture unless
    the pane is *displayed* (no pane, no compositing, no frames — this is what actually cost
    Sprint 6 its captures), and above ~1024px it composites an emulated viewport into its own
    surface without scaling up, so a 1280-wide page lands in a fifth of the image. Playwright is
    headless, so display state is irrelevant, and takes an arbitrary viewport plus
    `fullPage: true`.
  - A `scripts/capture-screens.mjs` that signs in against the seeded local stack
    (`scripts/seed-review-states.mjs`, Sprint 6) and captures the main views at three widths
    turns a per-sprint manual ritual into a Gate artifact. ~100 lines.
  - **It does not replace looking at the app.** All three defects Sprint 6 found in the browser
    came from poking around, not from assertions — a script only checks what somebody already
    thought to check. Playwright is for proving and re-proving; the pane is for looking.
  - Caveat worth writing down: Playwright's Chromium is not Safari, so it emulates iOS rather
    than being it. Sprint 6's iOS zoom bug was caught by measuring computed styles, which
    Playwright does equally well — but genuine Safari zoom-on-focus behaviour still wants a real
    device before beta.
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
| 2026-08-15 | Sprint 3 — V2 schema: tenancy, roles, licensing, guardians, meetings. **Schema frozen.** | `v2/sprint-3-schema` | **Complete.** Gate + `db:verify` + `test:rls` green (lint / 272 unit / 83 integration / 299 db / 258 rls / build). 7 migrations squashed to 6; the API-role grants survived intact. Roles are admin\|coach\|mentor\|student with a one-admin index and an 18+ trigger; four capability functions replace `is_team_coach`; `team_members`' five SELECT policies became one. `license_grants` + a `security_invoker` `team_entitlement` view make an expired team read-only *in the database*. Guardian and meetings tables landed schema-only. `season_id` is NOT NULL everywhere with composite `(season_id, team_id)` FKs, checklists are per-season (C6), and the `!x.seasonId \|\|` filters are deleted. **Found and closed B21**, a cross-tenant privilege escalation in the V1 policies. Schema assertions 6 → 14, RLS suite 180 → 258. Verified in the browser end to end: register → seeded season/sub-teams/checklist → edits sync. |
| 2026-08-15 | **Production migrated to the V2 schema** — `supabase db reset --linked` | `main` | **Complete.** `db push` cannot apply a squash (the first `CREATE TABLE users` collides), so the hosted project was reset from the new baseline. Greenfield decision applied: the testing data was discarded, with a full dump taken first into `backups/` (gitignored). `auth.users` emptied too, so the next signup is a genuine first run. Verified against the hosted project: all 14 schema assertions pass, every table and the `team_entitlement` view answer anon with `200 []`, `create_team_as_admin` responds and the old name is 404, and the live bundle is byte-identical to the merged build. B21's interim `ALTER POLICY` is superseded by the permanent V2 policy. |
| 2026-08-15 | Operator seeded; `TestTeam` moved from the automatic trial to an open-ended gift | `main` | **Complete.** Kevin's user id inserted into `platform_operators` (the table ships empty by design; no API path can write it). The gift was issued through `grant_team_license` rather than a direct insert, which verified the operator path end to end: the RPC refused a caller with no operator identity and accepted the operator. The automatic 90-day trial was then revoked with an audit note rather than deleted, so the grant history reads honestly. Entitlement now `active / unlimited / open-ended`. The trial block in `create_team_as_admin` still exists for new self-serve teams and is still slated for removal when Stripe lands. |
| 2026-08-15 | Sprint 4 — Season lifecycle | `v2/sprint-4-seasons` | **Complete.** Gate + `db:verify` + `test:db` + `test:rls` green (lint / 324 unit / 87 integration / 320 db / 261 rls / build). The first forward migration on the frozen schema: `seasons.game_title` + `is_archived`, and `season_is_open` gating the INSERT/UPDATE/DELETE policy of every season-scoped table, so a prior season is read-only **in the database** rather than in a disabled button. Rollover is client-side through the existing queue (an RPC cannot run offline, and the exit criteria require it to): season → cloned sub-teams (`member_ids = '{}'`, fresh uuids) → fresh checklist → archive, in one drain. Verified offline in a browser end to end. `useSeasonScope()`/`useSeasonScoped()` replace six duplicated filters and **found that ScoutingReports never filtered by season at all**. Season deletion now cascades locally to match the server. **Found and fixed B22** (season deletions never reached other devices — `seasons` was missing `REPLICA IDENTITY FULL`) and a queue-ordering hazard in `queueForSync` (B1's guarantee was incidental, not guaranteed). Schema assertions 13 → 15. `as any` 68 → 67. |

| 2026-08-15 | Sprint 5 — UI system, density, and real navigation | `v2/sprint-5-ui` | **Complete, reviewed, merged and deployed to falcon-forge.com** (`332f2bd`, CI + Deploy both green; live bundle verified serving Inter with zero Google-Fonts requests, and CNAME intact). No migration: `supabase/` untouched, so unlike Sprint 4 the bundle went live against a database that already matched. Gate green (lint / 342 unit / 87 integration / build); `supabase/` untouched, so no migration and no `db:verify` needed. Design tokens land in `tailwind.config`: the type scale is **retuned rather than extended** (`text-sm` 13px, `text-base` 14px) so density reaches ~1500 existing utilities without any of them opting in, plus `text-2xs` — the step below `text-xs` that 15 drifting `text-[10px]`/`[11px]` values had been standing in for. **49 arbitrary values → 1**, and that one is a computed column width, not a size. `forge-*` names the brand ramp, asserted byte-identical to Tailwind's orange, so 223 renames across 22 files are a provable visual no-op. **Inter renders for the first time** — `font-sans` had always overridden it — self-hosted, and the `fonts.googleapis.com` link nobody had noticed is gone with it. Tab state → real routes (`#/app/board`), deep-linkable, back button works, `React.lazy` per feature: main chunk **402 → 288 kB**. **One Sidebar** replaces the fully duplicated rail/drawer, and `Dashboard.test.tsx`'s `getAllByText(...).length > 0` assertions are `getByText` — the tightening that proves it. Four more store domains into typed slices; `user-context` merged into auth (one profile read, one cache). `transformers.ts` deleted. `as any` **67 → 58**. Coverage ratcheted **68/63/64/70 → 72/67/69/74**. Found by running the app, not the suite: an empty checklist rendered nothing at all (and "blank" is a rollover option), and a phone keyboard squeezed the nav to a 24px sliver. **Also found and left alone: a restored session can drop the user into the forced age-profile screen — confirmed on unmodified `main`, so pre-existing; see the parking lot.** |

| 2026-08-15 | Sprint 5.5 — UI polish: primitive kit, feedback pass, density pass; auth deadlock fixed | `v2/sprint-5.5-ui-polish` | **Complete.** Gate green (lint / 344 unit / 87 integration / build); no `supabase/` changes. Ran from the post-Sprint-5 UI review's findings. **The 🔴 restored-session bug is fixed and root-caused** — `onAuthStateChange` awaited a supabase REST call while supabase-js held its auth Web Lock, deadlocking the client on itself; profile sync now defers out of the callback (B23 regression test, verified to fail without the fix; reload-with-session verified live). The missing layer over the Sprint 5 tokens landed: `src/components/ui/` (Button/IconButton/Modal/EmptyState/SectionHeader) + `.field` — 8 primary-button recipes, 5 modal widths, 7 input recipes and three disabled opacities collapse to one each, `max-w-panel`/`max-w-dialog`/`z-dialog` go from dead tokens to the modal defaults, and ConfirmDialog composes the kit. Feedback pass: scouting Save no longer silently no-ops on an empty team number (disabled + explanatory title, under test); four keyboard-unreachable primary actions became real buttons (scouting cards, calendar rows, checklist items — under test); the native `confirm()` in MemberManager became ConfirmDialog; Reject got the busy spinner Approve had; the sync button answers hover and explains its disabled states; ± steppers got touch targets, hover, and a floor at zero. Density pass: calendar rows ~124px → ~88px of vertical cost and the view fills its frame; task-modal padding halved; checklist 800px → 608px column; EditProfile → `max-w-panel`; scouting/sub-team grids gain xl/2xl steps; dashboard's dead lower half became an Upcoming Deadlines panel. `as any` 58 → **55**; arbitrary values still 1 (the documented one). Verified in the browser end to end on the local stack. |

| 2026-08-16 | **Sprint 5.5 merged and deployed** | `main` | **Complete.** `--no-ff` merge (`909a163`), Gate green on the merged main (lint / 344 unit / 87 integration / build; `supabase/` untouched so no `db:verify`). CI and Deploy both green; falcon-forge.com verified serving `index-D4lvFf5W.js` — byte-identical to the local build — with the custom domain intact. The `onAuthStateChange` deadlock fix is live, which production users were hitting on every reload. |

| 2026-08-16 | Sprint 6 — Licensing & admin console + legal | `v2/sprint-6-licensing` | **Complete.** Gate + `db:verify` + `test:rls` + `test:db` green (lint / 470 unit +2 skips / 87 integration / build / 20 schema assertions / 265 rls / 364 db). `as any` stays **55**; arbitrary values still 1. **Seat semantics decided by Kevin at kickoff: seats are purchased TEAM CAPACITY and the gate is JOIN APPROVAL** — one seat per approved member including the admin, refused when full by `enforce_seat_capacity`, and **no policy consults `seat_assigned`** (assertion 19 fails if one starts to). That answers the hand-off's decision 1 without per-member RLS: the enforcement point becomes an action that is inherently online and rare, so the offline write path never consults licensing at all. Approval sets `status` + `seat_assigned` in one statement so the trigger refuses atomically; invites are capped at the seats free (`max_uses` had been in the schema since Sprint 3 unset). **Found B25, a live cross-tenant privilege escalation**: `can_manage_billing` was `current_team_role(t) = 'admin'`, which is **NULL** for a non-member, so `IF NOT can_manage_billing(...)` never fired and `transfer_team_admin` — SECURITY DEFINER, EXECUTE-granted to `authenticated` and `anon` — accepted an outsider. Verified as an exploit (`success: true`), fixed with `coalesce(..., false)` at the root. No policy was ever wrong, which is why 261 isolation assertions went green over it: RLS coerces NULL to false, and the one RPC with the vulnerable shape had no caller. **B24**: the sync drain gains error classification — but narrower than first written. A policy refusal is terminal only when local state already explains it (read-only team, or archived season), because PostgREST reports a cross-tenant write, an unlicensed write, an archived-season write **and a write naming a not-yet-synced season** with one identical 42501; the wider rule was refused by B19's own regression test, which models an outage with a CHECK-rejected title and then corrects the queued payload in place. **Ownership transfer** is a two-party handshake (nominate → the successor attests → transfer), because `enforce_member_role_eligibility` was a gate with no door: nothing had ever written the successor's attestation. `operator_transfer_team_admin` rescues a stranded team, audited in a new `operator_actions` table with a SELECT policy and no others. Legal documents rewritten (no uptime guarantee, discontinuation at any time, licence/seat terms, discretionary refunds, the COPPA posture spelled out to match the schema) and versioned to 2.0, with `ReAttestationPrompt` making the bump real; `src/pages/legal` 0% → covered by 32 claim-level tests. **Deploy is now manual** (`workflow_dispatch` only) — the first sprint whose bugs can remove access rather than merely look wrong. **Found by running the app, not the suite: the 16px iOS zoom floor had been protecting nothing since Sprint 5.5** — it was written as element selectors and `.field` is a class applying 13px, so every form control in the app was below the floor on every phone; measured at 13px, fixed to 16px, guarded by a source-level test because jsdom cannot apply `index.css`. Also found by looking: an under-18 could be nominated as admin (the roster carries no age, so the refusal landed on the student at acceptance), and a lapsed team's panel read "4 of 0". Three defects in my own new code were caught by the suite: a fail-CLOSED attestation read, an **infinite render loop** (an effect depending on the `user` object; ~2M iterations and a 2.7 GB log), and mock drift from B24's new import that hung a test file for fifteen minutes rather than failing it. |

**Discovered / parking lot:**

*From Sprint 6:*
- **🔴 CI does not run on sprint branches.** `ci.yml` triggers on `push: branches: [main,
  'refactor/**']` and on `pull_request`. Every `v2/sprint-*` branch since Sprint 1 has been pushed
  with **no CI run at all** — confirmed by the Actions API after pushing
  `v2/sprint-6-licensing`: zero workflows fired. So the only CI signal a sprint has ever had is
  the one that arrives *after* it merges to `main`, which is the worst possible moment for it. The
  Gate is run locally and reported, which is why this has not hurt yet, but it means "CI green"
  has never been true of a sprint branch before its merge. Add `'v2/**'` to the trigger list, or
  open PRs. One line either way; the reason it is 🔴 is that it silently inverts the point of
  having CI.
- **`transfer_team_admin` and the other admin RPCs are EXECUTE-granted to `anon`** as well as
  `authenticated`, via the schema's default privileges. B25's fix makes that harmless (an
  anonymous caller now gets `false` from every capability rather than NULL), but granting
  anonymous EXECUTE on team-administration functions is still wrong by default-deny. A
  `REVOKE EXECUTE ... FROM anon` sweep over the RPC surface is a contained forward migration
  and wants its own behavioural test per function, so it was not bolted onto this sprint.
- **`team_members` carries no `age_classification`, so the console cannot pre-filter successor
  candidates.** `nominate_team_admin` now refuses an under-18 up front, which puts the error in
  front of the admin instead of the student — but the dropdown still lists them. Fixing it
  properly means either denormalising the age onto `team_members` (a schema change, and one more
  column for `sync_user_to_team_members` to keep in step) or a second read. Neither is worth it
  before Sprint 9 touches the guardian model.
- **`team_entitlement` is `security_invoker`, so the operator console lists only teams the
  operator can already read.** Gifting works from a team id, which is what a support
  conversation produces, so this is a real limitation rather than a blocker. Cross-tenant
  visibility for the operator needs its own policy and its own isolation tests — deliberately
  not smuggled in alongside a UI sprint.
- **The trial licence in `create_team_as_admin` is still there.** Sprint 6 built the operator
  gifting UI that replaces it for real teams, but self-serve registration still issues itself a
  90-day unlimited grant, because a team with no licence is read-only and registration would be
  dead on arrival without one. Deleting the `INSERT INTO license_grants` block turns registration
  into "create team, then pay" and belongs with Stripe in Sprint 10.
- **A seat-count *reduction* has no admin-facing path yet.** The semantics are decided (allow it,
  never remove anybody, refuse new approvals until back under capacity) and `EntitlementPanel`
  renders the over-capacity state, but capacity only changes through the operator RPC until
  Stripe lands. The guard that refuses a downgrade-driven approval already exists — it is
  `enforce_seat_capacity` — so Sprint 10 needs the purchase UI, not new enforcement.
- **`MEMBER_REQUIRED_ATTESTATIONS` is now an empty named constant with a documented reason.**
  Kept rather than deleted so the join flow records that it asks for nothing deliberately. If a
  fourth sprint passes with it still empty, delete it.

*From Sprint 5.5:*
- **Due dates render one day early for US-negative UTC offsets.** A date picked as
  `2026-08-19` is stored as UTC-midnight epoch millis and rendered via local-time
  `new Date(...).getDate()`, so Chicago sees “AUG 18”. Pre-existing in SprintCalendar and
  SprintList; the new dashboard deadlines panel inherits it faithfully. The fix is a
  date-only render helper (or storing date-only strings), and it touches the task form's
  `<input type="date">` parsing too — small, self-contained, but it deserves its own tested
  change rather than a rider on a styling sprint.
- **Two `!important` utilities exist now** (`!px-2.5`, `!px-2 md:!px-4`) where a caller
  overrides the Button size recipe's padding — Tailwind orders spacing utilities by scale,
  so a plain override silently loses. If this pattern spreads, give Button a `padding:
  'none'` escape hatch instead of accumulating `!`.

*From Sprint 5:*
- **🔴 A restored session can drop the user into the forced age-profile screen.**
  Reproduced in a browser on the local stack and **confirmed on unmodified `main`**, so it
  predates Sprint 5. On a reload with a valid stored session, `supabase.auth.getSession()`
  never resolves: it takes the `lock:sb-<ref>-auth-token` Web Lock and stays there, with
  nothing queued behind it. After 5s the safety timeout in `auth.tsx` fires, `isLoading`
  flips to false with `ageClassification` still null, and `Onboarding` renders "Almost
  Done! Please complete your profile configuration" to somebody whose profile is complete.
  The token was not expired and the network round trip measured 52ms, so it is not
  slowness. For a real user this reads as "the app forgot who I am and is asking my age
  again", and the obvious response — re-entering it — is harmless but alarming. Belongs
  with Sprint 7's hardening (or wherever `auth.tsx`'s lifecycle is next opened): the
  timeout should not be able to leave the app in a state that *asks for data it already
  has*, whatever the underlying stall turns out to be. Left alone deliberately — it is
  auth lifecycle, not UI, and Sprint 5 had no business widening into the sync/auth core.
  - **Root cause found and fix verified (2026-08-15, UI-review session).** The stall is a
    self-deadlock in supabase-js, triggered by our own callback: `auth.tsx`'s
    `onAuthStateChange` handler `await`s `ensureUserProfile()` — a PostgREST call — inside
    the callback. supabase-js emits `INITIAL_SESSION`/`SIGNED_IN` while still holding the
    `sb-<ref>-auth-token` Web Lock; the REST call resolves its access token via
    `getSession()`, which wants that same lock; the client queues it internally (so
    `navigator.locks.query()` shows the lock held with an EMPTY pending queue) and neither
    side ever proceeds. Supabase's docs explicitly warn not to call other Supabase
    functions synchronously inside `onAuthStateChange`. Reproduced 100% on the local stack
    on every reload-with-stored-session AND on password sign-in; depending on whether the
    5s timeout loses or wins the race against the `INITIAL_SESSION` `setState`, the user
    gets either the documented age-profile screen or an **indefinite "Preparing your
    workspace..."** — the timeout does not cover the second ordering. Verified fix (left
    uncommitted in the working tree for review): defer the profile-sync block out of the
    callback with `setTimeout(0)` and release `isLoading` in a `.finally()`. After the
    patch, reload-with-session lands on a fully-loaded dashboard every time. Needs a named
    regression test when it lands (Rule 6); a supabase-js upgrade is a complementary
    hardening, not a substitute — the callback pattern is the bug.
- **`MemberManager`'s role `<select>` for the admin's own row is disabled with no title.**
  Correct behaviour (the one-admin unique index means `transfer_team_admin` is the only
  path), but it is a dead control with no explanation, the same class Sprint 4 fixed
  elsewhere. Sprint 6 owns that screen and should say "transfer the admin role instead".
- **`checklistTemplates` still has no management UI** (carried from Sprint 4 — Sprint 5
  did not add one; the checklist page gained an empty state, not a template manager).
- **Tailwind v4 re-deferred, now post-beta.** Kevin's call at Sprint 5 kickoff: v4 renames
  or drops utilities this markup uses and changes the default border colour and ring
  width, which is a framework migration on top of a token pass three weeks from kickoff.
  The token layer landing in v3 does not make v4 harder later.
- **`orange-*` is now `forge-*` in app source, but the tests still say `orange-`.** The
  ramps are asserted identical, so nothing renders differently; a handful of test files
  and `src/test/` fixtures were left out of the rename deliberately to keep the diff
  reviewable. Rename them whenever those files are next touched.

*From Sprint 4:*
- **`CreateTeam`'s default season name rolls over in January, not at kickoff.**
  `defaultSeasonName()` returns `<currentYear>-<nextYear>`, so a team registering in March
  2027 is offered "2027-2028 Season" when they are in fact in the 2026-2027 season.
  `suggestNextSeasonName` in `season-rules.ts` has the kickoff-aware fallback; CreateTeam
  was left alone because it is a different question (a brand-new team's FIRST season) and
  the Sprint 3 report verified its current behaviour in a browser. One line, plus a test,
  wherever Sprint 6's registration rework touches it.
- **A device offline during a rollover can still queue writes to the now-archived season.**
  Its copy of `is_archived` is stale, so the store guards pass, and the writes are refused
  on arrival and dead-lettered. Narrow: the pull that brings the archive back also fixes the
  UI, so the window is one sync interval, and the work is parked rather than lost. It is the
  same class as the entitlement refusal Sprint 6 owns and wants the same answer — classify a
  policy refusal that cannot succeed on retry as TERMINAL, and surface it. See the note
  below.
- **An entitlement refusal still burns five retries over nine minutes.** Sprint 3 raised
  this and Sprint 4 deliberately did not widen into it: the honest fix is a change to
  `sync.ts`'s failure classification (a 403 from a policy that depends on licensing or
  archival will never succeed on its own), and that touches the sync engine and needs its
  own regression tests under rule 6. Sprint 6 owns it, together with the read-only banner.
  Sprint 4's contribution is that rollover does not ADD a case: the action is not offered to
  an unlicensed team, and the archived-season guards refuse to queue.
- **Checklist templates have no management UI.** They can be saved from the Pre-Match
  Checklist page and picked in the rollover wizard, which is the loop the sprint brief
  asked for, but there is no way to rename, preview or delete one from the app
  (`deleteChecklistTemplate` exists in the store with no caller). Sprint 5's UI pass or
  wherever the checklist page is next touched.
- **✅ DELETED IN SPRINT 5.** Its last caller was a test, so the shim existed only to be
  tested; `match-number-optional.test.ts` asserts against the registry directly now, which is
  where B18 actually lives.

*From Sprint 3:*
- **✅ B21 patched on production 2026-08-15** (`ALTER POLICY` on the hosted project, verified
  before and after) and fixed permanently in the V2 policies. The V1 `team_members` INSERT
  policy allowed `user_id = auth.uid()`, so any authenticated user could insert themselves
  into any team as an approved coach. The lesson for future suites is in the sprint report:
  every cross-tenant INSERT the C7 suite tried named the *victim's* user id, so 180
  assertions passed over an escalation that only needed the attacker to name themselves.
- **The trial licence in `create_team_as_admin` is temporary and must be removed when
  billing goes live.** A team with no licence is read-only, so self-serve registration has
  to leave the team entitled or the app is dead on arrival; the RPC therefore issues a
  90-day unlimited gift grant. Sprint 6's operator gifting replaces it for real teams and
  Sprint 10's Stripe webhook replaces it permanently. Delete the `INSERT INTO license_grants`
  block in that function and registration becomes "create team, then pay".
- **An unlicensed team's writes fail silently in the UI.** *(Promoted into
  `HANDOFF_SPRINT_4.md` as a required guard, because rollover is a write gated on
  entitlement and would be the second feature to inherit it. Sprint 4 must test that
  rollover is refused for an unlicensed team and must not offer the action; the full
  enforcement UX stays Sprint 6.)* Verified in the browser: with the
  licence revoked, creating a task showed the card, the server refused the insert (403), and
  the sync indicator said "1 pending" with no reason given. The engine is behaving correctly
  — it retries, then dead-letters — but two things belong in Sprint 6 alongside the
  "expired team → read-only banner": the client should read `team_entitlement` and stop
  offering writes, and an entitlement refusal should be treated as TERMINAL rather than
  consuming five retries, since it will never succeed on its own.
- **Seat assignment is admin-only, enforced in a trigger, and the UI half is a stub.**
  `enforce_seat_capacity` now refuses both over-assignment and assignment by anyone who is
  not the team admin (`service_role` is exempt — it is what Stripe's webhook will use in
  Sprint 10). `MemberManager` disables the control for non-admins, but that screen is a
  Sprint 6 rewrite: the real admin console is where seat assignment gets a proper flow,
  including showing "12 of 15 seats" from `team_entitlement` rather than a per-row toggle
  with no total in sight.
- **`platform_operators` starts empty and there is no UI for it.** Kevin must insert his own
  row with the service key before `grant_team_license` will do anything; the SQL is in
  `docs/v2-schema.md`. Sprint 6 owns the operator gifting UI.
- **Guardian visibility is deliberately narrow, and depends on two predicates agreeing.**
  `get_user_team_ids` and `is_team_member` both exclude managed rows; both have to be wrong
  before anything leaks, which is why breaking only one of them left the guardian tests
  green during adversarial verification. Widening guardian access is a product decision for
  Sprint 9 — if it is widened, change both and re-check the roster assertion.
- **`meetings`, `meeting_attendance`, `managed_profiles`, `guardian_consents` and
  `license_grants` are not in the entity registry.** They have no client consumers yet, and
  a registry entry with nothing reading it is dead code. Sprint 6 (licensing UI), Sprint 8
  (meetings) and Sprint 9 (guardians) add them — with round-trip tests, like every other
  entity.
- **The store's per-season checklist has no UI for switching seasons yet.** `checklistsBySeason`
  is keyed correctly and the read path fills every season it receives, so switching seasons
  is instant — but the only season control is the sidebar picker, and Sprint 4's rollover work
  is what will exercise it properly.
- **`transfer_team_admin` has no caller.** Written because the one-admin unique index makes
  a client-side promote-then-demote impossible, and tested at the SQL level, but nothing in
  the UI calls it until the Sprint 6 admin console.

*From Sprint 2:*
- **✅ RESOLVED IN SPRINT 3** — was: **🔴 READ BEFORE SQUASHING MIGRATIONS (Sprint 3).** Our migrations create tables with **no
  DML grants for the API roles**. Supabase used to configure default privileges so anything
  created in `public` was granted to `anon`/`authenticated`/`service_role` automatically;
  newer stack versions do not, so tables came out with only REFERENCES/TRIGGER/TRUNCATE and
  PostgREST answered every request with `permission denied for table …`. Rebuilding from
  `supabase/migrations/` produced a database the app could not read a single row of. The
  hosted project predates the change and has the grants, so nothing was visibly broken —
  the gap was only ever in a rebuild, which is exactly what the Sprint 3 squash is.
  Fixed by `20260815000000_api_role_grants.sql`; that file's contents had to survive the
  squash, including the `ALTER DEFAULT PRIVILEGES` half, or every table Sprint 3 adds
  would have had the same problem. **They did** — `20260816000500_v2_grants.sql` carries
  them, keeps the note, and is documented as having to stay last in the file order. Assertion 6 in `schema_assertions.sql` now fails if any
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
- **✅ FIXED in Sprint 3** — was: `team_members` has no `updated_at`, so it can never take
  part in delta pulls. The column and its trigger exist now and assertion 4 covers it. The
  table is still excluded from the background sync loop; wiring it in is a separate change
  and belongs wherever live roster updates are actually wanted.
- **✅ DELETED IN SPRINT 5** — see the Sprint 4 note above. (This Sprint 2 entry was already
  stale: it said "two remaining callers" and there was one, a test.)
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
- **✅ FIXED IN SPRINT 5.** Was: `font-sans` never resolves to Inter — `index.css` sets Inter
  on `body`, but `App.tsx`'s `font-sans` re-applies Tailwind's default system stack over it.
  Kevin chose to make Inter real rather than drop it. It is self-hosted now (two latin subsets,
  +131 KB precache) and `font-sans` resolves to it. Sprint 5 also found the other half nobody
  had noticed: `index.html` was loading Inter from `fonts.googleapis.com` on every cold start —
  a render-blocking cross-origin dependency, of the same class as the C1 Tailwind CDN, paying
  for a webfont that `font-sans` then overrode so it never rendered. Both links and the two
  dead Google-Fonts `runtimeCaching` rules are gone.
- **✅ WEIGHED IN SPRINT 5 — deferred again, to post-beta.** Was: Sprint 1 installed v3 to
  preserve the exact class semantics the markup was authored against; v4 renames/drops
  utilities in use (`shadow-sm`, `outline-none`, `bg-opacity-*`, `flex-shrink`) and changes
  the default border colour and ring width. Kevin's decision at Sprint 5 kickoff was to stay
  on v3: a framework migration on top of a token pass, three weeks from kickoff, on the one
  sprint whose output is directly visible, mixes two sets of visual diffs in the screenshots
  he has to review. See the Sprint 5 entry above.
- **Unused attestation constants.** `SIGNUP_REQUIRED_ATTESTATIONS`, `COACH_REQUIRED_ATTESTATIONS`
  and `MEMBER_REQUIRED_ATTESTATIONS` in `lib/attestations.ts` have no consumers now that
  `getMissingAttestations` is gone. Left in place as they look forward to the Sprint 6
  registration flow — delete them there if that flow does not use them.
- **Unused CSS survives:** `.calendar-grid` and `.transition-smooth` in `index.css` have no
  consumers. Left alone as they were outside the named Sprint 1 sweep list.
- **✅ BOTH FIXED IN SPRINT 5**, though not the way this predicted. The >500 kB warning is gone
  because `React.lazy` per feature took the main chunk from 402 kB to 288 kB. The
  `offline-db.ts` static/dynamic warning was **not** fixed by route splitting and could not
  have been: the module is pulled into the entry chunk by `store.ts`, `sync.ts`, `realtime.ts`,
  `server-pull.ts` and three slices, so the `await import()` calls in `sign-out.ts` and
  `JoinTeam.tsx` deferred nothing and only produced the warning. Made static.
- **`.claude/launch.json` added** with a `preview` config on port 4188 (4173 was occupied), used
  to prove the offline-styling fix. Harmless to keep or delete.
