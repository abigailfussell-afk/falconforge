# Sprint 6 — Licensing & admin console + legal

Branch `v2/sprint-6-licensing`, off the merged `main` (`909a163`). Five commits. Not pushed.

---

## The Gate — real output

Run on the final commit (`8ad6895`), with the local Supabase stack up.

| Step | Result |
|---|---|
| `npm run lint` | clean, no output |
| `npm run test:run` | **36 files, 470 passed, 2 skipped** (472) |
| `npm run test:integration` | **9 files, 87 passed** |
| `npm run build` | **✓ built**, no warnings; PWA precache 37 entries |
| `npm run db:verify` | **schema assertions passed** — 20 assertions (was 15) |
| `npm run test:rls` | **265 passed** (was 261) |
| `npm run test:db` | **364 passed** (was 320) |

`as any` **55 → 55** (rule 7 satisfied; see the footnote below). Arbitrary Tailwind values still **1**.
Coverage thresholds unchanged at 72/67/69/74.

Movement: unit **344 → 470**, db **320 → 364**, rls **261 → 265**, schema assertions **15 → 20**.

---

## Phase 1 — Sprint 5.5 merged and deployed

`--no-ff` merge `909a163`, message in `332f2bd`'s shape. Gate green on the merged main;
`supabase/` untouched so no migration and no `db:verify`, the same situation as Sprint 5's merge
rather than Sprint 4's incident. Pushed on your OK: CI and Deploy both green, and
falcon-forge.com verified serving `index-D4lvFf5W.js` / `index-DW4KNnfU.css` — byte-identical to
the local build filenames — with the custom domain intact. The `onAuthStateChange` deadlock fix
is live.

---

## Your three decisions, and what they changed

**1. Seats are purchased team capacity; the gate is join approval.** This resolved the hand-off's
objection without per-member RLS. Reading the Sprint 3 schema first showed the model was almost
entirely pre-built: `invites` already had `max_uses`, `join_team_with_invite` already inserted
`status='pending'`, `is_team_member()` already required `'approved'` (so a pending member reaches
nothing), and `enforce_seat_capacity` already carried the comment *"a pending or removed member
does not occupy a seat"*. The one missing link was that approval and seat assignment were separate
actions, so approving cost nothing.

All three enforcement layers are server-side and were already there:

| Question | Enforced by | Where |
|---|---|---|
| Is this person on the team? | `is_team_member()` → `status='approved'` | RLS, every table |
| May the team write at all? | `team_can_write()` | RLS, every table |
| May the admin approve one more? | `enforce_seat_capacity()` | BEFORE trigger |

The exit criterion "enforcement is server-side, not just UI" is met at team granularity, and
**schema assertion 19 now fails if any policy grows a `seat_assigned` predicate** — so the
decision is enforced against a future sprint, not just documented.

**2. TERMINAL classification in Sprint 6 — done, but narrower than I first wrote it.** See B24.

**3. Deploy: manual for Sprint 6.** `deploy.yml` loses its `push` trigger; CI still runs on every
push. Rationale recorded in the workflow itself, with a note to revisit in Sprint 7 hardening.

**Your fourth question — ownership transfer — turned out to be the sharpest thing raised.** The
warm path existed since Sprint 3 with no caller; the version you described (a teacher who has
already left) was the one no API path could do at all.

---

## B25 — a live cross-tenant privilege escalation

Found by a test I expected to pass trivially: another team's admin nominating into this team
returned `success: true`.

`can_manage_billing(t)` was `SELECT current_team_role(t) = 'admin'`, and `current_team_role` is
**NULL** for a non-member. `NULL = 'admin'` is NULL, so the function returned NULL, and `NOT NULL`
is NULL rather than true. Every guard of the shape

```
IF NOT can_manage_billing(p_team_id) THEN RETURN error; END IF;
```

**was skipped for a non-member.** `transfer_team_admin` is exactly that shape, is SECURITY DEFINER
(so its writes do not meet RLS on the way out), and is EXECUTE-granted to `authenticated` **and
`anon`**.

Exploit confirmed, not theorised: against the unfixed definitions the RPC returns `success: true`
for a caller with no membership of the target team, and team B's admin role moves. The
precondition is that the nominee has accepted the terms somewhere — anyone who has ever created a
team — which is why the first version of the test passed for the wrong reason and had to be
strengthened.

**Why 261 isolation assertions went green over it:** RLS coerces a NULL `USING` result to false, so
every *policy* built on these functions was and is correct. The defect lived exclusively in the
plpgsql guards, and the one RPC with the vulnerable shape had no caller in the UI — so nothing in
the app or the suite ever executed one. This is B21's class, three sprints later, and it hid for
the same reason: a check that reads as airtight and is not evaluated.

Fixed with `coalesce(..., false)` in the three affected capability functions, which corrects every
existing guard and every future one at the root rather than one call site at a time.
`can_manage_content` was already safe (`is_team_member()` returns EXISTS, never NULL) and is left
alone so the diff says only what it means. Four regression tests, each verified to fail against the
vulnerable definitions, plus **schema assertion 20**, which asserts the behaviour rather than the
function text because the broken and fixed versions differ by one `coalesce` that is easy to drop.

**This is live on production right now.** It is on this branch, unpushed. Flagged to you mid-sprint
so you could choose to hotfix it ahead of the rest; no reply, so it ships with the sprint.

---

## B24 — the sync drain learns to stop retrying, narrowly

Three cases had accumulated since Sprint 3 — an unlicensed write, an archived-season write, and a
write queued by a device offline during a rollover. Each burned five retries over ~9 minutes and
arrived with no explanation.

**The design turned on a measurement rather than an assumption.** Against the real stack, a
cross-tenant insert, an unlicensed write, an archived-season write, *and a write naming a season
that has not synced yet* all come back identically:

```
{ code: '42501', message: 'new row violates row-level security policy for table "tasks"' }
```

So `42501 → terminal` would have been a bug, not a fix: Sprint 4's rollover queues sub-teams and a
checklist behind a season it creates client-side, and a merely-slow parent push makes every child
fail with that same code. A policy refusal is therefore terminal **only when local state already
explains it** — the team is read-only, or the record's season is archived here. Conservative by
construction: it can leave a refusal on the ladder, and it can never park something that would
have succeeded. The offline-during-rollover case lands one beat later by the same rule, because
`sync()` pulls before it drains.

**A wider rule was tried and the existing suite refused it.** The first draft also parked 23514
(CHECK/trigger), 22P02 and 23502, on the reasoning that a retry sends the same bytes. It does not:
`queueForSync` coalesces a later edit into an existing queue entry, so a queued payload is mutable
by design — and **B19's own regression test** models an outage with a CHECK-rejected title and then
corrects it in place, expecting the retry to push. Six tests across `sync-drain` and
`sync-retry-schedule` went red. That is the hardened engine's regression suite doing exactly its
job, and the narrowing is recorded in three unit tests that assert the un-obvious direction so the
widening is not re-attempted.

B2 is untouched: the work is preserved in the same dead-letter store with the same retry
affordance. `SyncFailure.terminalReason` carries the cause to the UI, which is the only place it
can be said — the raw error is that one sentence whatever the policy's reason was. Every new test
verified to fail against a neutered classifier (7 unit, 7 db).

---

## Ownership transfer

**Warm path.** `transfer_team_admin` existed since Sprint 3 and pointing a button at it would not
have worked: `enforce_member_role_eligibility` refuses `role='admin'` without the incoming admin's
own terms attestation, and **nothing in the app had ever written one for an existing member.** The
gate was armed with no door. So the admin nominates (`teams.pending_admin_*` +
`nominate_team_admin`) and the successor accepts (`AcceptAdminNomination`), which is where the
attestation is finally collected. Not ceremony: you cannot validly attest on somebody else's
behalf, and a one-click transfer would hand legal responsibility for a team of minors to somebody
who never agreed to it.

**The security boundary is a trigger, not the RPCs.** `teams_update_manager` grants UPDATE on
`teams` to `can_manage_roster` — admin **or coach**. Without `enforce_admin_nomination_authority`,
a coach could `PATCH pending_admin_member_id` to their own member row and then call
`accept_team_admin_nomination`: self-promotion to team admin in two ordinary REST requests, with
neither RPC's authority check ever running. Asserted at the boundary where it actually lives, plus
schema assertion 16, because nothing else in the schema references that trigger.

**Cold path.** Every warm route runs through `can_manage_billing`, so a coach who retires without
handing over strands the team — data intact, every remaining member a coach or below, and the
one-admin partial index blocking any promotion while their row still holds the role. A db test
asserts the team really is stuck before asserting that `operator_transfer_team_admin` unsticks it.
Recorded in a new `operator_actions` table with a SELECT policy for operators and **no
INSERT/UPDATE/DELETE policy at all** — a trail the caller can append to is not evidence. The first
draft wrote the audit into `license_grants.notes` with `seats = 0`; the schema refused it
(`CHECK (seats IS NULL OR seats > 0)`), and it was the right refusal for a better reason than the
constraint — `seats = NULL` means *unlimited*, so the audit row would have been one un-revoke away
from being a licence.

**The trap the hand-off warned about is preserved and tested.** Bumping the document versions makes
every existing attestation an old version, and if holding the admin role were re-checked on any
write to the member row, that would lock every current admin — including you, on the one production
team — out of the console that could fix it. `enforce_member_role_eligibility` short-circuits when
`role` and `user_id` are unchanged; there is now a test for that property and a paired one proving
a *fresh* grant still requires an attestation.

---

## What the browser found that the suite could not

Rule 10, and it earned its place again. `scripts/seed-review-states.mjs` builds the states no UI can
reach — 12 of 15 seats, every seat taken with four people waiting, a grant that expired *yesterday*,
one expiring in 9 days, a stranded team — and refuses to run against anything but localhost.

**1. The 16px iOS zoom floor has been protecting nothing since Sprint 5.5, and that is live on
production as of this morning's merge.** `index.css` floors form controls at 16px under
`(pointer: coarse)` because iOS Safari zooms the viewport when a focused control computes below
that and does not zoom back. It was written as `input, select, textarea` — element selectors,
specificity 0,0,1. Sprint 5.5 then added `.field`, a **class** (0,1,0) applying `text-sm` = 13px,
and a class beats an element whatever the source order.

Measured, not inferred: at 375px with `(pointer: coarse)` matching and `maxTouchPoints: 5`, all
seven controls on the operator console reported **13px**. After adding `input.field` &c. (0,1,1),
all 16 controls on the admin console report 16px. This affected **every form in the app** —
scouting, the task modal, profile — not just the new screens. Guarded by a source-level test,
because jsdom does not apply `index.css`, which is precisely why the 470-test suite could never
have caught it.

**2. An under-18 could be nominated as team admin.** The successor dropdown offered eleven
13-to-17 students, because `team_members` carries no age column so the client cannot filter them.
Nomination **succeeded**, and the refusal then landed on the *student* at acceptance — leaving the
admin believing they had handed the team over, and the error in front of the one person who could
neither act on it nor explain it. `nominate_team_admin` now checks age itself and refuses up front.

**3. "SEATS IN USE 4 of 0" on a lapsed team.** `team_entitlement` reports `seats_total` as NULL
when no grant is in force, and the panel rendered `?? 0` as a denominator — arithmetic that looks
broken, on the one screen a coach whose team just went read-only will be staring at.

Also verified by looking: the lapsed banner and its "nothing has been deleted"; Approve disabled
with a per-reason title while Reject stays enabled (you can always clear the queue); the
**both-refusals case rendering one banner plus a one-line note** rather than two stacked; the
operator page refusing a non-operator plainly with no nav entry for them; no horizontal overflow at
375px.

And one thing found and deliberately left alone, because it is the trigger being right:
`enforce_seat_capacity` refuses to seat a member on a team whose grant has already expired, even
for `service_role`. The lapsed state can only be reached the way reality reaches it — license, fill,
then let cover run out.

---

## Three defects in my own new code, caught by the suite

Worth recording because they are the suite paying for itself:

- **A fail-CLOSED attestation read.** `getOutdatedAttestations` returned *every* type as outdated
  when Supabase was unconfigured — in demo mode that prompts somebody with no account to accept
  terms that cannot be recorded, and on a flaky connection it is a nag with no way to comply.
- **An infinite render loop.** The re-attestation effect depended on the `user` object, so any
  caller whose `useAuth()` returns a fresh user per render produced render → effect → setState →
  render. It spun ~2 million times and wrote a **2.7 GB log** before anything failed. It now depends
  on `user?.id`. `AuthProvider` keeps `user` in state so the live app was not looping — but that is
  one provider refactor away from spinning production.
- **Mock drift with a nasty signature.** B24 added `getTerminalFailureReasons` to `sync.ts`, which
  `Dashboard.test.tsx`'s `offline-db` mock predated. The symptom was not a failed assertion but a
  test file that **hung for fifteen minutes**. `useSync`'s polling read is now guarded — it runs
  every five seconds and reads local state, so failing it must not throw once per tick.

Also caught by its own test: `deriveEntitlementState` initially reported `isAtCapacity: true` for a
device that had never read the entitlement, because `seatsRemaining` floored to 0. "No answer" and
"no seats" are arithmetically identical and semantically opposite, which is what `isKnown` exists
for. And `Math.floor` reported "ends in 0 days" for a licence with eleven hours left.

---

## Exit criteria, checked adversarially

| Criterion | Status |
|---|---|
| Admin console: roster & roles, seat assignment, invites, team settings, entitlement status | **Met.** `EntitlementPanel` renders the brief's "12 of 15 seats, gifted until…" sentence; mentor was already assignable. |
| Operator gifting flow (SQL + minimal UI gated to operator) | **Met.** The RPC pre-existed; the UI is new and double-gated. |
| Enforcement UX: unlicensed member → lock screen; expired team → read-only banner | **Met, reshaped by your decision.** Team-level lock is `LicenceBanner`; the per-member case is a *pending-approval* state, which is a better thing — a pending member already reaches nothing through RLS, and the team picker shows them waiting. |
| Registration flow updates; under-13 blocked with guardian messaging | **Met.** `COACH_REQUIRED_ATTESTATIONS` has a consumer; under-13 self-signup was already blocked server-side in `join_team_with_invite` with guardian messaging, verified rather than rebuilt. |
| Legal pages rewritten, versioned re-attestation, marked pending review | **Met.** |
| Gate + `test:rls` green, enforcement server-side | **Met.** |
| End-to-end walkthrough: register → gift → invite each role → verify capabilities | **Partially met, and I want to be precise.** The licensing halves were walked end to end in a browser against constructed states. What I did **not** do is a fresh registration through the sign-up form followed by four real invite-and-join round trips, because signup needs email confirmation on the local stack; role capabilities are covered instead by the 265-assertion RLS suite, which is stronger evidence for *capabilities* but not for the *flow*. Worth doing by hand before beta. |

Two exit-criteria items I could not fully satisfy, stated plainly rather than counted as done:
the walkthrough above, and **screenshots at 1280px** — the Browser pane composites an emulated
viewport without scaling up, so a 1280-wide capture is unreadable, exactly as the hand-off warned.
I verified 375 and 768 by measurement (computed styles, overflow checks, disabled states) rather
than by image. If you want wide captures for the record, widen the pane and I will retake them.

---

## Footnote on the `as any` ratchet

The count is measured by `grep -r 'as any' src/ | wc -l`, and a sentence in the rewritten privacy
policy — "administrative access to the database, as any operator of any service does" — tripped it,
taking 55 to 56. Reworded to "as the operator of any service does". Prose that inflates a
code-quality metric makes every future sprint's comparison ambiguous for no benefit, and my first
attempt at a comment explaining the rewording contained the phrase twice, which made it worse.

---

## Handing on

Nine parking-lot items named Sprint 6; all nine are addressed or explicitly re-parked with a reason
(see §8). Six new items are recorded, the most actionable being the **`anon` EXECUTE grants** on the
admin RPCs — harmless now that B25 is fixed, still wrong by default-deny, and a contained forward
migration with one behavioural test per function.

Nothing is pushed. `main` no longer auto-deploys, so shipping this is: merge, then run Deploy from
the Actions tab.
