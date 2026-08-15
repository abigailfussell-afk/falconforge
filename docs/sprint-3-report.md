# Sprint 3 — V2 schema: tenancy, roles, licensing, guardians, meetings · Report

**Branch:** `v2/sprint-3-schema` (local only — not pushed, no PR)
**Date:** 2026-08-15
**Baseline:** verified green before any change — `npm run db:verify` passed against the
pre-squash migrations, so everything below is measured from a known-good starting point.

**The schema is frozen as of this sprint.** From here every change is a forward migration.

---

## 🔴 Read this first — I found a live security hole in the V1 schema

**B21: any authenticated user could join any team, as a coach, and read everything in it.**

V1's policy was:

```sql
CREATE POLICY team_members_insert_policy ON team_members FOR INSERT
  WITH CHECK ((user_id = auth.uid()) OR is_team_coach(team_id, auth.uid()));
```

The first branch lets a user insert a row naming **themselves**, into **any** team, with any
role and `status = 'approved'`. Knowing a team's uuid is the entire attack.

I verified it against the V1 schema before replacing it, as a team A student against team B:

```
tasks_of_B_visible_BEFORE  0
INSERT 0 1                     <- inserted myself into team B as an approved coach
tasks_of_B_visible_AFTER   1
leaked_task                "B secret task"
```

**This is live on falcon-forge.com right now.** No beta teams are onboarded and team ids are
not exposed in the UI, so exploitation requires knowing a uuid — but the anon key ships in
the bundle and a team id appears in every PostgREST request a member makes, so any member of
any team can read one and use it.

Sprint 3's schema closes it (there is no self-insert branch; joining goes through
`join_team_with_invite`, which creates a PENDING member). If merging this sprint is going to
take more than a day or two, **the one-line fix can be applied to the hosted project
immediately**:

```sql
drop policy team_members_insert_policy on team_members;
create policy team_members_insert_policy on team_members for insert
  with check (is_team_coach(team_id, auth.uid()));
```

Nothing in the app self-inserts — `create_team_as_coach` and `join_team_with_invite` are both
SECURITY DEFINER and bypass RLS — so that change breaks no existing flow.

**Why the C7 suite missed it, which matters more than the bug.** All 180 assertions passed
over this schema. Every cross-tenant INSERT the suite tried named the *victim's* user id,
which the policy correctly refused. Nobody thought to try naming their own. A suite that
tests "can I write a row about someone else" is not the same suite as "can I write a row
about me", and the second one is the one that mattered. There is a named `B21` regression
test now, and I have tried to generalise the lesson into the capability tests around it.

---

## What changed

### 1. The squash

Seven migrations became six, archived under `supabase/migrations/_archive/pre-v2/` with a
README of what each one recorded and why. The V2 files are ordered by dependency:

```
20260816000000_v2_tables.sql          tables, constraints, indexes
20260816000100_v2_authorization.sql   role/capability/entitlement functions + the view
20260816000200_v2_rls.sql             enable RLS, every policy
20260816000300_v2_rpcs.sql            client-callable functions and triggers
20260816000400_v2_realtime.sql        replica identity (B7)
20260816000500_v2_grants.sql          API role grants — MUST stay last
```

**The parking lot's red note is discharged.** `20260815000000_api_role_grants.sql` survived
the squash intact, including the `ALTER DEFAULT PRIVILEGES` half — which is the part that
covers the six tables this sprint adds. The grants file's header now explains why it has to
stay last in the file order, and a new assertion (6b) covers views as well as tables, because
`pg_tables` does not list `team_entitlement` and a view the client cannot select from is
exactly as dead as a table it cannot select from.

### 2. Roles and capabilities

`admin | coach | mentor | student`. `assistant_coach` is gone — a fourth name for "not quite
a coach" that the UI exposed and no code branched on, while `mentor` existed in the schema
and was unreachable from the interface.

- **Exactly one admin per team**: `team_members_one_admin_per_team`, a partial unique index on
  `team_id WHERE role = 'admin' AND status <> 'removed'`. That is the "at most one" half; the
  "at least one" half is upheld by `create_team_as_admin` and by `transfer_team_admin` being
  the only supported way to move the role (demote-then-promote in one transaction, because
  the index permits no moment with two).
- **18+ at role grant**: `enforce_member_role_eligibility` refuses admin/coach/mentor to an
  account whose `age_classification` is not `18_plus`, and refuses `admin` to anyone who has
  not accepted the terms. A managed profile can only be a student.
- **Capabilities replace `is_team_coach`**: `can_manage_billing` (admin), `can_manage_roster`
  (admin, coach), `can_manage_structure` (admin, coach), `can_manage_content` (any approved
  member). A policy now reads as the question it is asking.
- **`team_members`' five overlapping SELECT policies became one.** Policies for a verb OR
  together, so five of them meant the effective rule was the union of five half-remembered
  intentions with no single place to read it. Assertion 9 fails if a second one ever appears
  on any content table.

`is_billing_active` became `seat_assigned`, which is what it always meant.

### 3. Licensing, and what "read-only" means

`license_grants` (source `gift|stripe`, seats or per-member, valid_from/until, revoked_at,
created_by, notes) plus a `team_entitlement` view answering "is this team active and how many
seats".

**Enforcement is in the database, not in a banner.** Every content write policy goes through
`can_manage_content`, which requires `team_can_write` — so an unlicensed team can read
everything and write nothing, and nothing is ever deleted for non-payment.

Two decisions worth your review:

- **`can_manage_roster` is deliberately NOT gated on entitlement.** A team whose licence has
  lapsed must still be able to manage who is on it. Locking the admin out of the roster is
  how a licensing problem becomes a support ticket nobody can resolve.
- **`create_team_as_admin` issues a 90-day trial gift grant.** A team with no licence is
  read-only, so self-serve registration has to leave the team entitled or the app is dead on
  arrival. This is the beta bootstrap and it is marked as temporary in the function, in the
  schema doc, and in the parking lot: delete the block when Stripe lands.

The view is `security_invoker = true`, and that is the single most dangerous line in the
schema to lose — without it the view executes as its owner, bypasses RLS on `license_grants`
and `team_members`, and hands every authenticated user the licensing state of every team on
the platform. It is invisible in the view definition, so assertion 12 checks `reloptions`
directly.

Gifting goes through `grant_team_license`, which checks `is_platform_operator()`.
`platform_operators` and `license_grants` have **no write policy at all** — deliberately. An
admin who can licence themselves is not a licensing model.

> **Action for you:** `platform_operators` ships empty. Insert your own row with the service
> key before gifting will work; the SQL is in `docs/v2-schema.md`.

### 4. Guardians (schema only)

A child under 13 has no login. `managed_profiles` is owned by a guardian's account, and the
child's `team_members` row carries the **guardian's** `user_id` plus a `managed_profile_id`.
That is what makes every existing `user_id = auth.uid()` policy do the right thing for a
managed child without a second access path.

The other half is that being responsible for a child on a team does not make the guardian a
member of it: `get_user_team_ids` and `is_team_member` both exclude managed rows. A guardian
reaches their own profiles, their consents and their child's membership row — and not the
team's tasks, scouting data, invites or roster. Widening that is a Sprint 9 product decision.

`guardian_consents` records the guardian's consent per profile, with a composite FK so a
consent cannot be attached to somebody else's child.

### 5. Meetings and attendance (schema only)

`meetings` (team + season scoped, `starts_at`/`ends_at`/`recurrence_rule`) and
`meeting_attendance` (`status`, `attested_by`, `attested_at`). The attestation columns are
the point: an attendance record is a claim somebody made, not a fact the system observed, and
`status` alone would not let a coach answer "who says so?" three weeks later.

### 6. Season scoping is mandatory now

`season_id` is NOT NULL on `sub_teams`, `tasks`, `scouting_reports`, `match_plans`,
`checklists` and `meetings`, and referenced **compositely** as
`(season_id, team_id) → seasons (id, team_id)`. A plain `season_id` FK would let a row in
team A point at team B's season and no policy would notice, because every policy looks only
at `team_id`.

On the client, `seasonId` is required on the four season-scoped types, which makes the
**five `!x.seasonId || x.seasonId === currentSeasonId` filters dead code**. They are deleted.
That escape hatch leaked every season-less record into *every* season — the exact opposite of
the fresh start a new season is supposed to be.

The store's create actions now refuse to make a record with no season instead of queueing a
push that could never succeed, and "New Item" is disabled to match.

**`create_team_as_coach` is `create_team_as_admin`**, takes the season name as an argument,
and the CreateTeam wizard asks for it with `<year>-<year+1> Season` pre-filled. That is what
removes the `'Demo Season'` hardcode.

### 7. C6 — the checklist is per season

One row per season per team, guarded by `checklists_one_per_season`. The store holds
`checklistsBySeason` and components read it through `selectChecklist`; six near-identical
actions collapsed onto one `updateChecklist` helper.

**The row id is the season id.** Blob-synced records have no per-record identity to merge on,
so two devices editing offline must agree on the row id without being able to talk to each
other. Deriving it from the season is what makes their upserts converge on one row instead of
racing to create two. V1 used the team id, which is the same trick one level too high: it
gave every season the same checklist.

A persist migration (v1 → v2) files an existing installation's checklist under whichever
season was current, so nobody loses the list they have been maintaining.

### 8. Client-side seed constants are gone

`DEFAULT_SUBTEAMS`, `DEFAULT_SEASON` and `DEFAULT_CHECKLIST_ITEMS` had hardcoded uuids so
every device would agree on them. Which meant every **team** agreed on them too — and I do
not think this was previously understood:

> The second team to push sub-team `657c8820-…` sends an upsert onto a row that belongs to
> the first team. RLS refuses the UPDATE branch, so the push dead-letters. That team's
> sub-teams never sync, on any device, with an error the coach cannot act on.

Sprint 2's C5 fix made the ids valid uuids, which fixed the cast failure and left this. Under
the V2 schema a seeded *season* is worse again: `season_id` is NOT NULL with a composite FK,
so every task created under a client-only season is unpushable too.

`create_team_as_admin` now creates the first season, its five sub-teams and its pre-match
checklist server-side, with per-team uuids, inside the transaction that creates the team.

---

## Gate output

```
$ npm run lint
> tsc --noEmit
(clean)

$ npm run test:run
 Test Files  27 passed (27)
      Tests  272 passed | 2 skipped (274)

$ npm run test:integration
 Test Files  9 passed (9)
      Tests  83 passed (83)

$ npm run db:verify        # full rebuild from migrations, then 14 assertion blocks
 result
--------------------------
 schema assertions passed

$ npm run test:db
 Test Files  5 passed (5)
      Tests  299 passed (299)

$ npm run test:rls
 Test Files  1 passed (1)
      Tests  258 passed (258)

$ npm run build
dist/index.html                 1.66 kB │ gzip:  0.75 kB
dist/assets/index-*.css        55.44 kB │ gzip:  9.60 kB
dist/assets/charts-*.js        41.18 kB │ gzip: 14.01 kB
dist/assets/vendor-*.js       162.72 kB │ gzip: 53.12 kB
dist/assets/supabase-*.js     171.11 kB │ gzip: 44.20 kB
dist/assets/index-*.js        383.54 kB │ gzip: 98.03 kB
✓ built in 3.77s

PWA v0.17.5 — precache 17 entries (4735.79 KiB)
```

The 2 skipped tests are pre-existing in `MatchPlanner.test.tsx`; no `describe.skip` was added.
Bundle size is +1.1 kB on the main chunk, which is the per-season checklist plumbing and the
extra CreateTeam field.

**`as any`: 71 → 68.** (Sprint 2 reported 66; `main` was at 71 by the time this sprint
branched.) The four the new RLS assertions needed were replaced with `.single<T>()` /
`.returns<T>()`, and three casts in `MemberManager` turned out to be unnecessary against the
regenerated types.

---

## Verified adversarially, not just run

Rule 10 says try to falsify each exit criterion. Three passes:

### The schema assertions bite

Twelve invariants broken one at a time, each inside a transaction that is rolled back. All
twelve were caught:

```
CAUGHT   season_id made nullable                        Season-scoped tables with a nullable season_id: tasks
CAUGHT   composite season FK replaced by a plain one    Season-scoped tables without a composite (season_id, team_id) FK: meetings
CAUGHT   a second SELECT policy on team_members         Tables without exactly one policy per verb: team_members.SELECT x2
CAUGHT   RLS turned off on a new table                  RLS is disabled on: meetings
CAUGHT   a SECURITY DEFINER fn with a loose search_path SECURITY DEFINER functions with an unpinned search_path: sloppy
CAUGHT   team_entitlement without security_invoker      team_entitlement is not security_invoker -- it leaks every team's licensing state
CAUGHT   the one-admin-per-team index dropped           The one-admin-per-team unique index is missing
CAUGHT   the one-checklist-per-season index dropped     The one-checklist-per-season unique index is missing
CAUGHT   API grants revoked from a new table            Tables the API roles cannot use: meeting_attendance (authenticated)
CAUGHT   the entitlement view unreadable by API roles   Views the API roles cannot select from: team_entitlement (anon), ...
CAUGHT   team_members.updated_at removed                Delta-synced tables without updated_at: team_members
CAUGHT   replica identity reverted                      Realtime-subscribed tables without REPLICA IDENTITY FULL: checklists
```

### The behavioural suite bites

Each defect reintroduced into the live schema, suite run, defect reverted:

| Defect reintroduced | Result |
|---|---|
| V1's self-insert branch on `team_members` | **caught** — the B21 test fails |
| `team_can_write` always returns true | **caught** — the read-only test fails |
| `team_entitlement` loses `security_invoker` | **caught** — 2 tests fail |
| `get_user_team_ids` includes managed rows | **not caught, and this found a real gap** |

**The gap, and what it taught.** Dropping the managed-row filter from `get_user_team_ids`
left every guardian assertion green. Chasing that down: the guardian exclusion lives in *two*
predicates, and `team_members_select` filters the subquery inside the leaky policy as well,
so both have to be wrong before anything escapes. What would actually leak is the two
policies that consult `get_user_team_ids` — `users_select_teammates` and
`managed_profiles_select_teammates` — handing a guardian the name and email of every adult
and every child on their child's team. Nothing was watching the roster side. There is an
assertion for it now, and with both predicates broken the guardian block fails 3 tests.

I have left the falsification scripts out of the repo (they mutate a live database), but the
mutations are listed above and are a few lines each to reproduce.

### Run in the browser, end to end

Against the local stack, through the real UI, with `.env.local` untouched (a
`.env.development.local` takes priority in dev mode and was deleted afterwards):

1. Signed in through the real login form.
2. Registered a team through the CreateTeam wizard — the season field was pre-filled
   `2026-2027 Season`, not `Demo Season`.
3. Checked the database: **5 sub-teams, an 8-item checklist whose row id equals the season
   id, entitlement `active`, unlimited seats, 1 seat used, trial valid to 2026-11-13.**
4. The dashboard, checklist and sprint board all loaded the server-seeded data. The task
   modal's sub-team dropdown listed all five; the season selector showed the real name.
5. Ticked "Swap main battery" — synced onto the seeded row, and there is still **one**
   checklist row for the season, which is the convergence property the season-derived id
   exists for.
6. Created a task — landed in Postgres with the right `season_id` and `sub_team_id`.
7. Revoked the licence and tried again: the server refused it (403), Postgres still holds
   exactly one task, and reads kept working.

Step 7 is where the finding below came from.

---

## 🟡 Finding: an unlicensed team's writes fail silently in the UI

**Not fixed — Sprint 6 owns the enforcement UX, and this is what it needs to cover.**

With the licence revoked, creating a task showed the card on the board, the server refused
the insert, and the sync indicator said `1 pending` with no reason given. The engine is doing
exactly what it should — retry on the backoff schedule, then dead-letter — but the user is
told nothing, and the work will never land.

Two things belong in Sprint 6 alongside the planned read-only banner:

1. **Read `team_entitlement` and stop offering writes** when the team is `read_only`, the
   same way "New Item" is now disabled with no season.
2. **Treat an entitlement refusal as terminal.** A 403 from a policy that depends on
   licensing will not succeed on retry, so it should park immediately rather than consuming
   five attempts over nine minutes. That is a change to `sync.ts`'s failure classification
   and wants its own regression test.

Recorded in the plan's parking lot.

---

## Exit criteria

- [x] **Gate + `db:verify` + `test:rls` green** — output above; all seven commands run for
      real, including a full rebuild from migrations.
- [x] **Migrations squashed to a clean baseline, old ones archived** — six files, with a
      README in `_archive/pre-v2/` explaining what each archived migration recorded.
      **The API-role grants survived, including `ALTER DEFAULT PRIVILEGES`.**
- [x] **The five overlapping `team_members` policies consolidated** — one per verb, and
      assertion 9 fails if a second ever appears.
- [x] **Roles `admin|coach|mentor|student`; one admin per team; 18+ at role grant;
      per-capability authorization functions.** Verified adversarially: the second admin
      insert fails on the unique index, a `13_to_17` account is refused the coach role with a
      readable message.
- [x] **`license_grants` + `team_entitlement`; operator gifting; expiry is read-only, never
      deletion.** Enforced in RLS and tested behaviourally in both directions.
- [x] **Guardian model (schema only)** — `managed_profiles` + `guardian_consents`, membership
      referencing either a user or a managed profile, with the visibility rules tested.
- [x] **Meetings/attendance (schema only)** — `meetings` + `meeting_attendance` with
      attestation columns, RLS, and cross-tenant coverage.
- [x] **`season_id NOT NULL` on all season-scoped tables; checklist per season (C6); no
      `'Demo Season'` hardcode.**
- [x] **`database.types.ts` regenerated; entity registry extended; `schema_assertions.sql`
      extended; RLS suite extended to every new table** — including managed-profile access
      and "expired team is read-only", both named in the sprint brief.
- [x] **An ERD/markdown schema doc committed** — [`docs/v2-schema.md`](v2-schema.md).
- [x] **`!x.seasonId ||` escape hatches deleted** — `grep` returns only prose in comments
      explaining why they are gone.

Binding rules held: no `describe.skip` added, no failing test deleted, every B1–B20
regression test still green, `as any` down, and every behaviour change ships with a test that
fails without it.

---

## Also for review

- **`.env.local` was not touched.** Sprint 2 destroyed it; I used a
  `.env.development.local` (higher priority in dev mode, gitignored) pointing at the local
  stack and deleted it afterwards. To repeat the browser walkthrough:
  ```bash
  printf 'VITE_SUPABASE_URL=http://127.0.0.1:54321\nVITE_SUPABASE_ANON_KEY=<local anon key>\n' > .env.development.local
  ```
  A `dev` config was added to `.claude/launch.json` (port 5188) — the dev server avoids the
  stale-service-worker problem Sprint 2 hit with `preview`.
- **Breaking client changes**, if anything outside this branch touches them:
  `TeamMember.isBillingActive` → `seatAssigned`; `role` no longer includes
  `assistant_coach`; `store.checklist` → `checklistsBySeason` (read via `selectChecklist`);
  `setChecklist` → `setChecklistForSeason`; `addTask` returns `string | null`;
  `Sidebar`'s `isCoach` prop → `canManageTeam`.
- **The hosted project is now behind the repo.** These migrations do not apply on top of the
  live schema — they are a squash, not a diff. The greenfield decision says that is fine (no
  production data), but it means `supabase db push` will not work: the hosted project needs
  resetting from the new baseline before beta, and any test account on it will be gone.
  Worth deciding when, given B21 above.
- **Everything discovered outside scope is in `FALCONFORGE_V2_PLAN.md` §8**, including the
  trial-grant removal, the seat-assignment permission gap, and the five new tables that are
  not in the entity registry yet because nothing reads them.

---

## Commits

```
ad55150 feat(db): squash to the V2 schema — roles, licensing, guardians, meetings
bbe30d3 feat(app): move the client onto the V2 model
```
