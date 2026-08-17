# Hand-off — Sprint 9: Guardian accounts UI

Written 2026-08-17, after the cross-sprint retrospective merged and deployed. Restores the
per-sprint hand-off convention, which drifted at Sprint 8 (there is no `HANDOFF_SPRINT_8.md` and
no `docs/sprint-8-report.md` — Sprint 8 exists only as three rows in the plan's §8 log).

This file carries **only what is not written down elsewhere**. Everything else is a pointer on
purpose: the last retrospective was largely about prose that drifted from the repo, and a
hand-off that restates the plan is a second source of truth with a shorter half-life than the
first.

---

## The prompt

> Read `FALCONFORGE_V2_PLAN.md` §5 (engineering rules) and the Sprint 9 line in §6's post-beta
> backlog, then `HANDOFF_SPRINT_9.md`, then execute Sprint 9 under those rules on branch
> `v2/sprint-9-guardians`.
>
> Before writing tests or claiming anything is done, read `docs/failure-modes.md` and
> `docs/environment-divergences.md`. They are new since Sprint 8 and they are the reason this
> sprint should cost less than the last one.
>
> Ask me about the open decisions at the bottom of the hand-off before building.

---

## What Sprint 9 is

From the plan: *"Guardian accounts UI: guardian signup, managed student profiles, profile
switching, consent records surfaced."*

The product rule it implements, from `CLAUDE.md`: under-13s use guardian-managed profiles, the
guardian owns the login, and the child has no credentials.

## What already exists — verified against the live schema, not inferred

- **`managed_profiles`** — `guardian_user_id`, `full_name`, `birth_year` (CHECK 1900–2200),
  `notes`. Unique on `(id, guardian_user_id)`, which is the composite a policy can lean on.
- **`guardian_consents`** — `(managed_profile_id, consent_type)` unique, plus `version` and
  `consented_at`.
- Both have RLS and behavioural isolation coverage in
  `src/test/db/tenant-isolation.rls.db.test.ts` (~line 900 onward), including the case Sprint 3
  flagged: `managed_profiles_select_teammates` is what would hand a guardian the name and email
  of every adult and child on their child's team. Read that block before touching a policy.
- **`team_members.managed_profile_id` already round-trips** through the entity registry
  (`entity-registry.ts:308,320`).
- Fixtures exist: `src/test/db/fixtures.ts:298-303` creates a profile and a consent.

**Nothing in `src/` reads or writes either table.** No UI, no store slice, no registry entry.
Both tables are empty locally and production is greenfield.

## Landmines specific to this sprint

Two are in the plan's parking lot as of today and both sit directly on this sprint's path; the
other two are older red items that this sprint is the first to actually walk into.

1. **🔴 `guardian_consents.version` DEFAULT `'1.0'`.** Drop it before the first consent row
   exists. This is the Sprint 8 follow-up defect in a new table — see the parking lot.
2. **Neither guardian table is in the entity registry**, so nothing syncs offline. Same work
   Sprint 8 did for meetings, `REPLICA IDENTITY FULL` included if deletes must propagate.
3. **🔴 The local stack's auth config differs from production.** Local
   `enable_confirmations = false` returns a session from `signUp`; production does not. Guardian
   signup is a *signup flow*, so this is the sprint where that bites hardest — Sprint 8's
   follow-up proved that client-side "do this right after signing up" code does not run in
   production. Anything that must survive account creation runs server-side or after the first
   real sign-in. See `docs/environment-divergences.md` §1.
4. **🔴 Password recovery is dead end to end in production**, broken twice over (non-hash
   `redirectTo` on a HashRouter gh-pages app with no `404.html`, and no matching route, so the
   catch-all silently discards the token). **The guardian owns the login for a child who has
   none** — a guardian who cannot reset their password locks out their child's account, not just
   their own. It is fixable on its own, without the deferred auth-email branding work. Consider
   whether it belongs in this sprint's scope; that is a decision for Kevin, below.

## Decisions to put to Kevin at kickoff

The last three sprints each turned on a decision taken at kickoff rather than discovered
mid-build (seat semantics in 6, check-in-as-RPC in 8), so ask first:

1. **Does password recovery come into this sprint?** It is a red production defect that this
   sprint's users are the most exposed to, and it is small on its own. It is also not "guardian
   accounts UI".
2. **Profile switching — what is it, exactly?** One guardian login viewing several children, or
   an act-as mode where the app renders as the student? These have very different blast radii on
   RLS, and the schema does not decide it.
3. **Can a guardian also be a team member in their own right** (a parent who mentors)? The
   schema permits it; no policy or UI has an opinion yet.
4. **What consent types exist**, and which are required before a managed profile can join a
   team? `consent_type` is free text with a uniqueness constraint and nothing enumerates it.

## Exit criteria

Beyond `npm run gate:db` green and the standard rules in §5:

- A guardian can sign up, create a managed profile, and have it join a team by invite —
  demonstrated end to end in a browser, as both the guardian and the coach approving.
- Consent records are visible to the guardian who gave them, and to nobody else — asserted
  behaviourally as the least-privileged role that can reach the table, including the teammate
  case Sprint 3 flagged.
- Both tables in the entity registry, with the offline path exercised.
- The `version` default is gone and the client owns the version.
- Screenshots at 375 / 768 / 1280 via `npm run capture`.

## Two things that are new since Sprint 8

- `npm run gate` / `npm run gate:db` is now the **only** definition of the Gate. Do not spell it
  out as separate scripts.
- ESLint exists now and is deliberately small. If you want to add a rule, name the commit it
  would have caught — that is the bar. Two rules are written up in `eslint.config.js` and
  *deliberately not enabled* (`exhaustive-deps`, 4 sites, one in the sync engine); turning either
  on is scoped work, not a lint fix, and both are in the parking lot with numbers.
