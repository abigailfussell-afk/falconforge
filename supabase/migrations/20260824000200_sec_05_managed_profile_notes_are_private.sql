-- SEC-05 — a child's `notes` and `promotion_code` stop being readable by their teammates.
--
-- WHAT WAS WRONG
--
-- `managed_profiles_select_teammates` returned the WHOLE ROW to anyone rostered on a team the
-- child is on:
--
--     FOR SELECT USING (id IN (SELECT tm.managed_profile_id FROM team_members tm
--                               WHERE tm.team_id IN (SELECT get_user_team_ids(auth.uid()))
--                                 AND tm.managed_profile_id IS NOT NULL))
--
-- and `AddChildDialog` asks the guardian to put "Allergies, pickup arrangements — anything you
-- want to keep to hand" into `notes`. Reproduced on the seeded stack: as `iron-student0@`, a
-- 13-to-17 student,
--
--     GET /rest/v1/managed_profiles?select=full_name,notes,promotion_code
--     -> [{"full_name":"Robin Fussell",
--          "notes":"Peanut allergy - epipen in bag. Collected by grandma on Thursdays.", …}]
--
-- `promotion_code` came with it. That column is a credential: "whoever redeems it takes the
-- child's place on the roster" (`20260822000200_guardian_access.sql`), and that migration
-- restricted only the WRITE side. `PrivacyPolicy.tsx` promises teammates see no more of a child
-- than "what any team member sees".
--
-- WHY THE POLICY IS DROPPED RATHER THAN NARROWED TO SOME COLUMNS
--
-- Column-level GRANTs are per ROLE, not per row, so `GRANT SELECT (id, full_name, …)` would
-- have taken `notes` and `promotion_code` away from the GUARDIAN too — and the guardian is the
-- one person who has to read both. Splitting the surface (base table for the guardian, a
-- name-only view for the roster) works, but it would publish a new PostgREST endpoint that
-- nothing reads:
--
--   * `managed_profiles` is a GUARDIAN-scoped registry entity (`entity-registry.ts`), so the
--     pull is always `.eq('guardian_user_id', <me>)`. A teammate's client never asked for
--     another family's child and never will;
--   * the roster renders a child from `team_members.full_name`, which
--     `join_team_with_invite_for_child` denormalises at join time and which this migration does
--     not touch. `MemberManager`, the approval queue, attendance and the assignee pickers all
--     read that column;
--   * grep for `managedProfiles` in `src/` returns `GuardianView`, `JoinTeam` and `AppShell`'s
--     `isGuardian` — three readers of the signed-in user's OWN children, nothing else.
--
-- So the teammate policy had no reader, and adding a view to replace it would be a new surface
-- opened in order to close a security finding. The exit criterion for SEC-05 asks that
-- `select=id,full_name` keep working for a rostered child; it now returns `[]` instead, and the
-- sprint report says so. What the criterion protects — the roster being able to name a child —
-- is unaffected and was checked in the built app.
--
-- The guardian's own access is `managed_profiles_guardian_all`
-- (`FOR ALL USING (guardian_user_id = auth.uid())`), untouched, so `select('*')` still returns
-- every column to the person who typed them in.

DROP POLICY IF EXISTS managed_profiles_select_teammates ON managed_profiles;

COMMENT ON TABLE managed_profiles IS
    'A child with no login of their own. SEC-05: readable only by the guardian who created it. '
    'A teammate sees a child through team_members.full_name, never through this table.';
