# Sprint 10 — Package A, "tenant safety"

**Package:** A, from `HANDOFF_ASSESSMENT.md` §"Sprint packages".
**IDs, in the order given:** SEC-01, SEC-02, SEC-05, SEC-09, SEC-10 ‖ SEC-03, SEC-06, SEC-08.
No more, no fewer.
**Branch:** `v2/sprint-10-tenant-safety` off `main`.
**Commit range:** `d80f046..67c62c5` — ten commits, 27 files, +3041 / −43.
**Not pushed, no PR, nothing deployed.** Production migrations are Kevin's to apply.

Six forward migrations on the frozen schema, one per ID that needed one:

| File | ID |
|---|---|
| `20260824000000_sec_01_protect_admin_membership.sql` | SEC-01 |
| `20260824000100_sec_02_age_classification_survives_signin.sql` | SEC-02 |
| `20260824000200_sec_05_managed_profile_notes_are_private.sql` | SEC-05 |
| `20260824000300_sec_09_invite_code_lifetime.sql` | SEC-09 |
| `20260824000400_sec_10_no_under_13_accounts.sql` | SEC-10 |
| `20260824000500_sec_06_predicates_are_not_an_api.sql` | SEC-06 |
| `20260824000600_sec_08_no_bare_team_inserts.sql` | SEC-08 |

SEC-03 is a client-side change and needed no migration (its schema half is explicitly out of
scope). `src/lib/database.types.ts` was regenerated with `npm run db:types` after each one; the
only change it produced across the whole sprint is `get_user_team_ids: { Args: never }`.

---

## 1. Gate

`supabase/` is touched, so the Gate is `npm run gate:db`. Real output, final run on
`67c62c5`:

```
> falconforge@0.1.0 gate:db
> falconforge@0.1.0 gate
> falconforge@0.1.0 lint
> falconforge@0.1.0 test:run
 Test Files  56 passed (56)
      Tests  678 passed | 2 skipped (680)
> falconforge@0.1.0 test:integration
 Test Files  9 passed (9)
      Tests  91 passed (91)
> falconforge@0.1.0 build
✓ built in 6.03s
> falconforge@0.1.0 db:verify
> falconforge@0.1.0 db:assert
 schema assertions passed
> falconforge@0.1.0 test:db
 Test Files  22 passed (22)
      Tests  517 passed (517)
> falconforge@0.1.0 test:rls
 Test Files  5 passed (5)
      Tests  343 passed (343)
```

Not part of the Gate, run anyway because SEC-02's and SEC-10's criteria both name the signup
path and both migrations sit on it:

```
> npx playwright test
Running 20 tests using 4 workers
  ...
  20 passed (46.5s)
```

Counts moved: unit 670 → 678 (+2 skips unchanged), db 489 → 517, rls 319 → 343, schema
assertions 23 → 26 (24, 25 and a 23a). `as any` unchanged at 56 — two were added mid-sprint by
`CreateTeam.test.tsx` and removed again before the commit that would have carried them; the
ratchet caught it, which is what it is for.

**A green Gate is not the evidence here.** Every one of the eight was reproduced over PostgREST
as the real role before it was fixed and proved closed the same way afterwards; §3 pastes both
outputs per ID. Four of the eight would have passed a Gate that never ran.

---

## 2. Decisions consumed

| Decision | How it was used |
|---|---|
| **D8** — may students edit any teammate's task/report/plan? | **Read only, as the package says.** The line is still blank, and it did not block anything: nothing in these eight IDs touches `can_manage_content` or who may edit a teammate's rows. `git diff main...HEAD -- supabase/` contains no reference to `can_manage_content`. |

No other decision is depended on. Two items **would** have depended on one, and are parked
rather than assumed: SEC-08's trial-chaining half (D1, D3) and any pricing-shaped consequence of
the seat count (D1). Both are in the plan's parking lot with numbers.

Nothing contradicted a decision.

---

## 3. Per ID: exit criteria, how verified, red tests

Each criterion is quoted from `docs/assessment-2026-08/exit-criteria.md`.

### SEC-01 — coach cannot touch the admin row or assign `admin` (M · Gate:db)

> As a coach (`successor@` on Iron Falcons) over PostgREST: `PATCH team_members?role=eq.admin {"role":"student"}` → `42501`; `PATCH` own row `{"role":"admin"}` → refused; `DELETE team_members?role=eq.admin` → refused; `PATCH` the admin row's `user_id`/`managed_profile_id`/`status` → refused.

**Met.** Reproduced first, as `successor@falconforge.test`, a coach of Iron Falcons:

```
step 1: POST /rest/v1/user_attestations {"attestation_type":"terms","version":"2.0"}   201
step 2: PATCH /rest/v1/team_members?team_id=eq.<iron>&role=eq.admin {"role":"student"} 200
step 3: PATCH /rest/v1/team_members?team_id=eq.<iron>&user_id=eq.<me> {"role":"admin"} 200
step 4: POST /rest/v1/rpc/can_manage_billing {"p_team_id":"<iron>"}                    true

roster after:
  6713eccb… | 287830bc… (reviewer@, the real admin) | role=student
  0e273ec4… | 68d9cba6… (successor@, a coach)       | role=admin
```

and the shorter version on a team whose admin has no referencing rows — a coach added to the
team `guardian@` had just registered:

```
DELETE /rest/v1/team_members?team_id=eq.<t>&role=eq.admin                 204
  admins left: 0                                                    (stranded)
PATCH  /rest/v1/team_members?team_id=eq.<t>&user_id=eq.<me> {"role":"admin"}  204
  role | full_name
  admin| Mr Adeyemi
```

After `20260824000000`, same account, same requests:

```
(a) PATCH ?role=eq.admin {"role":"student"}
    403 {"code":"42501","message":"The team admin's role, identity and membership status can
         only be changed by an admin transfer."}
(b) PATCH own row {"role":"admin"}
    403 {"code":"42501","message":"The admin role is granted by an admin transfer, never by a
         roster edit."}
(c) DELETE ?role=eq.admin
    403 {"code":"42501","message":"The team admin's membership cannot be removed. Transfer the
         admin role first."}
(d) PATCH admin row {"user_id":"<me>"}          403 42501
(e) PATCH admin row {"status":"removed"}        403 42501
(f) PATCH admin row {"managed_profile_id":"<a real profile>"}  403 42501

roster after:  admin | Iron Falcons Admin      coach | Mr Adeyemi     (unchanged)
```

One nuance worth recording, because the report's claim needed checking rather than repeating.
On the *seeded* Iron Falcons the DELETE variant came back `23502` and the `user_id` repoint came
back `23505` — refused by a NOT NULL foreign key and by `team_members_unique_self`, not by any
permission rule. The policy permitted both; two incidental constraints happened to catch them on
that fixture. On a clean team both succeeded, which is the repro quoted above. The finding is
correct; the seeded team is not where you can see it.

> `nominate_team_admin` → `accept_admin_nomination`, `transfer_team_admin` and `operator_transfer_team_admin` still succeed end to end (the existing db tests stay green).

**Met.** (The RPC is named `accept_team_admin_nomination`; there is no
`accept_admin_nomination`.) All four exercised over PostgREST *after* the trigger existed —
which is the trap's own instruction:

```
nominate_team_admin            {"success":true,"pending_admin_member_id":"0bf97405…",
                                "expires_at":"2026-09-06T00:29:04Z"}
accept_team_admin_nomination   {"success":true,"admin_member_id":"0bf97405…",
                                "previous_admin_member_id":"6f3c8745…"}
  -> admin | Mr Adeyemi          coach | Iron Falcons Admin
transfer_team_admin            {"success":true,"admin_member_id":"6f3c8745…"}
  -> admin | Iron Falcons Admin  coach | Mr Adeyemi
operator_transfer_team_admin   {"success":true,"admin_member_id":"b656aefa…",
                                "previous_admin_member_id":null}
  -> admin | Ms Okonkwo   on the seeded STRANDED team; operator_actions row written,
     detail->>'team_was_stranded' = true
create_team_as_admin           {"success":true,…}
  -> role=admin, seat_assigned=t on the founding member
```

`operator_transfer_team_admin` needed an eligible successor constructed: the seeded stranded
team's only members are two `13_to_17` students, so the first attempt was refused by
`enforce_member_role_eligibility` with `23514` — the eligibility rule, reached *through* the new
trigger, which is the correct ordering.

> Coach can still change another member student ↔ mentor ↔ coach and remove a non-admin.

**Met.** `PATCH` on `mentor@`'s row mentor→coach→mentor, both 204; `DELETE` of a pending row,
204, row gone. (An attempt to promote a *student* to mentor came back `23514` "The mentor role
requires an 18+ account" — the pre-existing age rule, not this change.)

> **Red tests:** four new cases in `tenant-isolation.rls.db.test.ts` (or a sibling), one per refusal above, asserting the error code — not just "no row changed".

**Met, in a sibling:** `src/test/db/admin-membership-protection.rls.db.test.ts`, 11 tests, five
of them refusals, each asserting SQLSTATE `42501` through a local `expectRefused` rather than the
file-level `expectDenied` (which is satisfied by "no rows changed" and would pass against a
policy that had simply stopped matching the admin's row).

**Watched red**, with `ALTER TABLE team_members DISABLE TRIGGER
enforce_admin_membership_protection_trigger`:

```
 ❯ admin-membership-protection.rls.db.test.ts (11 tests | 7 failed)
   × cannot demote the admin
   × cannot make themselves the admin
   × cannot delete the admin row and strand the team
   × cannot repoint the admin row at themselves, or change its status
   × cannot INSERT a second admin onto a team it already has one on
   ✓ a coach can still move a member between student, mentor and coach
   ✓ a coach can still remove a non-admin member
   × the warm path still completes: nominate then accept
   × transfer_team_admin still moves it back
   ✓ create_team_as_admin still creates a seated founding admin
   ✓ operator_transfer_team_admin still rescues a stranded team
```

The two transfer failures are consequential — with the trigger off, the first test really does
demote the admin, so the team is broken by the time they run. That is the defect, doing its work
inside the suite.

Two of the refusals came back `23514` rather than `42501` in that run — "The team admin must
accept the terms of service before taking the role", from `enforce_member_role_eligibility`.
That is exactly the confusion the trigger's *name* prevents: BEFORE triggers fire in
alphabetical order, `enforce_admin_membership_protection_trigger` sorts ahead of
`enforce_member_role_eligibility_trigger`, and so the authority question is answered before the
question of whether the attacker happens to hold an attestation. Schema assertion 24 fails if
that ordering is ever lost, and was watched failing.

> **Trap:** a trigger that also blocks the transfer RPCs. Use a transaction-local flag set inside the RPCs (`SET LOCAL`) and check it with `current_setting(..., true)`; the RLS suite must exercise the RPC path *after* the trigger exists. Do not solve it by making `can_manage_roster` admin-only.

Followed. `PERFORM set_config('falconforge.admin_transfer', 'on', true)` around exactly the
statements that need it in all four RPCs, lowered immediately after; the trigger reads
`coalesce(current_setting('falconforge.admin_transfer', true), 'off')`. `can_manage_roster` is
untouched — `git diff main...HEAD -- supabase/` contains no `can_manage_roster` definition.

`ALTER FUNCTION … SET falconforge.admin_transfer` would have been tidier and does not work:
Postgres refuses (`permission denied to set parameter`) for a placeholder custom GUC unless the
role is a superuser, which Supabase's `postgres` is not. The four function bodies therefore
travel in full in the migration, which is the honest cost of forward-only migrations.

**One thing the exit criteria did not ask for, and the fix needed anyway.** `team_members` is
`ON DELETE CASCADE` from `users` and from `teams`, so deleting an account through the GoTrue
admin API — or running `docs/beta-ops.md`'s erasure runbook in psql — cascades into this table
with no JWT. A guard written only in terms of `auth.role()` would have made a team's admin
undeletable and taken account deletion down with it, and the db suite's own teardown does
exactly that. The guard therefore exempts `session_user IN ('postgres', 'supabase_admin',
'supabase_auth_admin')`, written in the *exempt* direction as a list of non-API roles rather
than as "if this is not `authenticator`" — naming `authenticator` would fail OPEN on any
deployment that named the role differently.

> Record the class in `docs/failure-modes.md` §6 (widest-brush default).

**Met.** §6 gains a SEC-01 bullet, and its closing line becomes "180, 261 and 319 green
assertions said nothing about the shape nobody tried."

---

### SEC-02 — `age_classification` survives sign-in (S · Gate:db)

> `update_user_age_classification('18_plus')` → password sign-in → `users.age_classification` is still `18_plus`; same after `PUT /auth/v1/user` (profile update) and after a password change.

**Met.** Before, as `iron-student0@` (signup metadata `13_to_17`):

```
before:               13_to_17
rpc update_user_age_classification('18_plus')  {"success": true}
after rpc:            18_plus
POST /auth/v1/token?grant_type=password  200
after sign-in:        13_to_17          <-- reverted
PUT /auth/v1/user {"data":{"full_name":"…"}}  200
after updateUser:     13_to_17
```

After `20260824000100`, same account, same requests:

```
before:                 13_to_17
after rpc:              18_plus
password grant HTTP 200
after sign-in:          18_plus
PUT /auth/v1/user HTTP 200
after updateUser:       18_plus | Student One Renamed
roster row (sync_user_to_team_members):  Student One Renamed
set new password HTTP 200
after password change:  18_plus
restore password HTTP 200
after restore:          18_plus
```

> A brand-new signup still writes `age_classification` and `full_name` from metadata (registration smoke spec green).

**Met.** `profile-mirror.db.test.ts` asserts it directly, and the registration smoke spec is in
the 20/20 Playwright run above — including "a brand-new account is not asked to re-accept the
documents it accepted a minute ago", which walks the real Mailpit round trip.

> **Red test:** db test: set the column, `UPDATE auth.users SET last_sign_in_at = now()`, assert unchanged (fails today).

**Met with one substitution, stated here.** `src/test/db/profile-mirror.db.test.ts`. The
sign-in stand-in is an `app_metadata` write through the admin API rather than a raw
`UPDATE auth.users`: importing `pg` broke `npm run lint` (`pg` is a devDependency with no
`@types/pg` and no other importer), and adding a types package for one test was the wrong trade.
An `app_metadata` write is an UPDATE of `auth.users` that leaves `raw_user_meta_data` alone,
which is precisely what `last_sign_in_at` is from this trigger's point of view. The *real*
password grant is in the API evidence above.

**Watched red**, with the pre-fix conflict branch restored in the database:

```
 ❯ profile-mirror.db.test.ts (7 tests | 3 failed)
   ✓ still writes full_name and age_classification from the signup metadata
   × is not reverted by a sign-in
       AssertionError: signing in put the signup metadata back over the column:
       expected '13_to_17' to be '18_plus'
   × is not reverted by a profile update, which UPDATEs auth.users too
   ✓ still fills a NULL classification from the metadata (the ensureUserProfile race)
   ✓ propagates a changed full_name from the auth metadata
   × does not put a stale metadata name back over a corrected one on sign-in
   ✓ still tracks the email, which only GoTrue writes
```

> **Trap:** the same COALESCE also rewrites `full_name` — fix both; and correct the "✅ RESOLVED" line in `FALCONFORGE_V2_PLAN.md` §8.

Both done, and the first one **not** the way the fix direction words it. "`full_name =
COALESCE(users.full_name, EXCLUDED.full_name)` (existing value wins)" would have deleted the only
path by which renaming yourself reaches `public.users`: `updateProfile` writes
`auth.users.raw_user_meta_data.full_name` and this trigger is what lands it in the profile row,
from where `sync_user_to_team_members` carries it to the roster. The sidebar would have updated
and the roster would not — the exact defect Sprint 5 spent a pass removing.

So the rule is stated once instead: the trigger re-applies a metadata field only when THAT FIELD
CHANGED. `age_classification` therefore only ever fills a NULL (nothing writes that metadata
after signup), and `full_name`/`avatar_url` propagate on a rename and leave the row alone on a
sign-in. The four green tests in the red run above are the controls that catch the shortest
reading; they are green precisely because they would have gone red under it.

Plan §8's "✅ RESOLVED 2026-08-22" line is corrected in the same commit, with what was actually
still broken and for how long.

---

### SEC-05 — teammates see only a child's name (M · Gate:db)

> As `iron-student0@`: `GET managed_profiles?select=notes,promotion_code` → error or columns absent; `select=id,full_name` still works for rostered children.

**First half met. Second half NOT met as written — deliberately, and here is why.**

Before, with the guardian's own words in the field `AddChildDialog` offers them:

```
guardian PATCH managed_profiles {"notes":"Peanut allergy - epipen in bag. Collected by
                                 grandma on Thursdays."}                        200
as iron-student0@ (a 13_to_17 student on the team):
GET /rest/v1/managed_profiles?select=full_name,notes,promotion_code
[{"full_name":"Sam Fussell","notes":null,"promotion_code":null},
 {"full_name":"Robin Fussell",
  "notes":"Peanut allergy - epipen in bag. Collected by grandma on Thursdays.",
  "promotion_code":null}]
```

After `20260824000200`, same student, plus a real promotion code offered first:

```
guardian: rpc offer_managed_profile_promotion -> {"success":true,"code":"MDHDQ5WS"}
GET ?select=id,full_name,notes,promotion_code   200 []
GET ?select=id,full_name                        200 []
```

`select=id,full_name` returns `[]` rather than the child's name. The policy is **dropped**
rather than narrowed, because:

* column-level `GRANT SELECT` is per ROLE, not per row, so a column list would have taken
  `notes` and `promotion_code` away from the **guardian**, who is the one person who has to read
  both;
* the split-surface alternative — base table for the guardian, a name-only view for the roster —
  publishes a new PostgREST endpoint that nothing reads. `managed_profiles` is a
  **guardian-scoped** registry entity (`entity-registry.ts:507`), so every client pull is
  `.eq('guardian_user_id', auth.uid())`; a teammate's client never asked for another family's
  child. `grep -rn managedProfiles src/` returns `GuardianView`, `JoinTeam` and `AppShell`'s
  `isGuardian` — three readers of the signed-in user's own children, nothing else.

What the criterion protects — the roster being able to name a child — comes from
`team_members.full_name`, which this migration does not touch:

```
as iron-student0@:
GET /rest/v1/team_members?select=full_name,managed_profile_id&managed_profile_id=not.is.null
[{"full_name":"Robin Fussell","managed_profile_id":"7d0890e2-…"},
 {"full_name":"Sam Fussell", "managed_profile_id":"91e167c9-…"}]
```

and there is a test asserting exactly that beside the refusal, so the refusal cannot be
satisfied by making the roster unusable.

> As the guardian: full row still readable and writable; `AddChildDialog` and `GuardianView` unchanged in the browser.

**Met.** Over the API, `select('*')` exactly as the client sends it:

```
as guardian@:
GET /rest/v1/managed_profiles?select=*
[{"id":"91e167c9…","full_name":"Sam Fussell","notes":null,"promotion_code":null,…},
 {"id":"7d0890e2…","full_name":"Robin Fussell",
  "notes":"Peanut allergy - epipen in bag. Collected by grandma on Thursdays.",
  "promotion_code":"MDHDQ5WS",…}]
```

In the built bundle at 1280×800, signed in as `guardian@`, `/app/guardian` renders both
children, their four consents each with versions, upcoming meetings, "Attended 3 of 3 recorded
so far. Most recent: Present.", the pending-approval notice for Sam, and "Give them their own
login". `Add a child` opens with its `Allergies, pickup arrangements — anything you want to keep
to hand.` textarea present.

> The registry's `managed_profiles` pull still works for both roles (the `select('*')` trap in the fix direction).

**Met** — that is the `select=*` output above, and the guardian view rendering from it.

> **Red test:** RLS test asserting a student cannot read `notes`/`promotion_code` (fails today).

**Met.** Two cases in `tenant-isolation.rls.db.test.ts`, plus two controls. One of them
**replaces** an existing assertion that could not fail: `owns the profile: the child's own team
can see it but not change it` did `.select('id')` and checked for one row, so it was green for
the whole life of the defect while every student could read `notes`. That is `failure-modes` §2,
found by having to change the test.

**Watched red**, with the policy recreated:

```
 ❯ tenant-isolation.rls.db.test.ts (269 tests | 2 failed)
   × SEC-05: a teammate reads nothing of a child's profile, not even their name
       AssertionError: a coach still reads a child's profile row: expected [ { …(4) } ] to
       deeply equal []
   × SEC-05: a student cannot read a child's notes or promotion code
       AssertionError: a teammate read a child's health and pickup notes:
       expected [ { …(2) } ] to deeply equal []
```

Schema assertion 25 counts the SELECT-permitting policies on `managed_profiles` and requires
exactly one, guardian-only — because policies for one verb OR together, which is how
`team_members` came to have five. Watched failing (`managed_profiles has 2 policies that permit
SELECT`).

---

### SEC-09 — creation-time invite code lasts 7 days and says so (S · Gate:db)

> `create_team_as_admin` inserts `expires_at = now() + 7 days`; CreateTeam's success screen shows the expiry; InviteManager shows one consistent lifetime for both codes (WALK-B-08 screenshot no longer reproducible).

**Met.** Before — three teams registered in a row over the API:

```
name                   | code     | expires_at - created_at
SEC-08 Trial Chain 1   | D34352E1 | 1 day
SEC-08 Trial Chain 2   | 4E66EBD6 | 1 day
SEC-08 Trial Chain 3   | CA58F880 | 1 day
```

After `20260824000300`:

```
POST /rpc/create_team_as_admin
{"success":true,"team_id":"fd920b6f…","invite_code":"F7B80B7D",
 "invite_expires_at":"2026-08-30T00:47:49.310212+00:00"}

SEC-09 Verify | F7B80B7D | 7 days       (the registration code)
MANUAL01      |          | 7 days       (a code POSTed later, as InviteManager does)
```

The lifetime is written down **once**, as the column DEFAULT. `create_team_as_admin` still omits
the column and now reads back what the default chose (`RETURNING expires_at`);
`InviteManager` loses `INVITE_LIFETIME_HOURS` and stops sending `expires_at` at all. Two numbers
that merely agreed for now would have been `failure-modes` §12, which is how they came to
disagree in the first place.

In the built bundle, registering a team as `successor@`:

```
Team Created Successfully!
Your team invite code:
5A9F7794
Share this code with team members to invite them
Works until Saturday, Aug 29, 8:38 PM. You can make a new code any time from Admin → Invites.
```

and the row: `expires_at` = `2026-08-30 01:38:07.922804+00`, which
`AT TIME ZONE 'America/Chicago'` is `2026-08-29 20:38:07`. Exact.

The Invites panel on the same team, showing the registration code and one generated afterwards:

```
Invite Links   Generate Link
8TC8RDVP   167h 59m remaining
5A9F7794   167h 59m remaining
Invite links last a week.
```

WALK-B-08's screenshot is no longer reproducible.

**One defect found by running it, fixed in `67c62c5`.** The first version of the line said "Works
until Saturday, Aug 29" — correct to the day and misleading by an evening, since a code made on
a Sunday evening dies on the Saturday *evening*, and "works until Saturday" reads as all of
Saturday to the coach holding it. It names the hour now. This is not `failure-modes` §10's
UTC-midnight class: `expires_at` is an instant, so rendering it in the reader's own zone is the
correct reading, and the missing piece was the time rather than the zone.

At 375×812 the line wraps to three lines, computed font 12px, `document.documentElement.
scrollWidth === window.innerWidth === 375` — no horizontal overflow.

> **Red test:** db test on the RPC's inserted `expires_at` (fails today at 24 h).

**Met.** `src/test/db/invite-lifetime.db.test.ts`, watched red with the default put back to
24 hours:

```
 ❯ invite-lifetime.db.test.ts (3 tests | 2 failed)
   × the column DEFAULT is a week, not a night
       AssertionError: a hand-inserted invite still expires overnight: expected 1 to be 7
   × create_team_as_admin issues a code that lasts a week and says when it stops
       AssertionError: the registration code still expires overnight: expected 1 to be 7
   ✓ the code it issues is still usable a day later, which is what SEC-09 broke
```

The third stays green on purpose: it ages an invite row to 25 hours old and joins with it, so it
asserts the *behaviour* rather than the default, and would not notice a default change. It is
the control, and its greenness in that run is the point.

Plus two component tests in `CreateTeam.test.tsx`, watched red with the expiry line removed. They
derive the expected date from the RPC's own answer rather than asserting a literal, and pass
under `TZ=UTC` and `TZ=America/Chicago` — a hardcoded "Saturday, Aug 29" would have been green in
one and red in the other, which is how this project has found date defects before.

---

### SEC-10 — server-side under-13 (S · Gate:db)

> signup with `age_classification='under_13'` in metadata is refused by `handle_new_user`; `update_user_age_classification('under_13')` refused. Red tests for both.

**Met, and a third door closed with them.** Before:

```
POST /auth/v1/signup {"data":{"age_classification":"under_13","full_name":"Tiny Person",…}}
  200, user id 986b3aed-…
  users: sec10-child@falconforge.test | under_13 | Tiny Person

POST /rpc/update_user_age_classification {"classification":"under_13"}   {"success": true}
  users: iron-student0@falconforge.test | under_13
```

After `20260824000400`:

```
POST /auth/v1/signup {…"under_13"…}
  500 {"code":"23514","message":"Members under 13 use a guardian-managed profile and do not
       have an account of their own. Ask a parent or guardian to sign up and add you."}
  auth.users rows for that address: 0
  public.users rows for that address: 0

POST /rpc/update_user_age_classification {"classification":"under_13"}
  200 {"success": false, "error":"Members under 13 use a guardian-managed profile and do not
       have an account of their own."}

PATCH /rest/v1/users?id=eq.<me> {"age_classification":"under_13"}
  400 {"code":"23514","message":"Members under 13 use a guardian-managed profile…"}
  users: iron-student0@falconforge.test | 13_to_17          (unchanged)

POST /rpc/update_user_age_classification {"classification":"18_plus"}
  200 {"success": true} -> 18_plus                          (the control)
```

The third door is a plain `PATCH /rest/v1/users`, which `users_update_own` permits and which the
assessment's own capability matrix lists ("change own age classification (any value) — ✓ RPC /
direct `users` PATCH"). Closing the two named doors and leaving that one open would have been
theatre. So the rule is a BEFORE trigger on `public.users` that all three pass through, plus an
earlier, kinder copy in the RPC so the caller gets its `{success:false, error}` contract rather
than a 500 — the same pattern, and the same reasoning, `nominate_team_admin` already uses for its
own age check. Both are asserted rather than trusted to agree.

The column CHECK is deliberately **not** narrowed to two values: `join_team_with_invite` still
reads `under_13` to explain the guardian route, and `CompleteProfileForm` still offers the choice
in order to say what to do instead. `under_13` stays something a person can say; it stops being
something an account can be.

**Red tests:** `src/test/db/no-under-13-accounts.db.test.ts`. Watched red with the trigger
dropped and the RPC's old value list restored:

```
 ❯ no-under-13-accounts.db.test.ts (5 tests | 3 failed)
   × refuses an account whose signup metadata says under_13, and creates no auth user
       AssertionError: an under-13 signup succeeded: expected null not to be null
   ✓ still accepts an ordinary 13_to_17 signup — the control
   × the RPC refuses, in its own {success:false} shape
       AssertionError: expected { success: true } to match object { success: false }
   × a direct PATCH of users is refused too — the door the finding did not name
   ✓ "I've turned 18" still works — the control
```

**What the test deliberately does not assert, and why.** Not the wording of the signup refusal.
`/auth/v1/signup` answers plain curl with the trigger's sentence, but supabase-js sends
`X-Supabase-Api-Version: 2024-01-01`, and under that version GoTrue replaces every database error
with `{"code":"unexpected_failure","message":"Database error saving new user"}`. Confirmed by
capturing the client's request and replaying it byte-for-byte with and without the header. So the
sentence exists and the app can never see it; asserting it would be a green result about a
response no client receives. What the app shows a child is `CompleteProfileForm`'s disabled
button, which is unchanged. Mapping the generic message is in the parking lot, with OPS-06.

---

### SEC-03 — removing a member keeps history (M · Gate:db)

> In the browser as admin: "Remove" a student who has an assigned task and attendance → succeeds; the row is `status='removed'`, `seat_assigned=false`; the task shows unassigned (or keeps the name read-only — state which); `meeting_attendance` rows for that member still exist.

**Met. The task shows unassigned** — see the statement below.

Before, over PostgREST as the team's admin, issuing exactly what the Remove button issued:

```
member with 0 tasks, 9 attendance rows:
DELETE /rest/v1/team_members?id=eq.7cdb5389…            204
  attendance rows for that member afterwards: 0        <-- was 9

member with 1 assigned task, 9 attendance rows:
DELETE /rest/v1/team_members?id=eq.22200e4a…            400
{"code":"23502","details":"Failing row contains (18b4ece4-…, null, f6a9fd75-…, null,
 SEC-03 repro task, …)","message":"null value in column \"team_id\" of relation \"tasks\"
 violates not-null constraint"}
```

After, **in the built bundle** (`index-CgCf6QIl.js`, service worker cleared first and the loaded
script compared to `dist/`), signed in as `reviewer@` at 1280×800, Admin → Team Roster,
Student 1 (1 assigned task, 9 attendance rows), Remove → confirm:

```
DB after:
  Student 1 | removed | seat_assigned=f
  tasks still assigned to them: 1
  attendance rows kept:         9

Screen after:
  errorBanner ("Failed to remove member"): false
  Active Members (15)  ->  Active Members (14)
  SEATS IN USE 15 of 15  ->  14 of 15
  "No seats left — 15 of 15 in use" blurb: gone
  Student 1 listed:  false
```

The confirm dialog now says what actually happens: *"They lose access and free up their seat.
Their tasks, scouting reports and attendance stay on the team's record, and they can rejoin later
with an invite code."*

**Which option, stated as the criterion asks: the task shows unassigned.**
`server-pull.ts:245-247` filters `team_members` to `status = 'approved'`, so a removed member
leaves the client's collection entirely — the same as when the row was deleted, so this is not a
regression. Opening that task in the browser after the removal shows `Assigned To: Unassigned`
and an option list without Student 1. Keeping the name read-only needs the pull to carry
`status = 'removed'` rows, which is `server-pull.ts` and Package B's file; parked with the exact
call site, including the sharper edge — saving that task then persists `assignedTo: ''`.

> Rejecting a *pending* request still works (delete or mark removed — state which, and test it).

**Met — mark removed.** Both handlers take one path, `setMemberRemoved`. A pending row *usually*
has no references, and "usually" is how this defect got here; one path also means a rejected
person who reapplies lands back on their own row. `MemberManager.test.tsx` covers the path; the
pending row leaves the queue because `fetchPendingMembers` selects `status = 'pending'`.

> A removed member re-joining with a code lands `pending` on the **same** `team_members.id`.

**Met.** `member-removal.db.test.ts` → *"lets them rejoin with a code, onto the SAME
team_members row"*: `join_team_with_invite` returns
`{success: true, status: 'pending', member_id: <the same id>}`. That branch has existed since
Sprint 3 and nothing could ever reach it, because the row was gone.

> `docs/beta-ops.md` and plan §8 no longer claim "the app never deletes a member".

**Met**, both corrected in the same commit as the fix, each saying what was actually true and for
how long.

> **Red test:** db/integration test that removal of a member with an assigned task succeeds (fails today with `23502`).

**Met**, and doubled, because the db test alone cannot see this component reaching for `.delete()`
again — which is the drift that produced the finding.

`src/test/db/member-removal.db.test.ts` (4 tests) proves the statement against a real database,
and keeps a test asserting that the DELETE is **still** refused `23502`, so "nothing reaches the
composite FKs any more" stays a fact rather than an assumption.

`src/components/__tests__/MemberManager.test.tsx` (3 tests) has a mock that refuses `.delete()`
with the real `23502`. Watched red with `.delete()` restored:

```
 ❯ MemberManager.test.tsx (3 tests | 3 failed)
   × marks the member removed and releases their seat, in one statement
       AssertionError: expected [] to have a length of 1 but got +0
   × never DELETEs, which is what the schema refuses
       AssertionError: expected "vi.fn()" to be called at least once
   × does not show "Failed to remove member" — the message the old path produced
       AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
```

`src/components/__tests__/AppShell.roster.test.tsx` (3 tests, a new file — `AppShell` had none)
covers the other half: the shell drops removed rows from the roster it hands every route. One
filter, not one per picker — `pullFromServer` already filters to `approved`, so this is for the
path that bypasses it, `pullGuardianMemberships`, which merges a guardian's children in at every
status on purpose. A coach who is also a parent would otherwise be offered their own removed
child in every assignee `<select>` in the app. Watched red with the filter removed, all three
including the control that a *pending* member is still listed.

> **Trap:** do not fix this by widening the FK actions yet — that is a migration on the frozen schema (per-column `ON DELETE SET NULL (column)`) and is a separate, later item. The UI fix is enough for Phase 0.

Followed. No migration for SEC-03; `git diff main...HEAD -- supabase/` contains no
`ALTER TABLE … FOREIGN KEY`.

---

### SEC-06 — predicate exposure (S · Gate:db)

> `anon` `POST /rpc/get_user_team_ids` → no EXECUTE

**Met, by removing the function rather than the grant.** Before:

```
anon POST /rpc/get_user_team_ids {"p_user_id":"<reviewer's uid>"}
  ["163f3ef0-b0d6-4ad8-b357-7436f5aa10b3"]
```

After `20260824000500`:

```
anon /rpc/get_user_team_ids {"p_user_id":"<reviewer>"}
  {"code":"PGRST202","message":"Could not find the function
   public.get_user_team_ids(p_user_id) in the schema cache"}
full@ /rpc/get_user_team_ids {"p_user_id":"<reviewer>"}     same PGRST202
anon /rpc/get_user_team_ids {}                              []
full@ /rpc/get_user_team_ids {}                             ["8bd49f3b-…"]   (their own team)
```

The arg'd overload is dropped and replaced by a zero-argument form reading `auth.uid()`. The
caller-scoped form keeps its anon grant, and has to: `users_select_teammates` calls it, and a
policy is evaluated as the calling role. It answers `[]` for a caller with no session, which is
not information about anybody.

> `team_seats_remaining` removed from the allowlist or actually used

**Met — removed from the allowlist, and `team_can_write` with it.** Both gain a membership
check and are revoked from `PUBLIC, anon`. Before:

```
anon /rpc/team_can_write       {"p_team_id":"<iron>"}   true
anon /rpc/team_seats_remaining {"p_team_id":"<iron>"}   0
full@ (a member of another team), same two calls        same answers
```

After:

```
anon /rpc/team_can_write       {"p_team_id":"<iron>"}
  {"code":"42501","message":"permission denied for function team_can_write"}
anon /rpc/team_seats_remaining {"p_team_id":"<iron>"}
  {"code":"42501","message":"permission denied for function team_seats_remaining"}
full@ /rpc/team_can_write       {"p_team_id":"<iron>"}   false
full@ /rpc/team_seats_remaining {"p_team_id":"<iron>"}
  {"code":"42501","message":"Seat counts are only available to members of that team"}
full@ /rpc/team_can_write       {"p_team_id":"<own team>"}   true      (the control)
full@ /rpc/team_seats_remaining {"p_team_id":"<own team>"}   0         (the control)
```

`service_role` is exempt from the membership check, deliberately and for a specific reason:
without it, `operator-console.db.test.ts`'s *"team could still write after every grant was
revoked"* — which calls `team_can_write` through the service client — would have gone on passing
while asserting nothing at all, since the service client is a member of nothing. That is exactly
the class of green result this sprint keeps finding, and it would have been introduced by the fix
for it.

Both `auth.role()` comparisons are wrapped in `coalesce`: `auth.role()` is NULL on a connection
with no JWT, and `NULL OR false` is NULL — B25's exact shape. Schema assertion 20 now covers
`team_can_write` for it.

> anonymous SELECTs still return `[]` not an error (test it before and after).

**Met, tested rather than assumed, on all eighteen tables plus the view.** Before (`tasks users
managed_profiles seasons meetings meeting_attendance scouting_reports teams team_members invites
checklists`) and after (those plus `match_plans sub_teams license_grants guardian_consents
user_attestations operator_actions platform_operators team_entitlement`), every one:

```
tasks                  [] [HTTP 200]
users                  [] [HTTP 200]
managed_profiles       [] [HTTP 200]
…
team_entitlement       [] [HTTP 200]
```

**Not changed, and logged rather than done quietly:** `season_is_open` and
`meeting_season_is_open` still tell a caller who already holds a season or meeting uuid whether
it is archived. Both are consulted by every content WRITE policy, so a membership guard costs a
second `is_team_member` probe per row written (≈18 µs/row by the SEC report's own measurement),
for one bit about no person. Parked with the numbers.

**Red tests:** four cases appended to `anon-execute.rls.db.test.ts`, three watched red with the
pre-SEC-06 functions and grants restored:

```
 ❯ anon-execute.rls.db.test.ts (28 tests | 3 failed)
   × anon cannot ask which teams somebody else is on
       AssertionError: get_user_team_ids(p_user_id) answered an anonymous caller instead of
       refusing it: expected null not to be null
   × anon cannot ask whether a team may write, or how many seats it has left
       AssertionError: team_can_write answered an anonymous caller instead of refusing it
   × nor can a signed-in member of a DIFFERENT team
       AssertionError: another team's licensing state leaked: expected true to be false
```

The fourth — that the caller-scoped form still answers anon with `[]` — stays green, and is the
control that stops the refusals being satisfied by a function nobody can call.

Assertion 23's allowlist loses both functions. A new **23a** fails if either rejoins the anon set
or if `get_user_team_ids` grows an argument again — assertion 23 only catches a function that
JOINS the set, and nothing was watching the other direction. Both halves watched failing:

```
ERROR:  SECURITY DEFINER functions an anonymous caller can EXECUTE: team_can_write. …
ERROR:  get_user_team_ids takes an argument again -- at /rpc that is another user's team list
        for anyone holding the anon key (SEC-06)
```

---

### SEC-08 — bare `teams` insert (S · Gate:db)

> `teams_insert_owner` policy dropped; `create_team_as_admin` still works (it runs as definer).

**Met.** Before, as `guardian@`:

```
POST /rest/v1/teams {"name":"SEC-08 bare insert","owner_id":"<me>"}     201
  name               | members | grants | seasons
  SEC-08 bare insert |       0 |      0 |       0
```

Worth recording how nearly this was missed: the *first* attempt, with
`Prefer: return=representation`, came back `403 new row violates row-level security policy` —
because RETURNING has to satisfy the SELECT policy too, and a team you are not a member of does
not. The row landed both times. "I tried it and it was refused" and "it is refused" are different
claims.

After `20260824000600`:

```
POST /rest/v1/teams {"name":"SEC-08 bare insert","owner_id":"<me>"}
  403 {"code":"42501","message":"new row violates row-level security policy for table
       \"teams\""}
  rows created: 0

POST /rpc/create_team_as_admin {"team_name":"SEC-08 Proper Team","season_name":"2026-2027"}
  {"success":true,"team_id":"ed863d8f-…","invite_code":"071FDC4F",
   "invite_expires_at":"2026-08-30T01:25:14Z"}
  name               | members | grants | seasons | subteams | checklists
  SEC-08 Proper Team |       1 |      1 |       1 |        5 |          1
```

Nothing replaces the policy. `create_team_as_admin` is SECURITY DEFINER owned by `postgres`,
which owns `teams` and is not subject to its policies (`relforcerowsecurity` is `f`), so the RPC
never consulted it. `entity-registry.ts` already records `teams` as pull-only.

**Red test:** *"an authenticated user cannot POST a bare team row naming themselves as owner"* in
`tenant-isolation.rls.db.test.ts`, watched red with the policy recreated
(`AssertionError: a bare team INSERT was accepted: expected null not to be null`). It asserts the
ROW as well as the response, for the `Prefer` reason above.

The 269 existing isolation assertions ran over this policy without ever exercising its permitted
case: the cross-tenant `teams` INSERT names the VICTIM as owner, which the policy always refused.
Trying your own id is `failure-modes` §6's rule, written after B21, and this is the second time
the rule has found something.

**Not addressed**, and parked: SEC-08's other half, trial-chaining. One account registered three
teams in a row, each with its own unlimited-seat grant valid until 2026-11-21
(`v_trial_days constant integer := 90`). That is a billing question resting on D1 and D3 and
belongs with SEC-07 / Package F, not with the RLS fix.

---

## 4. Discovered → parking lot

Seven entries added to `FALCONFORGE_V2_PLAN.md` §8 under
*"From Package A of the August 2026 assessment"*, with exact numbers:

1. **Every seeded review account meets the legal-documents modal on its first screen.**
   `seed-review-states.mjs:52` omits `privacy_accepted`/`privacy_version` from the signup
   metadata, so no `privacy_and_guidelines` attestation is written; `reviewer@` has exactly one
   attestation (`coach_terms` 2.0) and `guardian@` has none. It is
   `docs/environment-divergences.md` §1's own story a second time — the e2e helper was fixed, the
   review seed was not. One line. It blocked the first click of my own browser pass.
2. **After SEC-03, saving a task assigned to a removed member writes the assignment away**
   (`server-pull.ts:245-247`). Package B's file.
3. **supabase-js never sees a trigger's message on signup** — `X-Supabase-Api-Version:
   2024-01-01`. Belongs with OPS-06.
4. **`season_is_open` / `meeting_season_is_open` are still anon-callable one-bit oracles.**
5. **SEC-08's trial-chaining half**, with the three-teams-in-a-row reproduction.
6. **`pg` is an unused devDependency** with no `@types/pg` (`package.json:73`).
7. **`schema_assertions.sql` printed its success line before assertion 23** — fixed in this
   sprint while adding 24, 25 and 23a; recorded because it is the shape of §3.

Nothing outside the eight IDs went into the diff, with two exceptions I am calling out rather
than hiding: the `SELECT 'schema assertions passed'` line moved to the end of the assertions file
(otherwise the three new assertions would have printed after it), and `CreateTeam.test.tsx` grew
a small typed `rpcMock()` helper so the two new cases did not raise the `as any` count.

---

## 5. What was not done, and why

- **SEC-05's `select=id,full_name` criterion is not met as written.** A rostered child's name is
  not readable through `managed_profiles` at all now; it returns `[]`. The reasoning, the
  alternatives weighed, and the evidence that nothing read that surface are in §3. What the
  criterion protects still works and is asserted. Scaling this back to a name-only view is one
  short migration if you want the literal criterion.
- **SEC-03's schema half** — per-column `ON DELETE SET NULL` on the five composite FKs — is
  untouched, as the trap instructs.
- **SEC-06 leaves `season_is_open` and `meeting_season_is_open`** as described above.
- **SEC-08's trial-chaining half** is parked on D1/D3.
- **`docs/beta-ops.md`'s deletion runbook was not re-rehearsed.** SEC-03 changes what the app
  does, not what the runbook does, and the runbook's own correctness argument (release each
  reference with a single-column UPDATE first) is unaffected. The prose that was false is
  corrected.
- **No screenshots.** The Browser pane would not composite frames in this session
  (`Screenshot timed out after 5s: the Browser pane is not displayed`), so the built-bundle
  evidence in §3 is accessibility-tree text, computed geometry and `document.body.innerText`
  read out of the live page, plus the database rows beside them. Every browser measurement was
  taken after clearing the service worker and comparing the loaded script filename against
  `dist/` — which caught a stale bundle twice, exactly as `environment-divergences` §4 says it
  would.
- **The local database is not in its seeded state.** It ends on `gate:db`'s own
  `supabase db reset`, i.e. schema-only. `npm run seed:review` restores it.

---

## 6. Effort, actual vs estimate

| ID | Estimate | Actual | Note |
|---|---|---|---|
| SEC-01 | M | M | The four RPC bodies travelling in full was the cost; `ALTER FUNCTION … SET` does not work for a custom GUC without superuser. |
| SEC-02 | S | S | The `full_name` half took the longest, and the fix direction's wording for it is wrong. |
| SEC-05 | M | S | Smaller than estimated once the reader survey showed there was none. |
| SEC-09 | S | S+ | The client half (one definition, not two) and the browser check that found the missing hour. |
| SEC-10 | S | S+ | The third door, and the GoTrue header finding. |
| SEC-03 | M | M+ | The largest, because it is the only one with real UI consequences; two new test files. |
| SEC-06 | S–M | M | Deciding what may be revoked without breaking `200 []` needed the before/after measurement, not reasoning. |
| SEC-08 | S | S | |

---

## 7. One line for the plan §8 Progress log

```
| 2026-08-24 | Sprint 10 — Package A "tenant safety" (SEC-01, 02, 05, 09, 10, 03, 06, 08) | `v2/sprint-10-tenant-safety` | **Complete, unmerged.** `gate:db` green (lint / 678 unit +2 skips / 91 integration / build / schema assertions / 517 db / 343 rls) and the e2e pack 20/20. Six forward migrations, one per ID that needed one. **Every one of the eight was reproduced over PostgREST as the real role before the fix and proved closed the same way after**, both outputs in `docs/sprint-10-report.md`. **SEC-01 was a three-request takeover**: `can_manage_roster` is admin OR coach with no column restriction, so a coach demoted the admin (200), promoted themselves (200) and got `can_manage_billing` true — or DELETEd the admin row and stranded the team. Closed by a BEFORE trigger with a transaction-local flag the four transfer RPCs raise; all four verified end to end afterwards, and the trigger's NAME is load-bearing (BEFORE triggers fire alphabetically, so authority is answered before eligibility — assertion 24 fails if that is lost). It exempts non-API session roles, because `team_members` cascades from `users` and a JWT-only guard would have made a team's admin undeletable. **SEC-02's plan line said RESOLVED for two days while the correction still reverted on the next login** — `handle_new_user` re-applied frozen signup metadata on every `auth.users` UPDATE; the fix direction's wording for `full_name` would have deleted the rename path, so the rule is "re-apply a metadata field only when THAT FIELD changed" and the four controls that catch the shortest reading are green in the red run. **SEC-05: a 13-year-old could read another family's child's "Peanut allergy - epipen in bag" and their promotion code**; the policy is dropped rather than narrowed (column grants are per role, and the surface had no reader) so `select=id,full_name` now returns `[]` — the one exit criterion not met as written, with the roster's own naming path asserted beside it. **SEC-03: the plan and the runbook both said the app never deletes a member and both handlers called `.delete()`** — 9 attendance rows to 0 on the delete that worked, `23502` on the one that did not; verified in the built bundle (seats 15/15 → 14/15, task and 9 attendance rows kept). **SEC-06 closed three oracles and left two, with the numbers**; `200 []` measured on all 18 tables before and after rather than assumed. SEC-09's lifetime is now one number (the column DEFAULT) and the screen names the hour, found by running it. SEC-10 closed a third door the finding did not name (`PATCH /rest/v1/users`). `as any` unchanged at 56; three new schema assertions, each watched failing; seven parking-lot entries including a review seed that puts a legal modal on the first screen of every account. |
```
