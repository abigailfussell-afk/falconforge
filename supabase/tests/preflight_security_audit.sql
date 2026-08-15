-- PREFLIGHT for 20260317000000_database_security_audit.sql
--
-- Verified 2026-08-09 with `supabase db diff --linked`: NONE of the constraints in that
-- migration exist in the hosted project. It references sub_team_members, which was never
-- created upstream, so the migration failed on that statement and its constraints never
-- landed. Production currently has no CHECK constraints and no composite tenant-isolation
-- foreign keys.
--
-- Applying them to a live database will FAIL, and roll back, if any existing row violates
-- them. This script finds those rows first. It is READ-ONLY -- every statement is a SELECT.
--
-- HOW TO RUN: paste into the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Every count should be 0. Any non-zero row must be cleaned up before applying the audit.
--
-- Checks 6-8 are the important ones: they detect data that is already leaking across team
-- boundaries. A non-zero count there is not just a migration blocker, it is a live tenant
-- isolation defect.

-- ---------------------------------------------------------------------------
-- 1-5. CHECK constraint violations (empty / whitespace-only strings, bad numbers)
-- ---------------------------------------------------------------------------
SELECT '1. teams with blank name' AS check_name,
       count(*) AS violations
FROM teams WHERE name IS NULL OR char_length(trim(name)) = 0

UNION ALL SELECT '2. seasons with blank name',
       count(*) FROM seasons WHERE name IS NULL OR char_length(trim(name)) = 0

UNION ALL SELECT '2. sub_teams with blank name',
       count(*) FROM sub_teams WHERE name IS NULL OR char_length(trim(name)) = 0

UNION ALL SELECT '3. tasks with blank title',
       count(*) FROM tasks WHERE title IS NULL OR char_length(trim(title)) = 0

UNION ALL SELECT '3. checklists with blank name',
       count(*) FROM checklists WHERE name IS NULL OR char_length(trim(name)) = 0

UNION ALL SELECT '4. invites with blank code',
       count(*) FROM invites WHERE code IS NULL OR char_length(trim(code)) = 0

UNION ALL SELECT '5. scouting_reports with match_number <= 0',
       count(*) FROM scouting_reports WHERE match_number <= 0

UNION ALL SELECT '5. match_plans with match_number <= 0',
       count(*) FROM match_plans WHERE match_number IS NOT NULL AND match_number <= 0

UNION ALL SELECT '5. invites with use_count < 0',
       count(*) FROM invites WHERE use_count < 0

-- ---------------------------------------------------------------------------
-- 6-8. TENANT ISOLATION violations.
--      These block the composite foreign keys AND indicate real cross-team data.
-- ---------------------------------------------------------------------------

-- A task pointing at a sub_team that belongs to a DIFFERENT team.
UNION ALL SELECT '6. tasks whose sub_team belongs to another team',
       count(*)
FROM tasks t
JOIN sub_teams st ON st.id = t.sub_team_id
WHERE t.sub_team_id IS NOT NULL AND st.team_id IS DISTINCT FROM t.team_id

-- A task pointing at a sub_team id that does not exist at all.
UNION ALL SELECT '6b. tasks whose sub_team_id is dangling',
       count(*)
FROM tasks t
WHERE t.sub_team_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sub_teams st WHERE st.id = t.sub_team_id)

-- A task assigned to a member of a DIFFERENT team.
UNION ALL SELECT '7. tasks assigned to another team''s member',
       count(*)
FROM tasks t
JOIN team_members tm ON tm.id = t.assigned_to
WHERE t.assigned_to IS NOT NULL AND tm.team_id IS DISTINCT FROM t.team_id

UNION ALL SELECT '7b. tasks whose assigned_to is dangling',
       count(*)
FROM tasks t
WHERE t.assigned_to IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = t.assigned_to)

-- A scouting report created by a member of a DIFFERENT team.
UNION ALL SELECT '8. scouting_reports created_by another team''s member',
       count(*)
FROM scouting_reports sr
JOIN team_members tm ON tm.id = sr.created_by
WHERE sr.created_by IS NOT NULL AND tm.team_id IS DISTINCT FROM sr.team_id

UNION ALL SELECT '8b. scouting_reports whose created_by is dangling',
       count(*)
FROM scouting_reports sr
WHERE sr.created_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.id = sr.created_by)

-- ---------------------------------------------------------------------------
-- 9. Duplicate keys that would block the composite UNIQUE (id, team_id) indexes.
--    Should be impossible given id is already a primary key, but cheap to confirm.
-- ---------------------------------------------------------------------------
UNION ALL SELECT '9. team_members duplicate (id, team_id)',
       count(*) FROM (
           SELECT id, team_id FROM team_members GROUP BY id, team_id HAVING count(*) > 1
       ) d

ORDER BY check_name;
