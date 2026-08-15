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

Two things outside your scope that may bite you:

  - `.env.local` points at the HOSTED project. Do not overwrite it (Sprint 2 did,
    and it was unrecoverable). For local work write `.env.development.local`, which
    takes priority in dev mode and is gitignored, and delete it when you are done.
    There is a `dev` config in .claude/launch.json on port 5188.
  - The hosted project is behind the repo — these migrations are a squash, not a
    diff, so `supabase db push` will not apply. Kevin has to reset it from the new
    baseline before beta. If your work needs the hosted project, ask first.

Rule 10 is the one that mattered most last sprint: verification is adversarial.
Breaking each invariant on purpose and checking the suite notices found a real
coverage gap that 258 green assertions had not. Do the same to yours.
