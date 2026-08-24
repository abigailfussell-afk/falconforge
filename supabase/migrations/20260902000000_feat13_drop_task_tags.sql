-- FEAT-13 — `tasks.tags` was a field with no input anywhere.
--
-- It was written as `[]` by the task modal, threaded through `addTask`, round-tripped by the
-- entity registry in both directions, and stored in a NOT NULL `text[]` column with a `'{}'`
-- default. Nothing has ever put a value in it: there is no tag input, no tag filter, no tag
-- display. It is a column, a type property and four lines of transform, all describing a feature
-- that does not exist — `docs/failure-modes.md` section 7's shape, a value written by nothing and
-- read by nothing.
--
-- MEASURED BEFORE DROPPING, because "nothing has ever written it" is a claim about data and not
-- about code. Production, read read-only on 2026-08-23: 2 tasks, **0** with a non-empty `tags`.
-- Locally the same, across every seeded team. So this drops nothing anybody typed.
--
-- WHY DROP IT RATHER THAN LEAVE IT. A nullable column costs nothing to keep, and that is exactly
-- the argument that leaves a schema full of things nobody can explain. The client stops sending
-- and reading it in the same change, so keeping the column would mean a NOT NULL column that
-- only ever holds its default, for a feature nobody has asked for — which is the dead field this
-- ID is about, moved one layer down where it is harder to notice.
--
-- IF TAGS ARE EVER BUILT, this is one `ADD COLUMN` away, and the design question ("are tags free
-- text, a per-team vocabulary, or the sub-team relationship that already exists?") will be worth
-- answering properly rather than inheriting from a column somebody added in Sprint 3.

BEGIN;

ALTER TABLE tasks DROP COLUMN IF EXISTS tags;

COMMIT;
