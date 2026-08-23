# Handoff — the build queue after the 2026-08-23 production release

Kevin pastes the block below into a fresh session. Everything under it is context for whoever
writes the next one.

---

## The prompt (paste this)

> Continue FalconForge (`C:\Claude\falconforge`). Read `CLAUDE.md`, `FALCONFORGE_V2_PLAN.md`,
> `docs/failure-modes.md`, `docs/environment-divergences.md`, `docs/assessment-2026-08/decisions.md`
> and `HANDOFF_BUILD.md` before non-trivial work. `HANDOFF_BUILD.md` has the sprint order, the
> scoping traps and the environment traps — it is the one written for this queue specifically.
>
> **All nine decisions are answered. Nothing in this queue is blocked on Kevin.** If you find
> yourself about to stop and ask, re-read `decisions.md` first — D1, D5, D6 and D7 were answered
> on 2026-08-23 and the answers are deliberately shaped as "deferred to the Stripe transition",
> which is an answer and not a blank.
>
> **Production is live and current.** 31/31 migrations applied, bundle deployed, nightly backup
> working. `main` deploys on push. Do not push, open PRs, deploy, or apply migrations to the
> hosted project unless I ask. Local branch + local merge is the normal loop.
>
> Work the sprints in `HANDOFF_BUILD.md` in order. One branch per sprint,
> `v2/sprint-<n>-<slug>` off `main`. For each: quote the exit criteria (or write your own and say
> that you wrote them, if the ID has none), name every red test and state that you watched it go
> red with the fix reverted, run the app for anything a user can see, and finish with
> `docs/sprint-<n>-report.md`, a §8 row, and any discoveries in the §8 parking lot with exact
> numbers rather than in the diff.
>
> Do not start P-03 … P-11. They are deferred.

---

## Sprint order, and why this order

Seven sprints. The order is not arbitrary: stability before new writers, and the engine before
the feature that adds writers to it.

### S22 — The September list *(8 items, all S)*

Everything a coach meets in their first ten minutes, plus the one claim that is still believed
rather than measured.

| ID | What |
|---|---|
| `WALK-B-06` | "Welcome back, Pat! 👋" is the first sentence a brand-new coach ever reads. |
| `WALK-B-07` | Two team-number badges, two truncations — `slice(0, 2)` in `Sidebar.tsx:287`, `slice(-3)` in `Onboarding.tsx:447`. Team 30727 reads `#30` in one and `#727` in the other. One helper, both call sites. |
| `WALK-B-10` | A child's name has no length limit. `managed_profiles.full_name` carries only a `> 0` CHECK and `AddChildDialog` has no `maxLength`. Sprint 19 capped eight title/name columns and missed this one — use the same `TITLE_MAX_LENGTH` and the same drift test. |
| `FEAT-14` | Sub-teams cannot be renamed: no update action in `createSubTeamSlice.ts`, no affordance in `SubTeamManager.tsx`. |
| `OPS-08` / `SYNC-12` | 5.13 MiB precache, 3.2 MB of it one 1024×1024 PNG included **four times**; the manifest double-lists three assets. First load on venue WiFi is the product's core promise. |
| `OPS-12` | 19 dependency audit findings — 2 critical, 8 high, all but 2 dev-only. Fix or accept, in writing, with the two non-dev ones named. |
| `OPS-14` / `OPS-15` | Three of six runbook scenarios missing; fresh-clone setup undocumented and fragile in three specific ways. |
| — | **Restore a backup artifact.** Decrypt, load, count rows. Turns the recovery position from believed into known. `docs/beta-ops.md` already records the trap: `SET session_replication_role = replica` is denied to a non-superuser, so the data half loads with triggers live and SEC-01's membership trigger silently rejects rows. A restore that drops the admin's row while reporting success is worse than one that fails. |

### S23 — Edits that are silently lost *(FEAT-03, FEAT-04, FEAT-10)*

Three shapes of the same defect: the user does work and the app throws it away without saying so.

- **FEAT-03** — comments typed on a not-yet-saved task are discarded on Save. `addComment` is
  guarded by `if (!isNewTask)` and `saveTask` passes no `timeline` to `storeAddTask`. Either hide
  the box while new, or thread `timeline` through `addTask`.
- **FEAT-04** — task checklist edits mutate store objects in place, so **Cancel cannot revert**.
  `SprintTaskDetail.tsx:165-179` assigns into items of a shallow-copied array whose objects are
  the store's. Replace immutably; the red test is that Cancel leaves the store unchanged.
- **FEAT-10** — `deleteSeason`'s local cascade omits meetings and attendance while its own
  docblock says the server cascade removes them, and the confirm dialog lists five things and not
  those two. The server FK cascade is real, so the rows go and the local store keeps them.

### S24 — The guardian edges *(SEC-15, SEC-16)*

- **SEC-15** — `addManagedProfile` queues the profile and consent rows, but
  `join_team_with_invite_for_child` refuses unless the consent exists **server-side**. A guardian
  who adds a child and immediately joins a team gets a misleading refusal. Wait for those two
  tables to drain, and say "saving your child's profile…" meanwhile.
- **SEC-16** — deleting a guardian's `auth.users` row cascades through the child's whole history,
  and `sync_user_to_team_members` only touches rows where `managed_profile_id IS NULL`, so a
  guardian's email change never reaches the child's roster row. Note SEC-11 already built
  `operator_erase_user`, which **anonymises rather than deletes** — check what that changes here
  before assuming the cascade is still reachable.

### S25 — The sync engine *(SYNC-13, SYNC-09, SYNC-04, SYNC-06 — in that order)*

**Read CLAUDE.md principle 2 before touching anything here.** `sync.ts`, `offline-db.ts` and
`entity-registry.ts` are hardened against B1–B26 with regression tests. Those stay green. **If a
B-test has to change, that is a finding to report, not a line to edit.** Ordered by increasing
blast radius so each lands on a stable base.

- **SYNC-13** *(venue-urgent — pull it forward if this sprint slips)* — a day offline makes a
  large queue, and the 30 s overall timeout cancels the drain mid-way and reports "Sync failed"
  even though items were pushed. Make the timeout progress-based, or don't enter `'error'` when
  `drain.pushed > 0`.
- **SYNC-09** — two tabs drain the same queue independently and each overwrites `appState` with
  its own copy. `navigator.locks.request('falconforge-sync', …)` with a no-lock fallback.
- **SYNC-04** — one WebSocket per tab with 24 `postgres_changes` bindings each. Subscribe to what
  the route reads; tear the channel down when the tab has been hidden a while.
- **SYNC-06** *(the big one)* — whole-row last-write-wins: an offline edit to one field reverts a
  teammate's change to another, because `update` sends every column from `toRemote(fullLocalRow)`.
  The minimal fix is queueing a **diff** and merging diffs on coalesce. **This interacts with
  principle 3** — every server read must honour `getPendingRecordIds()`, and partial updates change
  what "pending" means for a row. Work that out explicitly and write it down.

### S26 — Scouting that answers questions *(P-02, and FEAT-15 is the same work)*

`FEAT-15`'s fix direction points at "section 3's minimal set", which **is** P-02. One sprint, not
two. Exit criteria exist at `docs/assessment-2026-08/exit-criteria.md:110` — use them:

> per-team summary table (one row per team number, columns from `scoring.metrics`, sortable); team
> detail listing that team's reports; match #, alliance colour and station on the form; CSV export
> of the current event's reports. Works offline, computed client-side from the store. Red tests:
> metric aggregation (mean/max/σ) and a component test for sort.

**Do not re-open the event-data question.** P-02's prose asks for a legal read on the FTC Events
API; **D2 already answered it** and Sprint 18 built the answer — paste-and-parse from the public
page with a load-bearing preview, never fetched server-side. `competition_events` already exists.

### S27 — Consistency and dead code *(FEAT-06, FEAT-07, FEAT-09, FEAT-13)*

Small, and each has a scoping trap where the assessment's fix direction points at deferred work.

- **FEAT-06** — dead d3 "draggable robot" behaviour bound to a class nothing renders, carrying 3
  of the remaining `as any`. The fix direction offers "delete, or implement game-piece tokens";
  the second is P-01 phase M and is not scheduled. **Delete it.**
- **FEAT-07** — the help page tells students to "Drag a card"; the board has no drag-and-drop and
  no DnD dependency. Reword to what ships, and add a source-level ratchet like the existing
  "guidance describes the repo" ones in `harness-invariants.test.ts`.
- **FEAT-09** — two definitions of progress. Sidebar counts Backlog and Archived, the dashboard
  doesn't, so archiving a Done task *lowers* one figure and leaves the other unchanged. The fix
  direction says "fold into the sprint-entity work" — that is P-03 and deferred. **Do it
  standalone:** one `sprintProgress(tasks)` selector, both read it. Principle 9.
- **FEAT-13** — the fix direction is entirely "section 4", which is P-03. **Only the dead-field
  half is in scope:** `Task.tags` is written as `[]`, round-tripped, and has no input anywhere.
  Remove it or give it a UI. The sprint entity is deferred; do not build it.

### S28 — Training UI stub *(D5)*

D5 is answered as a **split**: the content is deferred (it will be AI-generated from FTC and REV
Robotics documentation later), the presentation is not. Settle the shape now, against no content,
because that is cheaper to move than settling it against real content.

In scope: routes, navigation, the unit/lesson structure, what a student sees versus a mentor, and
empty states with a small amount of representative placeholder copy.

Out of scope, and stated so this is not read as "build P-06": authoring tools, progress
persistence beyond what the store already offers, any content pipeline. **If it needs a
migration, it is out of scope.**

---

## Guardrails

**Exit criteria are the definition of done, not the Gate.** Quote each criterion in the report
with how it was verified. Several IDs here have no criteria block — check
`docs/assessment-2026-08/exit-criteria.md` rather than assuming, write your own, and say in the
report that you wrote them. (A previous sprint claimed four IDs had no criteria when they shared
one bullet; the correction is in `docs/sprint-19-report.md`.)

**Watch every red test go red.** Comment out the fix, see it fail, put it back. Then ask of each
verification step: *what would make this fail?* If there is no answer it is decoration. Three
checks in the last three sprints passed vacuously — a probe asserting a button's absence on the
wrong team's panel, and two comparing zero to zero because the seed creates no tasks.

**A green Gate is a precondition, not evidence.** Of this repo's fix commits, roughly zero were
found by the suite. Run the app: a real build, in a browser, at 375 px, as every role the feature
touches.

**Ratchets** — `as any` ≤ 55, arbitrary Tailwind values ≤ 2, `dark:text-slate-500` = 0, coverage
floors 68/60/63/70, no `describe.skip`, no assertion-free tests. They may only go up.

**Anything discovered outside a sprint's IDs** goes to the §8 parking lot with exact numbers, not
into the diff.

---

## Environment traps — all of these cost real time to learn

**Building for the browser.** `npm run build` alone points the bundle at **production**
(`.env.local`). For browser work: `npx vite build --mode development`, then confirm
`127.0.0.1:54321` appears in `dist/assets` and `supabase.co` does not. Never touch `.env.local`.

**Never `git checkout -- <file>` to undo a revert.** It restores from the **index**, not HEAD, and
it has destroyed uncommitted work four times in this project. Commit first, or copy the file to
the scratchpad and copy it back.

**Heredocs mangle backslashes** and backticks inside `git commit -m "..."` are executed by the
shell. Write Python helpers with the Write tool; use `git commit -F -` with a **quoted** heredoc.

**Repo files are CRLF; files written by the Write tool are LF.** A Python patcher must read with
`newline=''` and convert its anchors, or every match fails.

**Docker/psql on Windows.** `MSYS_NO_PATHCONV=1` for container paths. `docker exec` needs **`-i`**
for a heredoc to reach stdin — without it the SQL silently goes nowhere and the next command
reports a confusing failure. `docker cp` under `MSYS_NO_PATHCONV=1` needs a **Windows-style**
source path (`C:/Users/...`), not `/c/Users/...`.

**psql is not the app.** It connects as `postgres`, which SEC-01's admin-protection trigger
exempts — a psql probe of `operator_delete_team` **succeeded** while the same call through
PostgREST was refused. Test security behaviour through a real client with a real JWT.

**`CREATE OR REPLACE` on an existing function:** copy the live body from
`pg_get_functiondef` and patch it. Rebuilding from an older migration silently dropped SEC-01's
transaction-local flag and SEC-09's invite handling once already.

**`npm run gate:db` aborts part-way with exit 127 on this machine** — different suite each time,
never on a failing test, reproduces on commits predating the sprints that found it. Run the
stages individually: `npm run lint`, `npx vitest run`, `npx vitest run --config
vitest.config.integration.ts`, `npm run build`, `npm run db:assert`, `npx vitest run --config
vitest.config.db.ts`, then the same with `rls`.

**An interrupted `test:db` poisons the next run.** Its fixture teams survive at 30001+ and collide
on `UNIQUE (program, team_number)`, taking ~20 suites down with an error about the fixture rather
than the test. `npx supabase db reset --local` first. Same for `npm run seed:review` after any
operator action — an operator who has performed an audited action cannot have their auth row
deleted, because `operator_actions` must name who acted.

**Local postgres is not a superuser**, so `SET session_replication_role = replica` is denied —
which is why a data-only restore loads with triggers live.

---

## If a production change becomes necessary

Only on an explicit instruction from Kevin, and in this order — it is the order `deploy.yml`
already prescribes and the one that caught a real blocker on 2026-08-23:

1. `supabase db dump --linked -f …-schema.sql` **and** `--data-only -f …-data.sql` (a bare
   `db dump` is schema only and would restore an empty database). Verify with
   `grep -c '^INSERT INTO '`.
2. Restore that dump into a scratch database and **run the pending migrations against it**. This
   is what found two production teams sharing team number 30727 before D3's unique index did.
3. Apply with `supabase db push --linked`, then re-run `schema_assertions.sql` against production.
4. Only then push `main`, which deploys.

The nightly backup runs at 07:10 UTC and works. `supabase db query --linked` runs read-only SQL
against production and is the safe way to check something.

---

## Report format (`docs/sprint-<n>-report.md`)

Branch, commit range, the Gate's real numbers stage by stage, each exit criterion quoted with how
it was verified, each red test named with confirmation it was watched failing, what was found by
running the app rather than by the suite, and what was parked. Then the §8 row and the parking-lot
entries.
