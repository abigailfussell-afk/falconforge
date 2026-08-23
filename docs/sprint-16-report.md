# Sprint 16 — "licence lapse" (SEC-07, WALK-B-12)

**Branch:** `v2/sprint-16-licence-lapse` · **Commits:** `fa706c1..f07dcc1` (7) · off `main` at `a76632c`
**Scope:** exactly two IDs, as given. Everything else found is in the plan's §8 parking lot.
**Decisions consumed:** D3 (30-day probation, 2026-08-23). Nothing contradicted it; one of its
consequences turned out to be larger than the decision text says, and that is §2 below.

`supabase/` was not touched, so this is `npm run gate` rather than `gate:db`. That is itself a
result worth stating: SEC-07's operator half was assumed to need a migration, and it did not —
`operator_team_directory` already returns `valid_until`, so sorting and filtering by it is
client-side work over data the RPC has always sent.

---

## 1. The Gate

```
$ npm run gate
 Test Files  72 passed (72)
      Tests  868 passed | 2 skipped (870)
 Test Files  9 passed (9)
      Tests  95 passed (95)
✓ built in 4.59s
EXIT=0
```

Unit 831 → **868** (+37), integration 95 (unchanged), build green. The two skips are the
`MatchPlanner.test.tsx` drawing block, unchanged and already on the parking lot.

```
$ npm run test:e2e
  33 passed (59.5s)
EXIT=0
```

33/33 across both projects. Run because this sprint touched `sync.ts`, and the e2e pack is the
only thing in the repo that exercises the offline queue against a real Postgres. The known
`meetings.spec.ts:320` flake did not recur.

Ratchets (`harness-invariants.test.ts`, inside the Gate): `as any` 56, arbitrary Tailwind
values 2, `describe.skip` 2, assertion-free test bodies 0 — all unchanged.

---

## 2. SEC-07 — expiry is visible to the operator, and writes are not offered to a lapsed team

### Criterion 1 — "Operator console lists teams sorted by `valid_until` with an 'expiring ≤ 30 days' filter"

**Met.** `OperatorConsole.tsx` gained a three-way filter (all / expiring within
`EXPIRY_WARNING_DAYS` / already read-only), a count that says what it hid ("2 of 5 teams —
soonest first"), and a days-left flag on every row inside the window.

*How verified:* `src/components/__tests__/operator-expiry-view.test.tsx`, 17 tests. The pure
helpers (`orderDirectory`, `daysUntil`) take `now` as an argument so the boundary is pinned at a
fixed instant; four component tests then assert the rendered DOM actually uses them, because a
correct helper behind an unwired `<select>` is `failure-modes` §7.

*Red test:* `puts lapsed teams first, then soonest expiry, then open-ended` and `renders the
directory in expiry order`. Watched red twice, and the first time is the useful one — see §5.

**One judgement inside this criterion.** "Sorted by `valid_until`" taken literally buries a team
whose cover ended last week, because a lapsed team has no in-force grant and therefore a NULL
`valid_until`. That is `failure-modes` §4 in sorting form — absence read as a value — on a list
whose entire purpose is "who needs me". The order is lapsed → soonest → open-ended → name.

### Criterion 2 — "On a lapsed team every content New/Edit/Save control is disabled with the banner's reason (`useSeasonScope().canEdit` includes entitlement — this also closes WALK-B-12)"

**Met in substance; the named mechanism is different, deliberately, and here is why.**

`useSeasonScope().canEdit` cannot include entitlement. `entitlement.ts` imports
`season-scope.ts`, so the reverse import is a cycle; writing the check inside `season-scope.ts`
instead would mean a **second** implementation of "is this team read-only", which is the defect
class this project has hit eighteen times.

What shipped is the composition that already existed and had no consumers. `useAccessState`
was written in Sprint 6 precisely to join the two refusals, with a documented precedence rule
(the archived season wins, because switching season is a click and renewing a licence is a
conversation). It now carries `canEdit`, `editRefusal` and `editRefusalReason`, and
`useSeasonScope.canEdit` was **renamed** to `seasonAcceptsWrites`.

The rename is the load-bearing half. It turned all six call sites into compile errors rather
than a silent behaviour difference, and it leaves **exactly one `canEdit` in the app** — a
component reaching for that name now gets the entitlement-aware one. Two booleans of the same
name that disagree on a team's worst day is `failure-modes` §1 in its purest form, and the app
had precisely that for five sprints with nothing comparing them.

*How verified, in the built bundle:* `scripts/probe-lapsed-writes.mjs` — new, committed,
repeatable — signs in as `lapsed@falconforge.test` against a `vite build --mode development`
bundle served by `vite preview`, walks all five content screens at 375 px and 1280 px, and
reads every write control:

```
6 write controls · 0 not rendered · 0 STILL LIVE · 0 disabled with NO REASON
```

Every one carries `title="Your team's licence has lapsed — read only"`. The walkthrough's
finding was `[lapsed] New Item enabled=true`; the same measurement now reads `disabled: true`.
Images in `screenshots/walkb12/`. Bundle confirmed at `127.0.0.1:54321` with no `supabase.co`
string, service worker cleared, loaded script name compared against `dist/index.html`.

*The probe was watched failing.* Reverting the entitlement branch, rebuilding, and re-running
gives `6 write controls · 0 not rendered · 6 STILL LIVE`, which is the original defect exactly.
The script exits non-zero in that state.

*Red test:* `src/lib/__tests__/lapsed-team-cannot-edit.test.tsx`, 8 tests. Watched red twice:
once with the entitlement branch removed (2 fail), once reverted to the exact pre-sprint
semantics — season-only, one hard-coded reason string (3 fail, including the "no season" case).

**Two things fixed inside this criterion that the walkthrough had not found.**

- **Twenty-one hand-written copies of `'This season is archived and read-only'`** across six
  components, used for all three ways `canEdit` goes false. So a lapsed team read "this season
  is archived" about a season that was not archived, and a user with no season selected read it
  too. Wrong words are worse than none: they send someone to the season picker to fix a licence.
  One `EDIT_REFUSAL_TEXT` map now, three entries. Two components had hand-rolled a "Select a
  season first" branch around the problem; four had not.
- **`AttendanceRoster` gated on `isArchived` alone.** The walkthrough never reached it. A
  lapsed team could tap through an entire meeting's attendance — standing up, at a venue, with
  fifteen students in front of them — and dead-letter every tap. Meeting and attendance writes
  are gated by `team_can_write` exactly like task and scouting writes.

### Criterion 3 — "A write queued *before* lapse and drained after lands in the terminal 'renew and retry' state with the reason shown (rerun the WALK-B probe with the correct selector and screenshot it)"

**Met, and it took three wrong probes to get there. Each wrong one was a finding.**

`scripts/probe-queued-before-lapse.mjs`, new and committed. Final measurement, from reconnect,
**with no reload**:

```
lapsed banner shown at   : 2s
write controls disabled  : 2s   ("Your team's licence has lapsed — read only")
renew-and-retry reason   : 4s
parked changes           : [{ tableName: "tasks", operation: "create",
                              retryCount: 1, terminalReason: "Your team's licence has
                              lapsed… renew the licence and retry this change." }]
sync indicator: "Live / 1 change didn't save / Your team's licence has lapsed, so the server
                 is not accepting changes. Nothing has been lost — renew the licence and
                 retry this change. / Retry it / Review"
```

`retryCount: 1` is the B24 path working as designed: parked because it *cannot* succeed, not
because it ran out of attempts.

**Probe v1 clicked, and found a defect in the app.** It broke as soon as `didn't save` appeared,
and what the panel said at that moment was:

> 1 change didn't save
> They're still stored on this device. **Retry when you have a connection.**

On a device that was online, next to a chip reading "Live", about a problem that is not the
connection. IndexedDB held the correct `terminalReason` the whole time. **Cause:** three
hand-written copies of the same refresh, and one of them carried two of the three values —
`sync()`'s post-drain block set `pendingChanges` and `failedChanges` and left `failureReasons`
on its previous value, so the right sentence only arrived when the 5 s poll next fired. That is
the window in which the user is looking, because the badge appearing is what makes them look.
`failure-modes` §12 with §12's own prescribed fix: `refreshQueueCounts`, derived once, used by
all three sites. Commit `09251db`; red test
`src/lib/__tests__/dead-letter-reason-is-immediate.test.ts`.

The regression test freezes the clock **deliberately**, and this is the part a naive version
gets wrong: with real timers the 5 s poll repairs the omission on its own, so any generous
`waitFor` goes green against the defect by waiting out the window the bug lives in.

**Probe v2 reloaded the page, and the reload was covering for a second defect.** See §3.

**Probe v3 revoked the grant, which is not D3's case.** Revoking with the service key produces
a read-only team, but under a 30-day probation the ordinary way cover ends is that `valid_until`
*arrives*, with nobody doing anything. The final probe sets the grant to expire seconds after
the app has read it, stays offline through the lapse — so the write is genuinely queued-before
and drained-after — and then does nothing at all, which is what a coach at a venue does.

### Criterion 4 (the stated red test) — "`canEdit` false when `entitlement.status === 'read_only'`"

**Met.** `lapsed-team-cannot-edit.test.tsx` → `is FALSE on an open season when the licence has
lapsed`. Watched red with the fix reverted (`expected true to be false`).

That file also pins the thing that makes the fix safe rather than merely correct: **fail open.**
A device that has never read the entitlement view can still edit. `isReadOnly` stays positive
knowledge — `!== 'active'` would pass every other test in the file and lock a coach out of their
own team at a competition because a pull timed out.

---

## 3. WALK-B-12 — the board offers "New Item" to a lapsed team

**Closed by criterion 2 above**, which the exit criteria say it would be. Recorded separately
because the walkthrough's own status line was *"Medium (provisional) … whether the user sees the
terminal message is unverified"*, and it is now verified with numbers.

**And the fix was not complete when the UI was.** This is the sprint's main finding and it is a
direct consequence of D3 that the decision text does not name.

`fetchTeamData` reads `team_entitlement` **once, on arrival at a team**, and `server-pull.ts`
says why in as many words: *"Neither changes on its own between pulls: a licence is granted or
revoked by an operator."* That sentence was true of a 90-day trial. **D3 makes it false.** Under
a 30-day probation the ordinary way a licence ends is that a date passes — which nobody does, so
nothing prompts a re-read.

Two layers were needed, and the second was found only because the probe stopped reloading:

1. `pullChangesFromServer` re-asks the server when the stored `validUntil` has passed.
2. That was **not enough**: `sync()` runs only when `getPendingSyncCount() > 0`, so a client
   with an empty queue never pulls anything at all. A coach with the board open and not typing
   — at a competition, most of the day — would go on being shown live New/Edit/Save controls
   until they queued something or reloaded the tab, and `license_grants` has no realtime
   subscription to tell them either. So there is now a 60-second local check as well.

**The client clock asks a question and never answers one, and that distinction is the whole
design.** The obvious fix — "`validUntil` is past, therefore read-only" — compares a
server-written timestamp against the device's clock, and would lock a perfectly licensed team
out on a school Chromebook running two days fast. That is B4's skew defect pointed at a coach
instead of at a sync cursor, and it is the exact lock-out `entitlement.ts` is written to
prevent. A clock past `validUntil` does one thing: it asks the server again. Worst case, a
wasted query.

Nearly always free: the re-ask returns without a request unless the device *already* believes
cover has ended (never, for a licensed team), and it stops asking once the server has said
`read_only` — so a lapsed team does not query every minute for ever. Both properties have their
own tests.

*Red tests:* `src/lib/__tests__/entitlement-re-ask-on-expiry.test.ts`, 9 tests. Watched red
with the wiring removed from `pullChangesFromServer` (2 fail) and again with the interval effect
removed (1 fail — the idle case, which nothing else covers).

---

## 4. Effort

| ID | Estimate | Actual | Why |
|---|---|---|---|
| SEC-07 | M | ~M, plus half again | The operator half was small and needed no migration. The client half grew two unplanned fixes (§3) that are inside the ID's own sentence — "writes are not offered to a lapsed team" — and would have left the ID half-done. |
| WALK-B-12 | S | S | The one-line change the fix direction describes. Everything expensive was verification. |

---

## 5. What the falsification pass caught, in its own section

Because this is the second time in this project's history that a test went green against the
defect it was written for, and the pattern is worth stating rather than burying.

`operator-expiry-view.test.tsx` was written, run, and passed. Reverting the ranking to a naive
ascending sort on `valid_until` — the exact wrong implementation the test exists to forbid — and
re-running gave **17 passed**. The fixture had named the lapsed team "Alpha Lapsed" and the
open-ended one "Delta Open Ended", so the alphabetical tie-break put both in the right places by
accident. `failure-modes` §2: a test satisfied by a state the defect also produces.

The names now fight the intended order — the lapsed team sorts last alphabetically and must come
first, the open-ended one sorts first and must come last — and the same revert now fails 2. This
was found the only way it is ever found here: by reverting the fix and watching what did *not*
go red.

Three more findings in this sprint came from a probe rather than from the suite (the wrong
sentence in the panel, the reload dependency, the idle client). The running tally in
`failure-modes` §0 is unchanged in shape: **0 of 4 defects this sprint were found by the test
suite**, and all four now have tests.

---

## 6. Not done, and why

- **The operator's "one-click extend to season length"** is Sprint 17's (Package F, D3
  mechanics). This sprint gave the console the ability to *find* the teams that need it; the
  button that acts on them is next.
- **A weekly "expiring soon" email** — SEC-07's fix direction offers it as an alternative to the
  console view, not as an addition. The console view is the one the exit criteria name, and the
  email needs a scheduler and a Resend budget decision. Not started, not needed for the
  criterion.
- **Revocation mid-session** (as opposed to expiry) still needs a reload or a queued write
  before the device notices. That is `server-pull.ts`'s original reasoning holding: an operator
  revoking is a deliberate act with a human on both ends. Parked with the measurement rather
  than fixed, because closing it means either a realtime subscription on `license_grants` or a
  real poll, and neither is justified by anything observed. → §8.

---

## 7. Parking lot entries added

Four, all with numbers, in `FALCONFORGE_V2_PLAN.md` §8. Summarised in §8 of this report.

---

## 8. One line for the plan's §8 Progress log

> **2026-08-23 · Sprint 16 — SEC-07 + WALK-B-12, `v2/sprint-16-licence-lapse`.** Complete,
> merged to `main`. Gate green (lint / 868 unit +2 skipped / 95 integration / build), e2e 33/33
> across two projects; `supabase/` untouched, so no migration — SEC-07's operator half needed
> none, because `operator_team_directory` already returned `valid_until`. **A lapsed team was
> shown a red "read only" banner and a live New Item button underneath it**, and each write
> queued, was refused 42501 and dead-lettered; the server half had been right since Sprint 6, so
> the whole defect was the client offering the write. `canEdit` moved to `useAccessState` (which
> already existed to compose season + licence and had no consumers) and the season-only boolean
> was renamed `seasonAcceptsWrites` — the rename is what turned six call sites into compile
> errors and left exactly one `canEdit` in the app. Twenty-one hand-written copies of "This
> season is archived and read-only" became one three-entry map; the old string was false for two
> of the three refusals. **Three further defects came out of building the probe the criterion
> asks for, none from the suite:** the dead-letter panel said "retry when you have a connection"
> to an online device for up to 5s because one of three hand-written refreshes carried two of
> three values; the device only learned of its own lapse on a page reload, because D3's 30-day
> probation makes expiry a *clock* event and `team_entitlement` was read once per team arrival;
> and an idle client never learned at all, because `sync()` only runs when something is queued.
> Measured end to end at 375px on a `--mode development` build: banner 2s, controls disabled 2s,
> renew-and-retry reason 4s, no reload. The operator console sorts lapsed → soonest →
> open-ended, because "sorted by `valid_until`" literally would bury the teams that already need
> attention. **A test in this sprint passed against the defect it was written for** and was
> caught by the revert pass — see the report's §5.
