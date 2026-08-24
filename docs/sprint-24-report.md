# Sprint 24 — the guardian edges

**Branch:** `v2/sprint-24-guardian-edges`
**Commits:** `9d9f3c6..9b693f4` (two), off `main` at `a814195`
**Ratchets:** `as any` **55 → 55**, arbitrary Tailwind values **2 → 2**, `dark:text-slate-500`
**0**, no `describe.skip`, no assertion-free tests. Coverage **68.93 / 61.65 / 64.80 / 70.83**
against floors 68 / 60 / 63 / 70 (up again on all four).

Two IDs: `SEC-15`, `SEC-16`. One forward migration; no type regeneration (both changes replace
function bodies and add no columns).

---

## Gate

Stages run individually. `npx supabase db reset --local` before each database run.

| Stage | Result |
|---|---|
| lint | clean |
| unit | **1091 passed**, 2 skipped (was 1086 — five new) |
| integration | **9 files, 95 passed** |
| build | ok — precache 45 entries (1584.21 KiB) |
| `db:assert` | `schema assertions passed` |
| db | **650 passed** (was 645 — five new) |
| RLS | **6 files, 418 passed** |
| e2e | **36/36**, chromium + mobile |
| coverage | **129 files, 1836 passed**, thresholds met |

No intermittents.

---

## Exit criteria

**Neither ID has an exit-criteria block** — checked by ID and by subject (`guardian`). **The
criteria below are mine.**

### SEC-15

> A guardian who adds a child and joins a team in the same sitting succeeds. If the child's rows
> genuinely have not reached the server, the join is not attempted, and the message names the
> child, says what to do, and says nothing was lost — never "this child has no consent on
> record". A guardian joining as themselves, or with a child added last week, pays nothing for
> any of this.

Verified in the browser against a real build, with `fetch` blocked for `managed_profiles` and
`guardian_consents` **writes only** — a venue with wifi that is present and useless, narrowed so
the rest of the app keeps working and the failure is exactly the one SEC-15 is about:

- The child's profile and its four consents sat in the queue (`retryCount: 2`, 20 blocked writes).
- The submit button read **"Saving Robin Junior's profile…"** while the drain ran.
- The join was refused with *"We could not save Robin Junior's profile to the server yet, so the
  team cannot be told about them. Check your connection and try again — nothing you entered has
  been lost."* The RPC was never called, so the old consent error never appeared.
- Restoring `fetch` and clicking the same button pushed all five rows and joined. Server-side:
  `Robin Junior | 4 consents | Full House Robotics:pending | guardian@falconforge.test`.

### SEC-16

> A guardian's email change reaches the roster row of every child they are responsible for, and
> nothing else about that row moves. Erasing a guardian still takes a child who never had a login
> of their own, and keeps the record for one who now does — with the guardian's own free text
> about them removed.

Verified by the five db tests below, exercised through PostgREST and through
`auth.admin.updateUserById`. Not verified in a browser, and the reason is the finding: **there is
no in-app email-change screen at all.** A guardian changes their address through Supabase's own
auth flow. That is why the second test goes through the auth path — two triggers in a row, and
the first test only exercised the second.

---

## Red tests, each watched failing

| Test | Reverted | What it said |
|---|---|---|
| SEC-15 "drains the queue BEFORE asking the server", + 2 | the whole pre-join guard | `expected "vi.fn()" to be called 1 times, but got 0 times` |
| the same three | the drain moved to **after** the RPC | `expected 43 to be less than 42` |
| SEC-16 "carries the new address onto the child's roster row" | the email half of the migration, replaced live | `the child's row kept the old address: expected 'sec16-email-guardian-…' to be 'changed-…'` |
| SEC-16 "KEEPS the record for a child who has their own login now" | the retention half, replaced live | `the graduated child's record was destroyed with their guardian: expected null not to be null` |

Four assertions exist to stop the fix being made the wrong way:

- **The ordering assertion.** Two separate `toHaveBeenCalled` checks pass whether the drain runs
  before or after the RPC, and a drain that runs afterwards fixes nothing. The revert proves the
  check can tell the difference.
- **"does not drain at all for a child whose rows are already on the server"** and **"does not
  drain when the guardian is joining as themselves"**. A fix that drained unconditionally would
  pass every other assertion and put a queue round-trip in front of every join in the app.
- **"the child was renamed"** in the email test. Dropping `managed_profile_id IS NULL` from the
  *first* UPDATE would make the email assertion pass and rename every child the guardian is
  responsible for — which is precisely what that filter was there to prevent.
- **"takes a child who never graduated with them"**. The fix narrows a DELETE; narrowing it too
  far would leave orphaned profiles behind for every erased guardian.

---

## What was found while doing it

### The guardian fixture was writing a row production never produces

`Fixtures.createGuardian` inserted the child's `team_members` row with **no email**, while
`join_team_with_invite_for_child` writes the guardian's. Every db test using that fixture has
therefore been working against a managed row the app does not create — and SEC-16, whose entire
subject is that denormalised address going stale, had nothing to go stale: the first run of the
email test failed with `expected null to be 'sec16-email-guardian-…'`.

This is `docs/environment-divergences.md`'s thesis in miniature, one layer below where that
document usually looks: not the stack, not the browser, but the fixture. Fixed by writing the
pair the RPC writes, which strengthens every other test that uses it.

### `operator_erase_user` contradicted a locked decision

Plan §3, promotion: *"The `managed_profiles` row and its consents are retained as the record of
why the child was rostered."* SEC-11's erasure tool deleted them. Both were written on the same
day, three sprints apart, and nothing compared them — the same shape as §1's drifting copies,
except the two copies are a decision and its implementation rather than two functions.

Worth stating because it is the one class this repo's tooling cannot ratchet: a test can hold two
functions in step, and nothing holds code in step with a paragraph.

### The `ws` of this sprint: the erasure cascade is reachable, and it is by design

`HANDOFF_BUILD.md` asked whether SEC-11's anonymise-rather-than-delete makes SEC-16's cascade
unreachable. It does not, and the reason is worth writing down: `operator_erase_user` anonymises
the *login* and explicitly **deletes** `managed_profiles` for the guardian, which cascades
`guardian_consents` and the child's `team_members` row and its attendance. That is deliberate and
correct for a child with no account of their own. The gap was only ever the graduated case, which
is what this sprint narrowed.

---

## Files

New: `supabase/migrations/20260831000000_sec_16_guardian_edges.sql`,
`src/test/db/guardian-edges.db.test.ts` (5 tests).
Changed: `src/pages/JoinTeam.tsx`, `src/pages/__tests__/JoinTeam.test.tsx` (+5),
`src/test/db/fixtures.ts`.

5 files changed, 742 insertions, 2 deletions.

One parking-lot entry.
