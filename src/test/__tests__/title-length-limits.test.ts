/**
 * WALK-A-11 — the client cap and the database CHECK are the same number.
 *
 * WHY THIS TEST EXISTS AT ALL. `TITLE_MAX_LENGTH` in `src/lib/text-limits.ts` and the `120` in
 * `supabase/migrations/20260827000000_title_length_limits.sql` are the same limit written twice,
 * which is the shape `docs/failure-modes.md` §12 catalogues: a hand-maintained list that is
 * correct the day it is written and that nothing compares afterwards. This repo has already paid
 * for that with three definitions of the Gate, five overlapping SELECT policies and seven
 * display-name implementations.
 *
 * WHAT DRIFT WOULD ACTUALLY DO, so the check is not theatre:
 *
 *   - Client cap ABOVE the column: a user types a title the input accepts, the write is refused
 *     by Postgres, and the sync engine retries it five times and dead-letters it. The user's work
 *     is preserved (that much this app gets right) but they are told a save failed for a reason
 *     no screen explains.
 *   - Client cap BELOW the column: the limit is decoration. An older bundle that has not
 *     reloaded, or anything talking to PostgREST directly, walks straight around it.
 *
 * Neither is visible in review, and neither breaks a single existing test.
 *
 * The columns are enumerated here as well as in the migration, deliberately: the migration is the
 * thing under test, so reading the list back out of it would be `docs/failure-modes.md` §2 — the
 * test asserting the harness. This list is written from the schema (`information_schema.columns`
 * for every `title`/`name` column in public), and a NEW title column added without a CHECK fails
 * here rather than shipping unlimited.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TITLE_MAX_LENGTH } from '../../lib/text-limits';

/*
 * TWO migrations now, and the test reads both.
 *
 * Sprint 19 capped eight columns in one file. Sprint 22 found the ninth — `managed_profiles`
 * .full_name, the column a guardian types a CHILD'S name into — and capped it in a second file,
 * because the first has been applied to production and a migration that has run is not edited.
 *
 * Reading both and requiring the union to equal `CAPPED` is what makes the second file
 * discoverable: had this test kept reading only the first, adding the ninth column would have
 * needed the list here changed anyway, and the failure would have said "no CHECK expressions
 * found" rather than "you capped a column the list does not know about".
 */
const MIGRATIONS = [
    'supabase/migrations/20260827000000_title_length_limits.sql',
    'supabase/migrations/20260830000000_walk_b10_child_name_length.sql',
];

/** Every `title`/`name` column in the public schema, as of the Sprint 22 migration. */
const CAPPED = [
    ['tasks', 'title'],
    ['meetings', 'title'],
    ['sub_teams', 'name'],
    ['seasons', 'name'],
    ['checklists', 'name'],
    ['match_plans', 'title'],
    ['competition_events', 'name'],
    ['teams', 'name'],
    ['managed_profiles', 'full_name'],
] as const;

const sql = MIGRATIONS.map((m) => readFileSync(m, 'utf8')).join(String.fromCharCode(10));

describe('WALK-A-11: the title limit is one number, not two', () => {
    it('states the same limit in the migration as in TITLE_MAX_LENGTH', () => {
        /*
         * Read the CHECK expressions rather than grepping for the digits anywhere in the file:
         * the header comment mentions 120 too, and a check that is satisfied by its own
         * documentation is this repo's most-repeated test defect.
         */
        const limits = [...sql.matchAll(/char_length\(btrim\([a-z_]+\)\)\s*<=\s*(\d+)/g)].map((m) =>
            Number(m[1]),
        );
        expect(limits.length, 'no CHECK expressions found — did a migration move?').toBe(
            CAPPED.length,
        );
        for (const limit of limits) expect(limit).toBe(TITLE_MAX_LENGTH);
    });

    it.each(CAPPED)('caps %s.%s', (table, column) => {
        expect(sql).toContain(`ALTER TABLE ${table}`);
        expect(sql).toMatch(
            new RegExp(`CONSTRAINT ${table}_${column}_length CHECK \\(char_length\\(btrim\\(${column}\\)\\)`),
        );
    });

    /*
     * The guard that stops the migration from failing halfway through production.
     *
     * ADD CONSTRAINT on a table with a violating row aborts at the first one and names only that
     * table, which is the worst moment to discover there are three more. The DO block reports all
     * of them before anything is altered — and it must RAISE, not warn, or the constraint that
     * follows fails anyway with the unhelpful message.
     */
    it('refuses to run against rows that already exceed the limit, and says which', () => {
        expect(sql).toContain('RAISE EXCEPTION');
        expect(sql).toContain('must be shortened by hand first');
    });
});

describe('the inputs that write those columns carry the same cap', () => {
    /*
     * A DB constraint with no client cap is a dead-lettered write and a user with no explanation,
     * so the pairing is checked in both directions. Files are named individually rather than
     * globbed for `maxLength`: a glob would pass on the scouting notes cap, the check-in code
     * cap and the field-label cap, none of which are this limit.
     */
    const INPUTS = [
        'src/components/SprintTaskDetail.tsx',
        'src/components/SubTeamManager.tsx',
        'src/components/SeasonManager.tsx',
        'src/components/MatchPlanner.tsx',
        'src/components/meetings/EventFormModal.tsx',
        'src/components/events/CompetitionEvents.tsx',
        'src/components/guardian/AddChildDialog.tsx',
    ];

    it.each(INPUTS)('%s caps its title input at TITLE_MAX_LENGTH', (file) => {
        const source = readFileSync(file, 'utf8');
        expect(source).toContain('maxLength={TITLE_MAX_LENGTH}');
        expect(source).toContain('text-limits');
    });
});
