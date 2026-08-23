# Sprint 21 — erasure (SEC-11)

**Branch:** `v2/sprint-21-erasure`
**Commits:** `b8bad12..ddcf62d` (three)
**Ratchets:** `as any` 55 (unchanged), arbitrary Tailwind values 2 (unchanged), no `describe.skip`,
no assertion-free tests.

## Gate

Every stage run individually and green on the final state:

| Stage | Result |
|---|---|
| `lint` (`tsc --noEmit && eslint src`) | clean |
| unit | **1031 passed**, 2 skipped |
| integration | **95 passed** |
| build | ok |
| `db:assert` | passed |
| db | **642 passed** (was 632 — ten new) |
| RLS | **418 passed** |
| e2e | **35/35** |
| browser probe | **18/18** (`scripts/probe-erasure.mjs`) |

**Two intermittents, both recorded rather than re-run until quiet.** One unit run failed
`Dashboard > hands the board only the current season's tasks` on a **14 759 ms timeout** — not a
logic failure; that run followed a database reset, a re-seed and a browser probe. It passed alone
and in **five consecutive** full runs afterwards, so: one timeout in six. And one e2e run failed
`team-number-uniqueness > a typo has a way back`; it passed alone and 35/35 on the next full run.
That is the Sprint 18 parking-lot item recurring — a route guard discarding intent, diagnosed at
~1 run in 24, fix still parked.

## Exit criteria

**SEC-11 has no exit-criteria block** — checked `docs/assessment-2026-08/exit-criteria.md` rather
than assuming, having got that wrong in Sprint 19's first draft. So the definition of done is
**mine**:

> The Privacy Policy's sentence is backed by a tool rather than a psql session; an operator can
> erase a person and delete a team, both audited; a guardian can remove one child themselves; and
> the policy describes what actually happens.

Scoped **out**, and parked: the team JSON export, invoices, seat reduction and team rename that
SEC-11's fix direction also lists. The policy promises an export only as *"ask us — we do not
require a formal process"*, which a manual answer satisfies; erasure was the half promised as
something that just happens.

---

## What was there before

`docs/beta-ops.md`, "Erasing a person's data": a hand-typed transaction against production, and a
deliberate call for a beta of a few known teams (Kevin, 2026-08-18). The right decision then, and
the fix direction's own framing is "post-beta". Beta is September.

**This sprint encodes that runbook rather than inventing a procedure.** Its SQL had been run
against a real database and its effects measured, which makes it a far better specification than
anything written fresh — the order in it is load-bearing and non-obvious:

> `team_members` has five composite foreign keys pointing at it with `ON DELETE SET NULL`, and
> **four cannot fire**. `SET NULL` nulls *every* column in the key, so each tries to null a
> `team_id` that is `NOT NULL` — and `teams.pending_admin_member_id` tries to null `teams.id`
> itself. A plain `DELETE FROM team_members` is refused for anybody who has been assigned a task,
> created a meeting, filed a scouting report, taken a roster, or been nominated as admin.

---

## Three things the runbook got wrong

None of them findable by reading it. Each was believed, written down, and measured against.

### 1. "Then delete the login in the dashboard" does not work for most people

Measured: `auth.admin.deleteUser` on a **team owner** is refused (`Database error deleting user`);
on a plain student it succeeds. `public.users.id → auth.users(id) ON DELETE CASCADE` means
deleting the login deletes the profile row, and four `NO ACTION` references —
`teams.owner_id`, `teams.pending_admin_nominated_by`, `invites.created_by`,
`extra_team_grants.granted_by` — refuse that for anyone who has ever owned a team or issued an
invite. **Which is every admin.**

So the login is **banned**, not deleted: one deterministic outcome for everybody instead of a step
that silently half-works depending on whether the requester ever owned a team.

### 2. The anonymisation was not durable

The runbook writes the tombstone to `public.users` and leaves `auth.users` alone. But
`handle_new_user()` fires `AFTER INSERT **OR UPDATE** ON auth.users`, and its upsert says
`email = EXCLUDED.email` — its own comment reads *"GoTrue owns the address; there is no other
writer."* The next password reset or email confirmation copies the real address straight back over
the tombstone.

Combined with (1): **an erased administrator kept a working login that silently un-erased itself.**

The fix anonymises `auth.users` **first** and lets the trigger carry the tombstone into
`public.users` — using the sync rather than fighting it. Then it sets the two columns the trigger
deliberately preserves, because `handle_new_user` only takes a name from metadata when the
metadata changed *and* the new value is non-null, so emptying the metadata leaves `full_name`
exactly as it was.

### 3. SEC-01's trigger refuses the whole thing — and a psql probe says otherwise

Deleting a team cascades into `team_members` and takes the admin's row with it, which
`enforce_admin_membership_protection` exists to prevent. **`DELETE FROM teams` was refused for
every team that has an administrator, which is every team.**

**What makes this the finding of the sprint is how nearly it was missed.** A psql probe of
`operator_delete_team` **succeeded** — because psql connects as `postgres`, and the trigger's
first bypass is `session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin')`. The probe
agreed with a broken function and would have licensed shipping it. Only the db test, issuing the
call the way the app does — an operator's JWT through PostgREST — showed the refusal.

A new transaction-local `falconforge.operator_removal` flag licenses it, deliberately **not**
reusing `admin_transfer`: both licence the same mechanical act, but *"the role is moving and there
will still be an admin"* is exactly what an erasure and a team deletion do not promise. A flag
named for the wrong intent is a comment that lies to the next reader.

---

## What was built

| | |
|---|---|
| `operator_erase_user(p_user_id, p_notes)` | The runbook, encoded. Refuses if they are the **sole** administrator of any team — a narrower test than the runbook's "is an administrator anywhere", agreeing with it under the one-admin model and right where they differ. |
| `operator_delete_team(p_team_id, p_confirm_name, p_notes)` | Requires the name typed exactly, compared with `btrim` but **without case folding**: an operator who cannot reproduce the name is not looking at the team they think they are. |
| Console UI | Erase on each roster row; a delete-team panel. |
| Guardian UI | Remove on a child's card, plus `removeManagedProfile` in the store. |
| `operator_actions` | `team_id` nullable and `ON DELETE SET NULL`. |
| Privacy Policy | Reworded. |
| `docs/beta-ops.md` | No longer the procedure, and says so. |

### The audit trail had to be able to outlive its subject

`operator_actions.team_id` was `NOT NULL` with `ON DELETE CASCADE` — **deleting a team deleted the
record of its own deletion.** An audit log that erases exactly the entries most worth keeping. The
team's name and number are copied into `detail` so the row stays legible once the FK points at
nothing.

The **erasure** row is the opposite case and deliberately records the *shape* of what was removed
and **not** the name or address, with a test that fails if either appears: an audit log that keeps
the personal information it just erased is not an erasure.

### Two guards that are not UI polish

**Erase is absent on a child's row, not disabled.** A managed member's `user_id` is their
**guardian's**, because a child has no login of their own — so "erase this child" would erase the
parent and every other child they have. `operator_team_detail` now returns `user_id`, which is what
exposed the trap. Visible in the screenshot: *Robin Fussell (child profile) guardian@falconforge.test*
has no button.

**The sole admin's Erase is disabled, with a title saying to transfer the role first.** The server
already refused it, but learning that *after* confirming a dialog that says "this cannot be undone"
is a bad thirty seconds. Necessary and not sufficient — they may be the only admin of a team this
panel cannot see — so the server stays the authority. Disabled rather than absent, and the
difference is the point: this action is legitimate and merely blocked on something fixable.

### The guardian's removal mirrors the cascade locally

Deleting the profile also deletes the consents and the child's `team_members` row. A client that
removes only the profile leaves the child's name gone from the screen while their membership and
attendance keep counting from rows that outlived them — until the next full pull, which offline may
be days away (`failure-modes` §9). Its test has a **sibling control**, because "removes everything"
passes every other assertion in that file while taking the other child with it.

One queue entry, not three: the profile delete *is* the operation on the server, and queueing the
cascade's children is three writes racing to delete rows the first one already took.

Not offered once a child has their own login — after a promotion the memberships belong to the
child's account, and removing the profile would take a consent trail with it while not touching the
account it points at.

### The Privacy Policy described a button that has never existed

*"When you delete your account…"* implies self-serve deletion; grepping for one finds nothing. That
is the same defect as a control that does nothing (`failure-modes` §8), on the one document a
parent or a regulator reads literally. It now says *"when you ask us to"*, and names the guardian's
own affordance.

---

## Verified

**10 db tests**, watched red three ways:

| Reverted to | Red |
|---|---|
| the runbook's ordering (tombstone in `public.users` only) | 2 failed — the durability and the tombstone assertions |
| no ban on the login | 1 failed |
| no `operator_removal` flag | 2 failed — the delete is refused outright |

**12 console unit tests**, and the child guard watched red: dropping `!m.is_managed` fails it.

**4 store tests**, and the local cascade watched red: a profile-only removal fails it.

**18/18 in a real browser** against a real database — and the probe found *its own* defects first,
all three of the shape that reports success on a broken feature:

- It filled the search box and clicked the first row. The box is inside a `<form onSubmit>`, so
  filling without submitting leaves the **default listing** — it selected "Lapsed Legends", looked
  for an Iron Falcons member on it, found no Erase button, and reported **the child guard as a
  PASS**. Absence of a button on the wrong team's panel, on the one assertion protecting a
  parent's account.
- *"the team still has its work — 0 tasks"* and *"its content went with it — 0 tasks left"* both
  passed because the review seed creates no tasks. Zero equalling zero. Now counted on members and
  meetings, taken before: **4 members → 0**.
- *"their sibling is untouched"* counted managed profiles **globally**, so it was satisfied by a
  removal that took this guardian's other child and left a stranger's. Now: **2 of this guardian's
  children → 1**.

Everything is checked against the **database**, never the success banner — the banner is the
component's opinion of what happened.

## A defect this sprint exposed elsewhere

`scripts/seed-review-states.mjs` discarded the error from `auth.admin.deleteUser`, so a refused
delete was indistinguishable from a successful one and the *next* line failed with "A user with
this email address has already been registered" — pointing at the account rather than at whatever
holds a reference to it (`failure-modes` §4). Here that was
`operator_actions_operator_user_id_fkey`: **an operator who has performed any audited action cannot
have their auth row deleted**, because an audit entry must be able to name who did it. Correct for
the product, inconvenient for a re-runnable seed. It now says so, and names `npm run db:reset`.

## Files

**New:** `supabase/migrations/20260829000000_sec_11_erasure.sql`,
`src/test/db/erasure.db.test.ts`, `src/lib/__tests__/remove-managed-profile.test.ts`,
`scripts/probe-erasure.mjs`.

**Changed:** `src/components/admin/OperatorConsole.tsx`,
`src/components/guardian/GuardianView.tsx`, `src/lib/slices/createGuardianSlice.ts`,
`src/pages/legal/PrivacyPolicy.tsx`, `src/components/__tests__/OperatorConsole.test.tsx`,
`scripts/seed-review-states.mjs`, `docs/beta-ops.md`, `src/lib/database.types.ts`.
