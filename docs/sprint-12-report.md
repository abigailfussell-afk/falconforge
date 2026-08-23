# Sprint 12 — Package C, "day-one UI bugs"

**Package:** C — day-one UI bugs (Phase 0), from `HANDOFF_ASSESSMENT.md` §"Sprint packages".
**IDs:** FEAT-01, FEAT-02, FEAT-05, FEAT-12, WALK-A-07, WALK-B-01, WALK-B-02, SYNC-07.
**Branch:** `v2/sprint-12-day-one-ui`, off `main` at `443bb6b` (Sprint 11 merged first).
**Commit range:** `b9ae33c..c779c35` (nine commits; a tenth adds this report and the plan lines).
**`supabase/` touched:** no. No migration, no `db:verify`. The Gate is `npm run gate`; the e2e
pack was run as well because SYNC-07's named red test lives in it.

---

## 1. Gate output

```
$ npm run gate

> falconforge@0.1.0 lint
> tsc --noEmit && eslint src

> falconforge@0.1.0 test:run
> vitest run
 Test Files  65 passed (65)
      Tests  772 passed | 2 skipped (774)

> falconforge@0.1.0 test:integration
> vitest run --config vitest.config.integration.ts
 Test Files  9 passed (9)
      Tests  95 passed (95)

> falconforge@0.1.0 build
> tsc && vite build
✓ built in 5.24s
```

```
$ npm run test:e2e
  21 passed (36.6s)
```

Counts against `main`: unit 748 → 772, integration 95 → 95, e2e 20 → 21. `as any` unchanged at
**56**; arbitrary Tailwind values unchanged at **2**; no `describe.skip` added; `harness-invariants`
green.

`npm run test:db` was not re-run: nothing under `src/lib` that the db suite covers changed, and
`supabase/` was not touched. It was green at 526/526 on this branch's parent.

---

## 2. Per ID

Every one was verified in a **real build against the local stack at 375 px** — the service
worker unregistered, caches cleared, and the loaded script compared to `dist/index.html` before
each measurement (`docs/environment-divergences.md` §4; a stale worker has served a pre-fix
bundle here twice).

### FEAT-01 — comment authors render by name (S · Gate)

> **In the browser: student adds a comment; admin opens the task and sees the student's name and
> initials, not "Guest".**

Met, and done with two real accounts rather than one. `reviewer@` added "Intake jams on the third
cone" on the board; signed out; signed in as `successor@` (a coach on the same team); opened the
same task. The feed reads `IA / Iron Falcons Admin`, and `/Guest/` does not appear anywhere in the
modal.

> **Comments already stored with an auth user id still resolve (reader matches `userId` too).**

Met. The reader tries the member id first and falls back to `m.userId === authorId`. Every comment
written before this change is on a device and in a database with the old value in it, and a fix
that renamed all of that history to "Guest" for ever would be worse than the bug.

That fallback carries `!m.managedProfileId`, which is not decoration: a guardian's roster row holds
THEIR user id and their CHILD's profile — the COPPA model — so matching on `userId` alone would
print a child's name as the author of something an adult wrote. Asserted.

> **Red test:** the fixture in `SprintTaskActivity.test.tsx` writes via the same path
> `SprintPlanning` uses, with a *different* signed-in user than the author (the current fixture
> cannot fail).

Done as `comment-authors.test.tsx` — the round trip crosses the seam the defect lives in, so it
could not go in either component's own file. It renders `SprintPlanning`, adds a comment through
the UI, reads the timeline out of the `updateTask` call (what reaches the database, which is what
every other device renders), then renders `SprintTaskActivity` with a different user signed in.
**Nothing in it constructs an `authorId` by hand** — which is exactly what the old fixture did,
with `authorId: 'member-1'`, a value the writer never produced.

**Watched red:** with both halves reverted, 4 of 5 fail. The fifth is the control — somebody who
has left the team is still "Guest".

### FEAT-02 — archived-season controls (S · Gate)

> **Archived season: task modal Save/Delete/Archive, comment send/delete and Restore are disabled
> with the archived title text; modal opens read-only.**

Met. In the built bundle at 375 px, on the archived season, reading the live DOM:

```
save-task     disabled=true  title="This season is archived and read-only"
delete-task   disabled=true  title="This season is archived and read-only"
archive-task  disabled=true  title="This season is archived and read-only"
comment-send  disabled=true  title="This season is archived and read-only"
comment-input disabled=true  placeholder="This season is archived"
restore-task  disabled=true  title="This season is archived and read-only"
```

"Read-only" is a `fieldset[disabled]` around the modal body rather than eight `disabled` props,
because the ninth field is the one somebody adds next (§12). All eight controls in the modal match
`:disabled` and the textarea refuses focus.

**A verification step that was nearly worthless.** The first browser probe read `.disabled` on each
field and reported `fieldsAllDisabled: false` — because the IDL property reflects the element's own
attribute and says nothing about an ancestor fieldset. The controls were correctly inert the whole
time. Re-probed with `matches(':disabled')` and an actual focus attempt. Worth recording because
the jsdom assertion (`toBeDisabled`) was right and the browser probe was wrong, which is the
opposite of this project's usual direction.

The fieldset was a layout risk jsdom cannot see, so: `document.documentElement.scrollWidth === 375`
at a 375 px viewport — no horizontal overflow. `min-w-0` is on it, because a fieldset defaults to
`min-width: min-content`.

> Modal opens read-only / last season stays browsable.

Met, and three of the eleven assertions are controls for it: the modal still opens with its values,
the feed still renders, an archived task still opens from the list, and Cancel still works. A fix
that simply hid everything would pass every "is it disabled" assertion and destroy the reason
archiving keeps the data.

**Watched red:** ignoring `canEdit` in all three components → 5 fail, 6 controls green.

### FEAT-05 — planner update (S · Gate)

> **Planner: Load → edit → Save updates the same row (`match_plans` count unchanged); "Save as
> copy" available; match # editable.**

Met, and demonstrated in the browser rather than only in the store call. Saved "Match 3"; the Load
list held 1. Loaded it, pressed Save: the modal read **"Update Match Plan"**, `save-target` said
**`Saving over "Match 3".`**, title and match number came back prefilled (`Match 3`, `3`), and
"Save as copy" was offered. Confirmed the update — the Load list still held the same number of
plans afterwards, so nothing was duplicated.

> **Red test:** slice test that `handleSave` with a loaded id calls `updateMatchPlan`.

Done as `MatchPlanner.save.test.tsx`, asserting on the store call rather than the rendered list:
what makes this a duplicate is which row reaches `match_plans`.

**Watched red twice, and the second time is the point.** Reverting `handleSave` to always
`addMatchPlan` turned the update case red. The B18 case (`matchNumber` blank must be `undefined`,
never 0) did **not** go red — because my first revert changed a line the test never reaches. Redone
against the real guard, replacing it with `parseInt(trimmed) || 0` — the exact shape that corrupted
five of nine live production scouting rows — and it went red. A red-test observation aimed at the
wrong line is worth exactly nothing, which is the whole reason the step exists.

### FEAT-12 — due dates one day early

**No exit-criteria block exists for this ID. The definition of done below is mine, written for
this sprint, and stated as mine:**

> 1. A task due on the 15th renders as the 15th on the board, the list, the calendar and the
>    dashboard's deadlines panel, at a negative UTC offset and at a positive one.
> 2. The date input round-trips: pick the 15th, reopen, still the 15th.
> 3. "Overdue" compares two values in the same frame, so a task due today is not overdue at any
>    hour in any zone.
> 4. The suite is actually sensitive to the zone, not merely run in one.

(1) — three of four confirmed in the browser in `America/Chicago`, the zone where it was wrong:
board card `9/15/2026`, list `9/15/2026` with `9/14/2026` absent from the page, dashboard tile
`Sep 15`. The **calendar was not scraped successfully** — the view toggle did not switch under
script control — so it rests on the unit tests, which exercise the same two helpers the dashboard
tile uses (`dateOnlyMonthShort`, `dateOnlyDay`) across five zones. Said plainly rather than counted
as four.

(2) — met: reopened the saved task, the input reads `2026-09-15`.

(3) — met, with the boundary cases: 00:30 and 23:30 local on the due date are both "not overdue",
and `todayAsDateOnly` at 03:00 UTC on the 16th returns the 15th.

(4) — the `inZone` helper was **checked to actually bite** before being relied on: Node re-reads
`process.env.TZ` per operation, verified as 15 (UTC) vs 14 (Chicago) across a switch in the same
process. Without that check the five-zone table would have been five copies of one zone.

One of the twelve assertions asserts **the bug itself** — that `new Date(SEP_15).getDate()` is 14
in Chicago — so if `Date` ever stopped disagreeing with itself the suite would say the fix was
unnecessary rather than passing silently.

**Watched red:** reverting the helpers to local getters and local midnight fails 5 of 12 — and
passes in UTC, Berlin and Kiritimati, which is the bug's actual shape.

### WALK-A-07 — re-attestation "Later" persists (S · Gate)

> **Click "Later" → reload ×3 → the prompt does not return within the snooze window; it never
> renders on `/app/checkin/*`.**

Met, in the browser, with a genuinely stale attestation (set `successor@`'s recorded version to
`1.0` in Postgres, restored afterwards). Prompt appeared; "Later" wrote

```json
{"userId":"cf6ca48e-…","signature":"privacy_and_guidelines@2.0","until":1788064040981}
```

and it did not return on reload 1, 2 or 3. With the snooze deleted, the prompt does **not** render
on `/app/checkin` and **does** render on `/app/board` — the control, without which "never renders"
could be satisfied by never rendering at all.

> **Accepting still records the attestation at the displayed version.**

Met — unchanged path, plus accepting now clears the snooze so it cannot silently cover the next
rewrite for whatever is left of the week.

The snooze is keyed by user id **and** by the exact documents-and-versions dismissed, so a
different user on the same laptop, a new version, an expired window or unparseable storage all show
the prompt. Every "we are not sure" answer asks.

**Watched red:** reverting "Later" to session-only and removing the check-in exemption fails 3,
with the control green.

### WALK-B-01 + WALK-B-02 — guardians can use their own shell (S · Gate)

> **As `guardian@`: sign-in lands on `/app/guardian` (or a picker with "My children" first — state
> which); `/app/profile` and `/app/help` render and stay; "Switch team" does not loop to the
> Welcome screen.**

**Which: sign-in lands on `/app/guardian`.** Confirmed in the browser — signing in as
`guardian@falconforge.test` goes straight to "My children … Robin Fussell … Iron Falcons", not the
Welcome screen. And the routes, each waited out past the shell's 1 s hydration delay:

```
/app/profile  → #/app/profile   (stays)
/app/help     → #/app/help      (stays)
/app/guardian → #/app/guardian  (stays)
/app/board    → #/app/guardian  (redirected — and to their own view, not Welcome)
```

That last line is the two fixes composing: the shell sends a no-team account to `/onboarding`, and
Onboarding sends a guardian to their own view. A guardian who follows a stale deep link now lands
somewhere that makes sense to them.

"Switch team" passes `state: { picker: true }`, so the picker stays reachable for a guardian who
wants to join a team or add a second child — otherwise the button's only effect would be to return
them where they already were.

> **A no-team, no-children account still reaches onboarding.**

Met, and it is the assertion that matters most: a brand-new coach and a guardian both have zero
memberships, so a redirect written as "no teams → guardian view" would strand every new coach on a
page about children they do not have. Two more controls cover a member with a team and a pending
member.

> **Delete or make true the `GuardianOnly` comment in `Onboarding.tsx`.**

Made true, and the comment now describes what happens. `grep -rn GuardianOnly src` had found only
the comment — half a contract documented as whole, §7.

The redirect reads `AppView.requiresTeam` rather than a hardcoded path, so the rule and the route
registry cannot drift apart again; `profile` lost a `requiresTeam` it should never have had, since
it edits the signed-in user and reads no team data.

> **Red test:** AppShell test with `currentTeamId = null` at `/app/profile` asserting no navigation
> after 1.5 s (fails today).

Done, with fake timers so the wait is asserted rather than slept through. **Watched red:** restoring
the hardcoded guardian exemption fails `/app/profile` and `/app/help`; restoring the Onboarding
behaviour fails the guardian landing. Controls green throughout — `/app/board` and
`/app/checkin/:code` still redirect, because a fix of "never redirect" would show a parent a
plausible-looking empty version of a team they are not on, which plan §3 forbids outright.

### SYNC-07 — honest sync status (S · Gate)

> **Built bundle, network cut, `navigator.onLine === true`: indicator shows "Can't reach server"
> (or "Synced · N min ago" with a stale marker), never plain "Synced"; `lastSyncTime` surfaced.**

Met, against a genuinely unreachable server rather than a simulated one:

| | |
|---|---|
| `docker stop supabase_kong_falconforge`, cold reload | `navigator.onLine: true`, label **"Can't reach server"** |
| gateway restarted, sync pressed | label **"Synced · just now"** |

The label never says a bare "Synced" again: it carries the age, or says "Not synced yet" before any
contact, or "Can't reach server". Not "Offline" for that last one — the device thinks it is online,
and saying otherwise sends a coach hunting a WiFi problem their own status bar denies.

**Simulating the cut is where this nearly went wrong.** Overriding `window.fetch` did nothing:
supabase-js resolves its fetch at client creation, so the override never entered the path, and the
first two browser readings were of a perfectly healthy server. Stopping the API gateway is what
made it real.

> **Red test:** add the offline-reload assertion to `e2e/offline-sync.spec.ts` (SYNC-16's third
> spec).

Done. Neither existing offline spec reloads while offline — the first goes back online first, the
second navigates between hash routes without a reload — so `index.html`, session restore and store
hydration with the network down had never been exercised at all.

**Watched red:** against the old bare "Synced" the spec fails with *"the indicator claimed to be
synced after an offline cold boot (navigator.onLine=true)"*, which also confirms the finding's own
claim about `navigator.onLine` after an offline reload. 21/21 with the fix in.

**This fix reintroduced the defect it was written for, and running the app caught it.** The first
version recorded "the server answered" for every pull error, and accepted any string `code` on the
push. Both are wrong, and postgrest-js's own source says why: it **resolves** rather than rejects
when `fetch` fails, and deliberately leaves `code: ''` because "those fields are meant for upstream
service errors". So a dead network was being recorded as a healthy conversation, and the label went
on reading "Synced · just now" with the gateway stopped. One `isServerAnswer` now serves both paths
and requires a non-empty code; its three test fixtures are copied from `PostgrestBuilder.ts` rather
than invented, because inventing them is what produced the bug.

---

## 3. Decisions consumed

**None.** Package C lists no decision dependency and needed none. `decisions.md` D1–D9 are all still
blank; nothing in this work touched pricing, event data, trials, scouting depth, training, the beta
cohort, hosting tiers, content permissions or the nomination gate.

---

## 4. Discovered → parking lot

Five entries added to `FALCONFORGE_V2_PLAN.md` §8:

1. **The Match Planner's saved-plan rows are not buttons** — the Load modal contains three
   `<button>`s, all chrome (one Close, two delete). The row carrying the plan name is a clickable
   `div`, so a plan cannot be loaded from the keyboard. §8's recurring class, fixed in five other
   places already. `eslint-plugin-jsx-a11y` did **not** flag it, so the config is the thing to look
   at.
2. **`lastSyncTime` is now a second answer to a question `server-reachability` answers properly** —
   still tracked in `useSync` and still rendered in the expanded panel, set only when `sync()` runs,
   which never happens on a read-only device. Two sources for one fact inside one component.
3. **The indicator polls a 30 s clock** to keep "3 min ago" true — fine for one mounted indicator,
   wrong the moment there are two.
4. **`it.each` titles in `date-only.test.ts` print raw millisecond counts** — cosmetic, but it is
   the failure message somebody reads at 2am.
5. **OPS-02's seven assertion-free tests are still there**, deliberately: four of them are in
   `SprintPlanning.test.tsx`, which this sprint edited, and they were left alone because they are
   Package G's.

---

## 5. What was **not** done, and why

- **The calendar view's due-date rendering was not confirmed in the browser.** The view toggle did
  not switch under script control. It uses the same two helpers as the dashboard tile, which was
  confirmed, and both are unit-tested across five zones — but it is one renderer verified by
  inference rather than by looking, and it is written down as such rather than counted.
- **OPS-02 itself.** Named in this package's note as the cautionary tale to read, not as scope; it
  is Package G's.
- **`npm run test:db`.** Nothing the db suite covers changed and `supabase/` was untouched.
- **The two duplicate "Match 3" plans and one test task** created during the browser pass are still
  in the local database. It is disposable and was reset before the e2e run; `supabase db reset &&
  npm run seed:review` clears them.

---

## 6. One line for the plan §8 Progress log

Added to `FALCONFORGE_V2_PLAN.md` §8 as the `2026-08-24` row for `v2/sprint-12-day-one-ui` — see
that table. It records the Gate and e2e numbers, the 375 px verification, and the two occasions
this sprint's own fixes had to be caught by running the app: SYNC-07's discriminator and FEAT-05's
mis-aimed red test.
