# Sprint 9 — Guardian accounts UI

Branch `v2/sprint-9-guardians`, 2026-08-17. Password recovery folded in at kickoff.

This file exists partly to restore a convention: the cross-sprint retrospective noted that
*"there is no `docs/sprint-8-report.md`. Seven sprints have standalone reports; the convention
broke without anyone deciding to break it."* The plan's §8 row is the authoritative record; this
is the readable one.

---

## The Gate

`npm run gate:db`, exit 0:

```
Test Files  50 passed (50)          unit
     Tests  624 passed | 2 skipped (626)
Test Files   9 passed (9)           integration
     Tests  91 passed (91)
✓ built in 4.82s                    build
schema assertions passed            db:verify
Test Files  16 passed (16)          test:db
     Tests  459 passed (459)
Test Files   4 passed (4)           test:rls
     Tests  319 passed (319)
```

Screenshots at 375 / 768 / 1280 via `npm run capture`, including the new `guardian-children`.

**A green Gate is a precondition, not evidence.** Five of this sprint's defects were found in a
browser and none by the suite, which is the eighth sprint running that this has been true.

---

## What shipped

**The migrations, first, before any UI existed.** `managed_profiles.birth_year` is gone — §3
decided the app never knows anyone's age, so promotion is triggered by a person and never by a
date. `guardian_consents.version` lost its DEFAULT of `'1.0'`: that is the Sprint 8 follow-up
defect pre-assembled in a new table, and `attestations.ts:81-84` had written down the rule it
broke before the table existed. The column stays NOT NULL, so the regenerated types turn an
omitted version into a **compile error** rather than a silent wrong answer.

**Both guardian tables are registry entities**, which is what puts them through the one read
path and the one write queue. They are the first entities that are not team-scoped, so the
registry grew an explicit `scope`.

**Guardian visibility widened by a third predicate.** §3 requires a guardian to see their
children's meetings and attendance, so access had to widen; the parking lot warned that
`get_user_team_ids` and `is_team_member` both exclude managed rows and that breaking only one
leaves the guardian tests green. Neither was touched.

**Joining, approval and promotion.** The guardian joins with the coach's ordinary invite code
and the ordinary pending/approve path — the coach's workflow does not change at all. The admin's
COPPA attestation is recorded, not merely displayed. Promotion graduates in place: the
`team_members` row keeps its id, so attendance survives.

**Password recovery works.** It had been dead end to end in production.

---

## The five things the browser found

All the same shape, and worth stating as one finding rather than five: **a guardian is the first
kind of account that routinely has no team of its own, and nothing in the app had ever been
asked to survive that.**

1. **Onboarding offered a team the account is not a member of.** The query was right — it
   correctly returned `[]`. `setTeams` was only called when the result was non-empty, so a
   stale persisted list stayed on screen. Zero read as "no answer" rather than as "none".
2. **A stale `currentTeamId` then clobbered the guardian's own data.** `fetchTeamData` pulled
   that team and *replaced* the meetings collection with an empty result: "Nothing scheduled
   yet" for a child with a full schedule. Both requests were in the network log; the wrong one
   landed second.
3. **`/app/guardian` bounced to the team picker** one second after arriving, because the
   no-team redirect assumed no team was an error.
4. **The rail offered Dashboard, Scouting and Match Planner to a parent** who would have got an
   empty screen from each — §3's "never renders the team as the child", reached by accident.
5. **The children list reordered under the click** after every action, because the pull has no
   `ORDER BY`.

---

## Three things that were already wrong

- **`current_team_member_id` is `LIMIT 1` with no `ORDER BY`** and does not exclude managed
  rows, so a guardian with two children on one team reached an arbitrary one's attendance —
  differently between runs, and siblings are supported by design. Worse, `check_in_with_code`
  resolves the caller with the same function, so a guardian could check their own child in.
  Both fixed; see "Decided at review" below.
- **`coppa_responsibility` had no writer.** In `AttestationType` and the database CHECK since
  Sprint 3, checked by nothing, written by nothing. The admin's approval checkbox is now that
  writer.
- **Password recovery, twice over** — and the obvious fix is broken too, see below.

---

## Three places the work nearly went wrong

**The obvious password-recovery fix silently discards the token.**
`${origin}/#/auth/reset-password` is what a reasonable person writes. The implicit grant appends
its own fragment, a URL has one, and supabase-js parses the first key as
`/auth/reset-password#access_token`. It would have looked correct in review and worked nowhere.
Caught by running the real parser over the real shape, then proved against a real GoTrue and a
real email out of Mailpit.

**The first column-grant list was too narrow, and every policy test passed over it.** The
promotion code is a credential, so the client may read it and may not set it — which needs
column-level GRANTs, because RLS cannot express a column. The first list granted UPDATE on
`(full_name, notes, updated_at)`. All eleven policy tests passed, because they issue plain
UPDATEs and *the app upserts*: `ON CONFLICT DO UPDATE` needs UPDATE on every column sent.
`guardian-sync.db.test.ts` caught it with three items stranded in the queue.

**A promotion assertion was about the fixture, not the behaviour.** The first draft asserted
`seat_assigned: true` after promotion and failed against a fixture that never assigned a seat.
The property that matters is that promotion does not *change* it, so `status`, `seat_assigned`
and `joined_at` are now compared against what was there before.

---

## What was watched failing

Per `docs/failure-modes.md` §2 — a test not seen red is a test of unknown value.

| Reverted | What went red |
|---|---|
| Reinstated `birth_year` and the `version` DEFAULT | both refusal tests, "expected null not to be null" |
| Reversed the slice's queue order | 2 consents stranded in the queue after a full drain |
| Original non-hash `redirectTo` | 2 of 5 recovery tests |
| The "obvious" hash `redirectTo` | 4 of 5 recovery tests |
| Restored the `LIMIT 1` attendance policy | the sibling test |
| Gave back table-level UPDATE | the claim-code refusal test |
| Made a guardian an `is_team_member` | the roster/invites/tasks isolation test |
| Create-and-remove promotion | the attendance-history assertion |
| Reverted `setTeams` / `requiresTeam` | 3 of the browser-defect regression tests |
| Put managed rows back into `current_team_member_id` | the guardian check-in refusal test |
| Granted the guardian RPCs back to `anon` | 2 behavioural refusals + schema assertion 23 |

---

## Decided with Kevin

- **Password recovery comes into this sprint.** It is a live production defect and this
  sprint's users are the most exposed to it: the guardian owns the login for a child who has
  none, so a guardian who cannot reset their password loses their child's roster place too.
- **Promotion uses a two-party claim code**, not an email lookup. §3 locks promotion as
  guardian-initiated and graduating in place but does not say how the child's account comes to
  exist. An email lookup would make the RPC an account-enumeration oracle and would have the
  guardian asserting the child's identity rather than the child.

## Decided at review, after the first pass

**`current_team_member_id` fixed rather than parked — and it was worse than the ordering.**
`check_in_with_code` resolves the caller with it, so **a guardian who scanned a QR poster checked
their child in**, from wherever they were standing. That is §3's act-as mode reached by accident,
and it makes attendance self-attested by the one person `attested_by` exists to distinguish from.
The function now excludes managed rows and orders deterministically, and a guardian who scans
gets their own refusal naming the coach who *can* mark the child present.

**That fix nearly introduced a worse defect than it removed.** The first attempt rewrote
`check_in_with_code` from memory: different `reason` codes (the client branches on them), the
deadline guard dropped, and the race-safe `INSERT ... ON CONFLICT DO NOTHING` replaced with a
check-then-insert that reintroduced exactly the double-tap race the original comment explains.
Caught by diffing against the original before applying. The shipped migration is the original
text with one branch inserted, and the diff is that branch and nothing else. This is the
meta-class in `docs/failure-modes.md` — the fix introduces the next defect — and the only reason
it did not ship is that the diff was read.

**`teams` into the entity registry is the next scoped change**, on its own branch: it touches the
one read path, so it wants its own diff and its own browser pass rather than riding along.
Deleting `pullGuardianTeams` is part of it.

## Found after the migration landed on production

**The four guardian RPCs shipped EXECUTE-able by `anon`.** `20260822000200` ended with
`REVOKE ALL ... FROM PUBLIC` — the careful-looking half of the incantation, which does nothing
on its own, because `20260816000500_v2_grants.sql` sets `ALTER DEFAULT PRIVILEGES ... TO anon`
and every new function therefore arrives with its own acl entry independent of PUBLIC's.
`20260819000000_revoke_anon_execute.sql` says this in its header, in as many words, and revokes
`FROM PUBLIC, anon`. I read that header, cited it in my own migration, and wrote half the fix.

Not exploitable — each is SECURITY DEFINER and asks who the caller is on its first executable
line, so production returned refusal bodies rather than data. But the missing layer is the one
that exists *because* "the guard is code, and code is what was wrong the first time" (B25).

Two things follow. `20260822000400` does the revoke properly. And **schema assertion 23 now
enumerates every SECURITY DEFINER function `anon` can EXECUTE and fails on anything outside a
named allowlist** — the property `20260819000000` claimed in prose ("adding a function to this
schema does not silently join or leave the set") and nothing enforced, which is why four
functions could join it silently. The refusal itself stays behavioural, as anon, because
`docs/environment-divergences.md` §5 is exactly that a catalogue assertion once approved a
REVOKE that was a no-op; the assertion's job is drift detection, not proof.

**It was caught by verifying against production, not by the Gate.** `npm run gate:db` was green
over it — the behavioural suite tested a hand-maintained list of functions that predated these
four.

## Left in the parking lot, deliberately

No `404.html` for non-hash deep links and the now-dead `/auth/callback` route — neither reachable
by any flow a user takes. The guardian's inert season picker, and whether `ReAttestationPrompt`
should fire for a guardian-only account at all: both left until beta teams have used the flow,
and the second needs a rule from the pending legal review rather than an engineering guess.
