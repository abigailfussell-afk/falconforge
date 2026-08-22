# SEC — Security, tenancy, auth, roles, licensing, COPPA, operator tooling

Scope: all 17 migrations in `supabase/migrations/` (in order; `_archive/` holds the pre-V2 files
and is not applied), `supabase/config.toml`, `supabase/functions/forward-support-email`,
`supabase/tests/schema_assertions.sql`, the DB suite under `src/test/db/`, `src/lib/auth.tsx`,
`supabase.ts`, `sign-out.ts`, `attestations.ts`, `entitlement.ts`, `sync-failure-classification.ts`,
`server-pull.ts`, the auth/admin/guardian components and pages, `docs/beta-ops.md`,
`docs/environment-divergences.md`, the legal pages, and `FALCONFORGE_V2_PLAN.md` §8.

Method: read every migration, then verified the live catalogue on the local stack
(`pg_policies`, `pg_proc` + `has_function_privilege`), then **reproduced every security claim
over PostgREST as the real role** (curl with the anon key + a password-grant JWT for the seeded
accounts). Every repro below was run and its output is quoted. All test rows I created were
removed and the two roster rows I changed were restored.

`npm run test:rls` / `test:db` were **not run**: `src/test/db/stack.ts:44` says its helpers
"delete users and truncate tables", which the brief forbids. (Something else did wipe `tasks`
mid-session — 1200 rows at 19:30, 0 rows by 19:40, teams/users intact — see "not checked".)

---

## Findings

### SEC-01 — A coach can make themselves team admin in three REST calls
- **Severity:** Blocker
- **Type:** security
- **Status vs plan:** NEW (no §8 entry, no failure-modes entry; the RLS suite's "capabilities are enforced by the database" block at `src/test/db/tenant-isolation.rls.db.test.ts:618-700` never tries a coach writing `role = 'admin'` or touching the admin's row)
- **Evidence:**
  - `team_members_update_roster` is `FOR UPDATE USING (can_manage_roster(team_id)) WITH CHECK (can_manage_roster(team_id))` with no column restriction (`20260816000200_v2_rls.sql:161-162`; live `pg_policies` confirms). `can_manage_roster` is admin **or coach** (`20260818000000_v2_licensing_admin.sql:104-112`).
  - `enforce_member_role_eligibility` only checks that the *new* holder is `18_plus` and has any `terms`/`coach_terms` row (`20260816000300_v2_rpcs.sql:114-155`). It never asks who is doing the promotion, and never protects the existing admin's row from demotion.
  - `attestations_insert_own` lets any user insert their own `terms` attestation (`20260816000200_v2_rls.sql:75-76`).
  - `team_members_one_admin_per_team` is only an "at most one" index; "at least one" is upheld by RPCs only (`20260816000000_v2_tables.sql:152-159`).
- **Repro / how observed:** as `successor@falconforge.test` (coach of Iron Falcons, 18+, no attestation):
  ```
  1. POST /rest/v1/user_attestations {user_id:<me>, attestation_type:'terms', version:'2.0'}   -> 201
  2. PATCH /rest/v1/team_members?team_id=eq.<iron>&role=eq.admin   {"role":"student"}           -> 200, reviewer@ row now role=student
  3. PATCH /rest/v1/team_members?team_id=eq.<iron>&user_id=eq.<me> {"role":"admin"}             -> 200
  4. POST /rest/v1/rpc/can_manage_billing {"p_team_id":<iron>}                                   -> true
  ```
  Restored afterwards with psql. Variant: step 2 as `DELETE .../team_members?role=eq.admin` (`team_members_delete_roster`) also works and strands the team; a coach can likewise PATCH `user_id` on the admin's row to their own id.
- **Impact:** Any coach on any team can take over billing/seat authority, remove the real admin, and lock them out; the two-party nomination handshake, `transfer_team_admin`, and `operator_transfer_team_admin` are all bypassed by plain REST. Also a coach can leave a team with **no** admin (stranded), which today only the operator can fix. With beta coaches sharing one admin login-free roster, this is reachable the first time a coach opens devtools or a third party gets a coach's token.
- **Fix direction:** Make the admin row and the `role` column untouchable through the roster policy. Cleanest: a BEFORE UPDATE/DELETE trigger on `team_members` that (a) refuses any change to `role`, `user_id`, `managed_profile_id` or `status` on a row whose OLD role is `admin` unless `auth.role() = 'service_role'` or the statement is inside one of the transfer RPCs (use a `SET LOCAL falconforge.admin_transfer = on` flag set by the RPCs and checked with `current_setting(..., true)`), and (b) refuses `NEW.role = 'admin'` from anything but those RPCs. Add RLS tests: coach demotes admin → denied; coach sets own role admin → denied; coach deletes admin row → denied; admin transfer via RPC still works. Consider also restricting `can_manage_roster` role changes to `student|mentor|coach` only (never `admin`). Record the class in `docs/failure-modes.md` §6.
- **Effort:** M

### SEC-02 — "I've turned 18" reverts on the next sign-in (handle_new_user overwrites the column on every auth.users UPDATE)
- **Severity:** High
- **Type:** bug
- **Status vs plan:** KNOWN-but-worse — plan §8 marks it "✅ RESOLVED 2026-08-22 (`v2/age-classification-writer`)… Fixing it required fixing B27 first — every boot wrote signup metadata back over the column". The client half (B27) is fixed; the **server** half was never fixed and reverts the correction independently of the client.
- **Evidence:** `on_auth_user_created` is `AFTER INSERT OR UPDATE ON auth.users` (`20260816000300_v2_rpcs.sql:308-311`). `handle_new_user` (current body `20260821000000_signup_attestation_version.sql:59-83`) does `ON CONFLICT (id) DO UPDATE SET … age_classification = COALESCE(EXCLUDED.age_classification, users.age_classification)` where `EXCLUDED.age_classification` is `raw_user_meta_data->>'age_classification'` — the value chosen at signup, which nothing ever updates. GoTrue UPDATEs `auth.users` on every password sign-in (`last_sign_in_at`), on `updateUser` (the app's `updateProfile`, `auth.tsx:556`), on password change, and on email change.
- **Repro / how observed:** as `iron-student0@` (metadata `13_to_17`):
  ```
  rpc update_user_age_classification('18_plus') -> {"success":true}; users.age_classification = 18_plus
  POST /auth/v1/token?grant_type=password (same user)         -> users.age_classification = 13_to_17
  PUT /auth/v1/user {"data":{"full_name":"…"}}                 -> users.age_classification = 13_to_17
  ```
- **Impact:** Every student who uses the new profile control loses it on their next login; a freshly-18 student nominated as admin/coach/mentor fails `enforce_member_role_eligibility` again after they sign back in (role already granted stays, but any later role change re-checks). Also any future operator/RPC correction of `age_classification` or `full_name` is silently undone by the trigger.
- **Fix direction:** In `handle_new_user`, stop writing `age_classification` (and arguably `full_name`) on the UPDATE branch: `ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now()` plus `full_name = COALESCE(users.full_name, EXCLUDED.full_name)` (existing value wins), and set `age_classification` only when `users.age_classification IS NULL`. Alternatively have `update_user_age_classification` also write `auth.users.raw_user_meta_data` via the RPC (SECURITY DEFINER can UPDATE `auth.users`) so metadata and column agree. Add a DB test: raise age, then `UPDATE auth.users SET last_sign_in_at = now()`, assert column unchanged. Fix the §8 entry.
- **Effort:** S

### SEC-03 — "Remove from team" / "Reject" hard-DELETE the member row: refused for anyone with history, and destroys attendance when it succeeds
- **Severity:** High
- **Type:** bug
- **Status vs plan:** KNOWN-but-worse — plan §8 ("🔴 `DELETE FROM team_members` is impossible… **Masked completely today** because the app never deletes a member — `MemberManager` sets `status = 'removed'`") and `docs/beta-ops.md:295-297` say the same. **That is false**: `MemberManager.removeMember` and `rejectMember` both call `.delete()` (`src/components/MemberManager.tsx:227-229, 280-282`); nothing in `src/` ever writes `status = 'removed'` (grep: only the type union and `MEMBER_STATUSES`).
- **Evidence / repro:** as `reviewer@` (admin): create a task assigned to `iron-student10@`, then `DELETE /rest/v1/team_members?id=eq.<member>` (exactly what the button does) →
  `400 {"code":"23502","message":"null value in column \"team_id\" of relation \"tasks\" violates not-null constraint"}`. The UI shows "Failed to remove member". For a member with no task/report/meeting/attestation references the DELETE succeeds — and `meeting_attendance(team_member_id, team_id) … ON DELETE CASCADE` (`v2_tables.sql:386-387`) deletes their attendance (student10 has 8 rows). `invites.created_by`-style `NO ACTION` is not involved here.
- **Impact:** A coach cannot remove any student who has ever been assigned a task, filed a scouting report, or run a roster (the common case by mid-season); when removal does work, the attendance history the attendance feature exists to keep is destroyed. Rejoin via invite code then creates a fresh row with a new `id`, so task assignments are lost either way.
- **Fix direction:** Change `removeMember` to `update({ status: 'removed', seat_assigned: false })` and `rejectMember` for pending rows to delete (pending rows have no references) or also mark removed; make `join_team_with_invite`'s "removed → pending" branch the rejoin path it already is. Then fix the schema so DELETE means what it says: per-column `ON DELETE SET NULL (assigned_to)` etc. on the five composite FKs (PG15+), and decide whether `meeting_attendance.team_member_id` should cascade at all (it should not; `SET NULL` is impossible with NOT NULL — consider keeping the row and relying on `status='removed'`). Correct the plan and runbook text. Test: remove a member with an assigned task → succeeds; attendance rows survive.
- **Effort:** M

### SEC-04 — Full-table pulls are capped at PostgREST `max_rows` (1000) with no pagination; a full pull REPLACES the local collection
- **Severity:** High (becomes Blocker for a team that scouts >1000 matches or accumulates >1000 tasks across the season)
- **Type:** scale-blocker
- **Status vs plan:** NEW (not in §8; `docs/failure-modes.md` does not mention `max_rows`)
- **Evidence:** `pullFromServer` builds `select('*')` (+`.eq(scope)`, optional `.gte('updated_at', cursor)`) and awaits it once — no `.range()`, `.limit()`, or loop (`src/lib/server-pull.ts:240-262`; grep for `range(` returns nothing). `supabase/config.toml` `[api] max_rows = 1000`; the hosted default is also 1000. A full pull calls `updateLocalDatabase(table, rows, pendingIds)` which "replace[s] the collection (which is how deletions propagate)" (`server-pull.ts:279-281`). Delta pulls have no `ORDER BY updated_at`, so with >1000 changed rows the cursor advances to the newest timestamp in an arbitrary 1000-row page and the rest are never fetched. The seeded Iron Falcons team had 1200 tasks at the start of this session, so the review fixture itself exceeded the cap.
- **Repro / how observed:** code reading plus `Content-Range` behaviour of PostgREST; I could not repeat the row-count probe because the `tasks` table was emptied by another process mid-session (see "not checked").
- **Impact:** On every 5th pull (the full reconciliation) rows beyond 1000 vanish from every device; on delta pulls rows are skipped for ever. Silent — the pull path `console.warn`s and moves on.
- **Fix direction:** Page every pull: `.order('updated_at').order('id').range(from, from+999)` in a loop until a short page; advance the delta cursor only from the last page. Add a DB test that seeds 2,500 rows and asserts the local store holds 2,500 after a full and a delta pull. Belongs to the sync owner but is gated by API config, so recorded here.
- **Effort:** M

### SEC-05 — Every teammate (including 13-year-old students) can read every managed child's `notes` ("allergies, pickup arrangements") and `promotion_code` over the API
- **Severity:** High
- **Type:** security
- **Status vs plan:** NEW (plan §3/§8 discuss guardian→team visibility, never team→child-profile column exposure)
- **Evidence:** `managed_profiles_select_teammates` is `FOR SELECT USING (id IN (SELECT tm.managed_profile_id FROM team_members tm WHERE tm.team_id IN (SELECT get_user_team_ids(auth.uid())) …))` — whole row (`v2_rls.sql:94-102`). `AddChildDialog` invites the guardian to write "Allergies, pickup arrangements — anything you want to keep to hand." into `notes` (`src/components/guardian/AddChildDialog.tsx:102`). `promotion_code` is "a credential… whoever redeems it takes the child's place on the roster" (`20260822000200_guardian_access.sql:295-303`) and that migration only restricted the **write** side.
- **Repro / how observed:** as `iron-student0@` (13_to_17): `GET /rest/v1/managed_profiles?select=full_name,notes,promotion_code,guardian_user_id` → both Fussell children returned with all four columns (`notes` null in the seed; `promotion_code` null because none is offered).
- **Impact:** Health/pickup details about a minor, entered by a parent, readable by any rostered student with the anon key and their own token. The privacy policy (`PrivacyPolicy.tsx:98-100`) promises teammates see no more than "what any team member sees" of a child. A teammate who is *not* on another team the child is on could redeem an offered promotion code and hijack that roster row (`claim_managed_profile` only refuses when the claimant is already on the same team).
- **Fix direction:** Replace the teammates policy with a column-limited surface: either a `security_invoker` view `managed_profile_roster (id, full_name)` that the roster reads, with the base-table SELECT policy reduced to the guardian only; or keep the policy and `REVOKE SELECT ON managed_profiles FROM authenticated; GRANT SELECT (id, full_name, guardian_user_id, created_at, updated_at)` — but note `pullFromServer` does `select('*')`, so the registry's `managed_profiles` entry would need an explicit column list (the guardian's own read is unaffected only if the guardian path selects via a different query — it does not, so the view approach is safer). Add an RLS test: student selects `notes`/`promotion_code` → denied/absent.
- **Effort:** M

### SEC-06 — SECURITY DEFINER predicates are callable as RPCs by anyone (including anon) with arbitrary ids: cross-tenant oracles
- **Severity:** Medium
- **Type:** security
- **Status vs plan:** KNOWN-but-worse — plan §8 and `20260819000000_revoke_anon_execute.sql` deliberately keep the predicates anon-executable ("they are not an API surface"); `schema_assertions.sql:706-714` allowlists them. But they **are** an API surface: PostgREST exposes every granted function at `/rest/v1/rpc/<name>`, and several take an explicit id rather than `auth.uid()`.
- **Evidence / repro:**
  ```
  anon  POST /rpc/get_user_team_ids {"p_user_id":<reviewer uid>}   -> ["3fbd82ac-…"]   (another user's team list)
  anon  POST /rpc/team_can_write    {"p_team_id":<iron>}           -> true             (licence state of a team the caller is not on)
  anon  POST /rpc/team_seats_remaining {"p_team_id":<iron>}        -> 0
  full@ (member of a different team) same calls                    -> same answers
  ```
  `team_seats_remaining` is not used by any policy (grep of migrations) yet sits in the "predicates evaluated inside RLS policies" allowlist (`schema_assertions.sql:712`). `get_user_team_ids(p_user_id)` is the only predicate that takes a user id instead of reading `auth.uid()`.
- **Impact:** Needs a UUID (user ids are visible to teammates via `users`/`team_members`; team ids appear in invite-link flows), so not a mass-leak, but it is a cross-tenant membership and licensing oracle available to unauthenticated callers, and it contradicts the "default deny" principle the RLS migration states.
- **Fix direction:** Rewrite `get_user_team_ids` to ignore its argument or add a zero-arg variant used by the two policies, then revoke the arg'd one from anon/authenticated. Revoke `team_seats_remaining`, `team_can_write`, `season_is_open`, `meeting_season_is_open`, `current_team_role` from `anon` — the claim that revoking breaks anonymous SELECTs is worth testing rather than assuming: the `200 []` property only needs the functions executable by the role that *evaluates the policy*, and an anon SELECT that returns zero rows from the `team_id` index may never call them. If it does break, use PostgREST's `db-schemas`/a private schema for predicates so they are executable but not exposed at `/rpc`. Tighten assertion 23's allowlist to the ones actually referenced in `pg_policies`.
- **Effort:** S–M

### SEC-07 — Lapsed or over-capacity teams: the trial expires mid-season and nothing tells anyone but the banner
- **Severity:** High (for beta)
- **Type:** unfinished
- **Status vs plan:** KNOWN (plan §8: "The trial licence in `create_team_as_admin` is still there"; "A seat-count *reduction* has no admin-facing path yet") — adding the date arithmetic and the notification gap.
- **Evidence:** `v_trial_days constant integer := 90` (`v2_rpcs.sql:328`). A team registered at kickoff (≈6 Sep 2026) goes read-only ≈5 Dec 2026, in the league-meet/qualifier window. The only warning is `LicenceBanner` at ≤30 days (`entitlement.ts` `EXPIRY_WARNING_DAYS = 30`) and the `EntitlementPanel`; there is no email, no operator-side "expiring soon" list (`operator_team_directory` returns `valid_until` but the console does not sort/flag by it — `OperatorConsole.tsx` has no expiry filter), and no self-serve renewal until Stripe. Writes at a lapsed team are still offered by every content screen (only `SeasonManager` checks `isReadOnlyTeam`; no other component reads `useAccessState`/`isReadOnly` — grep), so a student at a venue edits normally and each change dead-letters with "Your team's licence has lapsed" (`sync-failure-classification.ts`).
- **Impact:** Beta teams on the automatic trial silently go read-only in December unless Kevin remembers each one; the failure surfaces as dead-letter items at a competition.
- **Fix direction:** (1) Operator console: sort/flag teams by `valid_until`, and a weekly reminder (a `pg_cron` job or GitHub Action hitting `operator_team_directory` with the service key and emailing via Resend). (2) Replace the 90-day trial for beta teams with the operator's gift at onboarding, or lengthen the trial to cover the season. (3) Gate content editors on `isReadOnly` (disable New/Edit with the banner's reason) so lapsed teams do not queue work that cannot land.
- **Effort:** M

### SEC-08 — Any 18+ account can create unlimited teams, each with a fresh 90-day unlimited-seat licence
- **Severity:** Medium (business risk once Stripe exists; irrelevant to security now)
- **Type:** unfinished
- **Status vs plan:** KNOWN (plan §8 trial-licence entry) — adding the abuse angle.
- **Evidence:** `create_team_as_admin` has no per-user or per-period limit (`v2_rpcs.sql:349-470`); `teams_insert_owner` additionally lets any authenticated user INSERT bare `teams` rows directly (`v2_rls.sql:123-124`) — these have no admin, no licence, no season, are invisible to their creator (not a member) and show up in the operator directory as stranded teams (LEFT JOIN admin).
- **Impact:** Trial-chaining defeats billing forever (re-register every 90 days); direct `teams` inserts are a free spam/garbage vector for the operator directory.
- **Fix direction:** Drop `teams_insert_owner` (the RPC inserts as definer and does not need it; `entity-registry.ts:663` already notes the client never supplies `owner_id`). When Stripe lands, remove the trial block; until then, log trial grants per `created_by` and have the operator directory flag a user with >1 trial.
- **Effort:** S

### SEC-09 — The invite code shown at team creation silently expires after 24 hours
- **Severity:** Medium
- **Type:** bug
- **Status vs plan:** NEW
- **Evidence:** `invites.expires_at timestamptz DEFAULT (now() + interval '24 hours')` (`v2_tables.sql:174`); `create_team_as_admin` inserts `(team_id, code, created_by)` only, so the default applies (`v2_rpcs.sql:421-423`). `CreateTeam.tsx:312-314` shows the code with "Share this code with team members to invite them" and no expiry. Codes generated later from `InviteManager` get 7 days (`INVITE_LIFETIME_HOURS = 24 * 7`, `InviteManager.tsx:30`).
- **Impact:** A coach who registers at home and reads the code out at the next meeting gets "Invalid or expired invite code" for every student; the first-run experience for every beta team.
- **Fix direction:** Have `create_team_as_admin` set `expires_at = now() + interval '7 days'` (one value, shared with the client constant — or drop the column default and make the RPC/ client explicit), and print the expiry on the CreateTeam success screen. Smoke-test: register, advance the clock 25h, join.
- **Effort:** S

### SEC-10 — Self-declared under-13s can still create an auth account; the block is client-only
- **Severity:** Medium
- **Type:** security (COPPA posture)
- **Status vs plan:** NEW
- **Evidence:** `CompleteProfileForm.tsx:149` disables the submit button when `ageSelection === 'under_13'`; `signUpWithEmail` forwards whatever `age_classification` it is given (`auth.tsx:489-501`); `handle_new_user` writes it and `users.age_classification` CHECK accepts `'under_13'`. GoTrue has no hook refusing it. `update_user_age_classification('under_13')` is also accepted for an existing account. The privacy policy states "A member under 13 does not have a FalconForge account and cannot create one" (`PrivacyPolicy.tsx:56`).
- **Impact:** A child who selects "under 13" in a modified/old client or via the API gets a real account with an email on file — exactly the collection the policy says never happens. Downstream the account is inert (`join_team_with_invite` refuses `under_13`), so exposure is the email + name only.
- **Fix direction:** In `handle_new_user`, RAISE when `raw_user_meta_data->>'age_classification' = 'under_13'` (GoTrue surfaces trigger errors as a signup failure) and reject it in `update_user_age_classification`. Test both.
- **Effort:** S

### SEC-11 — Operator console has no deletion/erasure tooling; privacy policy promises "when you delete your account"
- **Severity:** Medium
- **Type:** unfinished
- **Status vs plan:** KNOWN (plan §8 "Data erasure is deliberately a runbook and not a tool"; console "Complete except the deletion tooling") — adding what a paying customer would hit.
- **Evidence:** `OperatorConsole.tsx` calls exactly `is_platform_operator`, `operator_team_directory`, `operator_team_detail`, `grant_team_license`, `operator_revoke_license`, `operator_transfer_team_admin`. No RPC or UI exists for: delete team, delete/anonymise user, guardian-initiated child erasure, data export, invoices, seat reduction, or team rename/number edit (`teams_update_manager` exists; no `.from('teams').update` in `src/` except the nomination columns). `PrivacyPolicy.tsx:138` says "When you delete your account we remove…" but there is no account-deletion affordance anywhere (grep `deleteAccount|deleteUser` → none). `docs/beta-ops.md:262-375` is the manual SQL.
- **Impact:** Fine for a few known beta teams as decided; at scale every erasure request is a psql session against production, and the runbook's own correctness depends on SEC-03's FK shape.
- **Fix direction:** Post-beta: `operator_erase_user(p_user_id)` and `operator_delete_team(p_team_id)` as SECURITY DEFINER RPCs writing `operator_actions` (needs `team_id` nullable and the CHECK widened, as the plan notes); a guardian-side "remove this child" that deletes the `managed_profiles` row; a team export (JSON of the team's tables) for the admin. Reword the policy to "when you ask us to delete".
- **Effort:** L

### SEC-13 — Email enumeration and signup UX with confirmations on
- **Severity:** Low
- **Type:** ux
- **Status vs plan:** NEW
- **Evidence:** With `mailer_autoconfirm: false` (both environments, `environment-divergences.md §1`), GoTrue returns an obfuscated fake user for an existing email, so `Login.tsx:86-92`'s "already registered" branch never fires in production; the user sees "Account created! Please check your email" and no email arrives. `resetPasswordForEmail` is uniform. No app-level lockout; Supabase's `sign_in_sign_ups = 30`/5 min/IP is the only brake.
- **Impact:** Duplicate sign-ups look like a lost confirmation email (support ticket); enumeration itself is prevented by Supabase's behaviour, which is correct.
- **Fix direction:** After a signup "success", say "If this address is new you'll get a confirmation; if you already have an account, sign in or reset your password." Nothing to do server-side.
- **Effort:** S

### SEC-14 — Config that lives only in the Supabase dashboard (drift list for an operator)
- **Severity:** Medium
- **Type:** debt
- **Status vs plan:** partly KNOWN (plan §8 lists the stale Redirect URL allow-list and missing `emailRedirectTo`; `beta-ops.md` covers SMTP and the rate limit)
- **Evidence:** `supabase/config.toml` governs the local stack only; nothing in `deploy.yml`/`ci.yml` pushes auth settings. Settings the code depends on and cannot enforce:
  1. Site URL = `https://falcon-forge.com/` (signup confirmation has no `emailRedirectTo`, so it is Site URL or nothing).
  2. Redirect allow-list contains `https://falcon-forge.com/` (password reset and OAuth use `authRedirectUrl()` = origin root).
  3. `mailer_autoconfirm = false` (the whole attestation-at-signup design assumes the trigger, not the client).
  4. Custom SMTP = Resend; email rate limit 100/h; Resend daily cap 100 (beta-ops).
  5. Six email templates (`supabase/templates/*.html`) pasted into the dashboard by hand.
  6. Password min length (local 6, hosted unknown) and no leaked-password check.
  7. OAuth providers: Google/Azure are **not** configured and there is no UI button (`signInWithGoogle/Microsoft` have no caller — dead code); if ever enabled, the allow-list above must already hold the root.
  8. PostgREST max rows = 1000 (SEC-04).
  9. `platform_operators` row for Kevin (service-key insert; lost on any schema rebuild — beta-ops says so).
  10. Edge-function secrets `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `SUPPORT_FORWARD_TO`, and `verify_jwt = false` for `forward-support-email` (correctly signature-gated; fail-closed on a missing secret).
  11. Free-tier 7-day inactivity pause and no PITR (beta-ops "Backups").
- **Impact:** Any one of these silently regresses a flow the suite cannot see (environment-divergences' thesis).
- **Fix direction:** Add `scripts/check-production.mjs` steps that read `/auth/v1/settings` (autoconfirm, external providers, password policy exposure) and a documented dashboard checklist with the expected values in `docs/beta-ops.md`; consider `supabase config push` once the CLI version supports the auth keys used.
- **Effort:** S

### SEC-15 — Client-side guardian profile/consent writes are queued; joining a child before the queue drains fails with a misleading error
- **Severity:** Low
- **Type:** ux
- **Status vs plan:** NEW
- **Evidence:** `addManagedProfile` queues `managed_profiles` and `guardian_consents` rows (`createGuardianSlice.ts:43-48`); `join_team_with_invite_for_child` refuses unless a `coppa_data_collection` consent row exists server-side (`guardian_access.sql:187-196`) and also refuses an unknown profile. A guardian who adds a child and immediately enters the code (the flow the plan describes, in one sitting) races the drain.
- **Impact:** "This child has no consent on record" for a parent who ticked the box ten seconds ago; retrying works.
- **Fix direction:** In `JoinTeam`, wait for the sync queue to be empty for those two tables (or call the RPC after `drainQueue()` resolves) before submitting; surface "saving your child's profile…" meanwhile.
- **Effort:** S

### SEC-16 — Guardian-account deletion cascades through the child's whole history; guardian email change does not propagate to the child's roster row
- **Severity:** Low
- **Type:** debt
- **Status vs plan:** partly KNOWN (beta-ops "Under-13s")
- **Evidence:** `users → managed_profiles → team_members → meeting_attendance` are all `ON DELETE CASCADE`; deleting a guardian's `auth.users` row erases the child's attendance. `sync_user_to_team_members` only touches `managed_profile_id IS NULL` rows (`v2_rpcs.sql:69-74`), so the guardian's contact email denormalised on the child's row (`guardian_access.sql:236-252`) goes stale when the guardian changes email.
- **Fix direction:** Decide retention for a promoted/removed child (the plan says consents are retained as the record); extend the sync trigger to update `email` on managed rows for the same guardian.
- **Effort:** S

### SEC-17 — `supabase/tests/preflight_security_audit.sql` is orphaned; `team_seats_remaining` allowlisted under a false rationale; `invites` codes generated client-side with `Math.random`
- **Severity:** Low
- **Type:** debt
- **Status vs plan:** first KNOWN (plan §8); others NEW
- **Evidence:** `InviteManager.generateInviteCode` uses `Math.random()` over a 32-symbol alphabet, 8 chars (~40 bits) with a 7-day life and a global lookup by code (`join_team_with_invite` matches any team's code) — fine entropy, weak RNG; `create_team_as_admin` uses `md5(random())` 8 hex (~32 bits, 24 h). No rate limit on `/rpc/join_team_with_invite`.
- **Fix direction:** Generate invite codes server-side (`gen_random_bytes`) in an RPC or trigger default; wire or delete the preflight audit; fix the assertion-23 comment.
- **Effort:** S

---

## Answers to the brief's questions

**Q1 RLS.** 56 policies on 18 tables, RLS enabled on all (`team_entitlement` is a `security_invoker` view). All predicates are SECURITY DEFINER with `search_path=public` pinned. No recursion (predicates read `team_members`/`license_grants`/`seasons` directly, never a policy-protected view). Performance: `is_team_member(team_id)` is evaluated **per row** (SECURITY DEFINER SQL functions are not inlined) — measured 1,200 tasks → 23 ms, 21,200 tasks → 394 ms for the Iron Falcons SELECT (Seq Scan; `idx_tasks_updated_at` used for the delta form, 384 ms). ~18 µs/row, dominated by the function's own index probe (2 buffers/row). Acceptable per team; the real scale limit is SEC-04. Indexes on `team_id`, `season_id`, `updated_at` exist on every synced table; `team_members` has `team_id`, `user_id`, `updated_at`. Missing: a composite `(team_id, updated_at)` on the content tables (the delta pull filters both; today two single-column indexes), and `tasks(assigned_to)`, `meeting_attendance(attested_by)` for the FK checks. Full table in Appendix A.

**Q2 Auth.** Email+password only; confirmations on in both environments; password reset lands on `/` and hash-routes to `/auth/reset-password` via the `PASSWORD_RECOVERY` event (plan-resolved, and the reasoning in `auth.tsx:11-40` is right). OAuth: code exists, nothing calls it, no provider configured. Re-attestation: client owns versions (`ATTESTATION_VERSIONS`), signup version travels in metadata, `(user_id, type, version)` unique → history kept. Invite codes: SEC-09/SEC-17; join always lands `pending` and needs admin/coach approval; a deleted member rejoins as a new row (SEC-03); rotation = revoke + generate. Sessions: `supabase` client auto-refreshes; `supabaseSync` reads the stored token, falls back to `getSession()` when expired, and to the anon key when there is none (a queued write then gets 42501 and is retried — correct). Rate limits: only Supabase auth's per-IP defaults; none on PostgREST/RPC.

**Q3 Role model.** Matrix in Appendix B. Mismatches: (a) SEC-01 — RLS allows coach to edit/delete the admin row and to assign `admin`; UI hides it. (b) Coach UI shows the Approve button disabled (correct: `enforce_seat_capacity` is admin-only) — consistent. (c) Lapsed licence: UI offers every content write; RLS denies → dead-letter with reason (SEC-07). (d) Team name/number: RLS allows admin/coach UPDATE; no UI. (e) Students may edit/delete *any* teammate's task, scouting report, plan or checklist item — RLS and UI agree (`can_manage_content` = any approved member); worth stating as a product decision. (f) Mentor: UI = meetings only; RLS = meetings + content; consistent. (g) `status='removed'` is unreachable from the UI (SEC-03).

**Q4 Licensing.** Seat = approved member (`seat_assigned` flipped at approval, admin-only, capacity-checked in a trigger; no policy consults it). Expiry → `team_can_write` false → content/structure/meeting writes refused, roster/invites still work (by design). Queued offline writes after a lapse: terminal dead-letter with "renew and retry" once the device's entitlement copy says `read_only`; retryable until then (correct). Stripe: nothing exists beyond `source IN ('gift','stripe')`, `VITE_STRIPE_PUBLISHABLE_KEY` in `vite-env.d.ts`, and the seat-capacity trigger's `service_role` exemption. Operator console: directory/detail/gift/revoke/rescue work; missing deletion, erasure, export, invoices, seat reduction, expiry alerts (SEC-07/SEC-11). Gifting path: `grant_team_license` (operator only, no write policy on `license_grants`) — verified `anon`/non-operator get `Not authorized`/no EXECUTE.

**Q5 COPPA.** Path verified in code: guardian signs up (18+) → `AddChildDialog` creates `managed_profiles` + four `guardian_consents` (versions from the client) via the sync queue → `JoinTeam` calls `join_team_with_invite_for_child` (checks `is_profile_guardian`, consent present, code valid) → `pending` row with `user_id = guardian`, `full_name = child`, `email = guardian` → admin approves; `MemberManager.approveMember` records `coppa_responsibility` **before** the approval update. The child enters nothing; nothing is collected from them (the only gaps are SEC-10's self-declared under-13 account and SEC-05's exposure of what the guardian entered). Promotion: `offer_managed_profile_promotion` → 8-char server code → child signs up 13+ → `claim_managed_profile` repoints rows in place (verified by reading; `guardian-promotion.db.test.ts` covers it). Guardian deletion: SEC-16. Legal docs: all three "effective 16 August 2026", versions 2.0 in `attestation-versions.ts`; trigger hardcode history fixed in `20260821…` and its sibling default in `20260822000000…`; the remaining hardcode is `auth.tsx:362-366` (`version: '1.0'` in `ensureUserProfile`'s fallback insert — dead in practice because the trigger inserts first, but it is the same shape).

**Q6 Secrets/config.** `dist/assets/index-*.js` carries only the anon JWT (`role: anon`, ref `cvnonrjzshaawzxcjwmn`) and the project URL; no service key, no Stripe/Resend keys, no sourcemaps (`deploy.yml` has a sourcemap refusal step). gh-pages: no CSP/HSTS/frame headers possible; risk is XSS-to-token-theft (token in `localStorage`) and clickjacking — mitigated only by React's escaping; the plan already names "CSP/security headers over minors' data" as a hosting trigger. Drift list: SEC-14.

**Q7 Multi-team users.** Supported: Sidebar "Switch team" → Onboarding picker → `setCurrentTeam`; `teams` is an `rls`-scoped registry entity so the list is the union RLS returns. Sync cursors are keyed `${teamId}:${table}` (`server-pull.ts:202-207`), so switching does not reset the other team's cursor. Licence per user-per-team holds: a seat is a `team_members` row, one per team, each approved separately under each team's grants.

---

## Appendix A — RLS policy table (live `pg_policies`, local stack, 2026-08-22)

| table | select | insert | update | delete | key predicate |
|---|---|---|---|---|---|
| users | own OR teammates (via `get_user_team_ids`) | own | own | — | `id = auth.uid()`; teammates: `id IN (tm.user_id WHERE tm.team_id IN my teams)` — exposes `age_classification`, `email` to teammates |
| user_attestations | own | own | own | — (by design) | `user_id = auth.uid()`; any type insertable (SEC-01 step 1) |
| managed_profiles | guardian (ALL) OR teammates | guardian (cols: id, guardian_user_id, full_name, notes, created_at, updated_at) | guardian (same cols) | guardian | teammates read whole row incl. `notes`, `promotion_code` (SEC-05) |
| guardian_consents | guardian (ALL) | guardian | guardian | guardian | `guardian_user_id = auth.uid()` |
| teams | member OR guardian | `owner_id = auth.uid()` (any user, SEC-08) | roster managers | — (operator/service only) | nomination columns guarded by trigger `enforce_admin_nomination_authority` |
| team_members | member OR own rows | roster managers | roster managers (any column, SEC-01) | roster managers (SEC-01/03) | seats guarded by `enforce_seat_capacity` (admin only); role eligibility by trigger |
| invites | member (students see codes) | roster managers | roster managers | roster managers | — |
| license_grants | member | — | — | — | writes only via `grant_team_license` (operator) / service role |
| platform_operators | self | — | — | — | service role only |
| operator_actions | operator | — | — | — | written by operator RPCs |
| seasons | member | structure (admin/coach + entitled) | structure | structure | not gated by own `is_archived` (un-archive must work) |
| sub_teams | member | structure + season open | structure + open | structure + open | — |
| tasks / scouting_reports / match_plans | member | content (any member + entitled) + season open | same (USING+CHECK) | same | students edit anyone's rows |
| checklists | member | content + (template OR open) | same | same | templates exempt from archive |
| meetings | member OR guardian | meetings (admin/coach/mentor + entitled) + open | same | same | — |
| meeting_attendance | meetings-managers OR own row OR guardian's children | meetings-managers + meeting's season open | same | same | self check-in only via `check_in_with_code` |
| team_entitlement (view) | security_invoker → a member's teams | — | — | — | — |

Functions: 30 SECURITY DEFINER, all `search_path=public`. `anon` EXECUTE retained on: `can_manage_*` (5), `current_team_member_id`, `current_team_role`, `get_user_team_ids`, `guardian_member_ids`, `is_platform_operator`, `is_profile_guardian`, `is_team_guardian`, `is_team_member`, `meeting_season_is_open`, `season_is_open`, `team_can_write`, `team_seats_remaining`, the 5 trigger functions, and the 3 non-definer helpers. All 18 directly-called RPCs are anon-revoked (verified: `has_function_privilege('anon', …) = f`). See SEC-06.

## Appendix B — Capability matrix (UI vs RLS)

Legend: ✓ both allow · ✗ both deny · **UI✗/RLS✓** = hidden but server permits · **UI✓/RLS✗** = offered but server refuses. "L" = also requires licence in force; "S" = requires season open.

| action | admin | coach | mentor | student | guardian (no own membership) | pending |
|---|---|---|---|---|---|---|
| read roster, tasks, scouting, plans, checklist, seasons | ✓ | ✓ | ✓ | ✓ | ✗ (teams name + meetings + own children's attendance only) | ✗ (own `team_members` row only) |
| create/edit/delete tasks, scouting, plans, checklist (anyone's) | ✓ L S | ✓ L S | ✓ L S | ✓ L S | ✗ | ✗ |
| create/edit seasons, sub-teams, archive/rollover | ✓ L | ✓ L | **UI✗/RLS✗** | ✗ | ✗ | ✗ |
| create/edit meetings, set attendance | ✓ L S | ✓ L S | ✓ L S | ✗ (UI shows "My schedule") | ✗ | ✗ |
| self check-in (RPC) | ✓ | ✓ | ✓ | ✓ | ✗ (own refusal) | ✗ |
| read others' attendance | ✓ | ✓ | ✓ | ✗ | children only | ✗ |
| generate / revoke invite | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| read invite codes | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| approve member (assigns seat) | ✓ | UI disabled / RLS: row update ok, trigger refuses seat | ✗ | ✗ | ✗ | ✗ |
| reject / remove member | ✓ (DELETE; fails with history, SEC-03) | ✓ (same) | ✗ | ✗ | ✗ | ✗ |
| change member role student↔mentor↔coach | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| set role = admin / demote admin / delete admin row | **UI✗/RLS✓ (SEC-01)** | **UI✗/RLS✓ (SEC-01)** | ✗ | ✗ | ✗ | ✗ |
| change another member's `user_id`/`managed_profile_id` | UI✗/RLS✓ | UI✗/RLS✓ | ✗ | ✗ | ✗ | ✗ |
| nominate / cancel successor | ✓ | ✗ (RPC refuses; trigger refuses PATCH) | ✗ | ✗ | ✗ | ✗ |
| accept nomination | — | nominee only | nominee only | nominee only (18+) | ✗ | ✗ |
| edit team name / number | UI✗/RLS✓ | UI✗/RLS✓ | ✗ | ✗ | ✗ | ✗ |
| gift / revoke licence, see other teams | operator only (via `platform_operators`) | | | | | |
| add child profile, consents, offer promotion | any 18+ user (guardian of that profile) | | | | ✓ | |
| read other children's `notes`/`promotion_code` | **UI✗/RLS✓ (SEC-05)** | same | same | same | ✗ (only own) | ✗ |
| change own age classification (any value) | ✓ RPC / direct `users` PATCH | ✓ | ✓ | ✓ | ✓ | ✓ |
| create a team (new trial) | ✓ (any 18+ with `coach_terms`) | ✓ | ✓ | if 18+ | ✓ | ✓ |
| insert a bare `teams` row | UI✗/RLS✓ (any authenticated, SEC-08) | | | | | |

---

## Summary

1. **SEC-01 is a tenant-internal privilege escalation reachable with three REST calls** — a coach becomes admin or strands the team. Reproduced; nothing in the 319-test RLS suite tries it. Fix before any beta coach is onboarded.
2. **SEC-02: today's "I've turned 18" fix does not survive the next login** because `handle_new_user` re-applies signup metadata on every `auth.users` UPDATE. Reproduced; the plan marks it resolved.
3. **SEC-03: the plan and the runbook both say the app never DELETEs members; it does**, so "Remove from team" fails for any student with a task and destroys attendance when it works.
4. **SEC-04: no pagination against PostgREST's 1000-row cap; full pulls replace the local collection** — data silently disappears from devices past 1000 rows per table per team.
5. **SEC-05: every student can read every managed child's notes (allergies/pickup) and promotion code** — a COPPA-adjacent exposure the privacy policy contradicts.
6. Predicates double as anon-callable cross-tenant oracles (SEC-06); `get_user_team_ids(any uid)` is the worst.
7. The 90-day trial expires in early December for kickoff registrations, and nothing but an in-app banner says so (SEC-07); content screens keep offering writes that dead-letter.
8. Creation-time invite codes expire in 24 h with no warning (SEC-09) — the first thing every beta coach will hit.
9. The operator console is usable for gift/revoke/rescue but has no deletion, erasure, export, or expiry tooling; erasure is a psql runbook whose correctness depends on SEC-03's FK fix (SEC-11).
10. The client bundle is clean (anon key only); the risk surface is dashboard-only configuration that no script verifies (SEC-14).

## Confidence / not checked

- Did **not** run `test:rls`/`test:db` (they truncate). Something emptied `public.tasks` (1,200 → 0) between 19:30 and 19:40 local while teams/users/attendance stayed intact — probably another agent's seed or DB suite; my EXPLAIN transaction was rolled back (the 20,000-row insert is not present). If the review DB was meant to be stable, check with the other agents.
- SEC-04's "rows beyond 1000 vanish" is from code reading + PostgREST semantics; I did not get to re-run the row-count probe after the wipe (the first probe returned `Content-Range: */0` because the table was already empty).
- Hosted dashboard values (Site URL, allow-list, password policy, max rows, OAuth) were not read — production is off-limits; the drift list is what the code depends on, not what is set.
- RLS perf was measured on the 21k-row synthetic inside a rolled-back transaction with `ANALYZE`; real-world plans with many teams may pick the `team_id` index and be faster per query, but the per-row predicate cost (≈18 µs) does not change.
- The `handle_new_user` revert (SEC-02) was demonstrated via password sign-in and `PUT /auth/v1/user`; I did not test refresh-token rotation alone (it may or may not UPDATE `auth.users`).
- I did not exercise the e2e/Playwright UI for these flows (the brief's screenshot requirement) — every finding here was reproduced at the API layer, which is the security boundary; UI agents own the screens.
- Edge function `forward-support-email` was reviewed for auth shape only (signature-gated, fail-closed); Deno `index.ts` body beyond the header was not line-audited.
