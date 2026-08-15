# Hand-off — Sprint 4: Season lifecycle

Open a fresh Opus 5 session in `C:\Claude\falconforge` and give it everything below.

---

Read FALCONFORGE_V2_PLAN.md §5 (engineering rules — binding) and §6 Sprint 4, then
execute Sprint 4 under those rules. Branch v2/sprint-4-seasons off main.

Read first, in this order:
  - docs/sprint-3-report.md  — what just landed, and three findings that affect you
  - docs/v2-schema.md        — the schema reference; you are building on this
  - FALCONFORGE_V2_PLAN.md §8 parking lot

THE SCHEMA IS FROZEN. Sprint 3 was the last squash. Everything you need goes in a
forward migration on top of supabase/migrations/20260816*. Do not edit those files.

You will need at least one migration. Sprint 4's brief asks for "name + game title"
on a season and for prior seasons to be read-only; `seasons` has neither a
`game_title` nor an `is_archived` column. Both were deliberately left out rather
than speculated on — add them as you actually need them, with the same treatment
every other column got: a schema assertion if it carries an invariant, and a
behavioural test if it changes what anyone can do.

Sprint 3 context you cannot infer from the code alone:

  - `create_team_as_admin` already does most of what your new-season wizard does:
    it creates a season, five sub-teams and a checklist server-side in one
    transaction. That is the pattern to follow for rollover — an RPC, not a
    client-side loop — and it is why there are no seed constants left in the client.
    Cloning "sub-team structure but never member assignments" is `member_ids => '{}'`
    with fresh uuids under the new season.
  - The checklist row id IS the season id. That convention is load-bearing (it is
    what makes two offline devices converge on one row instead of two) and is
    enforced by `checklists_one_per_season`. A cloned checklist for a new season
    gets the NEW season's id. `is_template = true` rows are exempt from that index
    and are the "optionally from a team template" half of your brief.
  - Seasons and sub-teams are governed by `can_manage_structure` (admin or coach)
    and require the team to be entitled. Rollover is a write; an unlicensed team
    must not be able to do it, and that should have a test.
  - `season_id` is NOT NULL with a composite `(season_id, team_id)` FK everywhere.
    For offline rollover this matters: the season row must reach the server before
    anything referencing it. `SYNCED_ENTITIES` already orders seasons and sub-teams
    ahead of their children, so one drain handles it — but prove it, because your
    exit criteria say rollover works offline.
  - The five `!x.seasonId ||` filters are already deleted. Your `useSeasonScope()`
    work is now deduplicating four copies of `x.seasonId === currentSeasonId`, not
    removing an escape hatch.
  - The store holds `checklistsBySeason` keyed by season and the read path fills
    every season it receives, so season switching is already instant. Nothing
    exercises that properly yet — your rollover tests will be the first thing that
    does.
  - Local season deletion parity (your brief) is real: the server cascades, the
    client does not. Check `deleteSeason` in createSeasonSlice against what the DB
    actually removes.

ONE INHERITED DEFECT YOU MUST NOT SHIP AGAIN.

Sprint 3 left a known gap, recorded in the parking lot, and rollover walks straight
into it. An unlicensed team's writes fail SILENTLY: the row appears in the UI, the
server refuses it (403 from `can_manage_content`, which requires `team_can_write`),
and the sync indicator shows "1 pending" with no reason. Verified in a browser. The
engine is behaving correctly — retry on the backoff schedule, then dead-letter — but
the user is told nothing and the work never lands.

Rollover is a write gated on entitlement, so a lapsed team pressing "new season"
gets exactly this, and it would be the second feature to inherit it. Sprint 6 owns
the full enforcement UX (`team_entitlement` -> read-only banner, lock screens). What
is YOURS is narrower and non-negotiable:

  1. A test that rollover is refused for an unlicensed team. Server-side, behavioural,
     in src/test/db/ — the same shape as the "unlicensed team is read-only" block in
     tenant-isolation.rls.db.test.ts.
  2. The wizard must not silently queue a rollover it cannot complete. Disabling the
     action when `team_entitlement.status = 'read_only'` is enough; you do not have to
     build the banner. Follow the pattern already used for "New Item", which is
     disabled when there is no current season.

If you conclude the honest fix is bigger than that — for instance that `sync.ts`
should classify an entitlement refusal as TERMINAL rather than burning five retries
over nine minutes on something that cannot succeed — say so in your report and leave
it for Sprint 6 rather than widening this sprint. That change touches the sync engine
and needs its own regression tests under rule 6.

Two things outside your scope that may bite you:

  - `.env.local` points at the HOSTED project. Do not overwrite it (Sprint 2 did,
    and it was unrecoverable). For local work write `.env.development.local`, which
    takes priority in dev mode and is gitignored, and delete it when you are done.
    There is a `dev` config in .claude/launch.json on port 5188.
  - The hosted project is ON the V2 schema as of 2026-08-15 and is an empty slate
    (it was reset from the new baseline; the old testing data was discarded with a
    dump kept in backups/). Your migrations are ordinary forward migrations now, so
    `supabase db push` is the right command and will work. It is still production:
    ask before running anything against `--linked`.

Rule 10 is the one that mattered most last sprint: verification is adversarial.
Breaking each invariant on purpose and checking the suite notices found a real
coverage gap that 258 green assertions had not. Do the same to yours.
