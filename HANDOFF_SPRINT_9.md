# Hand-off — Sprint 9: Guardian accounts UI

Written 2026-08-17, after the cross-sprint retrospective merged and deployed, and updated the
same day once Kevin settled the design questions. Restores the per-sprint hand-off convention,
which drifted at Sprint 8 (there is no `HANDOFF_SPRINT_8.md` and no `docs/sprint-8-report.md` —
Sprint 8 exists only as rows in the plan's §8 log).

This file carries **only what is not written down elsewhere**. Everything else is a pointer on
purpose: the last retrospective was largely about prose that drifted from the repo, and a
hand-off that restates the plan is a second source of truth with a shorter half-life than the
first.

---

## The prompt

> Read `FALCONFORGE_V2_PLAN.md` §3 (the six guardian decisions locked on 2026-08-17), §5
> (engineering rules), and the Sprint 9 line in §6's post-beta backlog. Then read
> `HANDOFF_SPRINT_9.md`. Then execute Sprint 9 on branch `v2/sprint-9-guardians`.
>
> Before writing tests or claiming anything is done, read `docs/failure-modes.md` and
> `docs/environment-divergences.md`. They are new since Sprint 8 and they are the reason this
> sprint should cost less than the last one.
>
> The design questions are already answered — do not reopen them, and do not infer them from the
> schema, which is older than the decisions. Ask me only if you find something that contradicts
> them.

---

## What Sprint 9 is

From the plan: *"Guardian accounts UI: guardian signup, managed student profiles, profile
switching, consent records surfaced."* Read §3 for how each of those was decided — in particular
that **the guardian creates the profile, not the coach**, and that **there is no act-as mode**.

## Do this first

**Drop `managed_profiles.birth_year`** (§3, "Child's date of birth"). It is a forward migration
on the frozen schema, and it is cheap *now* and expensive later, because nothing writes the
column yet. It touches exactly three things:

- the column, added in `supabase/migrations/20260816000000_v2_tables.sql:73`
- `src/test/db/fixtures.ts:301`, the only line in the repo that sets it
- `src/lib/database.types.ts` (3 references) — regenerate with `npm run db:types`

Then `npm run gate:db`. Doing this before any guardian UI exists means no code is ever written
against a field that is going away.

## What already exists — verified against the live schema, not inferred

- **`managed_profiles`** — `guardian_user_id`, `full_name`, `birth_year` (going away), `notes`.
  Unique on `(id, guardian_user_id)`, which is the composite a policy can lean on.
- **`guardian_consents`** — unique on `(managed_profile_id, consent_type)`, plus `version` and
  `consented_at`. `consent_type` is free text and nothing enumerates it; Sprint 9 decides the set.
- **`team_members.user_id` is NOT NULL**, `managed_profile_id` is nullable, and there is a CHECK
  that `managed_profile_id IS NULL OR role = 'student'`. So the model is already the one §3
  locked: **the guardian's account holds the roster row and the managed profile names the child.**
  There is **no** unique constraint on `(team_id, user_id)`, so one guardian can hold two
  children on the same team — siblings work, and each consumes a seat.
- `team_members.managed_profile_id` already round-trips through the entity registry
  (`entity-registry.ts:308,320`).
- Both tables have RLS and behavioural isolation coverage in
  `src/test/db/tenant-isolation.rls.db.test.ts` (~line 900 onward), including the case Sprint 3
  flagged: `managed_profiles_select_teammates` is what would hand a guardian the name and email
  of every adult and child on their child's team. **Read that block before touching a policy.**
- Fixtures exist: `src/test/db/fixtures.ts:298-303`.

**Nothing in `src/` reads or writes either table.** No UI, no store slice, no registry entry.
Both tables are empty locally and production is greenfield.

## Landmines specific to this sprint

1. **🔴 `guardian_consents.version` has a DEFAULT of `'1.0'`.** Drop it in the same migration as
   `birth_year`. This is the Sprint 8 follow-up defect in a new table — a hardcoded version in the
   database that drifts the moment the documents are revised, against a comment in
   `attestations.ts:81-84` explaining why the database must not know the version. The client owns
   it, the way signup metadata now does. Free today, because no consent row exists anywhere.
2. **Neither guardian table is in the entity registry**, so neither syncs offline. This is the
   same enrolment Sprint 8 did for `meetings`/`meeting_attendance`, `REPLICA IDENTITY FULL`
   included if deletes must propagate. Note the offline question is real but small here: a
   guardian managing profiles is doing something inherently online-ish, but a coach reading who
   is on the roster at a venue is not.
3. **🔴 The local stack's auth config differs from production.** Local
   `enable_confirmations = false` returns a session from `signUp`; production does not. Guardian
   signup is a *signup flow*, so this is the sprint where that bites hardest — Sprint 8's
   follow-up proved that client-side "do this right after signing up" code does not run in
   production. Anything that must survive account creation runs server-side or after the first
   real sign-in. `docs/environment-divergences.md` §1.
4. **🔴 Password recovery is dead end to end in production** — a non-hash `redirectTo` on a
   HashRouter gh-pages app, no `404.html`, no matching route, so the catch-all silently discards
   the token. **The guardian owns the login for a child who has none**, so a guardian who cannot
   reset their password locks out their child's roster place too, not just their own account. It
   is fixable on its own without the deferred auth-email branding work. **Not yet scoped into
   this sprint — ask Kevin at kickoff whether it comes in.**
5. **Promotion graduates in place.** Read §3 before designing it. The `team_members` row keeps
   its `id`; only the identity it points at changes. Getting this wrong means re-approval, a lost
   seat, and orphaned attendance — `meeting_attendance` is unique on `(meeting_id,
   team_member_id)`, which is exactly why keeping the id is what preserves history.

## The one question left for Kevin at kickoff

Sprint 6 and Sprint 8 each turned on a decision taken at kickoff rather than discovered
mid-build, so ask before building:

- **Does the password-recovery fix (landmine 4) come into this sprint?** It is a live production
  defect that this sprint's users are the most exposed to, and it is small on its own — but it is
  not "guardian accounts UI", and Sprint 9 is already carrying a migration.

Everything else is settled in §3. Do not reopen it.

## Exit criteria

Beyond `npm run gate:db` green and the standard rules in §5:

- A guardian can sign up, add a child, and join a team with an invite code — demonstrated end to
  end **in a browser**, as both the guardian and the coach approving. The coach's flow must be
  unchanged from any other member.
- The admin's attestation at approval is recorded, not just displayed.
- A guardian can promote a child to their own login, **and the child keeps their team place and
  their whole attendance history** — asserted, not eyeballed.
- Consent records are visible to the guardian who gave them and to nobody else — asserted
  behaviourally as the least-privileged role that can reach the table, including the teammate
  case Sprint 3 flagged.
- `birth_year` is gone; the `version` default is gone; the client owns the version.
- Both tables in the entity registry, with the offline path exercised.
- Screenshots at 375 / 768 / 1280 via `npm run capture`.

## Two things that are new since Sprint 8

- `npm run gate` / `npm run gate:db` is now the **only** definition of the Gate. Do not spell it
  out as separate scripts.
- ESLint exists now and is deliberately small. To add a rule, name the commit it would have
  caught — that is the bar. Two rules are written up in `eslint.config.js` and *deliberately not
  enabled*; turning either on is scoped work, not a lint fix, and both are in the parking lot
  with numbers.
