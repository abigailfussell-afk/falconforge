/**
 * The game as data (P-01 phase S) and a team's changes to it (D4(b)).
 *
 * P-01's exit criteria name three red tests: that `SchemaForm` renders each field type, the
 * source-level literal ratchet, and *"entity-registry round-trip for `data` as an opaque bag
 * (unknown keys preserved)"*. The first is `SchemaForm.test.tsx`, the second is in
 * `harness-invariants.test.ts`, and the third is at the bottom of this file — it belongs with
 * the definition because the property it pins is a property of the definition's contract, not
 * of the registry's plumbing.
 */
import { describe, it, expect } from 'vitest';
import {
    allFields,
    blankReportData,
    isGameDefinition,
    resolveGame,
    TEAM_FIELD_PREFIX,
    type GamePatch,
} from '@/lib/game-definition';
import { BUNDLED_GAMES, DECODE, gameForSeason, gameById } from '@/lib/games';
import { findEntity } from '@/lib/entity-registry';
import { patchIssues, fieldError } from '@/lib/scouting-validation';

describe('the bundled definitions', () => {
    it('all load and validate', () => {
        expect(BUNDLED_GAMES.length).toBeGreaterThan(1);
        for (const game of BUNDLED_GAMES) {
            expect(isGameDefinition(game), `${game.id} is not a valid definition`).toBe(true);
        }
    });

    /*
     * THE CRITERION THAT MAKES THE WHOLE REFACTOR CHECKABLE: *"existing seeded DECODE rows
     * render unchanged (same values, same labels)"*. The DECODE definition was written to match
     * the old hand-coded form field for field, deliberately without improving anything in
     * passing — so this asserts the exact key set the ten typed properties used to be. Adding a
     * field to DECODE should fail this and make somebody think about the rows already stored.
     */
    it('DECODE has exactly the fields the old typed form had', () => {
        expect(allFields(DECODE).map((f) => f.key).sort()).toEqual(
            [
                'autoAim',
                'autoScore',
                'endGameNotes',
                'farShooting',
                'hasAutonomous',
                'intakeType',
                'parking',
                'rating',
                'shotsMissed',
                'shotsTaken',
            ].sort(),
        );
    });

    /*
     * P-01 NAMES THIS TRAP BY NAME: *"the `rating` default mismatch (3 in the form, 0 in
     * `fromRemote`) — pick one in the schema"*. A report saved without touching the slider read
     * back as a different number than it was saved with.
     */
    it('has one default per field, and rating is 3', () => {
        expect(blankReportData(DECODE).rating).toBe(3);
    });

    it('every field type in DECODE is one the form can render', () => {
        const renderable = new Set(['bool', 'int', 'counter', 'select', 'rating', 'text', 'textarea']);
        for (const field of allFields(DECODE)) {
            expect(renderable.has(field.type), `${field.key} is a ${field.type}`).toBe(true);
        }
    });

    it('a blank report has a value for every field, not a sparse bag', () => {
        const blank = blankReportData(DECODE);
        for (const field of allFields(DECODE)) {
            expect(
                Object.prototype.hasOwnProperty.call(blank, field.key),
                `${field.key} is absent from a blank report`,
            ).toBe(true);
        }
    });
});

describe('which definition a season plays', () => {
    it('uses the recorded id when there is one', () => {
        expect(gameForSeason({ gameDefinitionId: 'ftc-2025-decode' }).title).toBe('DECODE');
    });

    /*
     * EVERY SEASON IN PRODUCTION TODAY has a `gameTitle` and no id, because the column is new.
     * Without this fallback, opening an existing DECODE season after the upgrade would render
     * it as BIOBUZZ — silently relabelling a year of scouting with this year's rubric.
     */
    it('falls back to matching the game title, for seasons that predate the column', () => {
        expect(gameForSeason({ gameTitle: 'DECODE' }).id).toBe('ftc-2025-decode');
        expect(gameForSeason({ gameTitle: 'decode' }).id).toBe('ftc-2025-decode');
    });

    it('falls back to the newest bundle for a season with neither', () => {
        expect(gameForSeason({}).id).toBe(BUNDLED_GAMES[0].id);
        expect(gameForSeason(null).id).toBe(BUNDLED_GAMES[0].id);
    });

    it('ignores an id it does not ship rather than throwing', () => {
        expect(gameById('ftc-2099-nonexistent')).toBeUndefined();
        expect(gameForSeason({ gameDefinitionId: 'ftc-2099-nonexistent' })).toBeTruthy();
    });
});

describe('base ⊕ patch (D4(b))', () => {
    const patch: GamePatch = {
        hide: ['farShooting'],
        relabel: { shotsTaken: 'Attempts' },
        add: [
            {
                section: 'teleop',
                field: { key: `${TEAM_FIELD_PREFIX}climb`, label: 'Climbed', type: 'bool' },
            },
        ],
    };

    it('hides, relabels and adds — and nothing else', () => {
        const resolved = resolveGame(DECODE, patch);
        const keys = allFields(resolved).map((f) => f.key);

        expect(keys).not.toContain('farShooting');
        expect(keys).toContain(`${TEAM_FIELD_PREFIX}climb`);
        expect(allFields(resolved).find((f) => f.key === 'shotsTaken')!.label).toBe('Attempts');
        // The key is untouched by a relabel, which is what keeps the stored data meaningful.
        expect(keys).toContain('shotsTaken');
    });

    it('leaves the base object alone', () => {
        const before = allFields(DECODE).map((f) => `${f.key}:${f.label}`);
        resolveGame(DECODE, patch);
        expect(allFields(DECODE).map((f) => `${f.key}:${f.label}`)).toEqual(before);
    });

    /*
     * A MALFORMED PATCH RENDERS THE BASE, and does not throw. The patch is a jsonb column a
     * client wrote; a form that refuses to render takes the scouting screen down at a venue,
     * and the base is always a correct answer. The rules that stop a bad patch being WRITTEN
     * are `patchIssues`, below — both halves, as with every other rule in this project that
     * lives in two places on purpose.
     */
    it.each([
        ['null', null],
        ['empty', {}],
        ['garbage hide', { hide: 'farShooting' } as unknown as GamePatch],
        ['garbage relabel', { relabel: 'nope' } as unknown as GamePatch],
        ['garbage add', { add: [{ section: 'teleop' }] } as unknown as GamePatch],
    ])('survives a %s patch', (_label, value) => {
        const resolved = resolveGame(DECODE, value as GamePatch);
        expect(allFields(resolved).length).toBeGreaterThan(0);
    });

    /*
     * A field added last September to a section this September's game does not have. Keeping it
     * — in a section of its own — rather than dropping it is the decision: the team is still
     * collecting that value, and silently losing a column of a scout's data because a section
     * was renamed upstream is what the patch mechanism exists to avoid.
     */
    it('keeps a field whose section no longer exists', () => {
        const resolved = resolveGame(DECODE, {
            add: [
                {
                    section: 'a-section-from-last-year',
                    field: { key: `${TEAM_FIELD_PREFIX}legacy`, label: 'Legacy', type: 'text' },
                },
            ],
        });
        expect(allFields(resolved).map((f) => f.key)).toContain(`${TEAM_FIELD_PREFIX}legacy`);
    });
});

describe('what a team may write (D4(b))', () => {
    /*
     * THE NAMESPACE IS THE SAFETY PROPERTY, and it is the one worth a test of its own. Without
     * it a team's `climb` and next September's official `climb` become one key in one jsonb
     * bag, and last season's hand-typed value silently becomes this season's official field —
     * `docs/failure-modes.md` §9, an identity chosen for one property and wrong for another.
     */
    it('refuses a field key outside the team namespace', () => {
        const issues = patchIssues(DECODE, {
            add: [{ section: 'teleop', field: { key: 'climb', label: 'Climbed', type: 'bool' } }],
        });
        expect(issues.some((i) => i.message.includes(TEAM_FIELD_PREFIX))).toBe(true);
    });

    it('refuses a field that already exists on the template', () => {
        const issues = patchIssues(DECODE, {
            add: [
                {
                    section: 'teleop',
                    field: { key: 'shotsTaken', label: 'Mine', type: 'counter' },
                },
            ],
        });
        expect(issues.some((i) => i.message.includes('already exists'))).toBe(true);
    });

    it('refuses hiding or relabelling a field that is not on the form', () => {
        expect(patchIssues(DECODE, { hide: ['nonsense'] })).toHaveLength(1);
        expect(patchIssues(DECODE, { relabel: { nonsense: 'x' } })).toHaveLength(1);
    });

    it('refuses a blank label and an over-long one', () => {
        expect(patchIssues(DECODE, { relabel: { shotsTaken: '  ' } })).not.toHaveLength(0);
        expect(patchIssues(DECODE, { relabel: { shotsTaken: 'x'.repeat(80) } })).not.toHaveLength(0);
    });

    it('accepts an ordinary patch', () => {
        expect(
            patchIssues(DECODE, {
                hide: ['farShooting'],
                relabel: { shotsTaken: 'Attempts' },
                add: [
                    {
                        section: 'teleop',
                        field: { key: `${TEAM_FIELD_PREFIX}climb`, label: 'Climbed', type: 'bool' },
                    },
                ],
            }),
        ).toEqual([]);
    });
});

describe('validating a value against its field (WALK-A-06, widened by D4(b))', () => {
    const counter = { key: 'x', label: 'X', type: 'counter' as const, min: 0, max: 99 };

    it('refuses a non-integer and an out-of-range counter', () => {
        expect(fieldError(counter, 1.5)).toBeTruthy();
        expect(fieldError(counter, -1)).toBeTruthy();
        expect(fieldError(counter, 100)).toBeTruthy();
        expect(fieldError(counter, 5)).toBeUndefined();
    });

    it('treats absent as "not recorded", not as an error', () => {
        expect(fieldError(counter, undefined)).toBeUndefined();
    });

    it('caps a team-added text field even when it names no length', () => {
        const field = { key: `${TEAM_FIELD_PREFIX}note`, label: 'Note', type: 'text' as const };
        expect(fieldError(field, 'x'.repeat(600))).toBeTruthy();
        expect(fieldError(field, 'ok')).toBeUndefined();
    });

    /*
     * AN UNKNOWN SELECT OPTION IS NOT AN ERROR, and that is a decision rather than an
     * oversight: a report saved under last September's template can hold an option this
     * September's does not list, and refusing it would make an archived season's data
     * un-openable — the opposite of what "prior seasons are read-only but readable" promises.
     */
    it('accepts a stored select value the current template no longer lists', () => {
        const field = {
            key: 'intakeType',
            label: 'Intake',
            type: 'select' as const,
            options: ['A', 'B'],
        };
        expect(fieldError(field, 'Something From Last Year')).toBeUndefined();
    });
});

describe('the registry treats `data` as an opaque bag', () => {
    const entity = findEntity('scouting_reports')!;

    /*
     * THE RED TEST P-01's exit criteria name. Before this, `toRemote`/`fromRemote` enumerated
     * ten DECODE keys — so an unknown key was DROPPED, silently, on every round trip. A report
     * carrying a field the team added under D4(b), or one written by a newer build, lost that
     * field the moment an older client touched it, and the row still saved.
     */
    it('preserves a key it has never heard of', () => {
        const report = {
            id: 'r1',
            teamNumber: '12345',
            matchNumber: 3,
            eventName: '',
            data: {
                hasAutonomous: true,
                [`${TEAM_FIELD_PREFIX}climb`]: 'high',
                somethingFromNextSeptember: 42,
            },
            createdBy: 'member-1',
            seasonId: 'season-1',
            teamId: 'team-1',
            createdAt: undefined,
        };

        const back = entity.fromRemote(entity.toRemote(report) as never);
        expect(back.data).toEqual(report.data);
    });

    it('an empty bag round-trips as an empty bag, not as undefined', () => {
        const report = {
            id: 'r2',
            teamNumber: '1',
            matchNumber: undefined,
            eventName: '',
            data: {},
            createdBy: '',
            seasonId: 'season-1',
            teamId: 'team-1',
            createdAt: undefined,
        };
        expect(entity.fromRemote(entity.toRemote(report) as never).data).toEqual({});
    });
});
