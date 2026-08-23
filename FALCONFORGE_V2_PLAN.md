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
| Who creates a managed profile | **The guardian, never the coach** (Kevin, 2026-08-17). The coach shares an ordinary invite code; the guardian signs up, adds their own child, and joins with it; the admin approves the join exactly as for any member. Consent and the child's data therefore arrive in the same sitting, so there is nothing to chase — a coach-created profile would require an email round trip to the parent, a blocked roster entry while it is outstanding, and a whole consent-chasing subsystem built for no benefit. The coach's workflow does not change at all. |
| Who carries COPPA responsibility | **Three layers, one checkbox of new work** (Kevin, 2026-08-17). The guardian consents directly to FalconForge (`guardian_consents`, versioned, once). The team admin attests at approval that they will not roster a child without the guardian — a single checkbox recorded as an attestation, not a workflow. The ToS states the split. Note the surface is already small by construction: an under-13 has no credentials, so they cannot sign in and cannot self-check-in (`check_in_with_code` needs an authenticated caller and `anon` holds no EXECUTE), which means **FalconForge never collects information from a child** — every field is entered by an adult. Whether an admin attestation suffices where verifiable parental consent is required went to legal review and **came back cleared to proceed as designed (Kevin, 2026-08-22)**; the flow collects guardian consent directly regardless, which is why it was cheap to be strict here. |
| Child's date of birth | **Not collected** (Kevin, 2026-08-17). `managed_profiles.birth_year` is dropped — it is nullable, nothing writes it, and it existed solely to compute a child's age. Collecting less about a minor is the right default and removes a field that would otherwise need justifying in a privacy review. **Consequence, accepted deliberately: the app never knows anyone's age**, only what was asserted once. Promotion is therefore triggered by a person, never a date. |
| Promotion (managed child → own login) | **Guardian-initiated at any time, plus a nudge at the one moment the limit is felt** (Kevin, 2026-08-17). The guardian gets a "give this child their own login" action in their own view; separately, when a student tries to do the one thing a managed profile cannot — scan the QR to check themselves in — the app tells them to ask their guardian. Never automatic. **It graduates in place:** the `team_members` row keeps its `id` and only changes which identity it points at (`user_id` guardian → the new user, `managed_profile_id` → NULL), so attendance and task history survive untouched — `meeting_attendance` is unique on `(meeting_id, team_member_id)` — with no re-approval and no seat churn. The `managed_profiles` row and its consents are retained as the record of why the child was rostered. A season-rollover prompt is a reasonable later addition if this proves too quiet. |
| Guardian's view of the app | **Manage from their own view; no act-as mode** (Kevin, 2026-08-17). A guardian sees their children — consents given, upcoming meetings, attendance — and never renders the team as the child. Switching *into* the child would let a guardian account act as a team member, which is a far larger surface to get right in RLS and the shape that quietly becomes "a guardian could do X as their child". |
| Age that goes stale | **Ask at the moment it matters, do not store a birthday** (Kevin, 2026-08-17). `age_classification` is asserted once at signup and never recomputed, so a 17-year-old who turns 18 stays `13_to_17` for ever — and that column gates admin eligibility, which is why Sprint 6's under-18 nomination failed on the student rather than the coach. The fix reuses Sprint 6's two-party handshake: the nominated successor confirms "I am 18 or older" on the same screen where they accept the terms. A fresh answer at the moment of nomination is better evidence than a stale one from signup, and it needs no dates. |
| Schema freedom | **Greenfield.** No production data to preserve. Squash/rewrite migrations freely until the schema freeze (end of Sprint 3). After beta teams onboard, all changes are forward migrations. |
| Beta deadline | **FTC kickoff, early September.** Stability, sync reliability, seasons, roles, and UI polish ship first; attendance UI, guardian UI, and Stripe land during the season. |
| AI features | **Removed** to eliminate the per-use cost component. Full record of what they did + rebuild guidance: `docs/ai-features-reference.md`. |
| Hosting | gh-pages + custom domain (falcon-forge.com), Supabase free tier, HashRouter. The only backend is Supabase (Postgres/Auth/Realtime/Edge Functions). **Reaffirmed 2026-08-16 — stay put through beta.** Leaving gh-pages means HashRouter → BrowserRouter, which touches every route, the e2e pack, the capture script and the QR poster URLs already going onto paper: a framework-shaped change three weeks from kickoff, deferred for the same reason as Tailwind v4. Revisit post-season. The triggers are CSP/security headers over minors' data, wanting the repo private (Pages on a private repo needs a paid GitHub plan), and per-branch preview deploys — never traffic to *Pages*, which is unmetered for this size. **CORRECTED 2026-08-24 (SYNC-03, measured):** the sentence used to end "never traffic, which will not come close to any limit", and that was wrong about SUPABASE. Egress was measured at **863.8 KB per app open** for a mid-season team with a prior season — ~2.28 GB/month for one team at 15 devices × 6 opens/day — against a 5 GB free-tier allowance shared by every team, i.e. **two teams**. Sprint 11 took a warm open to 13.8 KB and the monthly figure to ~46 MB/team, so the wall has moved rather than been removed; the number to watch is the dashboard's egress, not the page views. Supabase free → Pro is a billing toggle with no migration and no downtime; its trigger is the first paying customer (PITR, log retention beyond 1 day, no 7-day inactivity pause), i.e. Sprint 10. |
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
2. **The Gate** — must pass before any commit is considered done; paste real output in the
   sprint report, never claim green without running:
   ```
   npm run gate            # lint (tsc --noEmit && eslint src) -> unit -> integration -> build
   npm run gate:db         # the Gate plus db:verify, test:db and test:rls. Use this
                           # whenever supabase/ is touched. Requires Docker.
   ```
   These are the **only** definitions. They used to be written out here as a list of separate
   scripts, and that list had drifted from `package.json`'s `test:all` and from `ci.yml`, which
   called `npx tsc --noEmit` directly — three definitions of done, of which the one an agent
   read was not the one CI ran. `test:rls` carried "once it exists (Sprint 2+)" until Sprint 8,
   five sprints after it existed and was green.
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
11. **Read `docs/failure-modes.md` before writing tests or claiming done.** Fourteen recurring
    defect classes mined from eight sprints, each with its commits, plus the checklist that
    closes them. Of the 34 fix commits in this repo, 13 were found by running the app and
    approximately zero by the unit suite — so budget for the browser, not just the Gate.
12. **Read `docs/environment-divergences.md` before testing auth, CSS, service workers, database
    permissions, or a clock.** Ten documented ways the thing under test is not the thing that
    ships. Every one has already produced a green result that meant nothing.

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
- ~~**Sprint 8 — Meetings & attendance UI**~~ **DONE 2026-08-16** — see the progress log. Was:
  (schema already live): schedule, recurring meetings,
  attendance attestation flows, attendance reports. Offline-capable like everything else.
- ~~**Sprint 9 — Guardian accounts UI**~~ **DONE 2026-08-17** — see the progress log. Was:
  guardian signup, managed student profiles, profile switching, consent records surfaced.
  *"Profile switching" was settled by §3 as NO act-as mode*: a guardian manages from their own
  view and never renders the team as the child, so what shipped is a guardian view plus
  promotion, not a switcher.
- **Sprint 10 — Stripe billing**: Edge Functions (Checkout session, webhook → license_grants,
  Customer Portal link), per-seat monthly subscription with quantity = licensed members, dunning
  via Stripe defaults, refund runbook. Entitlement checks already exist — this sprint only swaps
  the grant source.
- **Sprint 11 — Team data export**: admin bulk export (JSON + CSVs, client-generated from a full
  pull) for offboarding.
- **UNSCHEDULED — Auth email branding & the confirmation round trip.** Drafted 2026-08-16 as
  "Sprint 8.5" and deliberately **not** given a sprint slot; Kevin's call at the end of that
  session. **Two of its three parts have since shipped outside a sprint, and the third lost its
  original reason** — what is left is smaller and different, so read this before scheduling it.
  - **✅ SMTP — done 2026-08-22.** Custom SMTP via Resend's free tier (3,000/month, 100/day, one
    custom domain, no injected branding — **not** Brevo, whose free tier stamps its own branding
    on the mail, which is the whole problem in a different hat). Verified against a real Gmail
    with SPF, DKIM and DMARC passing; runbook in `docs/beta-ops.md`.
  - **✅ Templates — done 2026-08-22.** Six branded HTML templates in `supabase/templates/`,
    pasted into the dashboard by Kevin, documented in `docs/auth-email-templates.md`. This is
    the **one place the plan was overruled deliberately**: the draft said "repo files wired
    through the `[auth.email.template.*]` blocks, never pasted into the dashboard", and those
    blocks configure the *local* stack only — the hosted project reads its templates from the
    dashboard, so the dashboard is the live copy and the repo files are the reference it was
    pasted from. That is a drift risk and it is written down as one rather than pretended away.
  - **⬜ The `{{ .TokenHash }}` round trip — still open, but NOT for the reason drafted.** The
    original argument was that `{{ .ConfirmationURL }}` bounces through Supabase's
    `/auth/v1/verify` and returns tokens in the URL *fragment*, which is where HashRouter keeps
    its route. **Sprint 9 removed that argument**: `authRedirectUrl()` returns the origin root,
    the fragment survives, and the templates use `{{ .ConfirmationURL }}` today with zero app
    code. The reason that remains is a different one — **link scanners.** Corporate mail filters
    prefetch every URL in an incoming message and spend the one-time token before the human
    clicks it, and the user is told the link expired. Fixing it needs a route that reads
    `token_hash` and `type` from the query string and calls `verifyOtp`; `/auth/callback`
    renders a splash screen and nothing else. Schedule it if a beta team reports phantom expiry.
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

| 2026-08-16 | **Sprint 5.5 merged and deployed** | `main` | **Complete.** `--no-ff` merge (`909a163`), Gate green on the merged main (lint / 344 unit / 87 integration / build; `supabase/` untouched so no `db:verify`). CI and Deploy both green; falcon-forge.com verified serving `index-D4lvFf5W.js` — byte-identical to the local build — with the custom domain intact. The `onAuthStateChange` deadlock fix is live. (Said at the time to be something "production users were hitting on every reload" — corrected: production is greenfield since Sprint 3's reset, so the only person hitting it was Kevin.) |

| 2026-08-16 | Sprint 6 — Licensing & admin console + legal | `v2/sprint-6-licensing` | **Complete.** Gate + `db:verify` + `test:rls` + `test:db` green (lint / 470 unit +2 skips / 87 integration / build / 20 schema assertions / 265 rls / 364 db). `as any` stays **55**; arbitrary values still 1. **Seat semantics decided by Kevin at kickoff: seats are purchased TEAM CAPACITY and the gate is JOIN APPROVAL** — one seat per approved member including the admin, refused when full by `enforce_seat_capacity`, and **no policy consults `seat_assigned`** (assertion 19 fails if one starts to). That answers the hand-off's decision 1 without per-member RLS: the enforcement point becomes an action that is inherently online and rare, so the offline write path never consults licensing at all. Approval sets `status` + `seat_assigned` in one statement so the trigger refuses atomically; invites are capped at the seats free (`max_uses` had been in the schema since Sprint 3 unset). **Found B25, a live cross-tenant privilege escalation**: `can_manage_billing` was `current_team_role(t) = 'admin'`, which is **NULL** for a non-member, so `IF NOT can_manage_billing(...)` never fired and `transfer_team_admin` — SECURITY DEFINER, EXECUTE-granted to `authenticated` and `anon` — accepted an outsider. Verified as an exploit (`success: true`), fixed with `coalesce(..., false)` at the root. No policy was ever wrong, which is why 261 isolation assertions went green over it: RLS coerces NULL to false, and the one RPC with the vulnerable shape had no caller. **B24**: the sync drain gains error classification — but narrower than first written. A policy refusal is terminal only when local state already explains it (read-only team, or archived season), because PostgREST reports a cross-tenant write, an unlicensed write, an archived-season write **and a write naming a not-yet-synced season** with one identical 42501; the wider rule was refused by B19's own regression test, which models an outage with a CHECK-rejected title and then corrects the queued payload in place. **Ownership transfer** is a two-party handshake (nominate → the successor attests → transfer), because `enforce_member_role_eligibility` was a gate with no door: nothing had ever written the successor's attestation. `operator_transfer_team_admin` rescues a stranded team, audited in a new `operator_actions` table with a SELECT policy and no others. Legal documents rewritten (no uptime guarantee, discontinuation at any time, licence/seat terms, discretionary refunds, the COPPA posture spelled out to match the schema) and versioned to 2.0, with `ReAttestationPrompt` making the bump real; `src/pages/legal` 0% → covered by 32 claim-level tests. **Deploy is now manual** (`workflow_dispatch` only) — justified in `deploy.yml` by the second forward migration landing on the one database holding the operator identity no API path can recreate, which is Sprint 4's incident in a different costume. The first version of that justification claimed a bad deploy would show a lock screen to real users; **corrected, because production is greenfield** — `auth.users` was emptied at Sprint 3's reset and there is nobody to lock out but Kevin, who holds the service key. Reverting to auto is defensible until beta onboarding. **Found by running the app, not the suite: the 16px iOS zoom floor had been protecting nothing since Sprint 5.5** — it was written as element selectors and `.field` is a class applying 13px, so every form control in the app was below the floor on every phone; measured at 13px, fixed to 16px, guarded by a source-level test because jsdom cannot apply `index.css`. Also found by looking: an under-18 could be nominated as admin (the roster carries no age, so the refusal landed on the student at acceptance), and a lapsed team's panel read "4 of 0". Three defects in my own new code were caught by the suite: a fail-CLOSED attestation read, an **infinite render loop** (an effect depending on the `user` object; ~2M iterations and a 2.7 GB log), and mock drift from B24's new import that hung a test file for fifteen minutes rather than failing it. |

| 2026-08-16 | **Sprint 6 merged to `main`** | `main` | **Complete.** `--no-ff` merge (`cafc0d3`). Full Gate green on the merged main, including `db:verify` and `test:rls` this time because `supabase/` was touched: lint / 470 unit +2 skips / 87 integration / build / schema assertions / 265 rls / 364 db. One caveat recorded rather than smoothed over: the first (cold) `test:run` failed one deep-link test and passed on a re-run - diagnosed and fixed on the Sprint 7 branch, see below. Not deployed at merge time; `main` was still `workflow_dispatch` only. |

| 2026-08-16 | Sprint 7 - Beta hardening & launch | `v2/sprint-7-hardening` | **Complete.** Gate + `db:verify` + `test:rls` + `test:db` + the new smoke pack green (lint / 503 unit +2 skips / 91 integration / build / 21 schema assertions / 281 rls / 380 db / 10 e2e). `as any` **55 -> 55**; arbitrary Tailwind values still 1. **CI had never run on a sprint branch** - `ci.yml` triggered on `[main, 'refactor/**']` only, so six sprints merged on the strength of a locally-run Gate and the first CI signal always arrived *after* the merge, the one moment it is useless. `'v2/**'` added as the first commit. **Playwright now owns screenshot capture** (`npm run capture`, 27 images at 375/768/1280), which Sprint 6 could not produce at any width; and a **six-flow smoke pack** runs in CI against a production build served by `vite preview` rather than the dev server - not fastidiousness, since the dev server has no service worker and an offline navigation renders blank, so the pack would have been asserting things about the harness in the one codebase where offline behaviour IS the product. **Five defects found by building that tooling, none by the 476-test suite**: the Upcoming Deadlines panel vanished when empty, restoring the dead space it was added to fill, for every brand-new team; a coach who created a team was bounced to the team picker to select it from a list of one (and `setTeams` turned out to have exactly one caller in the app, so the obvious half-fix left the sidebar reading "Select Team" from inside that very team); the sign-up privacy checkbox was **never recorded** - `SIGNUP_REQUIRED_ATTESTATIONS` was checked by `ReAttestationPrompt` and written by nothing, so a COPPA-adjacent consent record was simply absent and every new account was told its documents were out of date on its first screen; the sync indicator hid the pending count while offline, so a team that had worked a whole session at a venue saw exactly what a team that had done nothing saw; and a test-isolation leak where `vi.clearAllMocks()` preserved a `mockReturnValue({ user: null })` into every test appended after it. **A latent CI flake was root-caused**: `asyncUtilTimeout` (5000ms) equalled Vitest's default `testTimeout`, so the documented async budget was unreachable and failures arrived as opaque test timeouts naming no assertion - measured with a probe (4800ms passed, 5500ms died at 5011ms), and it mattered now because a CI runner is cold and contended every single run. **PWA**: `autoUpdate` replaced by a visible update prompt, with `skipWaiting` and `clientsClaim` deliberately separated - dropping autoUpdate for plain `prompt` silently left a coach's FIRST visit uncontrolled by any service worker, caught by the offline smoke test within minutes. Per-route error boundaries (there were none anywhere in the app), a dead-letter **review** UI (per-item retry and discard, because all-or-nothing retry lets one permanently-dead change hold the badge hostage and the only escape was destroying the good work with it), and an app-level offline banner whose wording treats offline as the designed case rather than a failure. **`REVOKE EXECUTE ... FROM anon`** over the nine directly-called admin RPCs - third forward migration, privileges only. Its first draft was a convincing no-op: `REVOKE ... FROM anon` changes nothing, because EXECUTE comes from PUBLIC, and only the nine behavioural tests caught it - which is exactly why the parking-lot item demanded a test per function. The capability predicates keep their grant on purpose, with seven tests pinning that negative space. **Deploy returns to automatic** on Kevin's call, with the rule written into `deploy.yml` - schema changes are ordered by hand, everything else ships on merge - plus a **read-only** post-deploy production check, verified against the live site, every request a GET or a HEAD. **Venue simulation** (`npm run venue`) passes end to end: a session's work offline, an offline reload, a throttled reconnect draining in under five seconds, and every item confirmed on a second device. **Found while pruning `.agent/`: a real account's plaintext password was committed in three files, in a PUBLIC repository, and is still in git history** - removed from the tree; Kevin confirmed it is a dummy password and will rotate it. **Merged, migrated and deployed at Kevin's instruction**: both outstanding migrations (Sprint 6's and Sprint 7's) applied to the hosted project after schema and data dumps, verified on the real database (operator row and TestTeam intact, anon holds no EXECUTE, `team_entitlement` still answers anon `200 []`), then merged and pushed - Deploy fired automatically for the first time under the restored posture, and falcon-forge.com is confirmed serving this sprint's code. **The first CI run ever to cover this code went red and was right to**: `onRehydrateStorage` touched `document` unguarded, and because zustand's IndexedDB rehydration is asynchronous it can land after a test file's jsdom environment is torn down - an UNHANDLED error, so the run fails while every test still reports as passing, and a race against teardown, so it is green on a developer machine and red on a two-core runner. It did not reproduce under `CI=true`, `TZ=UTC`, or Linux in Docker; the check-run annotations identified it. Fixed, guarded, and regression-tested. |

| 2026-08-16 | Sprint 8 - Meetings & attendance UI | `v2/sprint-8-meetings` | **Complete.** Gate + `db:verify` + `test:rls` + `test:db` + smoke pack green (lint / 574 unit +2 skips / 91 integration / build / 23 schema assertions / 422 db / 301 rls / 16 e2e). `as any` **56 -> 56**; arbitrary Tailwind values back to the same **2** the repo had before, with this sprint's five tokenised. Built from an 11-screen design handed over by Claude Design, rendered to PNGs and read rather than inferred from markup. **Three of the migration's changes are NARROWINGS of what Sprint 3 shipped**, and each closed a hole no UI would ever have shown: `can_manage_content` is "any approved member", so a STUDENT could create events and set anybody's attendance - replaced on all six write policies by `can_manage_meetings`, which is also **the first capability in the application that distinguishes `mentor` from `student`** (the role has existed since Sprint 3 meaning nothing); attendance SELECT was `is_team_member`, so every student could read every student's record over the API even though the summary is a coach screen, and these are minors' records; and `status` allowed `'late'`, which the design has no state for. **`check_in_with_code` is an RPC rather than a queued write, decided with Kevin at kickoff** - a check-in is a claim about the present moment and an offline client has no credible account of what that is, so queueing it would turn the window, the dead code from last week and "a student cannot check in for a meeting they did not attend" into requests the client is trusted to honour. The offline half of attendance is the coach's roster, which is an ordinary queued write, so the venue with no WiFi is covered by the mechanism that can actually be trusted there - Sprint 6's seat-capacity shape in a different costume. **Every occurrence owns its own four-digit code**, unique per team BY INDEX rather than by intention, drawn from every code the team has ever used (the read path pulls whole tables, so the client's set is genuinely complete). No `event_series` table: `series_id` plus the `recurrence_rule` column Sprint 3 left unused gives all three apply-modes as three WHERE clauses, and editing one occurrence FORKS it so the next "this and all future" cannot reach back into it. The check-in window is **NULL-means-default**, which makes "moving the meeting moves the window unless it was overridden" true by construction instead of via a third column that gets out of step; the client necessarily holds a second copy of that arithmetic (it renders "check-in opens 5:45 PM" offline), so a test reads the intervals back out of the migration file. `meetings` and `meeting_attendance` finally enter the entity registry - a Sprint 3 parking-lot item - which enrols them in realtime as well as the pull and is why both got REPLICA IDENTITY FULL. **Kevin's two UI reports were both worse than reported**: the splash wordmark was not misaligned but on the SAME LINE as the logo (two inline-level boxes, plus a `justify-center` that does nothing to a content-sized flex box), and `.safe-area-bottom` was not missing padding but BEATING the `p-3` beside it from outside Tailwind's utilities layer, computing to 0px on every device without a notch. Both now measured in a real browser by the smoke pack, because jsdom renders the broken and fixed versions identically. **Six defects found by looking or by building the tooling, none by the 574-test suite**: the check-in screen had the same inline-layout bug as the splash; `MeetingWidget` destructured a null outlet context and took the whole dashboard down; a just-created event's code was reported to the student as invalid when the truth was that the create had not drained yet (found because the pack checks in faster than a human can); a cold deep link to an event showed "That event is not on this device" while IndexedDB was still rehydrating; the printable poster - the app's first full-screen ROUTE overlay - painted over `ReAttestationPrompt`, leaving a coach unable to dismiss a legal prompt; and the 420px QR overflowed its frame at 375px. **Two pieces of the tooling were themselves asserting nothing**: `page.goto` between two hash URLs does not reload, so the capture screenshotted the PREVIOUS view (`event-detail` came out as a picture of the summary), and `waitForSync` matched "Live", which is also true in the tick before the queue has registered the write. Verified end to end in the browser as coach, mentor and student: a 13-occurrence series arrived in Postgres as 13 rows with 13 distinct codes; a coach override landed `coach`-attested and a student's scan `qr`-attested BY THEMSELVES; a second scan was refused with `already_recorded` reporting the ORIGINAL timestamp. |

| 2026-08-16 | **Sprint 8 merged, migrated and deployed** | `main` | **Complete.** Order per `deploy.yml`: branch pushed -> CI -> migration to the hosted project -> merge -> deploy. **CI went red on the branch and was right to** - the meetings smoke test set an event's START and left its END at the form's default, which is derived from "the next round hour" and rolls to TOMORROW after 22:00, so with today's date and a 23:00 start it built an event ending twenty-one hours before it began; the form correctly disabled Save and the test waited on a button that was right to refuse. Green in US Central at 18:32, red on a UTC runner at 23:32 - a five-hour window the suite would have walked into on any timezone. Reproduced exactly with `TZ=UTC` while it happened to be 23:35 UTC. The fix reads the times from the BROWSER's clock rather than Node's, because the form composes local wall-clock parts into an instant and the two processes only share a timezone by coincidence; the half-fixed version failed next for exactly that reason. **Migration applied BEFORE the merge**, with schema and data dumps either side: `meetings` and `meeting_attendance` were empty on production (no INSERT block for either in the pre-dump), which is what made the narrowed `status` CHECK safe to apply rather than merely likely to be. Verified on the real database: both tables answer anon `200 []`, anon gets **42501 permission denied** on `check_in_with_code` and `close_meeting_checkin`, the six new functions exist, 13 references to `can_manage_meetings`, the partial unique index on `(team_id, public_code)` is present, and the data dump's row set is identical before and after (operator row, TestTeam, licence and season intact). Full Gate re-run on the merged `main` (lint / 574 unit +2 skips / 91 integration / build / 23 assertions / 422 db / 301 rls / 16 e2e), then pushed; Deploy and CI both green on `244f49c`, and `check:prod` passes read-only against the live site. **The live bundle is NOT byte-identical to the local `dist/`, and that is correct** - the last local build was Playwright's, which pins the LOCAL stack, so the 73-byte delta is the Supabase URL and key. Normalising chunk hashes shows the two are otherwise identical, and the live lazy chunks carry the feature: `MeetingsPage` has "Meetings & Events" and "My schedule", `CheckIn` has `check_in_with_code`, "You're checked in" and the `not_synced` copy added after CI's first red. |

| 2026-08-16 | Sprint 8 follow-up - four gaps found testing with a second person | `main` | **Complete, migrated and deployed.** Kevin tested with a friend, which found things one person on one machine cannot. **The re-attestation prompt on a thirty-second-old account was a HARDCODED VERSION IN A TRIGGER**: `handle_new_user` has written the signup consent as `'1.0'` since Sprint 3, Sprint 6 raised the documents to `'2.0'`, and from that moment every new account was told on its first screen that the documents had changed since it accepted them. `attestations.ts` predicted it exactly, in a comment explaining why the database deliberately does not know the current version - "duplicating it in a trigger would create two sources of truth that drift on the next legal rewrite". One had been duplicated in Sprint 3 and it drifted in Sprint 6. **Sprint 7 fixed the same symptom from a different cause and added a smoke test that passes against a configuration production does not have**: local is `enable_confirmations = false`, so `signUp` returns a session, the client's `recordAttestation` fires and the 2.0 row it writes MASKS the trigger's 1.0; production is `mailer_autoconfirm: false`, so there is no session, no client write, and only the stale row. Confirmed by reading `/auth/v1/settings` on both. The version now travels with the consent in signup metadata, so the client stays the only place a version is written down. **A scan while signed out threw the destination away** - `/app/*` guarded with `<Navigate to="/">`, dropping a student on the marketing page - now routes to the sign-in form carrying `?next=`, with the team picker skipped when there is one team and a destination pending; `readReturnTo` refuses anything that is not a rooted relative path, `//evil.example` included. **The "Preparing your workspace" hang behind it**: `isLoading` was released only inside `ensureUserProfile(...).finally()`, and the 5s safety timeout is cleared the moment `getSession()` resolves - including when it resolves WITH a user, which is exactly when the profile fetch has not started - so the splash was held up by one un-timed-out request with no timeout of its own. Bounded at 8s. **One tap checked a student in from anywhere**: the schedule linked to `/app/checkin/<code>` with the code read out of local data, making the poster decorative and the window meaningless; every student-facing route now arrives with an EMPTY field and the dashboard gains an open-check-ins card that asks for the code rather than skipping it. **Found by a test written for something else: the create-event form was unsaveable every evening after 22:00** - the default end is `start + 2h`, which crosses midnight, while the form has one date field, so "New event" at 22:15 produced a 23:00 start, a 01:00 end, a disabled Save and nothing on screen explaining that the form had done it to itself. Clamped to 23:59. Gate green (lint / 590 unit +2 skips / 91 integration / build / 23 assertions / 427 db / 301 rls / 19 e2e); migration applied to the hosted project before the merge, with the row set identical either side. |

| 2026-08-16 | **Cross-sprint retrospective — guidance, guardrails, and B26** | `v2/retrospective-guardrails` | **Complete.** Not a sprint: a mining pass over all seven sprint reports, the §8 log, and all 34 `fix` commits, asked for because the same defects kept being caught by independent review rather than by the process. Output is `docs/failure-modes.md` (fourteen recurring classes, each with its commits) and `docs/environment-divergences.md` (the ten documented ways the thing under test is not the thing that ships — the item Sprint 8's parking lot asked for). **The finding that reframed it: of the 34 fix commits, 13 were found by running the app, 3 by CI, 2 by reading a diff, 1 by production forensics, and approximately zero by the 592-test suite** — so the suite is a precondition for done, never evidence of it. The most frequent class is not on any prior rule list: **one concept implemented N times, then drifting** (8 sprints, ~18 instances), and *every* dedup pass in this project has uncovered a behavioural defect rather than mere redundancy — now CLAUDE.md principle 9. **ESLint added, deliberately tiny**: six rules, each naming the defect it would have caught, on a repo that had none — `npm run lint` had been `tsc --noEmit` for eight sprints while every rule document called it linting. Its first run found **B26, a live invalid hook call** on `JoinTeam`'s forced age-profile screen: C2's exact shape, fixed in `Onboarding.tsx` in Sprint 1 and never checked for elsewhere, swallowed by the handler's own `catch` and shown to a student as "An unexpected error occurred" with no way forward. Regression test written to the C2 precedent — a mock that is a *real hook* calling `useContext`, because `JoinTeam.test.tsx`'s plain `vi.fn()` **passed against the bug** for eight sprints. **The lint pass also found four slices swallowing queue-write failures**: `createSeason/SubTeam/Task` use `.catch(console.error)`, `createChecklist/MatchPlan/Meeting/Scouting` had drifted to nothing at all, so a rejected write to the queue — which in an offline-first app *is* the data — was silently dropped in 14 places. And enabling the rule surfaced **two mock-drift defects the existing `mock-drift.test.ts` structurally cannot see**, both stubs returning `undefined` where the real API returns a Promise. One keyboard-unreachable row fixed (`SprintArchived`), the fourth instance of a shape Sprint 5.5 fixed in four other places. **The Gate is now one script** (`npm run gate` / `gate:db`); there had been three definitions and CI's was not coupled to the `lint` script. **CI now runs the unit suite at `TZ=UTC` and `TZ=America/Chicago`**, because this project has had timezone defects in both directions and either zone alone hides one. New `src/test/__tests__/harness-invariants.test.ts` holds eight source-level ratchets, including `as any` counted **one agreed way** — three greps had been giving three answers (55/56/57) and Sprint 6 recorded a false increase when privacy-policy prose tripped the metric. Gate green at both timezones (lint / 603 unit +2 skips / 91 integration / build). **The UI fix was verified in a real browser against a build made with the local stack explicitly**, at 1280 and 375: the row summary is a real `<button>` with `tabIndex 0` and `text-align: left` (buttons centre their content, so that class is load-bearing), transparent background and zero border from preflight, Restore a sibling with no overlap at either width, no horizontal scroll, focus lands and activation opens the task. **And that verification nearly lied**: the preview page was service-worker controlled and serving `index-DAle-9hg.js` while the fresh build on disk was `index-iCBpGKv2.js`, so the DOM showed the pre-fix markup and a CSS class renamed sprints ago — Sprint 5's stale-worker defect, on `vite preview` rather than the dev server. Caught by comparing the loaded entry script to `dist/` before trusting a measurement; the check is now written into `docs/environment-divergences.md`. Deferred with numbers rather than silently: `exhaustive-deps` (4 sites, one in the sync engine), `mockReset: true` (39 tests, 3 files), no typecheck at commit time (proved on this branch), and four stale-claim fixes. |

| 2026-08-17 | **Retrospective merged and deployed** | `main` | **Complete.** CI green on the branch first (verify / schema / smoke), which is the point of pushing it — the schema and smoke jobs were the two surfaces the local Gate never touched, and **the new negative-offset timezone step ran the suite in 33s against 34s for UTC**, so it executed rather than silently skipping. `--no-ff` merge (`b7de7bf`), full Gate re-run on the merged `main` (lint / 603 unit +2 skips / 91 integration / build) with identical numbers to the branch, then pushed. No `supabase/` changes, so nothing to order ahead of the deploy — the first merge since Sprint 6 where that was true. CI and Deploy both green; every Deploy step ran including the CNAME check, the sourcemap refusal and the read-only production check. Verified live: falcon-forge.com answers 200, CNAME intact, and the entry bundle matches the local `dist/` — a comparison that means something here only because that build used the ambient (production) env rather than Playwright's local-stack one, which is the §8 parking-lot caveat applied rather than repeated. The shipped lazy chunk `SprintPlanning-D0QSVN1D.js` carries `flex-1 min-w-0 text-left`, the accessibility fix's own class string. |
| 2026-08-17 | **Sprint 9 — Guardian accounts UI** (+ password recovery, folded in at kickoff) | `v2/sprint-9-guardians` | **Complete.** Gate + `db:verify` + `test:db` + `test:rls` green (lint / 624 unit +2 skips / 91 integration / build / schema assertions / 459 db / 319 rls), `npm run capture` at 375/768/1280. **Two fields removed before anything wrote them**: `managed_profiles.birth_year` (§3 — the app never knows anyone's age, so promotion is triggered by a person, never a date) and `guardian_consents.version`'s DEFAULT of `'1.0'`, which was the Sprint 8 follow-up defect pre-assembled in a new table; the column stays NOT NULL, so the regenerated types make an omitted version a **compile error** rather than a silent wrong answer. **Both guardian tables enter the entity registry**, and they are the first entities that are not team-scoped — `pullFromServer` was an unconditional `.eq('team_id', …)`, so the registry now states a `scope` per entity and the field is REQUIRED, because a guardian table added without it would have been filtered on a column it does not have and the pull swallows that into a `console.warn`: an empty children list, indistinguishable from a guardian who has not added a child yet. `guardian_consents` gained `updated_at` rather than an exemption from the delta contract, because the exemption is failure-modes §12 and this project has already paid for that once (B22). **Guardian visibility widened by a THIRD predicate, not by the two that exist**: the parking lot warned that `get_user_team_ids` and `is_team_member` both exclude managed rows and that breaking only one leaves the guardian tests green, so neither was touched; `is_team_guardian` is new and used on exactly three tables. The one-line alternative — make a guardian an `is_team_member` — was tried against the suite and leaks the roster, the invite codes and the team's tasks, which is now an assertion. **A live defect found while reading that policy**: `current_team_member_id` is `LIMIT 1` with no `ORDER BY` and does not exclude managed rows, so a guardian with two children on one team reached an arbitrary one's attendance, differently between runs — failure-modes §13, and siblings are supported by design. **`coppa_responsibility` finally has a writer**: it has been in `AttestationType` and the database CHECK since Sprint 3 with none, which is §7 and the same shape that left `SIGNUP_REQUIRED_ATTESTATIONS` checked by one component and written by nothing for four sprints. It is recorded BEFORE the approval, so a failed attestation write means no rostered child. **Promotion graduates in place and it is asserted, not eyeballed**: the `team_members` row keeps its id, both attendance rows survive, and `status`/`seat_assigned`/`joined_at` are compared against what was there BEFORE rather than against literals — the first draft asserted `seat_assigned: true` and failed against a fixture that never assigned one, an assertion about the fixture wearing the costume of an assertion about behaviour. Watched failing against a create-and-remove implementation. §3 does not say how the child's account comes to exist; a **two-party claim code** was chosen with Kevin at kickoff over an email lookup, which would have made the RPC an account-enumeration oracle and had the guardian asserting the child's identity rather than the child. The code is a credential, so the client may read it and may not set it — RLS cannot express a column, so table-level INSERT/UPDATE is revoked and re-granted per column, which needed `schema_assertions.sql` to ask `has_any_column_privilege`. **The first grant list was too narrow and every policy test passed over it**, because they issue plain UPDATEs and the app upserts: `ON CONFLICT DO UPDATE` needs UPDATE on every column sent, and `guardian-sync.db.test.ts` caught it with three items stranded in the queue. **Password recovery fixed end to end, and the obvious fix is broken**: `${origin}/#/auth/reset-password` is what anyone would write, and it silently discards the token — the implicit grant appends its own fragment, a URL has one, and supabase-js then parses the key as `/auth/reset-password#access_token`. Checked against `parseParametersFromURL` rather than assumed, then proved against a real GoTrue and a real email out of Mailpit: the link now lands on `/` with the token intact, which is also the first time the local stack has run that flow at all. **Five defects found in the browser and none by the 624-test suite**, all of them the same shape — a guardian is the first account type that routinely has NO team of its own, and nothing had ever been asked to survive that: Onboarding offered a team the account is not a member of (the query was right; `setTeams` was only called when the result was non-empty, so a stale persisted list stayed on screen); a stale `currentTeamId` pointed `fetchTeamData` at that team and its pull REPLACED the guardian's meetings with an empty result — "Nothing scheduled yet" for a child with a full schedule, both requests visible in the network log with the wrong one landing second; `/app/guardian` bounced to the team picker one second after arriving; the rail offered Dashboard, Scouting and Match Planner to a parent who would have got an empty screen from each, which is §3's "never renders the team as the child" reached by accident; and the children list reordered under the click after every action, because the pull has no `ORDER BY` (§13 again). **Fixed at review after the first pass**: `current_team_member_id` did not exclude managed rows
and `check_in_with_code` resolves the caller with it, so **a guardian who scanned a QR poster
checked their child in** — §3's act-as mode reached by accident, and attendance self-attested by
the one person `attested_by` exists to distinguish from. The first attempt at that migration
rewrote the RPC from memory and was worse than the bug (different `reason` codes the client
branches on, the deadline guard dropped, the race-safe `ON CONFLICT DO NOTHING` replaced by a
check-then-insert); caught by diffing against the original before applying, and the shipped
version is the original text with one branch inserted. Verified end to end in a real browser as
guardian and as admin: add-child wrote profile + four consents at the versions displayed through queue → drain → Postgres, the COPPA checkbox gated approval with its reason on the control and recorded the attestation, and the two ordinary pending requests were untouched — the coach's flow is unchanged, as §3 requires. |
| 2026-08-17 | **Sprint 9 merged, migrated and deployed** | `main` | **Complete.** Order per `deploy.yml`: branch pushed -> CI green -> migrations to the hosted project -> merge -> deploy. Dumps taken either side; **row set identical across all 17 tables**, `auth` included. Safety established against the real production dump rather than assumed: `managed_profiles` and `guardian_consents` had NO INSERT block at all (genuinely empty), `meeting_attendance` likewise — so dropping `birth_year`, dropping the `version` DEFAULT, adding `updated_at NOT NULL`, and narrowing `current_team_member_id` were all free — and **production's `check_in_with_code` was byte-identical to the Sprint 8 migration text the Sprint 9 migration rebuilds from**, ignoring pg_dump's line-wrapping, so `CREATE OR REPLACE` reverted nothing. That was the one check worth doing by hand: an earlier draft of that migration had rewritten the function from memory and got it badly wrong (different `reason` codes the client branches on, the deadline guard dropped, the race-safe `ON CONFLICT DO NOTHING` replaced by a check-then-insert), caught by diffing before applying. **VERIFYING THE MIGRATION AGAINST PRODUCTION FOUND A DEFECT THE GATE WAS GREEN OVER**: all four guardian RPCs answered `anon` with 200. `20260822000200` ended with `REVOKE ALL ... FROM PUBLIC`, which is the careful-looking half of the incantation and does nothing alone — `20260816000500_v2_grants.sql` sets `ALTER DEFAULT PRIVILEGES ... TO anon`, so every new function arrives with its own acl entry independent of PUBLIC's, and `20260819000000_revoke_anon_execute.sql` states this in its header and revokes `FROM PUBLIC, anon`. The header was read and cited, and half the fix was written. Not exploitable — each is SECURITY DEFINER and asks who the caller is on its first executable line, so production returned refusal bodies rather than data — but the missing layer is the one that exists *because* "the guard is code, and code is what was wrong the first time" (B25). Fixed in `20260822000400`, applied before the merge, and **schema assertion 23 now enumerates every SECURITY DEFINER function `anon` can EXECUTE and fails on anything outside a named allowlist** — the property `20260819000000` claimed in prose and nothing enforced, which is exactly how four functions joined the set silently. The refusal itself stays behavioural, because environment-divergences §5 is that a catalogue assertion once approved a REVOKE that was a no-op. `is_team_guardian` and `guardian_member_ids` deliberately keep their grant (they run inside the `teams`/`meetings`/`meeting_attendance` SELECT policies as the calling role, and revoking them turns every anonymous SELECT into "permission denied" instead of `200 []`); that negative space is asserted too. **Re-verified on the live database after the second migration**: all four RPCs now `401 / 42501`, both predicates still reachable, and `teams`, `meetings`, `meeting_attendance`, `managed_profiles` and `guardian_consents` all answer anon `200 []`. Full Gate re-run on merged `main` with numbers identical to the branch (lint / 624 unit +2 skips / 91 integration / build / schema assertions / 459 db / 319 rls), then pushed; CI and Deploy both green on `b20e159`, `check:prod` passes read-only. **The shipped bundle carries the feature**: `GuardianView-DremLsG3.js` plus the entry chunk contain `claim_managed_profile`, `offer_managed_profile_promotion`, `join_team_with_invite_for_child`, `coppa_responsibility`, the guardian consent copy and the `auth/reset-password` route — so the deploy is the code, not a stale build. |

| 2026-08-18 | **Beta prep — landing page, the 404, the support address, and in-app help** | `v2/beta-prep` | **Complete, unmerged.** Not a sprint: the cheap half of the pre-beta list, chosen with Kevin from a decision table after a review of what beta actually needs. Gate green on each commit (lint / 626 unit +2 skips / 91 integration / build); `supabase/` untouched, so no migration and no `db:verify`. **Meetings finally exists on the landing page** — Sprint 8's feature, and the most differentiating one, had never been mentioned to a visiting coach. A fifth deep-dive section in the existing vocabulary (QR poster with a scan line, the session's own code, a roster filling in as students arrive), plus grid cards for Meetings and Seasons; the grid goes 4 columns → 3 because five cards in a four-column row leaves an orphan. **Three defects in that one canvas, all found in a browser and none by the suite**, which is failure-modes' headline holding for the ninth time: it clipped its own content at 375 *and* at 768 (every other canvas is `aspect-square md:aspect-video`, and this one needs ~480px — a 375 square is ~343, a 768 16:9 is ~432 — so the poster went under the window chrome and the fourth row vanished, with `overflow-hidden` hiding the evidence); every roster row below the first rendered "Expected" and "Present" stacked, because **during an `animation-delay` an element renders its NORMAL styles rather than the 0% keyframe** and both default to opacity 1, so the stagger that makes the animation legible was also what broke it (`animation-fill-mode: backwards`; the checklist section dodges the same trap with a base `opacity-0` class that never says why); and the two labels crossfaded over one window, leaving "Expected" legible through the pill. **The arbitrary-value ratchet caught principle 9 in miniature** — `tracking-[0.2em]` was written for the check-in code when `tracking-code` already existed, added for exactly that string. **A `404.html` that lands the link, not just the app**: serving `index.html` there boots the app at `/app/board` with no hash, so the router sees `/` and discards the destination; this translates the path into the hash route, and deliberately refuses two cases (a URL that already has a hash — the recovery token lives in a fragment and rewriting fragments is the Sprint 9 bug — and anything with a file extension, which is a missing asset rather than a route). Exercised against the built file the way Pages serves it, which `vite preview` structurally cannot show, since it answers unknown paths with `index.html` and would have made an inert file look correct. **`FEEDBACK_EMAIL` is now `support@falcon-forge.com`** — it is compiled into a bundle installed as a PWA, so whatever ships first is what people keep writing to; the alias must forward before this deploys, because a domain that accepts and drops mail fails silently rather than bouncing. **A Getting started page carrying no `requiresTeam`**, which is the only real decision in it: the two people most likely to need instructions are a coach with no team yet and a guardian who will never have one. That turned Sprint 9's `toEqual(['guardian'])` red, which is the guard working; updated to the new exact list rather than loosened to a `not.toContain`, plus a second test stating the property the literal stands for. **Two verification steps caught lying about themselves**: a build failure was masked by piping to `tail` (the pipeline's status is `tail`'s, so a capture ran against a stale `dist/` and reported three clean widths), and the light-mode pass set Playwright's `colorScheme` and screenshotted six dark pages, because the theme is a class the store applies from localStorage. **`docs/beta-ops.md` gains a transactional-email runbook** — the free tier's built-in SMTP is ~2/hour and the hosted project has confirmations on, so a coach onboarding fifteen students in one evening silently loses most of them. **Outstanding from this branch:** the SMTP move itself (Kevin's, DNS + dashboard), the `support@` alias, and an in-shell browser pass of the help page — Docker was down, so it was rendered through a temporary preview route instead of inside `AppShell`. |

| 2026-08-18 | **Operator console — the directory, the detail view, and revoke** | `v2/operator-console` | **Complete except the deletion tooling, unmerged.** `gate:db` green (lint / 637 unit +2 skips / 91 integration / build / schema assertions / 478 db / 323 rls). The console shipped in Sprint 6 able to gift and to rescue a stranded team, and **neither was usable**: `team_entitlement` is `security_invoker` and no policy anywhere mentions `is_platform_operator()`, so the operator's team list showed the operator's OWN teams, and both controls wanted a uuid typed by hand — including a `team_members.id` there was no way to obtain. Three RPCs and **no table changes**: `license_grants.revoked_at` and `operator_actions.action`'s `'license_revoke'` have been in the schema since Sprint 3/6 with nothing that could write them, which is failure-modes §7, and this is the writer. **RPCs rather than widening the policy, and that is a trap that only appeared last week**: `teams` became a registry entity with `scope: 'rls'` in the previous change, so the pull issues `select('*')` with no predicate — widening `teams_select_member` with `OR is_platform_operator()` would silently widen a BACKGROUND SYNC and cache every team on the platform into an operator's IndexedDB. **The line not crossed is team content**, asserted: the detail payload carries no tasks, scouting or match plans, so moving that line later is a visible change rather than a widened SELECT. **Revoking is by grant with an explicit `p_all`**, because grants accumulate (trial + gift) and the ambiguous version of a destructive action is the one that quietly does half the job and leaves the team writing; `p_all` is asserted to leave `team_can_write` false. **Three defects found by running it and none by the suite**: a lapsed team read **"4 of 0 seats"** — Sprint 6's exact defect, whose fix is *documented in a comment in `EntitlementPanel`*, reintroduced the moment the same fact got a second renderer (principle 9 again, caught by looking at Lapsed Legends); `revokeNotes` was read by the revoke call and written by nothing, so every revocation would have recorded a blank reason; and the seeder gave every team `team_number: '9000'`, so a directory that searches by number could not be reviewed by eye. **The refusal was watched failing** against a copy of the function with the operator gate removed — a team's own admin read the whole platform directory. Driven end to end in a browser: search by number finds the team, the successor dropdown is populated from the roster and offers no managed profile, no pending member and not the sitting admin, and revoking flips the row to Read-only with the audit row written. **Outstanding: the account/data deletion tooling**, which needs a decision — `operator_actions.team_id` is NOT NULL and its `action` CHECK has no erasure value, so recording one needs a loosening migration; and `public.users` cannot be hard-deleted at all (`teams.owner_id` and `invites.created_by` are NO ACTION), so the shape is anonymise-plus-remove-memberships, which is exactly what the Privacy Policy already describes. |

| 2026-08-22 | **Auth email templates — the six transactional emails, branded** | `main` | **Complete.** Not a sprint: the templates half of §6's unscheduled "Auth email branding" item, done on its own now that SMTP is live. Six HTML files in `supabase/templates/` (confirm signup, reset password, change email, invite, magic link, reauthentication), pasted into the Supabase dashboard by Kevin; runbook in `docs/auth-email-templates.md`. Gate green (lint / 659 unit +2 skips / 91 integration / build); no application code changed. **The plan's stated approach was overruled on evidence, twice.** Its `{{ .TokenHash }}` rationale — "the default returns tokens in the URL *fragment*, which is exactly where HashRouter keeps its route" — was written 2026-08-16 and **Sprint 9 voided it**: `authRedirectUrl()` returns the origin root, the fragment survives, so `{{ .ConfirmationURL }}` works today with zero app code. The reason to want `TokenHash` that survives is link scanners prefetching one-time tokens, which needs a `verifyOtp` route that does not exist. And "repo files wired through `[auth.email.template.*]`, never pasted into the dashboard" cannot work for the hosted project: those blocks configure the local stack only, so the dashboard is the live copy and the drift is documented rather than denied. **Three of the six are not sent by the app** — invite (dashboard button; the real path is `/join/:code`), magic link (`signInWithOtp` is never called) and reauthentication (`secure_password_change` is off) — written anyway, because the alternative to a branded unused template is Supabase's unbranded default going out the first time someone uses the feature. Verified by rendering all six at 375 px and measuring rather than eyeballing: no horizontal overflow, button 173×46 (clears the 44 px tap target), long fallback URLs wrap. **That verification was nearly worthless twice**: the file:// preview renders as a static snapshot with no compositing, and once served over http the built service worker's navigation fallback answered every request with `index.html` — the measured DOM was the app, not the template, and `location.href` reported the right URL throughout. Caught by checking `document.title` before trusting a measurement; same class as the retrospective's stale-worker incident, now on a third surface. What the Gate cannot cover and Kevin still has to do: the send round trip (`docs/beta-ops.md` step 8) and the OTP-expiry copy check. |

| 2026-08-22 | **The age a person can correct, and the signup path nothing had ever run** | `v2/age-classification-writer` | **Complete, unmerged.** Two items off the pre-beta list, chosen with Kevin. `gate:db` green (lint / 670 unit +2 skips / 91 integration / build / schema assertions / 478 db / 323 rls) and the smoke pack 20/20 on two consecutive runs. **`users.age_classification` finally has a writer** — "I've turned 18" on the profile screen, recording the `age_18_plus` attestation (in `AttestationType` and the database CHECK since Sprint 3 with nothing that could write it, the second §7 fact closed after `coppa_responsibility`) BEFORE the column moves, so a raised column with no record of who claimed it is refused. It raises only, and only from `13_to_17`; both refusals were watched failing with the gate removed, because they pass vacuously otherwise. **Building it found B27, and B27 is why the column could never have been changed at all**: `ensureUserProfile` upserted `age_classification` from `user_metadata` with `ignoreDuplicates: false`, so every boot UPDATEd it back to whatever was asserted at signup — under a comment claiming the opposite ("won't overwrite existing") that had been there since Sprint 1. Found by running the app: the write landed in Postgres, the reload put `13_to_17` back, no error anywhere. The regression test asserts on the WRITE rather than the state, because the read-back returns the same stubbed row either way and a state assertion passes against the bug. The first fix ran the NULL backfill before `setState` and an existing test caught what that costs — a throw there abandoned the profile sync and left a signed-in user on the forced age screen. **`enable_confirmations` is now `true` locally**, matching a hosted project that has always had it on: 670 unit, 91 integration, 16 e2e flows and the venue simulation had all been green over a signup path that does not exist in production, and it is the one flow every beta team runs exactly once. `registration.spec.ts` now walks the whole round trip — form, message out of Mailpit, link — and the other fifteen flows take a pre-confirmed account through the admin API; the pack still runs in 37s. The new test asserts the gap itself (submitting the form leaves NO session) and **its first version passed against auto-confirm for the wrong reason** — a signed-in account with no team also lands on `#/`, which the URL pattern accepted; it reads the stored session now, and was watched failing with the flag flipped back. Two things found by running it: the admin-API helper first omitted `privacy_version` and eleven specs timed out behind the "We've updated our legal documents" modal — migration `20260821000000`'s exact symptom from a third direction — and `ATTESTATION_VERSIONS` moved to its own module rather than being copied into the e2e pack, because a second copy of that number is the defect the migration exists because of. **Also written, executed nothing: `docs/cloudflare-migration-plan.md` + `HANDOFF_CLOUDFLARE.md`**, at Kevin's request, before any of it starts. Its finding: the move is hosting-only (HashRouter stays, so printed posters stay valid), but Pages cannot serve an apex domain from third-party DNS and GoDaddy has no apex CNAME — so it forces a nameserver move, which means re-creating the Resend MX, SPF, DKIM and DMARC that only started working today and that fail silently. DNS and hosting therefore change on different days. |
| 2026-08-24 | Sprint 10 — Package A "tenant safety" (SEC-01, 02, 05, 09, 10, 03, 06, 08) | `v2/sprint-10-tenant-safety` | **Complete, unmerged.** `gate:db` green (lint / 678 unit +2 skips / 91 integration / build / schema assertions / 517 db / 343 rls) and the e2e pack 20/20. Six forward migrations, one per ID that needed one. **Every one of the eight was reproduced over PostgREST as the real role before the fix and proved closed the same way after**, both outputs in `docs/sprint-10-report.md`. **SEC-01 was a three-request takeover**: `can_manage_roster` is admin OR coach with no column restriction, so a coach demoted the admin (200), promoted themselves (200) and got `can_manage_billing` true — or DELETEd the admin row and stranded the team. Closed by a BEFORE trigger with a transaction-local flag the four transfer RPCs raise; all four verified end to end afterwards, and the trigger's NAME is load-bearing (BEFORE triggers fire alphabetically, so authority is answered before eligibility — assertion 24 fails if that is lost). It exempts non-API session roles, because `team_members` cascades from `users` and a JWT-only guard would have made a team's admin undeletable. **SEC-02's plan line said RESOLVED for two days while the correction still reverted on the next login** — `handle_new_user` re-applied frozen signup metadata on every `auth.users` UPDATE; the fix direction's wording for `full_name` would have deleted the rename path, so the rule is "re-apply a metadata field only when THAT FIELD changed" and the four controls that catch the shortest reading are green in the red run. **SEC-05: a 13-year-old could read another family's child's "Peanut allergy - epipen in bag" and their promotion code**; the policy is dropped rather than narrowed (column grants are per role, and the surface had no reader) so `select=id,full_name` now returns `[]` — the one exit criterion not met as written, with the roster's own naming path asserted beside it. **SEC-03: the plan and the runbook both said the app never deletes a member and both handlers called `.delete()`** — 9 attendance rows to 0 on the delete that worked, `23502` on the one that did not; verified in the built bundle (seats 15/15 → 14/15, task and 9 attendance rows kept). **SEC-06 closed three oracles and left two, with the numbers**; `200 []` measured on all 18 tables before and after rather than assumed. SEC-09's lifetime is now one number (the column DEFAULT) and the screen names the hour, found by running it. SEC-10 closed a third door the finding did not name (`PATCH /rest/v1/users`). `as any` unchanged at 56; three new schema assertions, each watched failing; seven parking-lot entries including a review seed that puts a legal modal on the first screen of every account. |

| 2026-08-24 | Sprint 11 — Package B "the read path" (SYNC-01+03, SYNC-02, SYNC-05, SYNC-15) | `v2/sprint-11-read-path` | **Complete, unmerged.** Gate green (lint / 695 unit +2 skips / 95 integration / build) and `test:db` 526/526; `supabase/` untouched, so no migration. **A pull could return less than the truth four different ways, and a full pull REPLACES the collection, so each one deleted rows from the device.** SYNC-01: PostgREST caps a response at 1,000 rows and says nothing — `error` null, array short — so rows 1,001+ were deleted and `newestUpdatedAt` then advanced the cursor past records that had never arrived. Now paged, keyset on `(updated_at, id)` rather than `.range()` (an offset window over a table somebody is writing to skips the row that slides across the boundary), applied to the store ONCE after the last page; a page that errors abandons the table with the store and the cursor untouched. Proved against a real PostgREST at 1,001 and 2,500 rows. **`max_rows` was not raised** — the trap says it moves the cliff, and it does. SYNC-03: **measured, not estimated** — a mid-season team with a prior season cost **863.8 KB per app open** (gzip 63.4), close to the assessment's 0.7 MB guess and *wrong*, because attendance truncated. Season-scoped pulls, `field_image_data` off the season select, delta-on-mount and delta page hooks bring a **warm open to 13.8 KB (gzip 3.0) — 98.4% off**; a cold first-ever open is 637.8 KB (−26.2%), and that is the honest shape of it: the criterion's ≥60% is met by the open that happens six times a day, not by the one that happens once per install. `meeting_attendance` has no `season_id` and reaches its season through `meetings!inner()` with an EMPTY embed spec, which filters without adding a byte. SYNC-02: the pull refuses to run at all without an `authenticated` token — the anon fallback answered `200 []` on every table, which this read path treats as "deleted elsewhere"; the PUSH keeps the fallback, because a 42501 the classifier understands is a request that fails loudly. SYNC-15: a collection only ever holds the pulled team's rows now, on the delta path too, which is what makes delta-on-open safe; another SEASON's rows are the opposite rule and are kept. SYNC-05: sign-out reads the queue and the dead letters and asks before destroying them, in `performSignOut` so all three sign-out buttons obey it. **Every red test was watched red with its fix reverted**, per ID, and two defects were found by running the built bundle at 375 px that no test had asked about: "Sync, then sign out" could not touch a parked change and re-asked the same question with the same button, and the copy said "1 change hasn't reached the server. Signing out deletes them". `as any` unchanged at 56; six parking-lot entries. |

| 2026-08-24 | Sprint 12 — Package C "day-one UI bugs" (FEAT-01, FEAT-02, FEAT-05, FEAT-12, WALK-A-07, WALK-B-01, WALK-B-02, SYNC-07) | `v2/sprint-12-day-one-ui` | **Complete, merged to `main`.** Gate green (lint / 772 unit +2 skips / 95 integration / build) and the e2e pack **21/21**, including a new offline COLD-BOOT spec neither existing offline test performed. `supabase/` untouched. **All eight verified in the built bundle at 375 px**, against the local stack, with the worker cleared and the loaded script compared to `dist/index.html` each time. **FEAT-01**: `TimelineEvent.authorId` is documented and read as a TeamMember id and the writer stored the AUTH USER id, so every comment anybody else left rendered as "Guest" — invisible because the reader short-circuits on `profile.id`, so the author always saw their own name. Confirmed end to end by signing in as a second member and reading the first one's comment. The reader also matches `userId` (with `!managedProfileId`, or a guardian's comment is attributed to their child) because every comment written before today carries the old value. **FEAT-02**: an archived season offered Save, Delete, Archive, a comment box and Restore; each ran, the store `console.warn`ed, and `saveTask` closed the modal anyway. The modal body is a `fieldset[disabled]` rather than eight `disabled` props, so the ninth field is covered too; measured at 375 px with no horizontal overflow. **FEAT-05**: Load → edit → Save produced a SECOND "Match 3" — `updateMatchPlan` had existed since Sprint 4 with no caller outside its own test (§7). `match_plans.match_number` gets its first input; blank stays `undefined`, never 0 (B18). **FEAT-12** (no exit-criteria block; DoD written by the agent): four renderers read a UTC-midnight due date with LOCAL parts, so every US team saw the 14th for a task due the 15th, and `overdue` compared local midnight to UTC midnight. One `date-only.ts`; 12 assertions across five zones from −8 to +14, one of which asserts the bug itself so the fix cannot become unnecessary silently. **WALK-A-07**: "Later" was a `useState` flag — the walkthrough met the modal 60+ times in one run. Now a week's snooze keyed by user AND by the versions dismissed; watched surviving three consecutive reloads in the browser, and it never renders on `/app/checkin/*`. **WALK-B-01/02**: the no-team redirect asked "is this `/app/guardian`?" instead of "does this route need a team?", so a guardian following their own sidebar's "Edit Profile" landed on the Welcome screen; and a guardian with children was greeted as a brand-new user on every sign-in, under a comment promising a `GuardianOnly` component that `grep` says never existed (§7). The redirect reads `AppView.requiresTeam` now. **SYNC-07**: everything hung off `navigator.onLine`. The label never says a bare "Synced" again — it carries the age, or "Can't reach server", or "Not synced yet". **Its own fix reintroduced the defect once**: postgrest-js RESOLVES with an error object when `fetch` fails and sets `code: ''`, so the first version recorded a dead network as a healthy conversation; caught by stopping the API gateway and watching the label go on saying "Synced · just now". Every red test watched red per ID. `as any` unchanged at 56; five parking-lot entries. |

| 2026-08-23 | Sprint 13 — Package D "beta logistics" (OPS-03, OPS-05 feedback half, OPS-06, LAND-01/02/03, OPS-11, §9.2 corrections) | `v2/sprint-13-beta-logistics` | **Complete except two items that are Kevin's, merged to `main`.** Gate green (lint / 791 unit +2 skips / 95 integration / build); `supabase/` untouched. **OPS-03**: every deploy carried `0.1.0` — a package version unchanged since January, eighteen production deploys, under a comment claiming the id attached a report to a version. `vite.config.ts` compiles `GITHUB_SHA` in; a local build says `local` rather than inventing something version-shaped. `check-production.mjs` asserts the served bundle carries the expected SHA, which retires the hand-run chunk-hash diff that environment-divergences §8 records as unreliable in both directions. Verified end to end: building with `GITHUB_SHA` set puts the short SHA in `dist/assets/index-*.js`. **OPS-05 (feedback half)**: the mailto carried the reporter's prose and nothing else; it now carries build, route, whether the DEVICE thought it was online, whether the SERVER was answering (two different questions — SYNC-07 exists because they were conflated), the queued/parked counts and the team id. A hook rather than a module constant, because all of those are facts about NOW and an installed PWA is not reloaded on a schedule. Asserted ABSENT: member names, task content, any address but the recipient — a support inbox is not where minors' data should arrive by accident — and the body tells the reporter what it is attaching. **OPS-06**: Resend Free is 100/day and a 20-member team costs ~23, so four teams onboarding on one evening exhausts it; both ceiling errors arrived as a bare GoTrue sentence ("Error sending confirmation email") that reads exactly like a rejected address, in front of twenty students. Mapped to copy that says it is our limit and when to come back; everything unrecognised passes through unchanged, so an upstream rewording costs nothing. **LAND-01/02/03**: the page had **zero `<a>` elements** — Terms, Privacy and Acceptable use existed as routes and were unreachable from the one page a district privacy officer looks at. Real footer, trademark disclaimer, and the two hero CTAs became links (they navigate to routes; a `<button onClick>` cannot be middle-clicked, opened in a tab, or counted). The program is named above the fold. **All eight LAND-03 overclaims removed** — and the honest copy is more differentiating than the invented analytics were. Four source-level ratchets hold it, including one whose failure message says that a phrase since BUILT should be deleted from the list in the same commit. Verified in the built bundle at 375 px: 6 anchors, three legal routes rendering their real headings, zero overclaims, no horizontal overflow. **OPS-11**: six false README claims, three of which a fresh clone hits in ten minutes — no demo mode exists, Node 18 fails at install, `db push` has not worked since the Sprint 2 squash, the OAuth section configured providers nothing calls, and two counts were wrong. Quick Start rewritten around the local Docker stack; `engines` + `.nvmrc`; `.env.example` points at the local stack and says why `.env.local` is production; `tsconfig` stops including two directories that do not exist. **The MIT licence claim is corrected rather than satisfied** — no `LICENSE` file has ever existed, and MIT on a product intended to be paid would let anyone run a competing instance. README joins the ratchet that every documented `npm run` script must exist. **Not done, and why:** Resend Pro or a staggered onboarding schedule is an account change (Kevin's); the beta-ops trigger text waits on **D7**; the licence waits on Kevin. Four parking-lot entries. |

| 2026-08-23 | Sprint 14 — Package G "observability and ops" (OPS-01, OPS-02, OPS-04 classification, OPS-05 uptime, OPS-09, OPS-10, OPS-13, SYNC-08, SYNC-11, SYNC-16) | `v2/sprint-14-observability` | **Complete except two account signups that are Kevin's, merged to `main`.** Gate green (lint / 805 unit +2 skipped / 95 integration / build), `test:db` 526/526, e2e **31/31 across two projects**. **OPS-02**: seven tests asserted nothing and a dozen more put the action behind an `if`. Every one was hunting for a control that does not match what it looked for — "add" or ANY `svg` child, `[class*="trash"]`, `[data-testid="reset"]` when the id is `reset-checklist` — and doing all its work inside the guard. Rewritten to click by test id and assert what follows; **one was deleted rather than rewritten**, because it would have been a fourth copy of something that file already tests three times. Two `expect(x).toBeDefined()` calls found and replaced: that matcher passes for `null`. A ratchet now requires zero assertion-free bodies, **and a second test asserts the extractor finds >500 tests** — a scan that matches nothing reports perfect health, which is the exact failure it exists to catch. **OPS-01**: thresholds set in Sprint 5 and enforced by nothing, so nine sprints of files landed underneath them; measured **66.6/60.41/63.08/68.34** against 72/67/69/74. Kept and lowered to the measurement rather than deleted — a floor at today's number is a ratchet that starts working now; a deleted floor is nothing. `test:coverage` runs in CI's `schema` job, the only one with the stack the db suite needs. **OPS-13**: the board, the planner and password reset had no browser coverage at all, and the pack had one viewport in it. A `mobile` project (iPhone 13 metrics, pinned to Chromium because CI installs chromium only — §10 stays as true as it was) plus three specs, each ending in a reload because a card that only existed in Zustand dies there. **Adding the project surfaced a failure and the fix was not the obvious one**: it reproduced in ISOLATION under `--repeat-each=4`, so it was never contention — the toggle-knob test waited for the transition after its click but not before its first measurement. Fixed in the test; workers stay 4/2; three consecutive full-pack runs green. **SYNC-08**: nothing had ever called `navigator.storage.persist()`, so the queue and the whole offline copy were evictable — and the symptom is an empty queue, indistinguishable from having synced. Requested after sign-in (it is a permission), `persisted()` checked first so a browser is not asked twice, `null` for "could not ask" rather than `false`. The half no code can fix — Safari's 7-day rule — is now told to the person on Getting started, with the gesture that fixes it. **OPS-09/SYNC-11**: `beta-ops.md` had documented a dump one-liner since Sprint 7 and `grep 'db dump' .github/workflows` found only the document. Nightly encrypted backup workflow, plaintext shredded before upload, 30-day retention, **fails rather than uploading** when a secret is missing or the dump is under 50 KB — that size is "connected, authenticated, read nothing", which otherwise looks like a backup for a month. **Rehearsing it found two defects that reading could not, and they are the most valuable thing in the sprint.** (a) `supabase db dump` with no flag is SCHEMA ONLY: 137,067 bytes, zero data statements — and it PASSES a 50 KB size gate, so the job would have gone green nightly and the artifact would have restored an empty database. The hand-written one-liner this repo has told Kevin to run before every migration since Sprint 7 has the same defect and has never contained one row of anyone's data. Two dumps now, gate moved to the DATA half. (b) The restore reports success and loses five tables: the data dump opens with `SET session_replication_role = replica` and **the `postgres` role on Supabase is not a superuser** (`usesuper` = f), so psql prints one permission-denied line among hundreds, runs the load with every app trigger live, and **exits 0** — teams 32, seasons 32, `team_members` **0**, `tasks` **0**, `meetings` **0**, `meeting_attendance` **0**, `scouting_reports` **0**. Fixed with `ALTER TABLE ... DISABLE TRIGGER USER` around the load, which the owner IS allowed to do; rehearsed with it: 32/64/7/20/126/4 and 67 auth users, zero errors. A third fell out of the write-up — `beta-ops.md` had TWO "Restoring" sections and the Sprint 7 one was a bare `psql -f` with none of this, the **seventh** dedup pass in this project to surface a live defect. **OPS-10**: `deploy.yml` spelled the Gate out a fourth time and called `tsc` directly, so Sprint 9 adding ESLint to `lint` never reached the deploy; it runs `npm run gate` now. **OPS-04 classification**: `PGRST204`/`42703` were retried for nine minutes and parked with a raw error while the fix (reload) was one the coach could do immediately — terminal with a reason now. **23502 deliberately NOT included** though the finding asks for it: an unknown COLUMN can only be a version disagreement, a missing VALUE cannot, and this file's data-preserving rule is what B19 leans on. **OPS-05**: the feedback body carries build, route, device-online AND server-reachable (two questions — SYNC-07 exists because they were conflated), queue depth and team id, with member names and task content asserted ABSENT. **SYNC-16**: the cold-boot spec now proves the DATA came back, not just the shell. **Outstanding, both Kevin's:** the two backup secrets, and an UptimeRobot/BetterStack signup — the URLs and the reasoning are in `beta-ops.md`. Five parking-lot entries. |

| 2026-08-23 | Sprint 19 — WALK-A-08/09/10/11, the accessibility set | `v2/sprint-19-accessibility` | **Complete.** `gate:db` green (lint / 1021 unit +2 skipped / 95 integration / build / schema assertions / 626 db / 418 rls). One forward migration; no type regeneration needed (CHECK constraints add no columns). Two new browser probes, `probe-accessibility.mjs` (axe-core wcag2a+aa, 12 checks) and `probe-long-titles.mjs` (8 checks), both green against a freshly reset and reseeded stack. None of the four IDs has an exit-criteria block, so this sprint **wrote its own definitions of done** and states them in `docs/sprint-19-report.md`. **The finding worth reading first: 64 of WALK-A-10's 123 sub-32px controls were a measurement artefact.** `touch-target` is gated on `@media (pointer: coarse)`, and a desktop Chromium resized to 375px matches `fine` — so the walkthrough (and this probe's first run) measured a media query that was switched off. The four sidebar controls the finding names by number were already correct on a real phone. `docs/failure-modes.md` §11, invisible in both directions: both runs produce a plausible list of small boxes, and had the fix landed without noticing, the probe would have reported *no change* and the obvious next move is an ungated rule that wrecks the desktop. **WALK-A-08**: focus/trap/Escape live once in `Modal.tsx` for fifteen call sites; two modals deliberately take no `onClose` and keep the trap without dismissing. Its own test caught a real error — capture-phase + `stopPropagation` does **not** order two listeners on the same node (`document`), so one Escape closed a stacked confirm *and* the form under it; a module-level stack answers "am I innermost?" explicitly. No backdrop dismiss: most modals here are forms, and a mis-click beside the scouting dialog would discard a report a scout just typed. **WALK-A-09**: 24 contrast nodes and 15 nameless controls → **zero**, across nine scans including the task modal, which the walkthrough explicitly could not reach. Both name bugs have the same shape — `aria-label={showLabel ? undefined : label}` looked like the careful choice (don't repeat a name the user can see) and left the switch with no accessible name at all, because the visible text is a *sibling* span; and `text-slate-400 dark:text-slate-500` looked careful (dimmer text on a dimmer ground) and inverts the requirement. New ratchet at zero: slate-500 measures 3.07/2.52/2.18:1 on the three dark grounds this app uses, so it needs no knowledge of the ground to judge. The probe also found a defect nothing else had — Sprint 18's new-event date input has no label and a `type=date` has no placeholder to fall back on; the Gate was green for it twice. **WALK-A-10**: 123 → 59 → 15 → **0**, via one element-selector min-height rule (not the class-substring rule index.css removed, and not min-*width*, which is what squashed the board's row actions). Two defects introduced and caught by *looking*: the floor stretched the toggle's track to 32px leaving its knob adrift (hit area and track are separate boxes now — 36×32 and 36×20, both asserted), and a 32×32 native checkbox dwarfed its 12px label while answering a question nobody asked, since every checkbox here is wrapped in its label and the label is the control. The probe now measures the label, and it re-checks the **desktop** to prove the floor did not leak — 51 controls still compact. **WALK-A-11**: `break-words` **alone did nothing** — the h1 still measured 1331px inside a 375px viewport, because a flex item defaults to `min-width: auto` and `overflow-wrap` only breaks text that has run out of room. Now 343px over four lines. The 120-character limit is written twice (a TS constant and a CHECK on all eight title/name columns) and a test reads the migration's CHECK *expressions* — not the digits, since the header comment says 120 too — and requires them to equal the constant; watched red both ways. Verified against real Postgres: 121 refused, 120 accepted, trailing spaces accepted (btrim first), 120 emoji accepted because `char_length` counts code points where JS counts 240, so the client is always the stricter of the two. The migration's fail-loud guard was tested by making it fire. One parking-lot entry. |
| 2026-08-23 | Sprint 18 — Package E: P-01 phase S, D4(b), D2 | `v2/sprint-18-game-and-events` | **Complete except P-02, merged to `main`.** `gate:db` green (lint / 991 unit +2 skipped / 95 integration / build / schema assertions / 626 db / 418 rls), e2e 35/35, and a 19-check browser probe at 375 px on a `--mode development` build. One forward migration, `db:types` regenerated. **The game stopped being TypeScript**: `intakeType`'s union, `FIELD_IMAGE_URL`, "Lifted Park" and ten enumerated keys in the entity registry are all data now, and a ratchet over the four files P-01 names keeps them out (watched failing). No row was migrated — `scouting_reports.data` was always keyed this way — and the registry's no longer enumerating it fixed something enumeration made invisible: an unknown key was **dropped**, silently, while the row still saved. **D4(b)**: curated templates plus add/hide/relabel, with keys namespaced `team.` so a team's `climb` can never become next September's official one; season-scoped, and carried over a roll **only when the game is the same**, which is both halves of D4's sentence. The settings screen matters more than it looks — without it the patch is a gate with no door. **D2**: `competition_events` with matches, and participants as **ROWS** because FRC is 3v3 and because a surrogate is a property of a participation; paste/parse with a preview that names what it ignored (`Ignored 2 number(s) after the teams (108, 11) — usually the scores`), and manual entry as the substrate rather than the fallback. The parser's first test found a real bug on its first run: the last team's name ran to end-of-line and came out as "Nano Ninjas 108 11". 75 cross-tenant assertions on the four new tables, including B21's own shape (naming your OWN id on somebody else's row) and the season gate checked through a join. **`registration.spec.ts`'s intermittent failure is diagnosed** — a route-guard redirect that discards intent on the confirmation path, 1 run in 24, ruled out as contention by a 12/12 control probe; the one-line fix is outside this sprint's IDs and is in the parking lot. |
| 2026-08-23 | Sprint 17 — D3 mechanics + WALK-B-03/04/05/09/11 | `v2/sprint-17-onboarding-gate` | **Complete, merged to `main`.** `gate:db` green (lint / 904 unit +2 skipped / 95 integration / build / schema assertions / 551 db / 343 rls) and the e2e pack **33/33 twice in a row**, which is the interesting number — see `docs/sprint-17-report.md` §5. Three forward migrations, `db:types` regenerated. **D3's licence stops being the anti-abuse control**: a 30-day probation instead of a 90-day trial, `UNIQUE (program, team_number)` (partial — a rookie team with no number yet is real), one auto-created team per account closing SEC-08's chaining, and an operator console panel that lists new teams with *whether anybody has used them* and extends one to season length in a click — `v2-schema.md` had that as SQL to paste into psql. `teams.program` is a column, not an `"FTC-12345"` string, because FRC numbers overlap; no FRC behaviour built. **Four things went wrong and three were caught by a suite:** the D3 migration's `CREATE OR REPLACE` was rebuilt from the Sprint 3 body and silently dropped SEC-01's transaction-local flag and SEC-09's invite handling (the fourth copy of that function — the WALK-B-05 migration was produced by *copying* the current body instead); the new db suite passed once and failed on the second run because `Fixtures` never cleaned up teams the RPC created; and two e2e numbering schemes failed, `TEST_PARALLEL_INDEX` because it is a reused *slot* and `TEST_WORKER_INDEX` because the pack never deletes its teams — so the numbers are random now and the collision is *handled*, which means every run exercises D3's new screen. WALK-B-04's root cause was a link to `?redirect=` that **nothing has ever read** (this app's parameter is `next`), and fixing the name would not have been enough either, because production sign-up round-trips through email. WALK-B-09 and WALK-B-11 have no exit criteria, so this sprint **wrote its own definitions of done** and states them in the report and in the test file. **One interpretation needs Kevin's eye:** "routes to request to join" was built as "routes to the existing invite-code join page", because a request-to-join keyed on a team NUMBER would let anyone attach a pending row to any team by guessing five digits. |
| 2026-08-23 | Sprint 16 — SEC-07 + WALK-B-12, the licence lapse | `v2/sprint-16-licence-lapse` | **Complete, merged to `main`.** Gate green (lint / 868 unit +2 skipped / 95 integration / build), e2e 33/33 across two projects; `supabase/` untouched, so no migration — SEC-07's operator half needed none, because `operator_team_directory` already returned `valid_until`. **A lapsed team was shown a red "read only" banner and a live New Item button underneath it**, and each write queued, was refused 42501 and dead-lettered; the server half had been right since Sprint 6, so the whole defect was the client offering the write. `canEdit` moved to `useAccessState` (which already existed to compose season + licence and had no consumers) and the season-only boolean was renamed `seasonAcceptsWrites` — the rename is what turned six call sites into compile errors and left exactly one `canEdit` in the app. Twenty-one hand-written copies of "This season is archived and read-only" became one three-entry map; the old string was false for two of the three refusals, and `AttendanceRoster` — which the walkthrough never reached — let a lapsed team tap through a whole meeting's attendance. **Three further defects came out of building the probe the criterion asks for, none from the suite:** the dead-letter panel said "retry when you have a connection" to an ONLINE device for up to 5 s, because one of three hand-written refreshes carried two of three values; the device only learned of its own lapse on a page reload, because D3's 30-day probation makes expiry a *clock* event while `team_entitlement` was read once per team arrival; and an idle client never learned at all, because `sync()` only runs when something is queued. The client clock now asks a question and never answers one — a `validUntil` in the past triggers a re-read, never a local refusal, because the other version locks a licensed team out on a Chromebook running two days fast (B4 pointed at a coach). Measured end to end at 375 px on a `--mode development` build, with no reload: banner 2 s, controls disabled 2 s, renew-and-retry reason 4 s. The operator console sorts lapsed → soonest → open-ended, because "sorted by `valid_until`" taken literally buries the teams that already need attention. **One test in this sprint passed against the defect it was written for** and was caught by the revert pass — `docs/sprint-16-report.md` §5. |
| 2026-08-23 | Sprint 15 — WALK-A-06, the **one unblocked ID** in Package E | `v2/sprint-15-scouting-validation` | **Complete, merged to `main`.** Gate green (lint / 831 unit +2 skipped / 95 integration / build), e2e 33/33 across two projects. **Scope is one ID on purpose:** Package E depends on D4 and Package F on D3 + D9, all three still blank, and guardrail 3 says stop on the ID rather than infer. WALK-A-06 depends on none of them and its exit-criteria block covers only the validation half. **The defect worth naming is the match number.** `-5` was not refused — it was accepted, discarded, and rendered as "No match #", which is also what the card says when the scout did not record one. The scout types a number, sees it reported as missing, and cannot tell whether the app refused it or they mistyped: `failure-modes.md` §4, and the same shape as the fabricated "Match 0" B18 already guards. Rules now live in `src/lib/scouting-validation.ts` rather than the form's `onChange`, because the sync engine replays queued reports and a rule in a handler is not a rule the round trip has. Team numbers stay TEXT — `0123` and `123` are two teams on a pit board, so it is a 1–5 digit check, not a parse. Blank and `NaN` stay non-errors so B18's behaviour is untouched. **The geometry half is the lesson.** jsdom renders the broken and fixed cards identically, so it is an e2e assertion at both viewports — and **the first version of it passed with the layout fix reverted**: a 56-character event name was not long enough to overflow. Decoration, caught by reverting rather than reading. At 120 characters the badge sits **618px outside a 485px card** on desktop and 492px outside on mobile, and it fails as it should. Cause was never the string: a flex child defaults to `min-width: auto` and will not shrink below its content. **Two more came from opening the built app at 375px** rather than from the suite: the notes counter read "-4500 left" after a paste that got past `maxLength` (a negative allowance is a number pretending to be a budget — "4500 over" now, with a test), and no horizontal overflow with all three messages inside the modal. Two parking-lot entries. |

**Discovered / parking lot:**

*From Sprint 19 — the accessibility set, `v2/sprint-19-accessibility` (2026-08-23):*
- **White on `forge-600` fails AA on the primary button of every screen, and the fix is a
  brand decision rather than an accessibility chore.** Measured by axe on the built app in dark
  mode: `#ffffff` on `#ea580c` at 13px is **3.55:1** against a 4.5:1 requirement, and it is the
  most-repeated contrast failure in the app by node count — seven of the nine Sprint 19 scans hit
  it, on `/app/dashboard`, `/app/board`, `/app/meetings`, `/app/scouting` (×2), `/app/planner`,
  `/app/checklist` and the task modal (×2). It is not large text by any definition: WCAG's
  exemption starts at 18.66px bold or 24px normal. **`forge-700` (`#c2410c`) measures 5.18:1**
  and is already the hover state, so primary would move 600→700 and hover 700→800. Left out of
  Sprint 19 for two reasons: it is not among the three ratios WALK-A-09's evidence names, so it
  is a new discovery rather than part of the ID; and CLAUDE.md principle 8 makes the forge ramp
  Kevin's call, not an agent's. `scripts/probe-accessibility.mjs` prints it on every run and does
  not fail on it, keyed on the **measured colour pair** rather than the rule id — parking the
  button must not also park the secondary-text failures, which share the id `color-contrast` and
  nothing else.

*From Sprint 18 — Package E, `v2/sprint-18-game-and-events` (2026-08-23):*
- **`registration.spec.ts`'s intermittent failure is no longer unexplained, and the fix is one
  line that this sprint did not take.** `App.tsx` guards the route as
  `user ? <CreateTeam/> : <Navigate to="/" replace/>`; a momentarily falsy `user` sends the
  coach to `/`, which bounces a signed-in user to `/app`, which for a user with no team is the
  onboarding picker — which is the failing screenshot, all three times. **Numbers:** it happens
  only on the email-confirmation path (a control probe signing in NORMALLY and issuing the same
  immediate `goto('/#/create-team')` reached the wizard **12/12**); it reproduces at roughly
  **1 run in 24** under `--repeat-each=8`; and it hit a *different* test in the same file this
  time, so it is the shared `createTeam` helper rather than one spec. This is
  `docs/failure-modes.md` §14 — a redirect discarding intent on the one journey every team takes
  exactly once. The fix is `<Navigate to={loginWithReturnTo('/create-team')} replace />`, using
  the helper this repo already built for exactly this, and the same argument applies to
  `/onboarding` on the line above it. Left out because it is outside Sprint 18's IDs; the e2e
  helper retries and now throws with the real reason rather than "waiting for a button".
- **An archived season created BEFORE this sprint will render the wrong game once we stop
  shipping DECODE.** `gameForSeason` prefers `seasons.game_definition_id`, falls back to
  matching `game_title`, then to the newest bundle. Seasons created from now on record the id
  and are correct for ever; every season in production today has no id and rides the title
  fallback, which works only while `ftc-2025-decode.json` is still in the build. `game_snapshot`
  (P-01 phase M) is the real fix and the phase-S exit criterion anticipates it. A cheaper
  interim exists and should be considered before September 2027: a one-off backfill setting
  `game_definition_id` from `game_title` where it matches a bundled definition.
- **`event_matches` and `match_participants` are not season-filtered on pull**, because they have
  no `season_id` — they hang off the event, which has one, and the composite FK is what makes
  that safe. So they land in `TEAM_SCOPED_TABLES` and a team's whole match history downloads on
  every team load. At beta scale that is small (one event ≈ 60 matches × 4 participants = 240
  rows), and SYNC-01's paging means it will not truncate — but it is SYNC-03's shape and grows
  with every season. Adding `season_id` to both would denormalise a fact the event already
  holds; filtering the pull through a join is the better answer when it matters.
- **The Match Planner's partner capabilities are LABELS ONLY.** `partner_autonomous` and
  `partner_park` are columns on `match_plans`, so the game definition supplies their words and
  cannot add, remove or reorder them — a game with three partner capabilities cannot be
  expressed. "Lifted Park" as a literal is gone, which is what P-01 phase S asked for; making
  the set itself schema-driven is a `match_plans` change and belongs with phase M.
- **One unexplained 409, recorded with its exact body rather than dismissed.** During the
  sprint's browser debugging a single run produced
  `409 competition_events?on_conflict=id :: {"code":"23505", … "competition_events_id_team_id_key"}`
  — a duplicate on the `(id, team_id)` unique index during an upsert whose conflict target is
  the primary key, which should not be reachable. It has not recurred in six subsequent runs,
  including three deliberate attempts with leftover rows present, and the two probe failures
  around it turned out to have a different cause (a wait condition that was already true). Kept
  here because this repo's standing rule about its other intermittent failure is that "it passed
  the next four times" is how a defect gets ignored for a season.

*From Sprint 17 — D3 + WALK-B-03/04/05/09/11, `v2/sprint-17-onboarding-gate` (2026-08-23):*
- **"Routes to request to join" was interpreted, and Kevin should confirm the reading.** D3
  says a coach claiming a taken number "routes to request to join, reusing the existing pending
  membership status and join RPC. Do not write a second join path." What shipped is a screen
  naming the team that holds the number and a button to the existing `/join` page — so the
  coach still needs an invite code from that team's admin. The alternative,
  `request_to_join_team(p_team_id)`, is a second join path (which D3 forbids) **and** would let
  anyone attach a pending row to any team by guessing five digits: B21's "knowing a team's uuid
  is the entire attack", with a number in place of the uuid. If Kevin meant the stronger thing,
  it is one RPC and a rate limit.
- **`operator_grant_extra_team` has no button.** The RPC exists, is tested, and is how an
  account gets a second team; the console has no UI for it, because that needs a user picker
  the console does not have (every other control there hangs off a SELECTED TEAM, and this
  grant is about a person with no second team yet). The refusal a coach sees names
  `support@falcon-forge.com`, so the path is a support interaction, which is what D3 describes.
  Worth a button before September if more than one team is expected to need it.
- **The e2e pack never deletes the teams it creates**, and D3's uniqueness rule turned that from
  harmless into a source of cross-run failures. Measured: 39 leftover teams after three runs, no
  `globalSetup`, no reset. Handled rather than fixed — `createTeam` now recognises the
  taken-number screen and retries with a different number — but the underlying fact is that this
  pack's database grows without bound and every future uniqueness constraint will meet it. A
  `globalSetup` that deletes teams whose number is in the e2e range would close it in about ten
  lines.
- **Two SQL/tooling traps that cost a migration run each, neither in
  `docs/environment-divergences.md`.** (1) A Bash heredoc mangles backslash escapes, so a `'`
  escaped shell-style (`'\''`) reached plpgsql verbatim and failed at `SQLSTATE 42601`; the
  file already warns about heredocs for commit messages, not for SQL. (2) `migrations/*.sql`
  written inside a `/* */` comment opens a NESTED comment — Postgres supports them — and the
  whole rest of the migration became comment, reported as `unterminated /* comment`. Both are
  one-line additions to that document.
- **`team_entitlement.is_probation` is keyed on the grant's notes TEXT**, which is two
  definitions of one fact matched by prose. `schema_assertions.sql` asserts the RPC and the view
  still agree, and that assertion was watched failing — but the honest version is a column on
  `license_grants` (or a widened `source` CHECK), and that is a change to a frozen table with
  several readers. Worth doing if `source` is ever revisited for Stripe, which it will be.

*From Sprint 16 — SEC-07 + WALK-B-12, `v2/sprint-16-licence-lapse` (2026-08-23):*
- **An operator REVOKING a licence still needs a reload before the device notices.** Expiry is
  now noticed on its own (a 60-second local check re-asks the server once the stored
  `validUntil` has passed), but a revocation moves a date the client has no reason to doubt, so
  nothing prompts a re-read. Measured: `scripts/probe-queued-before-lapse.mjs` in its
  revoke-based form sat at "1 pending" for the full 180 s budget and never reached the terminal
  message; the same probe in its expiry-based form reaches it in 4 s. Left alone deliberately —
  `server-pull.ts`'s original reasoning holds for revocation, which is a deliberate act with a
  human on both ends, and closing it means either a realtime subscription on `license_grants`
  or a real poll. Neither is justified by anything observed, and the project's guardrail bar is
  "name the defect or leave it out".
- **A content screen's write control is disabled for ~70–120 ms on first paint, saying "No
  season is selected yet".** Measured at **69 ms** to the first sample and enabled by **121 ms**,
  on the sprint board at 375 px against a `--mode development` build. `currentSeasonId` is null
  until the store hydrates, so `canEdit` is false and the control renders with the no-season
  reason. `docs/failure-modes.md` §4 — loading conflated with absent — and pre-existing: the old
  `!!currentSeasonId && !isArchived` behaved identically, it just had no words of its own so
  nobody noticed. Too short to be a user-facing defect; long enough that it made the first
  version of the lapse probe report a licensed team as unable to write. The honest fix is a
  third state (hydrating) rather than a longer disabled window, and it belongs with whatever
  next touches store hydration.
- **`SyncFailure.lastError` stores `"[object Object]"` for a PostgREST refusal.** Read straight
  out of IndexedDB on a parked change: `{ tableName: "tasks", operation: "create", retryCount: 1,
  lastError: "[object Object]", terminalReason: "…licence has lapsed…" }`. The user-facing text
  is fine — `terminalReason` is what the panel renders and it is correct — so this is a
  diagnostics loss, not a UX one: the one field that would tell a future debugger what the
  server actually said has been stringified into nothing. One `JSON.stringify` or a
  `.message ?? String(err)` at the `moveToDeadLetter` call site.
- **`useSeasonScope().canEdit` no longer exists**, and any document referring to it is now
  stale. It is `useAccessState().canEdit` (entitlement-aware, with `editRefusal` and
  `editRefusalReason`); the season-only boolean is `useSeasonScope().seasonAcceptsWrites`.
  `docs/assessment-2026-08/exit-criteria.md` names the old one under SEC-07 — left as written,
  because the exit-criteria file is the record of what was asked for and Sprint 16's report
  explains why the mechanism differs (a cycle, and a second implementation of "is this team
  read-only"). Anything written from here on should use the new names.

*From Sprint 15 — WALK-A-06, `v2/sprint-15-scouting-validation` (2026-08-23):*
- **The event name is the remaining unbounded string on a report card.** The team number is
  capped at five digits and the notes at 500; the event name has no rule at all, and it is what
  the new geometry test uses to overflow the card. The layout survives it now, which is why this
  is a line and not a change — capping it is a product decision (event names are genuinely long,
  "FIRST Tech Challenge Michigan State Championship — Dow Division") and it belongs with P-02's
  form work rather than being decided in passing.
- **The reports page still has no filter, sort or search.** The other half of WALK-A-06's
  finding, explicitly P-02's and blocked on D2. The impact line is unchanged: at an event with
  30+ teams × 5 matches there is no way to find a given team's reports, and scouting that cannot
  be read back is scouting that was not worth taking.

*From Package G of the August 2026 assessment — Sprint 14, `v2/sprint-14-observability`
(2026-08-23):*
- **The two backup secrets, and an uptime signup — both Kevin's, both blocking a finished
  feature.** `backup.yml` fails red every night until `SUPABASE_DB_URL` and
  `BACKUP_PASSPHRASE` exist (deliberately: a backup job that skips quietly is the failure it
  exists to remove). The uptime check needs an UptimeRobot or BetterStack account. Both are
  documented in `docs/beta-ops.md` with the exact values and URLs.
  **CORRECTED 2026-08-23 (Sprint 16), and the correction is not the one expected.** Both
  secrets now exist — `gh secret list` dates them 2026-08-23 11:50 and 11:55 — and Kevin
  reports UptimeRobot is set up. The backup is still not running, for a reason neither this
  line nor `beta-ops.md` had considered: **`gh workflow list --all` returns only CI, Deploy
  and pages-build-deployment.** `backup.yml` was written in Sprint 14 and `main` has not been
  pushed since `c1cec81`, so GitHub has never seen the file. It is not failing nightly; it has
  never run once, no artifact exists, and the recovery position is unchanged from before
  Sprint 14 wrote the workflow. Unblocking it is a `git push` of `main`, which is Kevin's
  because `main` deploys to production — and which is why an agent could not simply do it.
  The same fact retires the "run the workflow once by hand" item that Sprint 16 was asked to
  close: there is nothing on GitHub to run.
- **The last mile of the restore is still unrehearsed: a HOSTED artifact into a NEW Supabase
  project.** *(Still blocked as of 2026-08-23, one step further back than this line assumed:
  it waits on a real nightly artifact, and the workflow that would produce one is not on
  GitHub — see the corrected line above. The secrets were the blocker named here; the push is
  the blocker that was not.)* The local rehearsal on 2026-08-23 did happen and found both defects recorded in the
  row above, but the local stack supplies the `auth`, `extensions` and `vault` schemas that
  Supabase manages on a hosted project — the same restore into a bare Postgres database fails on
  all three — so it cannot speak for what a fresh project provides. Needs a scratch project and
  one real nightly artifact, so it is blocked behind the two secrets. An hour once they exist,
  and it should happen before the first competition rather than during one.
- **Every other backup claim in this repo deserves the same treatment.** Two of the three things
  `beta-ops.md` said about backups were false, and both had been written down and never run. The
  same shape of claim appears in the deploy ordering ("apply the migration by hand first"), the
  erasure SQL, and the support-email forwarding — each documented, each unexecuted since it was
  written. `check-production.mjs` proves the app is served; nothing proves the runbooks work.
- **The `mobile` e2e project is Chromium wearing an iPhone's metrics, not WebKit.**
  `devices['iPhone 13']` selects WebKit and CI installs chromium only, so the project overrides
  it. Every claim in this repo about iOS — the 16px zoom floor, the safe-area insets, the
  7-day storage rule — remains unverified on the real engine, exactly as
  `docs/environment-divergences.md` §10 says. Installing WebKit in CI is one line plus a
  download; it would close the oldest standing divergence in that document.
- **Two conditional actions remain, both inside the repo's one skipped suite**
  (`MatchPlanner.test.tsx`'s drawing block). The new ratchet's ceiling is 2 for that reason.
  Un-skipping that block — the planner's pointer handling now has real e2e coverage, so those
  skipped unit tests may simply be deletable — takes it to zero.
- **One unexplained e2e failure, parked with its numbers rather than called a flake.**
  `meetings.spec.ts:320` ("a code the server has not seen yet is not blamed on the student")
  failed once, in the first full-pack run after a `db reset`; the error text was lost when the
  next run cleared `test-results/`. Then: 5/5 green in isolation at 4 workers under
  `--repeat-each=5`, and four consecutive green full-pack runs, one deliberately reproducing the
  same post-reset condition. So it is not contention and not a cold database. The test aborts a
  POST route and waits 30 s for a heading; if it recurs, capture the error before re-running —
  "it passed the next four times" is how an intermittent defect gets ignored for a season.
- **Coverage is a floor at 66/60/63/68, not a target.** The biggest gaps are whole files at 0%:
  `GettingStarted.tsx` and `ResetPassword.tsx` (both now have e2e coverage but no unit tests),
  and the guardian and operator surfaces. Raising the floor is a deliberate piece of work, not
  a side effect; the ratchet stops it slipping further meanwhile.

*From Package D of the August 2026 assessment — Sprint 13, `v2/sprint-13-beta-logistics`
(2026-08-23):*
- **The licence is undecided and now says so.** README claimed MIT from the first commit with
  no `LICENSE` file to match, so the claim was unenforceable in both directions. It needs a
  decision rather than a default: FalconForge is intended to be paid (§2), and MIT would let
  anyone run a competing instance. Until then the README says no licence is granted and the
  code is source-available for review. **Kevin's call**, and it should be made before the
  repo is shown to a beta cohort.
- **The `docs/beta-ops.md` trigger text still waits on D7.** Package D's note says D7 gates it;
  D7 is blank. The specific edits waiting are the two the decisions file proposes — adding
  "first paid licence" as a hard Cloudflare trigger (GitHub Pages' ToS excludes commercial
  SaaS) and moving Supabase Pro's trigger from "first paying customer" to "first real team
  data". Both are one-line changes once the line is filled in.
- **`Landing.tsx` is 1,050 lines and the largest component in the repo**, most of it animated
  CSS mock widgets. LAND-05/06/07/09 (real screenshots, a trust strip, an OG image, the
  10,120 px mobile scroll) are all still open and all touch this file; whoever takes them
  should expect to split it first. Not in Package D's scope, and left alone.
- **`Login.tsx` maps GoTrue errors by substring**, because GoTrue does not give these two a
  code. That is fragile to an upstream rewording, which is why the fallback is the original
  message — but the honest version of this is a mapping keyed on something stable. If Supabase
  ever exposes an error code for the email ceilings, this should move to it.

*From Package C of the August 2026 assessment — Sprint 12, `v2/sprint-12-day-one-ui`
(2026-08-24). Each was found while fixing one of the eight ids and is outside them:*
- **The Match Planner's saved-plan rows are not buttons, so a plan cannot be loaded from the
  keyboard.** Enumerated the Load modal in the built bundle: three `<button>`s, all of them
  chrome — one Close and two `delete-matchplan-button`. The row carrying the plan name is a
  clickable `div`. This is `docs/failure-modes.md` §8's keyboard-unreachable class, which
  Sprint 5.5 fixed in four places and Sprint 8's retrospective in a fifth (the archived task
  row); `SprintArchived.tsx:48-55` has the exact shape this needs, comment included. Worth
  noting that `eslint-plugin-jsx-a11y` did NOT flag it, so whatever rule catches the others
  does not catch this — the ESLint config is the thing to look at, not just the file.
- **`lastSyncTime` is now a second, worse answer to a question `server-reachability` answers
  properly.** `useSync` still tracks it and `SyncStatusIndicator:246-247` still renders
  "Last synced: <time>" in the expanded panel, set only when `sync()` runs — which happens
  only when the queue is non-empty, so a read-only device never sets it at all. The label at
  the top of the same component now reads the reachability tracker instead. Two sources for
  one fact, in one component, is principle 9 in miniature; deleting `lastSyncTime` is a small
  follow-up that belongs with **SYNC-08/OPS-05** rather than in a UI-bug package.
- **`SyncStatusIndicator` polls a 30 s clock purely to keep "3 min ago" true.** Cheap, but it
  is a `setInterval` per mounted indicator and the component is mounted once in the sidebar
  for the life of the session. If a second indicator is ever rendered (the mobile header is
  the obvious candidate) that becomes two timers for one fact; the tick belongs in the
  reachability module if that happens.
- **The `it.each` titles in `date-only.test.ts` print the raw millisecond count**
  ("describes 300000ms ago as …"), because Vitest's `%i` formats the argument rather than a
  label. Cosmetic, but the failure message is what somebody reads at 2am.
- **OPS-02's seven assertion-free tests are still there**, untouched: this package's note
  named them as the cautionary tale, not as scope. Four of them live in
  `SprintPlanning.test.tsx`, which this sprint edited (eleven render sites gained a
  `currentMember` prop) — so the file has been opened and the tests left alone deliberately.
  They are Package G's.

*From Package B of the August 2026 assessment — Sprint 11, `v2/sprint-11-read-path`
(2026-08-24). Each was found while fixing one of the five SYNC ids and is outside them:*
- **A dead-lettered change records `"[object Object]"` as its `lastError`, for every server
  refusal there is.** `processSyncItem` throws PostgREST's error OBJECT (`throw result.error`,
  `sync.ts:469/492/500`), and `moveToDeadLetter` stores `error instanceof Error ? error.message
  : String(error)` (`offline-db.ts:363`) — a plain object is neither, so `String()` gives
  `"[object Object]"`. Reproduced by cutting the network in the built bundle: one parked task,
  `lastError: "[object Object]"`. It reaches no user today — `ParkedChangesDialog:140-143` shows
  `terminalReason` or a generic sentence, deliberately — **so the SYNC report's claim that the
  dialog "shows `lastError` when no reason" (SYNC-14) is not true of the code as it stands**.
  It matters for **SYNC-10**, whose whole design is shipping this record to a server so Kevin can
  see why a device is stuck; it would ship `"[object Object]"`. One line:
  `String((error as { message?: string })?.message ?? error)`.
- **`sync.integration.test.ts`'s delta test does not exercise the delta path.** It seeds
  `localStorage['falconforge-sync-timestamps']` and `'falconforge-sync-counter'` (lines 316-319),
  which nothing has read since B5 moved cursors into IndexedDB — and `setup-integration.ts`
  clears `db.appState` before each test, so there is never a cursor and the run is always a FULL
  pull. The test is named "performs delta pull when counter is not a multiple of 5 and timestamp
  exists" and passes either way. Its mock also had to gain `.or()`, `.order()` and `.limit()` this
  sprint, which is the same file's documented drift (`.gt()` vs `.gte()`) recurring. §2 class.
- **The `team_members` `status = 'approved'` filter is still in the pull, deliberately.** The
  Sprint 10 entry below asks for it here, and the pull half genuinely is one line — but only the
  pull half. Twelve components read `teamMembers`; nine get the shell's already-filtered list
  through the outlet context, and **three read the store directly** (`AppShell.tsx:95`, which
  filters with `isActiveMember`; `GuardianView.tsx:32`; `PreMatchChecklist.tsx:32`, which do
  not). Dropping the filter without the picker half changes nothing visible and quietly widens
  what those two see. The fix is "carry `status='removed'` rows and filter in the pickers",
  which is roster UI work, not read-path work.
- **A team switch costs two season pulls, not one.** `fetchTeamData` asks for the new team's
  season with `mode: 'full'` and the shell's season effect asks for the same season with
  `'auto'`; `fetchSeasonData` de-duplicates on `(team, season, mode)`, so the two do not share.
  Keying without the mode would collapse them at the price of "whichever caller arrives first
  decides", which is the kind of order-dependence this project has been bitten by. Harmless
  today (a team switch is rare and the second pull is a delta); listed so it is a decision
  rather than an accident.
- **The sync loop only pulls when the queue is non-empty** (`sync.ts:301` — `attempt()` returns
  early unless `getPendingSyncCount() > 0`), so a read-only device — a student watching the
  board — never reaches the periodic full reconciliation at all. Deletions reach it through
  realtime, and through `fetchTeamData`'s every-5th-open reconcile. That was already true before
  this sprint; it matters more now that the mount pull is a delta. The cheap version is to let
  the timer run a pull with an empty queue at a much longer interval.
- **`meeting_attendance` reaches ~1,000 rows in the CURRENT season alone** for a 15-member team
  meeting three times a week — measured at 1,025 on the seeded mid-season team, i.e. one page
  plus 25. Season-scoping bought it a year, paging bought it the rest, and it is still the
  single largest thing a device downloads (383.6 KB of the 637.8 KB cold open). If attendance
  summaries ever need to be fast rather than complete, this is the table to page lazily.

*From Package A of the August 2026 assessment — Sprint 10, `v2/sprint-10-tenant-safety`
(2026-08-24). Each of these was found while fixing one of the eight SEC ids and is outside them:*
- **✅ FIXED 2026-08-24, same sprint, at Kevin's request.** Every seeded review account used to
  meet the "We've updated our legal documents" modal on its first screen:
  `scripts/seed-review-states.mjs`'s `makeUser` created accounts with
  `user_metadata: { full_name, age_classification }` and no `privacy_accepted` /
  `privacy_version`, so `handle_new_user` fell back to recording `privacy_and_guidelines` at
  `'1.0'` — or, with `privacy_accepted` absent, recording nothing at all. **36 of 36 accounts,
  0 with a current acceptance**, for as long as the seed has existed; a reviewer just clicked
  "Later" every time. `docs/environment-divergences.md` §1's own story reaching a third
  consumer: the e2e helper was fixed when eleven specs timed out behind this modal, and the
  REVIEW seed was not. Now **36 of 36 accepted `privacy_and_guidelines@2.0`**, and the seed says
  so on the way out. The versions moved to `src/lib/attestation-versions.json` so plain `node`
  can read the same numbers the app checks against rather than writing them down again — which
  is what `attestation-versions.ts` moved out of `attestations.ts` for in the first place; the
  script also had an unguarded hardcoded `'2.0'` in its own `attest()`, now gone. The seed
  asserts the property itself before reporting success, watched failing at "36 of 36" with the
  metadata removed.
- **After SEC-03, a task assigned to a removed member renders "Unassigned", and saving that task
  writes the assignment away.** `server-pull.ts:245-247` filters `team_members` to
  `status = 'approved'`, so a removed member leaves the client's collection entirely — the same
  as when the row was deleted, so this is not a regression, but removal now actually SUCCEEDS, so
  it goes from "almost never" to "every time somebody leaves". The `<select>` falls back to
  `Unassigned` because the option is gone, and `Save Task` then persists `assignedTo: ''` while
  the server row still names them. Keeping the name read-only needs the pull to carry
  `status = 'removed'` rows and the pickers to filter instead — `server-pull.ts`, i.e. Package B.
- **supabase-js never sees a database trigger's message on signup.** It sends
  `X-Supabase-Api-Version: 2024-01-01`, under which GoTrue replaces any database error with
  `{"code":"unexpected_failure","message":"Database error saving new user"}`. Plain curl to
  `/auth/v1/signup` gets the real sentence; confirmed by replaying the captured request with and
  without the header. So SEC-10's "Members under 13 use a guardian-managed profile…" reaches
  nobody through the app, and `auth.admin.createUser` collapses it further to "Database error
  creating new user". Belongs with **OPS-06**, which owns the auth-error copy in `Login.tsx`.
- **`season_is_open(p_season_id, p_team_id)` and `meeting_season_is_open` are still
  anon-callable oracles.** SEC-06 closed `get_user_team_ids`, `team_can_write` and
  `team_seats_remaining`; these two remain, and tell a caller who already holds a season or
  meeting uuid whether it is archived. They are consulted by every content WRITE policy, so a
  membership guard costs a second `is_team_member` probe per row written (~18 µs/row measured in
  the SEC report). Left as one bit about no person, deliberately.
- **SEC-08's other half is untouched: trial-chaining.** `create_team_as_admin` has no per-user or
  per-period limit; one seeded account registered three teams in a row, each with its own
  unlimited-seat grant valid until 2026-11-21 (`v_trial_days constant integer := 90`). Depends on
  **D1** and **D3** and belongs with SEC-07 / Package F, not with the RLS fix.
- **`pg` is an unused devDependency.** `package.json:73` carries `"pg": "^8.20.0"`; after Sprint
  10 nothing under `src/`, `scripts/` or `e2e/` imports it, and there is no `@types/pg`, so the
  first test that tries fails `npm run lint` rather than failing to install. Either add the types
  and use it for raw SQL in the db suite, or drop the dependency.
- **`supabase/tests/schema_assertions.sql` printed its success line before assertion 23.**
  `SELECT 'schema assertions passed'` sat between assertions 22 and 23, so a run that failed 23
  printed "passed" first (the exit code was still non-zero, so nothing was actually wrong — but
  the output said the opposite of the result). Moved to the end in Sprint 10 while adding
  assertions 24, 25 and 23a; recorded here because it is the shape of §3, not because it is open.


*From the age-classification work and the e2e confirmation change (2026-08-22):*
- **A team created seconds before going offline has no season selected, so the board is
  read-only.** The New button renders disabled with "Select a season first" until the season pull
  lands, and a brand-new team's pull is still in flight. Found because the smoke pack started
  losing that race once account creation got faster; the spec now waits for the season before
  going offline, which is right for that spec — its subject is "work created offline survives",
  not "the app is switched off mid-boot". **The second scenario is real**: a coach who registers a
  team in the car park and walks into a venue with no signal gets an app that cannot create
  anything, with a message that does not explain why. The honest fix is for the season the team
  was just created with to be selected from the create-team response rather than waited for, which
  is the same shape as Sprint 7 seeding the store from the create-team write.
- **The under-18 nomination handshake is still open, and it is now unblocked.** §3's fix — the
  successor confirms "I am 18 or older" on the screen where they accept the terms — was
  impossible before B27, because any correction reverted on the next boot. It is also no longer
  the only path: the profile control fixes the same staleness for the coach and mentor roles,
  which the nomination handshake never would have. What remains is that `nominate_team_admin`
  refuses a `13_to_17` account outright, so a student who has genuinely turned 18 and not yet
  corrected it still cannot be nominated — the refusal now points at a screen that exists, which
  is the part that was missing. Whether to soften the nomination gate is Kevin's call and is not
  urgent.
- **`AcceptAdminNomination`'s checkbox says "I am 18 or over" and still records only the
  attestations.** The age half of that sentence is written nowhere. Harmless while the nomination
  gate refuses under-18s up front, and the obvious place to fix it is whenever the handshake above
  is picked up.


*From the auth email templates (2026-08-22), found while checking what the links actually need
rather than by reading the templates:*
- **🔴 The precache is 60% one image, copied four times.** `logo.png`, `falcon_logo.png`,
  `icon-192.png` and `icon-512.png` are **byte-identical** (md5 `f74e417a…`): the same
  1024×1024, 784 KB PNG, four times, for **3.06 MB of a 5.01 MB precache**. All four are
  precached — `globPatterns` in `vite.config.ts` takes `**/*.png` — so every cold install pays
  for all of them, on an offline-first app whose premise is a cold start on venue WiFi. The
  manifest also **declares `icon-192.png` as `sizes: '192x192'`**, which it has never been; the
  browser downscales 1024px for a 192px slot and the manifest states something untrue about its
  own asset. Principle 9 with a measurable cost attached. The fix is real image work (resize per
  slot, delete the aliases, check `DecodeField.png` and the 582 KB `hero_bg.png` while in there),
  not a config edit, which is why it is here rather than folded into the template change.
- **`signUpWithEmail` passes no `emailRedirectTo`.** So the signup confirmation link is built
  from Site URL and *only* Site URL, which means a confirmation started from `localhost` or the
  `github.io` origin sends the user to production. Correct-by-accident for beta — Site URL is
  `https://falcon-forge.com` and that is where a real user should land — but it is the one auth
  flow that ignores `authRedirectUrl()`, the helper written precisely so no flow grows its own
  answer. Worth one line and a test when the `token_hash` route above is built.
- **⬜ The dashboard's Redirect URL allow-list is stale and nobody would notice.** It holds
  `https://abigailfussell-afk.github.io/falconforge/auth/callback` (that origin 301s to the apex
  now, and `base` is `/`, so it can never match) and `http://localhost:3000/auth/callback` (dev
  targets the **local** stack per `.env.development.local`, so the hosted project never sees it).
  Both carry the `/auth/callback` path, which is the Sprint 9 defect preserved as configuration.
  It should be one entry, `https://falcon-forge.com/`. **Nothing is visibly broken**, and that is
  the point worth recording: an unmatched `redirect_to` silently falls back to Site URL, so a
  wrong allow-list is indistinguishable from a right one until Site URL is also wrong. Kevin's
  to change in the dashboard; not verified as changed at the time of writing.

*From writing the data-erasure runbook (2026-08-18), found by running the SQL rather than by
reading the schema:*
- **🔴 `DELETE FROM team_members` is impossible for almost any real member, and four
  `ON DELETE SET NULL` actions can never fire.** `team_members` is referenced by five COMPOSITE
  foreign keys — `tasks(assigned_to, team_id)`, `meetings(created_by, team_id)`,
  `scouting_reports(created_by, team_id)`, `meeting_attendance(attested_by, team_id)` and
  `teams(pending_admin_member_id, id)` — every one of them `ON DELETE SET NULL`. `SET NULL`
  nulls **every column in the key**, so each tries to null a `team_id` that is `NOT NULL`, and
  the last one tries to null `teams.id`, the primary key. Deleting a member who has been
  assigned a task therefore fails with `null value in column "team_id" of relation "tasks"
  violates not-null constraint`. **"Masked completely today because the app never deletes a
  member — `MemberManager` sets `status = 'removed'`" is what this entry used to say, and it was
  false.** `MemberManager.removeMember` and `rejectMember` both called `.delete()`, and nothing
  in `src/` had ever written `status = 'removed'` — the value existed in the type union and in
  `MEMBER_STATUSES` with no writer. So this was reached by the ordinary flow: "Remove from team"
  failed for any student who had ever been assigned a task, and destroyed the member's whole
  attendance record (`meeting_attendance … ON DELETE CASCADE`) when it succeeded. Found by
  [SEC-03](docs/assessment-2026-08/auth-rls-licensing.md) and reproduced over PostgREST both
  ways: 9 attendance rows to 0 on the delete that worked, `23502` on the one that did not.
  **The UI half is fixed in Sprint 10** — both handlers now set
  `status = 'removed', seat_assigned = false`, which is what the partial admin index and
  `join_team_with_invite`'s rejoin branch have expected since Sprint 3 — so the schema defect
  below is genuinely unreached now rather than assumed to be. The runbook in
  `docs/beta-ops.md` works around it by releasing each reference with a single-column UPDATE
  first (a composite FK with any NULL column is not enforced), which is correct but is a
  workaround for a constraint that does not mean what it says. **The real fix is per-column
  `ON DELETE SET NULL (column)`**, which Postgres 15+ supports and which would make these
  actions do what every reader of the schema already assumes they do. Deferred: it is a
  migration touching five constraints on a frozen schema, for a code path nothing takes, and
  the beta workaround is written down and measured.
- **Data erasure is deliberately a runbook and not a tool** (Kevin, 2026-08-18). The Privacy
  Policy's §6 promise stands; for a beta of a few known teams a request handled by hand is a
  real answer, and the operator RPC — which would need `operator_actions.team_id` to become
  nullable and its `action` CHECK widened — is post-beta work. `public.users` cannot be
  hard-deleted at all: `teams.owner_id` and `invites.created_by` are `NO ACTION`, so the shape
  is anonymise-plus-remove-memberships, which is what the policy already describes.

*From the teams-into-the-registry change (2026-08-18), found while reasoning about which rows
`teams` RLS returns, then confirmed against the local stack as a real pending member:*
- **✅ RESOLVED 2026-08-18** (`v2/pending-team-name`, option (b) — Kevin's call). The client keeps
  the name the join RPC already returned, in `pendingTeamNames`, and the RLS read still wins
  when it is available. No policy change and no new exposure; the one limitation is that it is
  per-device. Was: **A member waiting for approval is shown "Unknown Team".** `Onboarding` builds its
  "waiting for the team admin" list from a nested `team_members -> teams:team_id (...)` select
  and falls back to `'Unknown Team'` when the join is empty — and the join IS empty for exactly
  these rows, because `teams_select_member` is `is_team_member(id) OR is_team_guardian(id)` and
  `is_team_member` requires `status = 'approved'`. So the one row a pending member needs to name
  is the one RLS refuses them. Verified as `full-hopeful0@falconforge.test`: the membership row
  comes back with `teams: null` and a direct `teams` select returns `[]`, while an approved
  member gets the name both ways. **Live today and not introduced by this change** — the
  registry change neither fixed nor worsened it, which is why it is logged rather than folded
  in. A student who joins with a code and waits sees the app name a team it will not name.
  Two fixes, and the choice between them is Kevin's because one touches the security boundary:
  (a) a narrow additional SELECT policy admitting anyone with a `team_members` row of any
  status — cheap, but it also exposes `owner_id` and the `pending_admin_*` columns, which name
  a governance decision to somebody not on the team; or (b) capture the team name client-side
  at join time from `join_team_with_invite`, which needs no policy change and no new exposure
  but does not help a device that did not perform the join. (b) looks right for beta.

*From Sprint 9 (2026-08-17), found while building the guardian UI:*
- **Sprint 9's four RPCs shipped EXECUTE-able by `anon`, and the hosted project is what
  found it.** `20260822000200` ended with `REVOKE ALL ... FROM PUBLIC`, which is the
  careful-looking half of the incantation and does nothing on its own:
  `20260816000500_v2_grants.sql` sets `ALTER DEFAULT PRIVILEGES ... TO anon`, so every new
  function arrives with its own acl entry independent of PUBLIC's.
  `20260819000000_revoke_anon_execute.sql` states this in its header and revokes
  `FROM PUBLIC, anon`; Sprint 9 read the header and wrote half the fix. Not exploitable — each
  is SECURITY DEFINER and asks who the caller is on its first line, and production returned
  refusal bodies rather than data — but the missing layer is the one that exists precisely
  because "the guard is code, and code is what was wrong the first time" (B25). Fixed in
  `20260822000400`, and **schema assertion 23 now enumerates every SECURITY DEFINER function
  `anon` can execute and fails on anything outside a named allowlist**, so the property the
  Sprint 8 migration only claimed in prose is now enforced. Caught by running the verification
  against production rather than trusting the migration; the local `db:verify` had been green
  over it too.
- **RESOLVED IN SPRINT 9** (`20260822000300_current_member_ordering.sql`), and it was worse
  than the ordering. Kevin's call at review: fix it rather than leave a defect class
  half-closed. `current_team_member_id` also failed to exclude managed rows, and
  `check_in_with_code` resolves the caller with it — so **a guardian who scanned a QR poster
  checked their CHILD in**, from wherever they were standing. That is the act-as mode §3
  refuses, reached by accident, and it makes attendance self-attested by the one person
  `attested_by` exists to distinguish from. The function now excludes managed rows and orders
  deterministically; a guardian who scans gets their own refusal naming the coach who *can*
  mark the child present (§8). **The first attempt at this migration rewrote
  `check_in_with_code` from memory and got it badly wrong** — different `reason` codes the
  client branches on, the deadline guard dropped, and the race-safe `ON CONFLICT DO NOTHING`
  replaced by a check-then-insert that reintroduced the double-tap race its own comment warns
  about. Caught by diffing against the original before applying; the shipped version is the
  original text with one branch inserted.
- **No `404.html`, so every non-hash deep link 404s on GitHub Pages**, and **the now-dead
  `/auth/callback` route** (nothing navigates to it since all three redirects moved to the
  origin root). **Both reviewed 2026-08-17 and deliberately left in here**: Sprint 9 was already
  carrying four migrations and a live-defect fix, and neither is reachable by any flow a user
  takes. Password recovery no longer depends on a `404.html` — the redirect lands on `/`, which Pages serves — so this is no longer
  a live defect. It remains true that `falcon-forge.com/app/board` typed by hand gets Pages'
  404 page rather than the app. A Pages SPA fallback is the fix if anybody hits it; it was
  deliberately NOT bundled into the recovery fix for sounding related.
- **✅ RESOLVED 2026-08-18** (`v2/teams-entity-registry`). `teams` is a registry entity with a
  third scope, `'rls'` — its policy is `is_team_member(id) OR is_team_guardian(id)`, so one
  unfiltered select returns the union a member and a guardian should each see, and
  `pullGuardianTeams` was deleted rather than relocated: its merge-by-id was a client-side
  reimplementation of a policy. Three hand-written mappings collapsed to one. Was:
  **🔴 `teams` is still the one collection outside the entity registry**, and Sprint 9 added a
  second hand-written loader for it (`pullGuardianTeams`, which merges by id so a coach who is
  also a parent does not lose their own team list). That makes two loaders for one collection —
  the shape CLAUDE.md principle 9 is about, and the fourth feature to depend on it.
  **Decided 2026-08-17: this is the next scoped change, on its own branch.** It touches the one
  read path — the thing C3 was about — so it wants its own diff, its own round-trip test and its
  own browser pass, rather than riding along at the tail of a UI sprint three weeks from
  kickoff. Deleting `pullGuardianTeams` is part of it.
- **The guardian's sidebar still renders the season picker** with no team and no seasons. It is
  inert rather than wrong, and it is the last piece of team chrome on a screen that has no
  team. Cosmetic. **Reviewed 2026-08-17 and deliberately left**, along with the item below —
  both are live-with-able and worth revisiting once beta teams have actually used the flow,
  rather than being guessed at now.
- **`ReAttestationPrompt` fires for a guardian**, asking them to re-accept documents they
  accepted for their children minutes earlier. The prompt is about the SIGNER's own
  attestations and is behaving correctly; whether a guardian-only account should be asked at
  all is a product question, not a bug. **Left open 2026-08-17**: suppressing it needs a rule
  for what a guardian-only account is legally expected to accept, which is a question for the
  pending legal review rather than for an engineering sprint.

*From scoping Sprint 9 (2026-08-17), all verified against the live schema:*
- **✅ RESOLVED 2026-08-24** (Sprint 10, `20260824000100_sec_02_…`) — **and this line said
  "RESOLVED 2026-08-22" for two days while the correction still reverted on the next login.**
  Sprint 9 fixed the CLIENT half (B27). `handle_new_user` is `AFTER INSERT OR UPDATE ON
  auth.users` and its conflict branch read `age_classification = COALESCE(EXCLUDED.…,
  users.…)`, where EXCLUDED is signup metadata that nothing ever updates — so GoTrue's
  `last_sign_in_at` write put `13_to_17` back on the next password grant, independently of the
  client. Found by the August 2026 assessment ([SEC-02](docs/assessment-2026-08/auth-rls-licensing.md));
  reproduced over the API, closed by making the column win and letting metadata fill only a
  NULL. The class is failure-modes §1: one fact, two writers, nothing comparing them. It has a
  writer: "I've turned 18"
  on the profile screen, which records the `age_18_plus` attestation and then raises the
  column. Fixing it required fixing B27 first — every boot wrote signup metadata back over
  the column, so no correction of any kind could have survived a reload. The profile control
  covers coach and mentor as well as admin, which the nomination handshake §3 proposes would
  not have; what is left of that handshake is in the newer parking-lot entry above. Was:
  **🔴 `age_classification` is a stored fact with no writer and no clock, and it gates admin
  eligibility.** `public.users.age_classification` is `under_13 | 13_to_17 | 18_plus`, asserted
  once at signup, and **there is no birth date anywhere on `users`** — so nothing can recompute
  it. A 17-year-old who turns 18 remains `13_to_17` for ever. Sprint 6 already hit the
  downstream symptom (an under-18 could be nominated as admin, and the refusal landed on the
  student, who could neither act on it nor explain it). This is failure-modes §7 (a value with
  readers and no writer) crossed with §10 (time). **Decided 2026-08-17: do not add a birthday**
  — bolt the confirmation onto Sprint 6's existing nomination handshake instead. Logged here
  because it is live today and independent of Sprint 9's scope.
- **✅ RESOLVED IN SPRINT 9** — `20260822000000_guardian_schema_cleanup.sql:47` drops it
  (`ALTER TABLE guardian_consents ALTER COLUMN version DROP DEFAULT`), before the first consent
  row existed, so the client owns the number as `attestations.ts` says it should. Was:
  **🔴 `guardian_consents.version` has a DEFAULT of `'1.0'` in the database.** This is exactly
  the shape of the Sprint 8 follow-up defect: `handle_new_user` hardcoded the attestation
  version `'1.0'` in Sprint 3, Sprint 6 raised the documents to `2.0`, and from that moment
  every new account was told its documents were out of date. `attestations.ts:81-84` states the
  rule the schema is breaking — the version is a client artefact (`ATTESTATION_VERSIONS`) and
  "duplicating it in a trigger would create two sources of truth that drift on the next legal
  rewrite". **Nothing writes this table yet** (only `src/test/db/fixtures.ts` and the RLS suite;
  both tables are empty locally and production is greenfield), so the default can be dropped
  for a fraction of what it cost last time. Sprint 9 is the sprint that starts writing it —
  drop the default *before* the first consent row exists, and have the client pass the version
  the way signup metadata now does.
- **RESOLVED IN SPRINT 9** — both tables are registry entities with round-trip tests, the
  version DEFAULT and `birth_year` are gone, and there is a client. Was: **The guardian surface
  is schema-only and has no client at all.** `managed_profiles`
  (`guardian_user_id`, `full_name`, `birth_year`, `notes`) and `guardian_consents` have shipped
  since Sprint 3 with RLS and isolation coverage, and `team_members.managed_profile_id` already
  round-trips through the entity registry (`entity-registry.ts:308,320`) — but neither table is
  in the registry, so neither syncs offline. Enrolling them is the same piece of work Sprint 8
  did for `meetings`/`meeting_attendance`, including `REPLICA IDENTITY FULL` if deletes must
  propagate.

*From the 2026-08-16 cross-sprint retrospective (all verified by measurement; none fixed, and
each is deferred because it is scoped work rather than because it is unimportant):*
- **`react-hooks/exhaustive-deps` is written but not enabled — 4 sites.**
  `InviteManager.tsx:109`, `MemberManager.tsx:122`, `Onboarding.tsx:35`, `sync.ts:207`. Each is a
  plain async function redefined every render, so the fix is a `useCallback`, **not** a
  dependency added to the array — adding the dependency without memoising produces the infinite
  render loop that spun ~2M times and wrote a 2.7 GB log in Sprint 6. One of the four is inside
  the sync engine, which principle 2 protects. Needs the four data-loading paths re-verified in a
  browser; turning the rule on in `eslint.config.js` is the last step, not the first.
- **`mockReset: true` fails 39 tests across 3 files.** It is the systemic fix for the Sprint 7
  leak (`vi.clearAllMocks()` clears calls, not implementations, so a `mockReturnValue` leaked a
  signed-out user into every later test and the new panel tests were asserting against the
  landing page). The 39 set their return values at factory scope and expect them to persist, so
  this is a real conversion. Rationale is recorded in `vitest.config.ts` where the flag would go.
- **Two swallowed Playwright *actions* remain** — `scripts/venue-simulation.mjs:123` and
  `e2e/helpers.ts:142`, both `await box.check().catch(() => {})`. This is the exact shape of the
  Sprint 7 defect where the venue simulation "reported success while doing nothing"; both are
  guarded by an `isVisible()` check, which is why they have not lied yet. Ratcheted at 2 in
  `harness-invariants.test.ts`. Swallowing a *wait* is fine; swallowing an *action* is not.
- **Three uses of Node's clock remain in `e2e/meetings.spec.ts`** (lines 52, 156, 350). They
  survive only because they sit far from a day boundary, which is luck rather than design — the
  defect they resemble was green in US Central and red at UTC. Ratcheted at 3.
- **The coverage thresholds are enforced by nothing — and are now also FAILING.** OPS-01
  measured them roughly ten points below the configured floor, so turning the enforcement on
  is no longer a no-op commit; it is a decision about whether to lower the floor or write the
  tests. Package G owns it.
- *(original entry follows)* **The coverage thresholds are enforced by nothing.** `vitest.config.coverage.ts:57-62` sets
  72/67/69/74 under a comment calling it "a ratchet, not an aspiration / never lower to get a
  build green", and **neither the Gate nor either workflow runs `test:coverage`**. It needs
  Docker (it composes the db project), so the cheap version is one step in `ci.yml`'s `schema`
  job, which already has the stack up. Either wire it or stop calling it a ratchet.
- **Nothing typechecks at commit time, and this retrospective proved it on itself.**
  `.husky/pre-commit` runs `lint-staged`, which runs `vitest related --run` and nothing else —
  no typecheck, no lint. Vitest does not typecheck either, so a commit in this very branch
  landed with `TaskType.Build` in a new test file (the enum has only `Feature` and `Bug`); it
  passed the hook, passed the tests it ran, and was caught only by the next `tsc`. Fixed by
  amend. The fix is a `.lintstagedrc` function returning `tsc --noEmit` (the command form
  cannot work, because lint-staged appends filenames and `tsc` then ignores the project
  config). Deferred deliberately: it adds ~10s to every commit Kevin makes, which is his call.
- **There is no `docs/sprint-8-report.md`.** Sprint 8, its merge and its follow-up exist only as
  three rows in this log. Seven sprints have standalone reports; the convention broke without
  anyone deciding to break it. **Sprint 9 wrote `docs/sprint-9-report.md`, so the convention is
  running again from here — Sprint 8 remains the gap.**
- **`supabase/tests/preflight_security_audit.sql` (104 lines) is orphaned** — referenced by no
  script and no workflow, mentioned only in the Sprint 1 report. Wire it in or delete it; a
  security audit nothing runs is the same shape as a check nothing evaluates.

*From the 2026-08-16 planning session (no sprint — found while scoping the deferred auth-email
work above; both verified by reading the code, neither fixed):*
- **✅ RESOLVED IN SPRINT 9.** One `authRedirectUrl()` helper serves recovery, OAuth and email
  confirmation alike, the link lands on `/` with the token intact rather than on a non-hash
  path Pages answers with its own 404, and `/auth/reset-password` is a real route. Proved
  against a real GoTrue and a real message out of Mailpit, and covered by
  `password-recovery.test.ts`. Was:
  **🔴 Password recovery is dead end to end in production, and it is broken twice over.**
  `resetPassword` sends `redirectTo: ${window.location.origin}/auth/reset-password`
  (`src/lib/auth.tsx:433`) — a **non-hash** path, on a HashRouter app, hosted on gh-pages. There
  is no `404.html` anywhere in the repo, so GitHub Pages answers that URL with its own 404 page
  and the app never boots; React Router's catch-all at `App.tsx:273` never runs, because nothing
  ever loaded. Adding a `404.html` alone would **not** fix it: there is no
  `/auth/reset-password` route in `App.tsx` either, so the fallback would match the catch-all,
  redirect to `/`, and silently discard the recovery token. Nobody has hit it because production
  has been greenfield since Sprint 3's reset and Kevin is the only account — but he is also the
  person who has to rotate the password leaked into public git history (see Sprint 7 below), and
  that rotation goes through this exact flow. **This is fixable on its own** and does not need
  the branding work, the SMTP move, or any of the deferred sprint: correct route, correct
  redirect, regression test. The OAuth `redirectTo` at `src/lib/auth.tsx:395` and `:407` has the
  identical non-hash shape and is latent only because no provider is configured — fix all three
  together or the next one to be enabled inherits the bug.
- **✅ RESOLVED 2026-08-22** (`v2/age-classification-writer`). `enable_confirmations = true`
  locally, `registration.spec.ts` walks form → Mailpit → link, and the other fifteen specs take a
  pre-confirmed account through the admin API — the shape drafted below, built as drafted. A new
  test asserts the gap itself, so the pack now fails if the config drifts back. Was:
  **The local stack has never once run the flow every real user takes.** `enable_confirmations
  = false` in `supabase/config.toml:209`, while the hosted project has confirmations **on** —
  so 574 unit tests, 91 integration tests, 16 e2e flows and the venue simulation have all been
  green over a signup path that does not resemble production's. Turning it on locally is one
  line, but it breaks all 16 e2e specs at once, because every one of them goes through
  `signUp` (`e2e/helpers.ts:60`). The shape that was drafted: create pre-confirmed users through
  the admin API for the fifteen specs where email is incidental, and let `registration.spec.ts`
  alone walk the real UI signup and pull the link out of Mailpit's API (already running locally,
  port 54324) — one flow proves the thing and the pack stays fast, which matters because Sprint 7
  found it contention-sensitive enough to need a worker cap. Same class as "CI never ran on
  sprint branches" and "the capture script screenshots the dev server": a gap that stays
  invisible precisely because everything downstream of it is green.

*From Sprint 8:*
- **✅ RESOLVED 2026-08-22** — the config matches production and the smoke pack absorbs the
  difference the way production does; see the entry above. The audit this asked for found its
  first answer immediately: the signup attestation, which migration `20260821000000` had already
  moved server-side for exactly this reason. Was:
  **🔴 THE LOCAL STACK'S AUTH CONFIG DIFFERS FROM PRODUCTION, and it has already made one
  test pass for the wrong reason.** `supabase/config.toml` sets `enable_confirmations = false`;
  the hosted project reports `mailer_autoconfirm: false`. So on a developer machine `signUp`
  returns a session and every client-side "do this right after signing up" path fires, while in
  production there is no session until the user follows an email link. Sprint 7's registration
  smoke test asserts that a brand-new account is not asked to re-accept its documents, passes,
  and proves nothing about the case Kevin actually hit. Anything that must survive the gap has
  to run SERVER-side at account creation (a trigger reading signup metadata) or after the first
  real sign-in. Worth auditing what else assumes a session exists at signup, and worth writing
  the divergence down somewhere a test author will see it.
- **A student's device still HOLDS every check-in code.** The UI no longer hands it over --
  no student-facing route carries a code, and nothing renders one -- so the casual "check in
  from the sofa" path is closed. But `public_code` is a column on `meetings`, the pull fetches
  whole rows, and RLS is row-level: a student who opens devtools can read the code out of
  IndexedDB and check in from anywhere. Closing it properly means the code not reaching the
  device at all, which means moving it to its own table (`meeting_codes`, selectable only by
  `can_manage_meetings`) with `check_in_with_code` reading it as SECURITY DEFINER. That is a
  schema change plus a registry change plus a UI change, and it is the right shape if
  attendance ever has to survive an adversarial student rather than a lazy one.
- **The event form cannot express an event that crosses midnight.** One date field, two time
  fields. The default no longer produces one (it clamps to 23:59), and a user who sets one gets
  a clear refusal, but a genuine overnight competition lock-in cannot be entered as a single
  event. A second date field is the fix if anybody asks.
- **"The live bundle is byte-identical to the local build" is only a real check if the local
  build was made with production env.** Three sprint reports lean on it. After any `test:e2e`
  run the local `dist/` is Playwright's build, which pins the LOCAL stack — so the comparison
  fails for a reason that has nothing to do with the deploy, and would equally PASS while
  hiding a real difference if the two happened to agree. Normalising chunk hashes and diffing,
  then checking the live lazy chunks for the feature's own strings, is the version of this
  check that means something. Same class as the capture note below: a verification step that
  can quietly stop verifying.
- **✅ FIXED.** `npm run capture` builds and serves its own bundle now (`vite preview` on
  port 5197, torn down afterwards), so the images are evidence about a BUILD — which is the
  only thing they were ever meant to be evidence about. `CAPTURE_BASE_URL` still points it at
  a running server, but it warns that doing so opts out of the guarantee. Two things worth
  keeping: the build is given the local stack explicitly rather than inheriting the ambient
  env (`.env.local` points at PRODUCTION), and the teardown kills the process TREE — `shell:
  true` means the child is a shell that spawns npm that spawns vite, and killing the top left
  port 5197 answering 200, which would have failed the next run on `--strictPort`. Was:
  **✅ RESOLVED.** `capture-screens.mjs` builds its own bundle and serves it on its own port,
  and says why in its header. Was:
  **🔴 `npm run capture` screenshots whatever the DEV SERVER is serving, which can be stale
  CSS.** A dev server started before a `tailwind.config.js` change keeps serving the old
  generated stylesheet, so the capture produced a set of images in which the event manager's
  table had silently collapsed to a stack at every width — the class existed in the JSX and
  not in the CSS. The BUILD was correct throughout; only the artifact lied, and it lied in a
  way that looks exactly like a responsive bug. Cost twenty minutes of diagnosing a layout
  that was never broken. The smoke pack does not have this problem because it serves a
  production build through `vite preview`; the capture script should do the same, or at
  minimum refuse to run against a server older than the config it is capturing. Same class as
  Sprint 2's "a stale service worker serves the previous build indefinitely".
- **A coach who is offline while a student checks in ONLINE will dead-letter their override.**
  `setAttendance` reuses the existing local record's id so the coach's change becomes an
  UPDATE, which covers every ordinary case - but a device that has not pulled since the scan
  does not HAVE that record, so it queues a create and meets the `(meeting_id,
  team_member_id)` unique constraint. It lands in Sprint 7's dead-letter review with the
  server's message rather than being lost. Narrow (it needs the students online and the coach
  offline simultaneously) and deliberately not solved with a deterministic row id, which
  would mean a hash function written twice in two languages that have to agree.
- **A student scanning a QR can be met by the re-attestation prompt instead of the check-in
  screen.** Correct behaviour - the documents changed and acceptance is required - but it
  lands at the one moment a student is trying to do something with ten seconds of patience.
  Worth considering whether the prompt should defer on the check-in route specifically.
- **The recurrence RULE of an existing series cannot be edited.** Changing it would mean
  regenerating occurrences that already have codes on posters, so the form offers it only at
  creation; a coach edits or deletes occurrences instead. If a team asks for it, the honest
  shape is "end this series here and start a new one", not a rule edit.
- **`teams` is still not in the entity registry** (carried from Sprint 7). The poster reads
  the team name and number from `state.teams`, which the team picker populates, so it is
  correct - but it is the third feature to depend on a collection with one loader.
- **`MeetingWidget` drags the whole event manager into the ENTRY chunk.** It imports
  `AttendanceBar` from `EventManager.tsx`, and `MeetingWidget` is reached from
  `DashboardHome`, which is deliberately not lazy — so `EventManager` and everything it
  imports ride along in the entry bundle rather than in the meetings chunk. Noticed while
  verifying the deploy: the pencil icon turned up in `index-*.js` rather than in
  `MeetingsPage-*.js`. Harmless today, but Sprint 5 took the entry from 402 kB to 288 kB on
  purpose, so the fix if it matters is to move `AttendanceBar` into its own file.
- **The event manager calls `useRoster` once per row.** Fine at a season's worth of events;
  if a team ever schedules hundreds, the per-row tally wants hoisting into one pass.
- **`attendance_required` has no effect beyond a label.** It renders "Attendance required" or
  "Optional" and nothing consumes it - no reminder, no report column. It exists because 1a
  and 1i both draw the distinction; if nothing uses it by the end of the season, delete it.

*From Sprint 7:*
- **ROTATED 2026-08-22 by Kevin.** The credential in git history is now dead; scrubbing history
  remains optional and remains Kevin's call, and making the repo private would not have fixed it.
  Was: **A real account's password was committed to a PUBLIC repository and is still in git
  history.** `.agent/rules/coding-rules.md` and two `.agent/skills/*/SKILL.md` files carried
  `jkfussell@gmail.com` and its plaintext password as "test credentials". The repository is
  public (an unauthenticated GitHub API call returns 200), and that account is the one holding
  the `platform_operators` row. Removed from the working tree in Sprint 7, but **removal does
  not remove it from history** - the password must be ROTATED, and rotating it is the fix;
  scrubbing history is optional and Kevin's call. The seeded local accounts exist precisely so
  that no real credential ever needs to be written down.
- **Registration logs a 406 and a 409 to the console.** Seen during the venue simulation's
  online phase. `ensureUserProfile` upserts into `users` with `onConflict: 'id'` while the
  `handle_new_user` trigger is inserting the same row, so the two race; the flow succeeds
  either way, which is why nothing has surfaced it before. Noise - but auth-lifecycle noise on
  the one path every user takes exactly once, and it makes a real error in that area harder to
  see. Wants the auth lifecycle opened deliberately, not at the end of a large sprint.
- **`vi.clearAllMocks()` preserves implementations, and this bit once already.** Fixed in
  `Dashboard.test.tsx` by capturing the factory default at import time and restoring it in
  `beforeEach`. Other suites that call `mockReturnValue` on a module-factory mock have the same
  latent shape, and it stays invisible until somebody appends a test to the file.
- **The smoke pack is capped at 4 workers (2 in CI) and that cap is load-bearing.** At
  Playwright's default 8 it failed exactly one test per run, a different one each time, always
  on an app boot or a reload - every spec shares one Postgres and one preview server. Verified
  as contention rather than a defect by running the offline spec serially three times. If the
  pack grows, add workers only alongside a second stack.
- **`teams` is not in the entity registry**, and `setTeams` has exactly one caller (the team
  picker's loader). Sprint 7 worked around it by seeding the store from the create-team write.
  The second place that needs the teams list will hit the same wall; the honest fix is a
  registry entry, which belongs with Sprint 11 (export) or whenever team metadata is next
  touched.
- **Playwright's Chromium is not Safari.** The 16px iOS zoom floor is guarded by a source-level
  test and by computed styles, but genuine Safari zoom-on-focus behaviour still wants a real
  device before teams get the URL. Carried forward from Sprint 6 deliberately.
- **Client errors are not written to Postgres, and `docs/beta-ops.md` says why.** It would need
  a table anyone may INSERT into - an unauthenticated write endpoint on the database holding
  every team's data. If error reporting is wanted properly it is an Edge Function with a rate
  limit, not a table with a permissive policy.


*From Sprint 6:*
- **✅ RESOLVED IN SPRINT 7.** `ci.yml` now triggers on `branches: [main, 'refactor/**',
  'v2/**']` plus `pull_request`, with a comment saying that any new sprint-branch namespace
  belongs on that list on the day it is coined. Was:
  **🔴 CI does not run on sprint branches.** `ci.yml` triggers on `push: branches: [main,
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
- **PARTLY RESOLVED IN SPRINT 8** — `meetings` and `meeting_attendance` are registry
  entities now, with round-trip tests, which is also what enrolled them in the realtime
  subscription. `managed_profiles`, `guardian_consents` and `license_grants` are still out;
  Sprint 9 and Sprint 10 own them. Was: **not in the entity registry.** They have no client consumers yet, and
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
- **✅ ACTUALLY PINNED AS OF SPRINT 8.** This note said the CLI "is pinned to the version CI
  installs", and it was not: both `ci.yml` jobs said `version: latest`, so the local stack was
  pinned to `^2.114.0` and CI floated — the same gap this note describes, facing the other way.
  It also resolves through the GitHub API, which is rate-limited on shared runners and took CI
  red on a DOCS-ONLY commit before a single test ran. Both jobs name `2.114.0` now. Was:
  **The Supabase CLI is pinned to the version CI installs** (2.114). Developing against an
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
