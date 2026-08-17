# Failure modes — what keeps going wrong, and what now catches it

Built after Sprint 8 by mining all seven sprint reports, the plan's §8 progress log and parking
lot, and all 34 `fix` commits in the history.

**This is not a style guide.** Every pattern below actually happened, most of them in three or
more sprints, and each entry names the sprint or the commit. Read §0 and the checklist at the
end before starting a sprint; read an individual class when you are about to touch that kind of
code.

Companion documents: `docs/environment-divergences.md` (the detail behind §3) and
`src/test/__tests__/harness-invariants.test.ts` (the checks that hold some of this in place).

---

## 0. The statistic that should change how you work

Where the 34 fix commits were actually discovered:

| Discovery channel | Fixes |
|---|---|
| Running the app — screenshots, a real browser, a second human | **13** |
| The first CI run over a newly-covered surface | 3 |
| Reviewing a previous sprint's own diff | 2 |
| Production data forensics | 1 |
| **The unit suite** | **~0** |

The suite is not useless. It holds 26 documented sync bugs down, and it regularly catches
defects in the *new* code of the sprint writing it — Sprint 6 alone caught a fail-closed
attestation read, an infinite render loop, and mock drift that hung a file for fifteen minutes.

But **it has never been the thing that found a defect that reached a user.** Sprint 7 and
Sprint 8 both say so outright: *"Five defects found by building that tooling, none by the
476-test suite"*; *"Six defects found by looking or by building the tooling, none by the
574-test suite."*

A green Gate is a precondition for being done. It is not evidence of it. The evidence is a
browser, over a real build, at 375px, as the role that will actually use the screen.

---

## 1. One concept implemented N times, then drifting apart

**8 sprints, ~18 instances — the most frequent class in the project's history.**

| Sprint | Instances |
|---|---|
| 1 | **Seven** display-name/initials implementations disagreeing on fallback and word-split; **two** copies of sign-out; two nested `QueryClientProvider`s, the outer applying to nothing |
| 2 | **Three** server read paths, two of which "did not know the first one's rules" and could discard offline work; a `'default'` record id spelled out five times |
| 3 | **Five** overlapping SELECT policies on `team_members` — "the union of five half-remembered intentions"; **five** `!x.seasonId ||` escape hatches |
| 4 | **Six** copies of the season filter; a **fourth** read path in Onboarding that Sprint 2's unification missed; a local delete cascade duplicating the server's |
| 5 | **Two** complete Sidebars; a **third** copy of sign-out in `JoinTeam`; **two** sources for one profile row; a duplicated MatchPlanner toolbar; a hand-listed `resetToDefaults` |
| 5.5 | 8 primary-button recipes, 5 modal widths, 7 input recipes, 3 disabled opacities |
| 7, 8 | `teams` outside the entity registry with one loader — "the third feature to depend on a collection with one loader" |
| 8-follow-up | The document version duplicated into a database trigger, against a code comment saying not to |

Each copy is correct on the day it is written. Nothing compares them afterwards, so they diverge
silently, and the divergence is visible only to someone looking at two screens at once —
*"renaming yourself changed your name in the sidebar and not on your own comments."*

**The load-bearing observation: every deduplication pass in this project has uncovered a
behavioural defect, not just redundancy.** The `"JUNDEFINED"` initials from splitting on a single
space. ScoutingReports never filtering by season **at all**, while the dashboard count beside it
did and disagreed. A sign-out missing its realtime teardown — the one path where a missed step
leaks the previous user's data into the next session on a shared team laptop.

**What to do.** Deduplicate as a defect-finding activity, budgeted, not as tidying. Before adding
a second way to do something, delete the first. Prefer composition over a hand-maintained list
(see §12). This is now CLAUDE.md principle 9.

---

## 2. The test asserts the harness, not the behaviour

**8 sprints, ~14 instances.** The most dangerous class, because it manufactures confidence and
hides every other class on this list. Not "a test was missing" — a test existed, ran, went green,
and was satisfied by a state the defect also produces.

| Where | The non-assertion |
|---|---|
| S1 (**C9**) | 319 lines and 11 tests that never called the transform. *"`transformToSupabaseSchema` could have been deleted outright and the suite stayed green."* |
| S2 | `sign-out.test.ts` proves each teardown step is *called* — "that would still pass if `clearLocalDatabase()` stopped clearing the dead-letter store" |
| S3 (**B21**) | A cross-tenant escalation survived **180** isolation assertions: *"every cross-tenant INSERT the suite tried named the victim's user id. Nobody thought to try naming their own."* |
| S4 | The entitlement-guard test clicked with an empty name, so the handler declined on the name and the test **asserted nothing about licensing at all** |
| S5 | `toHaveBeenCalledTimes(1)` cannot see which columns were requested; `getAllByText(...).length > 0` **accommodated** the duplicated sidebar; JoinTeam's sign-out test asserted a call **both** implementations make |
| S6 (**B25**) | A privilege escalation survived **261** isolation assertions — every policy was correct, and the one RPC with the vulnerable shape had no caller, so nothing ever executed it |
| S7 | The venue simulation matched no elements and swallowed the failure, *"reporting success while doing nothing"*; `REVOKE … FROM anon` was a no-op that *"an assertion over `pg_proc` ACLs would have passed"* |
| S8 | `page.goto` between two **hash** URLs does not reload, so the capture screenshotted the **previous view**; `waitForSync` matched `"Live"`, which is also true in the tick before the queue registers the write |
| S8 retro | `JoinTeam.test.tsx` mocks `useAuth` as a plain `vi.fn()`, which returns happily from an async handler — so it **passed against B26** for eight sprints |

Three variants recur: asserting a spy was called (both correct and broken code call it);
asserting against a mock that cannot represent the property under test; and a precondition that
short-circuits before the assertion is reached.

**What to do.** **Watch every new test fail** — comment out the fix, see it red, put it back. It
is the only countermeasure with a track record here: the adversarial falsification pass is the
sole reason four vacuous tests were ever found. Beyond that: no assertion behind an `if`; assert
arguments, not call counts; and when a mock stands in for an async function, **make it return a
promise** — two mocks were found in this retrospective returning `undefined` where the real API
returns one.

---

## 3. The thing being verified is not the thing that ships

**8 sprints, ~12 instances.** Full detail and the current live divergences are in
`docs/environment-divergences.md`. The shape, stated by the reports three times in near-identical
words: **a gap here stays invisible precisely because everything downstream of it is green.**

The catalogue: schema assertions that run as `postgres` and so cannot see a permission gap, over
migrations that rebuilt a database PostgREST could not read a row of. CI that had never once run
on a sprint branch, so six sprints merged and the first signal always arrived *after* the merge.
A capture script pointed at a dev server still serving the stylesheet it generated at startup —
producing images of a collapsed layout *"that looked exactly like a responsive bug."* A local
auth configuration that has never run the signup path every real user takes. jsdom, which applies
no stylesheet at all. A "byte-identical bundle" check pinned to the local stack. A CLI pin that
was documented and not real.

**What to do.** Never let a verification step inherit ambient environment; pass it explicitly and
assert the target at the network layer. And ask of every check: **what would make this fail?** If
there is no answer, it is decoration.

---

## 4. Absence conflated with a value — NULL, empty, zero, or not-yet-loaded read as an answer

**5 sprints, ~11 instances, and it produced one of the two privilege escalations.**

- **B25** — `current_team_role(t)` is **NULL** for a non-member, so `NULL = 'admin'` is NULL, and
  `IF NOT can_manage_billing(...)` never fired. A SECURITY DEFINER RPC granted to `anon` accepted
  an outsider; exploit confirmed `success: true`. RLS coerces NULL to false, which is why every
  policy was correct and 261 assertions went green over it.
- **B20** — zero checklist rows read as "cleared on another client", so **every brand-new team
  lost its eight seeded pre-match items on first dashboard load.**
- **B18** — `parseInt('')` → `NaN` → `|| 0` → `0` into a NOT NULL column. **5 of 9 live
  production scouting rows were corrupted this way.**
- `seats_total ?? 0` rendered as a denominator: **"Seats in use 4 of 0"**, on the exact screen a
  coach sees when their team has just gone read-only.
- `isAtCapacity: true` for a device that had never read the entitlement. *"'No answer' and 'no
  seats' are arithmetically identical and semantically opposite."*
- A cold deep link reported **"that event is not on this device"** while IndexedDB was still
  rehydrating; a just-created event's code was reported **invalid** when the truth was that the
  create had not drained yet — a false statement about a perfectly good code.
- **Missing empty states**, twice, both hitting a brand-new team on day one: an empty checklist
  rendered "header, rule, white space" (and "blank" is one of the three options the rollover
  wizard offers), and Upcoming Deadlines vanished when empty, restoring the dead space it was
  built to fill — while Recent Activity beside it had an empty state, so **the screen disagreed
  with itself**.

**What to do.** Three states, not two: **loading**, **absent**, **empty**. Before writing `?? 0`
or `|| 0` on a domain value, ask what NULL *means*; usually the type should be `number | null`
and the UI must decide explicitly. In SQL, `coalesce(..., false)` at the root of every boolean
guard — three-valued logic does not reach `IF NOT`. Distinguish hydrating from missing via
`persist.hasHydrated()`. Every list gets a designed empty state: the zero case is not an edge
case here, it is the **first** case every new team meets.

---

## 5. CSS and markup that silently lose — a class in the DOM with no effect

**5 sprints, ~9 instances**, including one live on production for two sprints. CSS is a
resolution system with **no error channel**: the markup reads correctly and something else wins.
Every instance was invisible to the suite, because jsdom renders the broken and fixed versions
identically.

- The iOS **16px zoom floor** was written as `input, select, textarea` (specificity 0,0,1).
  Sprint 5.5 added `.field`, a class (0,1,0) applying 13px. A class beats an element whatever the
  source order, so **every form control in the app was below the floor on every phone** from the
  moment `.field` shipped. Measured at 13px on all seven controls.
- `.safe-area-bottom` **beat** the `p-3` beside it from outside Tailwind's utilities layer,
  computing to 0px on every device without a notch.
- `screens: { tall: { raw: '(min-height: 600px)' } }` parsed, the class was in the markup, the
  build succeeded, and **Tailwind emitted no rule at all** — so `hidden tall:block` was plain
  `hidden` at every height, and an earlier measurement of the fix was partly measuring this bug.
- A toggle knob was `absolute` with **no `left`**: `left: auto` falls at the static position and
  a `<button>` centres its inline content, so it started centred and `translate-x-4` pushed it
  14px past the track. *"It was never positioned; it was placed by accident, and the accident
  looked roughly right at 36px on a laptop."*
- `font-sans` re-applied the system stack over Inter, so the webfont **never rendered a glyph**.
- A `@media (pointer: coarse)` rule matched on a class-attribute **substring**, so `p-` matched
  `placeholder-slate-400` and `pointer-events-none`.
- A `truncate`d stat label that overflowed nothing and clipped nothing — every measurement said
  the layout was fine. **It was simply unreadable** ("SPRINT PROGR…"). Found by looking at an
  image.
- The poster overlay tied `z-50` with the sidebar and, being later in the DOM, painted over
  `ReAttestationPrompt` — leaving a coach unable to dismiss a legal modal.

**What to do.** Geometry assertions in a real browser at 375px, measuring the **computed value**.
Asserting the class is present is what all nine of these would have passed. Precedents:
`src/__tests__/ios-zoom-floor.test.ts`, and the knob-travel and wordmark-centre measurements in
`e2e/`. And look at the screenshots — twice, that was the only thing that worked.

---

## 6. The widest-brush default, granted to unblock something, narrowed only later

**5 sprints, ~8 instances**, including both privilege escalations.

- `GRANT ALL ON ALL FUNCTIONS TO anon` plus matching default privileges, so **every RPC in the
  schema — team administration and licensing included — was EXECUTE-granted to unauthenticated
  callers.** Written to fix a real outage, *"and fixed it with the widest possible brush."*
- **B21** — `team_members_insert_policy` allowed `user_id = auth.uid()`, so any authenticated
  user could join any team as a coach and read everything in it. *"Knowing a team's uuid is the
  entire attack."* Live on production until patched.
- `teams_update_manager` granted UPDATE to admin **or coach**, so a coach could PATCH the pending
  admin field and then accept their own nomination: self-promotion in two ordinary REST requests,
  with neither RPC's authority check running.
- `invites_select_all USING (true)`.
- Sprint 8 found three more as **narrowings of what Sprint 3 shipped**: `can_manage_content` meant
  "any approved member", so a **student** could create events and set anybody's attendance; and
  attendance SELECT was `is_team_member`, so every student could read every other student's
  record over the API — **and these are minors' records.**

The corollary the corpus proves twice: a security suite tests the attack shapes its author
imagined. 180 and 261 green assertions said nothing about the shape nobody tried.

**What to do.** An unblocking grant is a defect with a deadline, not a fix — write it narrow, or
write the parking-lot item in the same commit. Policies name a **capability**, never a membership
test. Write the isolation test from the perspective of the *least* privileged role that can reach
the table, and try naming **your own** id, not just the victim's.

---

## 7. Half a contract shipped — "a gate with no door", and its inverse

**4 sprints, ~7 instances.** The reports coined the name and then hit it twice more. Nothing
fails when a check is never evaluated or a value is never written, so it survives every green
suite.

- `transfer_team_admin` refused `admin` without the successor's attestation, and **nothing in the
  app had ever written one.**
- `SIGNUP_REQUIRED_ATTESTATIONS` was **checked** by `ReAttestationPrompt` and **written by
  nothing**. Traced to a refactor that renamed the parameter to `_isPrivacyAccepted` **to silence
  the unused-argument warning** — so a product whose COPPA posture rests on attestation records
  was not recording the one attestation every user gives, for four sprints.
- `mentor` existed in the schema from Sprint 3 **meaning nothing** until Sprint 8 gave it a
  capability; `assistant_coach` was exposed by the UI and branched on by no code.
- `attendance_required` renders a label and nothing consumes it.

**What to do.** When you add a check, grep for the writer in the same sitting — and the reverse.
**When a tool tells you a value is unused, that is a finding to investigate, not a warning to
silence.** The `_` prefix is how the COPPA gap was introduced, and `noUnusedParameters` honours it.

---

## 8. An enabled affordance whose handler silently does nothing

**5 sprints, ~7 instances.** The control is live, the tap registers, nothing happens, nothing
explains why. At a venue with no WiFi this is indistinguishable from lost work.

- `Save Report` early-returned on an empty team number **with the button enabled**; `Add` ate the
  tap on an empty field.
- **B2** — after five failed attempts the drain called `db.syncQueue.delete()` and logged to the
  console. **The user's work was destroyed with no UI signal anywhere.**
- A push retried with "Unknown error" and the indicator gave no reason: *"the exact silent-write
  failure this sprint exists to prevent, reintroduced by the sprint itself."*
- The sync indicator discarded the pending count while offline, so a team that had worked a whole
  session saw exactly what a team that had done nothing saw — the number returned only when the
  connection did, i.e. when it stops mattering.
- Nominating an under-18 admin **succeeded**, and the refusal landed on the **student** at
  acceptance: the error reached the one person who could neither act on it nor explain it.
- **Keyboard-unreachable controls**, repeatedly: ticking a checklist item went through a clickable
  div/span pair — *on the page whose entire job is ticking items* — plus scouting cards, calendar
  rows, and (found in this retrospective) archived task rows.

**What to do.** A control that cannot act is `disabled` with a `title` saying why, never an
enabled control with an early `return`. Every `catch` either shows the user something or
re-throws. When a rule can refuse, make the refusal reach **the person who can satisfy it**.
Interactive means `<button>` — now enforced by `eslint-plugin-jsx-a11y`.

---

## 9. Record identity chosen for one property and wrong for another

**4 sprints, ~7 instances.** Costly because offline-first makes id selection a distributed
consensus problem: every id must satisfy the column's type, per-tenant uniqueness, **and**
convergence between two devices that cannot talk. Each defect satisfied two and violated the
third, and always surfaced late — as a dead-lettered push with an error the coach cannot act on.

- **C5** — seed ids that were not uuids: the push failed its cast, retried five times, and parked;
  a bad `season_id` took everything created under it down with it.
- Hardcoded uuids **shared by every team**: the second team to push sub-team `657c8820-…` upserts
  onto a row belonging to the first, RLS refuses the UPDATE branch, and *"that team's sub-teams
  never sync, on any device."*
- **C6** — the checklist row id was the **team** id, *"the same trick one level too high: it gave
  every season the same checklist."*
- `setAttendance` reuses the local record's id, so a coach who has not pulled queues a create and
  meets the `(meeting_id, team_member_id)` unique constraint.

---

## 10. Time computed from the wrong clock, or from wall-clock parts that roll over

**4 sprints, ~6 instances.**

- **B4** — the sync cursor stored `Date.now()` (client clock) and filtered against a column
  written by the **server** clock, so a client running fast **silently skipped every record in
  the skew window.** *"School Chromebooks with bad time sync make that routine."*
- The create-event form's default end is `start + 2h`, which crosses midnight **while the form
  has one date field** — so "New event" at 22:15 produced a disabled Save and nothing on screen
  explaining that the form had done it to itself. **Every evening, for the last two hours of
  every day.**
- The same default made CI **red on a UTC runner at 23:32 and green in US Central at 18:32** — a
  five-hour window the suite would have walked into on any timezone. The half-fix still read
  Node's clock rather than the browser's.
- Due dates render **one day early** at negative UTC offsets — a date-only value stored as
  UTC-midnight epoch millis and read with local `getDate()`. The dashboard deadlines panel
  inherited it faithfully. *(Still open — parking lot.)*
- A check-in window seeded once at mount from "the next round hour", so a coach opening the form
  at 7:28pm and setting a 3–5pm meeting was offered 7:45pm–10:00pm.
- `Math.floor` reporting "ends in 0 days" for a licence with eleven hours left.

**What to do.** Server time for anything ordered or compared server-side. The **browser's** clock
in e2e (`page.evaluate`), never Node's — now ratcheted. Any default derived from "now" recomputes
from its inputs, not from mount time, and is clamped to the domain's boundaries. CI runs the unit
suite at UTC **and** at a negative offset, because this project has had defects in both directions
and either zone alone hides one.

---

## 11. The retry or safety timeout is bound to the wrong event

**4 sprints, ~6 instances, all in the two systems the product depends on most.**

- **B23** — the `onAuthStateChange` callback awaited a REST call whose token resolves via
  `getSession()`, needing the auth Web Lock supabase-js was **already holding while waiting for
  the callback**. Self-deadlock; the app hung on "Preparing your workspace…" on any reload with a
  stored session.
- Its successor, three sprints later: `isLoading` was released only inside
  `ensureUserProfile(...).finally()`, and the 5s safety timeout was cleared the moment
  `getSession()` resolved — **including when it resolves with a user**, which is exactly when the
  profile fetch has not started. **The same safety timeout failed to cover the ordering that
  mattered, twice.**
- **B19** — retry was left to a React effect, which fires only when a dependency *changes*. After
  a failure nothing does: `syncStatus` returns to `idle`, `pendingChanges` holds steady, React
  bails out of both `setState` calls. Work sat queued for over a minute after reconnection.
- **B6** — `withTimeout` rejected the outer promise while the work inside kept running, mutating
  the queue as the next run started.
- `onRehydrateStorage` touched `document` unguarded and could land **after** jsdom teardown — an
  *unhandled* error, so the run fails while every test reports passing.

**What to do.** Every await in a callback you do not own gets its own timeout, and never rely on
a timeout something else may clear. Never `await` inside a library callback that may hold a lock.
Retry is a self-re-arming schedule reading the queue, never React state. Anything that can fire
after teardown guards on `typeof document/window`.

---

## 12. A hand-maintained list that must track another list

**4 sprints, 5 instances.** Nothing fails when they diverge; the drift shows up as a missing
behaviour rather than an error.

- **B22** — `seasons` lacked `REPLICA IDENTITY FULL`, so season deletions never reached other
  devices. **The assertion designed to prevent exactly this was itself built from a stale list** —
  written from the tables an earlier fix happened to name, rather than from what the client
  actually subscribes to. It now matches `SYNCED_TABLES`.
- `resetToDefaults` spelled out fourteen keys by hand, where a forgotten key is the previous
  user's data still on screen after someone else signs in on a shared laptop. Now composed from
  each slice's own initial state — the model fix for this class.
- `ci.yml`'s branch list never updated when the sprint naming convention changed: **six sprints
  merged with no pre-merge CI.**
- `meetings`/`meeting_attendance` sat outside the entity registry from Sprint 3 to Sprint 8;
  `teams` still is.

**What to do.** Derive the list from its source of truth, the way `resetToDefaults` now does. If
it genuinely must be hand-written, add the test that compares it to the thing it must track.

---

## 13. An ordering relied upon that the storage layer never promised

**3 instances — and B1 was fixed twice.**

- **B1** — the drain was `db.syncQueue.toArray()`. Dexie returns rows in **primary-key** order and
  the key is `crypto.randomUUID()`, so a delete could apply before its create, or an update before
  its create → fail → 5 retries → silently discarded by B2. The `timestamp` column was already
  indexed and simply never used.
- **B1 again**, a sprint later — with ordering now *by* timestamp, `queueForSync` allocated that
  timestamp **inside** the Dexie transaction, and almost every caller is fire-and-forget, so order
  became whatever IndexedDB scheduled. Season rollover depends on this hardest.
- **B12** — the checklist blob took `records[0]` from a query with **no `ORDER BY`**.

**What to do.** No implicit ordering, ever: `.select()` without `.order()` on a multi-row read is
a bug. Allocate ordering keys **before** entering the transaction that stores them. And when you
fix an ordering bug, ask what else in the same path relies on the same accident — one pass was
not enough.

---

## 14. Redirects that discard the user's intent

**3 sprints, 4 instances**, three of them on paths a user takes exactly once, where nobody is
around to notice.

- Creating a team sent you to the team picker *"to select the team they had finished creating ten
  seconds earlier, from a list with one entry."*
- A QR scan while signed out hit `<Navigate to="/">` and dropped a student on the marketing page.
  Now carries `?next=`, with `readReturnTo` refusing anything that is not a rooted relative path
  — `//evil.example` included.
- Service-worker registration lived inside the app shell, so nothing registered until the user
  had signed in and picked a team.
- **Still open:** password recovery is dead end to end — a non-hash `redirectTo` on a HashRouter
  gh-pages app with no `404.html`, and no matching route, so the catch-all would **silently
  discard the recovery token**.

---

## The meta-class: the fix introduces the next defect

**5 sprints.** Worth naming because it argues for the falsification pass rather than for any code
change. Sprint 4 reintroduced the exact silent-write defect it existed to prevent, and **320
database assertions were green over it.** Sprint 5's density pass produced the truncated labels.
Sprint 6's first terminal-error rule was refused by B19's own regression test. Sprint 7's fix for
the service-worker preset left a coach's **first** visit uncontrolled by any worker. Sprint 7
fixed a re-attestation symptom from the wrong cause and added a smoke test that passes against a
configuration production does not have.

---

## Before you claim a sprint is done

`npm run gate` is a precondition, not evidence. Then:

1. **Run the app** — a real build, in a real browser, at 375px, as every role the feature
   touches. Thirteen of thirty-four fixes came from here and none from the unit suite.
2. **Every new test was watched failing.** If you did not see it red, you do not know what it
   asserts.
3. **Every new list has a designed empty state**, and "missing" is distinguished from "still
   loading".
4. **Every control that can refuse is `disabled` with a reason**, and the refusal reaches the
   person who can act on it.
5. **Anything touching layout, CSS, or z-index has a geometry assertion.** jsdom cannot see it.
6. **Anything touching a date was run at a day boundary and in another timezone.**
7. **Every new policy was tested as the least-privileged role that can reach the table** — and
   from the attacker naming their own id, not only the victim's.
8. **You deduplicated something, and treated what you found as a defect report.**
9. **Ask of each verification step: what would make this fail?** If there is no answer, it is
   decoration. At least eight steps here have gone quietly inert already.
