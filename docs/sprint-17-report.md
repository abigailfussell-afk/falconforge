# Sprint 17 — "the onboarding gate" (D3 mechanics + the rest of Package F)

**Branch:** `v2/sprint-17-onboarding-gate` · **Commits:** `0e5170e..ea45e83` (5) · off `main` at `99086fb`
**Scope:** the D3 mechanics, plus WALK-B-03, B-04, B-05, B-09, B-11. Nothing else.
**Decisions consumed:** D3 (30-day probation), D9 (nomination gate). Both were followed; D3's
consequences turned out to reach further than its own text, and §6 says where.

`supabase/` was touched, so this is `npm run gate:db`, and `npm run db:types` was regenerated.
Three forward migrations.

---

## 1. The Gate

```
$ npm run gate:db
 Test Files  77 passed (77)
      Tests  904 passed | 2 skipped (906)          ← unit
 Test Files  9 passed (9)
      Tests  95 passed (95)                        ← integration
✓ built in 5.07s
 schema assertions passed
 Test Files  25 passed (25)
      Tests  551 passed (551)                      ← db
 Test Files  5 passed (5)
      Tests  343 passed (343)                      ← rls
EXIT=0
```

Unit 868 → **904** (+36), db 545 → **551** (+6 net; 19 new in `onboarding-gate`, 6 in
`walk-b03-b05`, offset by the suite re-running against a reset database). Schema assertions
gained two blocks and were watched failing — §5.

```
$ npm run test:e2e
  33 passed (1.0m)      ← and again: 33 passed (1.0m)
```

**Run twice deliberately**, on a database already holding 39 leftover test teams, because the
first version of the fixture change passed once and failed on the second attempt. §5.

Ratchets unchanged: `as any` 56, arbitrary Tailwind 2, `describe.skip` 2, assertion-free
bodies 0.

---

## 2. D3 — the 30-day probation and the two controls that replaced the licence

D3 has no exit-criteria block; the decision text is the specification. Quoting the parts that
became code, with how each was verified.

### "`create_team_as_admin` grants 30 days automatically"

`v_trial_days constant integer := 30`, and the grant notes say *probation* rather than *trial*
because extension is the normal path.

*How verified:* `src/test/db/onboarding-gate.db.test.ts` → `grants cover ending about 30 days
out`, asserted as a range rather than an instant (the row is written with the server's `now()`
and read back over the wire; an exact comparison would be a test about clock skew). Confirmed
in the built app by `scripts/probe-operator-new-teams.mjs`: `cover before: 30 days`.

*Red test:* watched red with `:= 90` restored — 2 fail.

*Also asserted in `schema_assertions.sql`*, because the number is a product decision that a
later refactor could quietly change: the assertion names SEC-07's original complaint, that 90
days expires mid-season.

### "`teams.program` column (default `'ftc'`, no FRC behaviour) + `UNIQUE (program, team_number)`"

A partial unique index — `WHERE team_number IS NOT NULL AND btrim(team_number) <> ''` — because
a rookie team registering before FIRST has issued a number is a real case in September, and
because `''` is *not* distinct from `''` in an index while NULL is.

*How verified:* six tests in `onboarding-gate.db.test.ts`, including one that bypasses the RPC
entirely with the service key and expects `23505` — the RPC's check is ergonomics, the index is
the rule — and one that puts the same number in `frc` and expects it to succeed, which is the
only thing `program` currently does.

*Red test:* `refuses a number another team already holds, and names the team`, plus two others.
Watched red with the taken-number branch bypassed — 3 fail.

*The migration refuses to run on a database with existing duplicates*, naming them, rather than
picking a winner. Production is migrated by hand before merge, so an exception there is a
conversation. **The local database had 29 teams sharing `9911`** when this started — see §5.

### "Claiming a taken number routes to request to join, reusing the existing pending membership status and join RPC. Do not write a second join path."

**Interpreted, and the interpretation is worth Kevin's eye.** The refusal returns
`error_code: 'team_number_taken'` with the team's **name**, and `CreateTeam` shows a screen that
routes to the existing `/join` page. It does **not** create a `request_to_join_team(team_id)`
RPC, for two reasons:

1. D3 says not to write a second join path, and an invite code is what the existing one takes.
2. A request-to-join that needed only a team NUMBER would let anyone attach a pending row to
   any team by guessing five digits. B21's lesson was "knowing a team's uuid is the entire
   attack"; a number is far easier to guess than a uuid. The blast radius would be a nuisance
   approval queue rather than data access — but it is a new surface opened to close a
   correctness finding.

**So a coach who claims a taken number cannot self-serve into that team; they must get a code
from its admin.** If Kevin meant something stronger by "request to join", this is the line to
change and it is one RPC.

The refusal deliberately returns the team's **name and not its id** — asserted separately, in
`does not hand the caller the id of a team they are not on`, because it is exactly the kind of
thing a later "make the error more helpful" change undoes. A caller who *is* on that team gets
`already_on_team` **and** the id, because sending a team's own admin into a queue for their own
team would be absurd, and because they could read that row anyway.

*How verified end to end:* `e2e/team-number-uniqueness.spec.ts`, two specs, on a real build
against real Postgres — two accounts in separate browser contexts, the second told which team
has the number and routed to `/join`, and a second spec proving the typo case has a way back
and completes. Watched red with the client branch bypassed: `expect(locator).toBeVisible()
failed / Timeout: 30000ms`.

### "One auto-created team per account; a second needs an operator grant. This closes SEC-08's unlimited trial chaining."

Counted on `teams.owner_id`, not on trial grants: "how many teams did you create" is the
question. A person can be a coach on three teams and that is normal; creating three is what
this stops.

The permission is a new `extra_team_grants` table, single-use. **A separate table rather than a
row in `operator_actions`, and the reason is a column:** `operator_actions.team_id` is NOT NULL
and references `teams`, and this grant exists precisely when there is no team. Borrowing it
would have meant making that column nullable — weakening an audit table so a different feature
could reuse it.

*How verified:* four tests, including `granting twice is idempotent` (an operator saying yes
once and losing the tab must not buy two teams), `a non-operator cannot grant themselves an
extra team`, and `the grant table is invisible to the user it names` — the last written from
the least-privileged role over PostgREST rather than over the catalogue.

*Red test:* `refuses a second team, and says how to ask` — watched red with the check bypassed,
2 fail.

### "Operator console: new-team list (number, name, age, whether it has been used) and a one-click extend to season length. Today the grant is SQL in `docs/v2-schema.md`."

Built as `operator_new_teams` + `operator_extend_to_season`, and a panel above the directory.

**`has_been_used` is the field that carries the decision**, and it is deliberately generous
about what counts — a second person on the roster, or any content row at all — because the
question the operator is answering is "is this real", not "is this active". A fake team and a
real one are identical on number, name and age.

The extension **appends a grant and leaves the probation in force** rather than editing it.
`team_entitlement` takes the MAX of in-force end dates, so the longer one wins and the shorter
one stops mattering; editing it would erase the fact that a probation ever happened, which is
the fact an operator wants six months later.

*How verified in the built app*, since the console is on its own route behind
`is_platform_operator()` and the e2e pack does not reach it —
`scripts/probe-operator-new-teams.mjs`, at 375 px, on a `--mode development` build:

```
FTC 83582 D3 Probe Robotics · Nobody has used it yet
Probe Coach · d3-probe-…@falconforge.test
Registered today · 1 member · cover until Sep 22, 2026
  → "Extended to Apr 30, 2027. The probation row is kept, so the audit trail still shows one happened."
cover after : 2027-04-30T23:59:59+00:00 (is_probation false)
grants      : 2, revoked: 0
horizontal overflow at 375px: false
PASS
```

`docs/v2-schema.md` no longer describes the extension as SQL to paste into psql.

*The season end is computed*, not a constant: "the next 30 April strictly after now", so a team
extended in October 2026 and one extended in February 2027 both land on 2027-04-30 rather than
eighteen months apart. A constant that has to be edited every August is `failure-modes` §12
with a one-year fuse.

---

## 3. WALK-B-03, B-04, B-05 — quoted from `exit-criteria.md`

### B-03 — *"`managed_profiles.promoted_to_user_id`/`promoted_at` written by `claim_managed_profile`; guardian view shows 'Now has their own login' with no join/offer actions; registry round-trip test."*

**All three met.**

*How verified:* `src/test/db/walk-b03-b05-promotion-record.db.test.ts` (columns written, second
code refused, profile and consents kept, guardian cannot write the columns themselves — the
last over PostgREST as the real role) and the registry round-trip in `entity-registry.test.ts`,
where the two new fields are declared `serverAssigned`.

*Red test:* `writes promoted_to_user_id and promoted_at on the profile`, watched red with the
UPDATE's two new SET clauses removed.

**Two things the criterion did not ask for and this shipped anyway**, both inside the ID:

- The **FK is `ON DELETE SET NULL`, not CASCADE**. CASCADE would delete the `managed_profile`
  when the promoted account is deleted, taking the **guardian consents** with it — and plan §3
  is explicit that the profile and its consents are retained as the record of why a minor was
  rostered. There is a test for it.
- `offer_managed_profile_promotion` **refuses** a second code, not just the button being
  hidden. The walkthrough found the button still offered and recorded that it never tried it;
  a rule that lives only in the UI is `failure-modes` §7, and one that lives only in the server
  leaves an affordance that does nothing, which is §8. Both halves.

`fromRemote` keeps NULL as `null` rather than flattening to `''`/`0`. `promotionCode` uses `''`
for "none" because a code is a string; a timestamp cannot borrow that trick — `0` is 1 January
1970, and B18's `parseInt('') → NaN → || 0` corrupted five of nine live production rows through
exactly that reflex.

### B-04 — *"hit `/#/join/CODE` signed-out → sign up → confirm → onboarding offers 'Join &lt;team&gt; with CODE' first; code cleared on use. Red test: Onboarding renders the stored-code action."*

**Met, with one honest deviation: the action says "Join a team with your code" and shows the
code, not the team's NAME.** Signed out, the client has only the code — the team's name is
knowable solely by calling the join RPC, which is a write. Naming the team would need either a
public code→name lookup (an enumeration oracle over every invite code in the platform) or a
speculative join. The code is what the student needs to recognise and to read back to a coach
who typed it wrong.

*The root cause was worse than "the code is lost".* The signed-out page linked to
`/login?redirect=/join/CODE`, and **nothing has ever read `redirect`** — this app's parameter is
`next`. A gate with no door, `failure-modes` §7, and the kind that survives forever because a
link that goes somewhere plausible looks like it worked.

*And renaming it would not have been enough*, which is why there is a storage module and not a
one-word fix: production sign-up is a round trip through **email**
(`environment-divergences.md` §1), so the confirmation link starts a fresh navigation with none
of the original query on it, and on a phone the tab it came from is gone. Both are fixed —
`loginWithReturnTo` for a plain sign-in, storage for the sign-up that `next` cannot survive.

*Red tests:* `src/pages/__tests__/onboarding-stored-invite.test.tsx` (5) and
`src/lib/__tests__/pending-invite.test.ts` (12). The "offered first" assertion is by **DOM
order**, not by reading the code back — an action that renders below "Create a Team" satisfies
the letter of the criterion and none of it.

*Cleared when the code is TRIED, not when it succeeds*: a code the server rejected as expired
must not reappear as the first suggestion on every later visit, offering the same dead end for
ever.

### B-05 — *"pending screen advances to the team within 30 s of approval without a manual reload (poll or realtime); a signed-in approved member hitting `/join/CODE` is sent into the team."*

**Both met.** An 8-second poll (`src/lib/approval-watch.ts`), and
`join_team_with_invite`'s "already a member" refusal now carries the team id.

*A poll rather than realtime, and the choice is not laziness.* `team_members` is in the
publication, but `realtime.ts`'s subscription is scoped to a team the user is already in —
which is exactly what a pending member is not. A channel per pending membership, on a screen
that lives ninety seconds, is teardown to get wrong; `failure-modes` §11 is four sprints of
timeouts bound to the wrong event. A `select` every eight seconds has none.

*Red tests:* `src/lib/__tests__/approval-watch.test.tsx` (7). The three that matter are not
"does it poll":

- **it reports a TRANSITION, not a state.** The join page is reachable from inside the app, so
  most people who see it already hold an approved membership; a hook firing on "you are
  approved somewhere" would eject them from the page they deliberately opened.
- **it issues no query at all when switched off** — asserted on a call log rather than a spy
  count, because "was called" is true of both the correct and the broken version.
- **it asks only for this account's own memberships**, asserted at the query shape, because the
  mock's rows cannot express `managed_profile_id` and asserting on them would be decoration.
  A guardian walked into their child's team is the act-as mode plan §3 rules out.

*One thing the first version got wrong and the falsification pass caught:* the test used
`waitFor` under fake timers, which schedules real-clock retries and sat there for fifteen
seconds before failing. The flush is by hand now, and the comment says why.

---

## 4. WALK-B-09 and WALK-B-11 — definitions of done written by this sprint

Neither has a block in `exit-criteria.md`. **These were written here**, the way Sprint 11 did
for SYNC-15, and they are restated verbatim in
`src/components/__tests__/walk-b09-b11-labels-and-picker.test.tsx`.

### WALK-B-09 — "A brand-new self-serve team is labelled 'Gifted licence'"

**Definition of done (Sprint 17's):**
1. A team on the automatic grant is not described as having been gifted anything.
2. The words say what happens next — the operator extends it — rather than only counting down,
   because under D3 extension is the normal path.
3. A team that really *was* gifted a licence still reads "Gifted licence".
4. The two are told apart by a **server-supplied fact**, not by client arithmetic over the
   expiry date.

(4) is the one worth arguing. The tempting shortcut is "cover ends within ~30 days, therefore
probation", which relabels a genuine 30-day gift and flips a probation to "Gifted licence" on
day 2 of its second month. The test that pins it uses two fixtures with the **same**
`validUntil` differing only in `is_probation`.

`team_entitlement` gained `is_probation`, derived with `bool_and` over the in-force grants'
notes — `bool_and`, because the moment an operator extends there is a second, human-issued
grant and the team has stopped being on probation even though the probation row is still there.

**The cost, stated plainly: it is keyed on a STRING.** Both kinds of grant are
`source = 'gift'`, and widening that CHECK on a frozen table means revisiting every reader of
`source`. So `schema_assertions.sql` asserts the RPC and the view still agree — the failure
otherwise is silent, and every team quietly reads "Gifted licence" again with nothing going red.
That assertion is what makes the cheaper choice defensible rather than lazy.

*Red test:* watched red with the label reverted — 2 fail.

### WALK-B-11 / D9 — "A 13–17 member is offered in the 'New team admin' nominate dropdown"

**Definition of done (Sprint 17's, with D9 supplying the shape):**
1. A `13_to_17` member is not offered — `nominate_team_admin` refuses one outright, and an
   affordance that cannot act is `failure-modes` §8. Sprint 6's version delivered that refusal
   to the **student** on acceptance, the one person who could neither act on it nor explain it.
2. An 18+ member is still offered.
3. The empty case has **words** — D9: *"a team whose only other members are minors sees why,
   not an empty list"* — and they differ from "nobody is on the roster".
4. It **fails open**: if the ages cannot be read, everyone is offered.

(4) is the assertion that stops the fix becoming the next defect, and it is the same rule
`entitlement.ts` states at length. `team_members` carries no age, so this reads
`users.age_classification` for the candidates (which `users_select_teammates` already permits).
Offline or on a failed query that read returns nothing — and hiding every candidate would tell
the admin of a perfectly ordinary team that they have nobody to hand over to, over a timeout.
The server refuses an under-18 regardless.

(3) matters more than it looks: "Invite or approve someone first" is useless advice to a coach
whose roster is eleven fifteen-year-olds, and they have approved eleven people. The other
message names the real answer — the next adult to join — and the operator as the fallback.

*Red test:* watched red with the filter removed — 2 fail.

---

## 5. Four things that went wrong, and what caught each

Recorded because three of the four were caught by a suite rather than by review, which is
unusual for this project and worth the evidence.

**1. `CREATE OR REPLACE` from the wrong copy — two prior fixes silently dropped.** The D3
migration's `create_team_as_admin` was rebuilt by hand from the Sprint 3 original, and lost
SEC-01's transaction-local flag (so the founding admin INSERT was refused by the very trigger
SEC-01 added) and SEC-09's invite handling (which had *removed* a second definition of the
seven-day lifetime, and which this file promptly wrote back in). **Both were caught by
`onboarding-gate.db.test.ts` on its first run** — nothing in the unit suite can see a trigger.
This is the **fourth** copy of that function; the file now says so, and the WALK-B-05 migration
was produced by *copying* the current body out of the migration that owns it and patching one
branch.

**2. A db suite that passed once and failed on the second run.** `Fixtures` cleans up only what
it inserted itself, and almost every team in the new file is created by the RPC — so nothing was
tearing them down, and the second run reused `#50001`, got the correct "already registered"
answer, and failed eleven tests on the fixture rather than on anything under test. Fixed with an
explicit tracker, deleted **before** `fixtures.cleanup()` because `teams.owner_id` references
`users(id)` with no cascade. Now run twice in a row, green both times.

**3. Two wrong e2e team-number schemes, four failures and one, none of whose messages mentioned
team numbers.** `TEST_PARALLEL_INDEX` is a *slot* between 0 and workers−1 and is **reused**, so
chromium's worker 0 and the mobile project's worker 0 produced the same numbers over the same
specs. Switching to `TEST_WORKER_INDEX` fixed that and was still wrong **across runs**: the pack
never deletes its teams, so every run restarts its counter and collides with the last one's
leftovers. The numbers are random now and `createTeam` **handles** the collision — recognises
the taken-number screen, goes back, tries another — which also means every full run exercises
D3's new screen for real. Two consecutive full runs, 33/33 each, on a database holding 39
leftover teams.

**4. Two SQL mistakes the migration runner caught immediately**, recorded only because both are
environment traps this repo has not written down: a `'` escaped shell-style inside a plpgsql
string (the Bash heredoc mangled it — `environment-divergences` should say so), and
`migrations/*.sql` inside a `/* */` comment, where the `/*` in the glob opens a nested comment
that Postgres supports and never closes. → parking lot.

---

## 6. What D3 turned out to touch that its text does not mention

- **29 teams shared `9911` on the local database**, and every db fixture shared `9999`. Both
  were invisible while nothing enforced uniqueness and are hard failures the moment something
  does. Fixed in `fixtures.ts` and `seed-review-states.mjs`'s callers.
- **The e2e pack never cleans up its teams.** Harmless until D3; now a source of cross-run
  collisions, and handled rather than fixed. → parking lot.
- **`join_team_with_invite` needed changing** for WALK-B-05, which is a Package F ID that reads
  like pure UI. The client cannot send an approved member into a team it has not been told the
  id of.

---

## 7. Effort

| ID | Estimate | Actual |
|---|---|---|
| D3 mechanics | — (no estimate given) | ~1.5 days equivalent. The migration and RPCs were straightforward; the fixture/e2e fallout in §5 was most of it. |
| WALK-B-03 | M | M. The migration, the registry round trip and the second-code refusal. |
| WALK-B-04 | S | S–M. The store is small; the root cause (`redirect` vs `next`, plus the email round trip) took longer to establish than to fix. |
| WALK-B-05 | S–M | M. Two halves, one of them a migration nobody had scoped. |
| WALK-B-09 | S | S–M. The label is one line; the view change and the assertion that keeps it honest are not. |
| WALK-B-11 | S | S. |

---

## 8. Not done, and why

- **Nothing in the scope was skipped.**
- **`operator_grant_extra_team` has no UI.** It is an RPC an operator calls; the console has no
  "let this account create another team" button. The refusal a coach sees names
  `support@falcon-forge.com`, so the path exists and is a support interaction — which is what
  D3 describes ("ask an operator"). Adding a button needs a user picker the console does not
  have, and that is a bigger change than the ID asks for. → parking lot.
- **The taken-number screen does not offer "request to join this team" directly**, for the
  reasons in §2. Flagged for Kevin.
- **No FRC behaviour**, per D3.

---

## 9. Parking lot entries added

Five, in `FALCONFORGE_V2_PLAN.md` §8.

---

## 10. One line for the plan's §8 Progress log

> **2026-08-23 · Sprint 17 — D3 mechanics + WALK-B-03/04/05/09/11, `v2/sprint-17-onboarding-gate`.**
> Complete, merged to `main`. `gate:db` green (lint / 904 unit +2 skipped / 95 integration /
> build / schema assertions / 551 db / 343 rls) and the e2e pack **33/33 twice in a row**, which
> is the interesting number — see the report's §5. Three forward migrations, `db:types`
> regenerated. **D3's licence stops being the anti-abuse control**: 30-day probation instead of
> a 90-day trial, `UNIQUE (program, team_number)` (partial — a rookie team with no number yet is
> real), one auto-created team per account closing SEC-08's chaining, and an operator console
> panel that lists new teams with *whether anybody has used them* and extends one to season
> length in a click — `v2-schema.md` had that as SQL to paste into psql. `teams.program` is a
> column, not an `"FTC-12345"` string, because FRC numbers overlap; no FRC behaviour built.
> **Four things went wrong and three were caught by a suite:** the D3 migration's
> `CREATE OR REPLACE` was rebuilt from the Sprint 3 body and silently dropped SEC-01's
> transaction-local flag and SEC-09's invite handling (fourth copy of that function; the
> WALK-B-05 migration was produced by *copying* the current body instead); the new db suite
> passed once and failed on the second run because `Fixtures` never cleaned up teams the RPC
> created; and two e2e numbering schemes failed, `TEST_PARALLEL_INDEX` because it is a reused
> *slot* and `TEST_WORKER_INDEX` because the pack never deletes its teams — so the numbers are
> random now and the collision is *handled*, which means every run exercises D3's new screen.
> WALK-B-04's root cause was a link to `?redirect=` that **nothing has ever read** (this app's
> parameter is `next`), and fixing the name would not have been enough either, because
> production sign-up round-trips through email. WALK-B-09 and WALK-B-11 have no exit criteria,
> so this sprint **wrote its own definitions of done** and states them in the report and in the
> test file. **One interpretation needs Kevin's eye:** "routes to request to join" was built as
> "routes to the existing invite-code join page", because a request-to-join keyed on a team
> NUMBER would let anyone attach a pending row to any team by guessing five digits.
