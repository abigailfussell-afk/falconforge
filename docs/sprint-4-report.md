# Sprint 4 — Season lifecycle · Report

**Branch:** `v2/sprint-4-seasons` (local only — not pushed, no PR)
**Date:** 2026-08-15
**Baseline:** verified green before any change — the Gate, `db:verify`, `test:db` and
`test:rls` all passed on `main` first, so everything below is measured from a known-good start.

**This is the first forward migration on the frozen schema.** `supabase/migrations/20260816*`
were not touched.

---

## The headline

"New season = fresh start" is real, and **a prior season is read-only in the database** rather
than in a disabled button.

A rollover creates the new season, clones the sub-team *structure* with no member
assignments, gives it a fresh checklist, leaves the sprint board, scouting log and match
planner empty, and closes the outgoing season to writes while keeping every row of it
readable. It works with no network and syncs in one drain — verified in a browser with the
connection down.

---

## 🔴 One decision that departs from the hand-off, and why

**The hand-off said rollover should be an RPC, following `create_team_as_admin`. It is
client-side instead.**

The pattern is right for registration: `create_team_as_admin` seeds a team's first season,
five sub-teams and a checklist server-side in one transaction, and registration cannot happen
offline anyway. A rollover can, and Sprint 4's exit criteria require it to: *"works offline
(rollover queued and syncs cleanly)"*. An RPC needs a connection at the moment it is called,
so an RPC-only rollover fails that criterion outright, and an RPC-plus-fallback is two write
paths for one action.

The concern behind the hand-off's advice was that client-side seeding is what produced the
old `DEFAULT_SUBTEAMS` disaster. That was about **hardcoded shared uuids**, not about
client-side creation: every team pushed sub-team `657c8820-…`, the second team's push landed
on the first team's row, and RLS dead-lettered it forever. A rollover generates fresh uuids
per team per rollover, so none of that applies.

`rollOverSeason` is also not a second write path. It composes three things the store already
does — create a season, create a sub-team, write a checklist — through the same
`queueForSync` calls and the same entity registry. An RPC would have been the second path.

The hand-off's other point stands and is what makes this work: `season_id` is NOT NULL with a
composite `(season_id, team_id)` foreign key, so the season row must reach the server before
anything referencing it. That ordering is now proved, not assumed — see B1 below.

---

## What changed

### 1. The migration — `20260817000000_v2_season_lifecycle.sql`

`seasons.game_title` (the FTC game, distinct from the team's label for the year) and
`seasons.is_archived` (NOT NULL, default false).

`season_is_open(season_id, team_id)` gates the **INSERT, UPDATE and DELETE** policy of every
season-scoped table: `tasks`, `scouting_reports`, `match_plans`, `checklists`, `meetings` and
`sub_teams`. `meeting_attendance` is the one table with no `season_id` of its own, so it
reaches its season through `meeting_season_is_open(meeting_id, team_id)`. SELECT is untouched
everywhere — read-only, not hidden.

**Why in RLS rather than in the client.** The client that matters is the one that was offline
when the season rolled over: its copy of the flag is stale, it still believes last season is
current, and every guard in the store passes. That is the same argument Sprint 3 made for
licensing. The client-side half exists so the app does not *queue* a write the server will
refuse.

Two deliberate exemptions:

- **`seasons` is not gated on its own flag**, or archival would be a one-way door recoverable
  only with a service key.
- **A checklist template is exempt** — see the finding below, which is how that was learned.

`is_archived` being NOT NULL is load-bearing rather than tidy: the policies read
`NOT is_archived`, NULL is neither true nor false, and a nullable flag would make a season
with no value silently reject every write. Assertion 14 fails if it is ever relaxed.

### 2. B22 — season deletions never reached other devices

`realtime.ts` subscribes to every entity in `SYNCED_ENTITIES`, and that list has always
included `seasons`. B7's `REPLICA IDENTITY FULL` migration covered five tables and `seasons`
was not one of them — so under the default replica identity a season DELETE emitted no
`team_id`, the subscription's `team_id=eq.<id>` filter could not match, and the event was
dropped before any client saw it. A season deleted on one device stayed on every other one
until the every-5th-pull reconciliation happened to run.

Assertion 5 did not catch it because its list was written from the set of tables B7 happened
to name rather than from what the client actually subscribes to. The list now matches
`SYNCED_TABLES`.

### 3. B1's ordering guarantee was incidental, not guaranteed

`queueForSync` allocated its timestamp **inside** the Dexie transaction. Almost every caller
is a store action that fires it and moves on (`queueForSync(...).catch(console.error)`), so
one gesture leaves several transactions in flight and the drain order became whatever order
IndexedDB happened to schedule them in. Nothing guarantees that.

This surfaced immediately: the first version of the rollover test drained an order that did
not match the order written. Rollover leans on B1 harder than anything before it — one click
queues a season, five sub-teams and a checklist against a NOT NULL composite foreign key.

Fixed by taking the timestamp before awaiting anything. Two regression tests: call order
survives concurrent unawaited writes, and timestamps stay strictly increasing within a
millisecond.

### 4. `useSeasonScope()` — and what deduplication found

Six copies of `x.seasonId === currentSeasonId` across three components became
`useSeasonScoped(items)`, with `useSeasonScope()` answering "which season, and may I edit
it" in one place.

**ScoutingReports never filtered by season at all.** It rendered the store's whole
`scoutingReports` array, so a team's second season listed the first season's opponents mixed
in with its own — with no way to tell them apart, since a report shows an opponent's number
and not a season — while the dashboard's "Scouting Reports" count, which *did* filter,
disagreed with the list beside it. That is exactly what a filter copy-pasted per component
produces, and exactly what a shared hook prevents.

### 5. Season deletion parity

The server cascades; the client did not. Local state kept tasks, sub-teams, reports and plans
pointing at a season id that existed nowhere — they rendered in no season, counted towards
nothing, and survived every pull, because a full pull replaces a collection with what the
server sent and the server had never heard of them.

`deleteSeason` now removes them locally and queues the children's deletes **before** the
parent's. That ordering does double duty: `queueForSync` collapses a delete onto a pending
create by dropping both, so a season created offline and deleted before it ever synced takes
its unsynced children with it rather than leaving creates queued against a season the server
will never have.

### 6. Checklist templates

The brief's "optionally from a team template" is now real: a checklist can be saved as a
template from the Pre-Match Checklist page, templates are read by their own pull, and the
wizard offers them as a rollover source.

A template carries a **generated** id rather than the season-derived one working checklists
use. That convention exists so two offline devices editing the same season converge on one
row; a template is created once, deliberately, by one person, and the season id is already
taken by that season's working checklist. `checklists_one_per_season` already exempted
templates, which is the schema saying the same thing.

Templates share the `checklists` table, so two paths needed guarding: `updateLocalDatabase`
skips `is_template` rows (realtime does not filter them and would otherwise file a template
over a season's working list), and `handleRealtimeDelete` checks the template library before
treating an id as a season id.

### 7. Onboarding's ad-hoc season read is gone

`handleSelectTeam` had its own `.from('seasons').select(...)` with a hand-written row
mapping — a fourth read path that C3 missed because it reads one table on one screen. It
listed columns explicitly (so it silently dropped `is_archived` and `game_title`, and a user
arriving through the team picker would have seen archived seasons as editable), had never
heard of the sync queue (B3, in the one place it had not been fixed), and needed a network,
silently doing nothing without one. `Dashboard` already calls `fetchTeamData` on mount.

---

## Gate output

```
$ npm run lint
> tsc --noEmit
(clean)

$ npm run test:run
 Test Files  28 passed (28)
      Tests  324 passed | 2 skipped (326)

$ npm run test:integration
 Test Files  9 passed (9)
      Tests  87 passed (87)

$ npm run db:verify        # full rebuild from migrations, then 16 assertion blocks
 result
--------------------------
 schema assertions passed

$ npm run test:db
 Test Files  6 passed (6)
      Tests  320 passed (320)

$ npm run test:rls
 Test Files  1 passed (1)
      Tests  261 passed (261)

$ npm run build
dist/index.html                 1.66 kB │ gzip:   0.75 kB
dist/assets/index-*.css        55.97 kB │ gzip:   9.68 kB
dist/assets/charts-*.js        41.18 kB │ gzip:  14.01 kB
dist/assets/vendor-*.js       162.72 kB │ gzip:  53.12 kB
dist/assets/supabase-*.js     171.11 kB │ gzip:  44.20 kB
dist/assets/index-*.js        402.42 kB │ gzip: 102.49 kB
✓ built in 7.82s

PWA v0.17.5 — precache 17 entries (4754.77 KiB)
```

The 2 skipped tests are the pre-existing `describe.skip` in `MatchPlanner.test.tsx`; none was
added. Main chunk +18.7 kB (the wizard, the archived-season states, the template UI, and the
season-scope hooks).

**`as any`: 68 → 67.** Five were added while writing this and then removed —
`pullEntitlement` reads the generated `team_entitlement` view type, and the db suite's
helpers are typed off `Database['public']['Tables']`.

---

## Verified adversarially, not just run

Rule 10. Three passes, and the third one found a defect the first two could not.

### The schema assertions bite

Six invariants broken one at a time, each inside a transaction that is rolled back:

```
CAUGHT   seasons.is_archived made nullable            assertion 14 (is_archived nullable/missing)
CAUGHT   seasons.game_title dropped                   assertion 14 (game_title missing)
CAUGHT   archive gate removed from tasks UPDATE       assertion 15 (a write policy ignores the archive)
CAUGHT   archive gate removed from sub_teams DELETE   assertion 15 (a write policy ignores the archive)
CAUGHT   archive gate removed from meeting_attendance assertion 15 (a write policy ignores the archive)
CAUGHT   seasons replica identity reverted (B22)      assertion 5 (replica identity)
CONTROL  nothing broken                               nothing reported
```

### The behavioural suite bites

Each defect reintroduced into the live schema or the client, the suite run, the defect
reverted:

| Defect reintroduced | Result |
|---|---|
| `season_is_open` always returns true | **caught** — 3 archived-season tests fail |
| `meeting_season_is_open` always returns true | **caught** — the attendance test fails |
| `team_can_write` always returns true | **caught** — including the new unlicensed-rollover test |
| rollover carries member assignments forward | **caught** — 2 tests fail, client and server |
| the archived-season store guards removed | **caught** — 6 tests fail |
| the wizard's entitlement guard removed | **caught, after the test was fixed** (below) |
| ScoutingReports reverted to no season filter | **caught** — the new scoping test fails |
| `deleteSeason` stops cascading locally | **caught** |
| a template reuses the season-derived checklist id | **caught** |
| the archive queued FIRST instead of last | **not caught — and the code comment was wrong** |

**Two things this pass corrected.**

*A test that passed for the wrong reason.* With the wizard's entitlement guard deleted, "queues
nothing even if the click gets through" still passed — because it clicked with an empty name,
so the handler declined on the name and the test asserted nothing about licensing at all. It
types a name first now, and a third case was added; all three fail without the guard.

*A comment that claimed more than the code did.* Moving the archive to the top of
`rollOverSeason` broke nothing, because what actually protects the user's earlier work is
that the **queue appends** — edits made before the button was pressed already hold earlier
timestamps. The position is still last, for the narrower reason that `setSeasonArchived`
mutates the array the clone steps read, but the comment now says what is true.

### Run in the browser, end to end

Against the local stack, through the real UI, with `.env.local` untouched (a
`.env.development.local` takes priority in dev mode and was deleted afterwards):

1. Signed in, opened a team seeded with two tasks, a scouting report and a member assigned to
   the Build sub-team.
2. Opened the wizard: pre-filled **"2027-2028 Season"** from "2026-2027 Season", listed the
   five sub-teams it would copy, and stated that member assignments start empty.
3. **Took the browser offline**, typed a game title, and pressed Create Season. Postgres still
   held one season; the queue held exactly
   `seasons:create → sub_teams:create ×5 → checklists:update → seasons:update`.
4. **Back online.** One drain, `0 pending / 0 dead-lettered`, and Postgres held: the new
   season with `game_title = DECODE`, the old one `is_archived = true`, ten sub-teams (the
   new season's five with **empty** `member_ids`, the old season's Build still holding its
   member), two checklists — one per season, each with `id = season_id` and 8 unticked
   items — and 2 tasks in the old season, 0 in the new one.
5. Switched back to the archived season: banner shown, "New Item" disabled with *"This season
   is archived and read-only"*, checklist Edit and Reset disabled, every sub-team control
   disabled — and last season's tasks and checklist items all still on screen.
6. Revoked the licence: "Start New Season" disabled, with the reason stated in the panel.

Step 5 is where the finding below came from.

---

## 🟡 Finding: I reintroduced the silent-write defect, and the browser caught it

Saving a checklist as a team template **while looking at an archived season** was offered by
the UI and refused by the server. The row appeared in the library, the push retried with
"Unknown error", and the sync indicator said nothing useful — the exact failure this sprint
was written to prevent, reintroduced by this sprint.

The cause: a template's `season_id` records which season it was captured *from*, and
`checklists_insert_content` read that as scope. Neither the unit suite nor the db suite found
it, because both saved templates from an *open* season.

Fixed in the migration rather than by disabling the button: looking back at the checklist a
team spent a season refining is the single most likely moment to want to save one. The
`checklists` write policies now read `is_template OR season_is_open(...)`. Two regression
tests: a template saves from an archived season, and a template cannot be flipped to
`is_template = false` to smuggle a working checklist into a closed season (the UPDATE
policy's `WITH CHECK` sees the row as it would become).

This is the argument for rule 10 in one bug. 320 database assertions were green over it.

---

## Exit criteria

- [x] **Gate green** — output above, all seven commands run for real including a full rebuild
      from migrations.
- [x] **New-season wizard (admin/coach): name + game title.** Both columns added in a forward
      migration, both carried in both directions by the registry, both editable afterwards.
- [x] **Clone sub-team *structure*, never member assignments.** Fresh uuids,
      `memberIds: []`. Asserted client-side, asserted against Postgres after a real drain,
      and falsified on purpose.
- [x] **Fresh checklist, optionally from a team template.** Three sources: the previous
      season's items unticked, blank, or a saved template. The template library is saved from
      the checklist page and read by its own pull.
- [x] **Empty sprint board / scouting / match plans**, with the previous season's rows intact.
- [x] **Roster persists at team level; sub-team assignments reset.** The roster is
      team-scoped and untouched by a rollover; the browser walkthrough shows the old season's
      Build keeping its member while the new season's Build has none.
- [x] **Prior seasons: read-only browsing mode, no edit/queue writes.** Enforced in RLS on
      every season-scoped table, with the client refusing to queue and saying why. A clear
      archived-season banner, rendered once in the shell rather than five times.
- [x] **Season deletion parity: local cascade matches `ON DELETE CASCADE`.** Plus the queue
      cleanup for a season that never reached the server.
- [x] **Single `useSeasonScope()` selector replaces the duplicated filters.** Six copies
      gone; the deduplication found that one view had no filter at all.
- [x] **Rollover integration test** — `season-lifecycle.db.test.ts`: season 2 created, board
      empty, structure cloned without members, season 1 intact and read-only, checklist fresh.
- [x] **Works offline (rollover queued and syncs cleanly)** — asserted in the db suite and
      demonstrated in a browser with the connection down.

### The hand-off's two non-negotiables

- [x] **A test that rollover is refused for an unlicensed team** — server-side, behavioural,
      in `tenant-isolation.rls.db.test.ts` inside the existing read-only block. It covers all
      three writes a rollover makes (the season, a cloned sub-team, the archive) and confirms
      with RLS bypassed that nothing landed, because an empty result from UPDATE is weaker
      evidence than it looks. Verified to fail when `team_can_write` is broken.
- [x] **The wizard must not silently queue a rollover it cannot complete** — disabled when
      `team_entitlement.status = 'read_only'`, with the reason stated. The check is
      `=== 'read_only'`, not `!== 'active'`: a null entitlement means the client could not
      *read* the view, which is not the same as "not licensed", and blocking on it would take
      rollover away from every offline team.

**On the bigger fix the hand-off offered to defer:** `sync.ts` should classify an entitlement
refusal as TERMINAL rather than burning five retries over nine minutes. It is still the right
change and it is still not this sprint's — it touches the failure classification in the sync
engine and needs its own regression tests under rule 6. Left for Sprint 6, in the parking lot,
now with a second case attached to it (an archived-season refusal behaves identically).

Binding rules held: no `describe.skip` added, no failing test deleted, every B1–B21 regression
test still green, `as any` down, and every behaviour change ships with a test that fails
without it.

---

## Also for review

- **`.env.local` was not touched.** A `.env.development.local` pointing at the local stack was
  used and deleted afterwards, as in Sprint 3.
- **A stale dead-letter was sitting in the dev browser profile** from Sprint 3's walkthrough —
  one `tasks:create` against a database that has since been reset. Cleared before testing.
  Worth knowing that the dead-letter store survives a database reset and has no UI for
  inspecting *what* is parked; Sprint 7's "a coach can understand and retry" work should
  cover that.
- **Breaking client changes**, if anything outside this branch touches them:
  `Season` gains required `gameTitle` and `isArchived` (with a persist migration v2 → v3 that
  backfills both); `addSeason` returns `string | null` and refuses without a team;
  `deleteSeason` now cascades locally; store writes are refused for archived seasons.
- **Everything discovered outside scope is in `FALCONFORGE_V2_PLAN.md` §8**, including
  `CreateTeam`'s season-name default rolling over in January rather than at kickoff, and the
  absence of a template management UI.

---

## Commits

```
e6f8e1b feat(db): season lifecycle — game title, archival, read-only prior seasons
742f5ab fix(sync): fix queue order at call time, not at transaction-commit time (B1)
bd6e22b feat(app): season rollover, archived-season read-only mode, and useSeasonScope
5430415 feat(ui): new-season wizard, archived-season state, and the entitlement guard
d31af7e test: cover the season lifecycle, client-side and against real Postgres
f12de80 fix(db): a checklist template is not scoped by the season it came from
<this>  docs: schema reference, README, plan log, and the Sprint 4 report
```
