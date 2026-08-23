import { describe, expect, it } from 'vitest';
import {
    NOTES_MAX_LENGTH,
    TEAM_NUMBER_MAX_DIGITS,
    checkMatchNumber,
    checkNotes,
    checkTeamNumber,
    isSavableScoutingReport,
    scoutingReportErrors,
} from '../scouting-validation';

/**
 * WALK-A-06. The three inputs at the top of each block are the ones the walkthrough actually
 * typed into the running app, verbatim — not invented edge cases.
 */
describe('scouting report validation', () => {
    describe('the three the walkthrough got in', () => {
        it('refuses the team number the walkthrough pasted', () => {
            // `$S/shots/walkA-d-scouting-after-create.png`: stored as typed, and wide enough to
            // push the match badge outside its own card.
            const check = checkTeamNumber('-12345678901234567890 🦅');
            expect(check.error, 'the pasted team number was accepted again').toBeTruthy();
        });

        it('refuses a negative match number instead of quietly calling it "No match #"', () => {
            const check = checkMatchNumber(-5);
            expect(check.error).toBe('Match numbers start at 1');
        });

        it('refuses 5,000 characters of notes', () => {
            const check = checkNotes('x'.repeat(5000));
            expect(check.error).toBeTruthy();
        });
    });

    describe('team number', () => {
        it('accepts an ordinary one', () => {
            expect(checkTeamNumber('3990').error).toBeUndefined();
        });

        it('accepts the widest legal one and refuses one digit more', () => {
            expect(checkTeamNumber('9'.repeat(TEAM_NUMBER_MAX_DIGITS)).error).toBeUndefined();
            expect(checkTeamNumber('9'.repeat(TEAM_NUMBER_MAX_DIGITS + 1)).error).toBeTruthy();
        });

        it('requires one', () => {
            expect(checkTeamNumber(undefined).error).toBe('Enter a team number');
            expect(checkTeamNumber('   ').error).toBe('Enter a team number');
        });

        it('refuses signs, spaces and symbols', () => {
            expect(checkTeamNumber('-5').error).toBeTruthy();
            expect(checkTeamNumber('39 90').error).toBeTruthy();
            expect(checkTeamNumber('3990🦅').error).toBeTruthy();
            expect(checkTeamNumber('39.9').error).toBeTruthy();
        });

        it('keeps a leading zero rather than parsing it away', () => {
            // Two different teams on a pit board. Coercing to a number would merge them.
            expect(checkTeamNumber('0123').error).toBeUndefined();
        });
    });

    describe('match number', () => {
        it('accepts a whole number from 1 up', () => {
            expect(checkMatchNumber(1).error).toBeUndefined();
            expect(checkMatchNumber(87).error).toBeUndefined();
        });

        it('treats blank as "not recorded", which is a legitimate answer', () => {
            expect(checkMatchNumber(undefined).error).toBeUndefined();
        });

        it('treats a cleared number input as blank, not as a violation (B18)', () => {
            // `parseInt('')` is NaN, and the field produces it on the way to being cleared.
            expect(checkMatchNumber(Number.NaN).error).toBeUndefined();
        });

        it('refuses zero, which the old handler fabricated', () => {
            expect(checkMatchNumber(0).error).toBe('Match numbers start at 1');
        });

        it('refuses a fraction', () => {
            expect(checkMatchNumber(2.5).error).toBe('Match numbers are whole numbers');
        });
    });

    describe('notes', () => {
        it('accepts the cap exactly and refuses one character more', () => {
            expect(checkNotes('x'.repeat(NOTES_MAX_LENGTH)).error).toBeUndefined();
            expect(checkNotes('x'.repeat(NOTES_MAX_LENGTH + 1)).error).toBeTruthy();
        });

        it('accepts nothing at all', () => {
            expect(checkNotes(undefined).error).toBeUndefined();
            expect(checkNotes('').error).toBeUndefined();
        });
    });

    describe('the whole draft', () => {
        it('names every offending field at once, not just the first', () => {
            const errors = scoutingReportErrors({
                teamNumber: '-12345678901234567890 🦅',
                matchNumber: -5,
                endGameNotes: 'x'.repeat(5000),
            });
            expect(Object.keys(errors).sort()).toEqual([
                'endGameNotes',
                'matchNumber',
                'teamNumber',
            ]);
        });

        it('lets an ordinary report through', () => {
            expect(
                isSavableScoutingReport({ teamNumber: '3990', matchNumber: 4, endGameNotes: 'Fast intake' }),
            ).toBe(true);
        });

        it('lets a report with no match number and no notes through', () => {
            expect(isSavableScoutingReport({ teamNumber: '3990' })).toBe(true);
        });

        it('does not report an empty error object as a failure', () => {
            // `{}` is truthy. A caller written as `if (errors)` would reject every valid report,
            // which is why the module exposes this predicate rather than leaving it to each one.
            expect(isSavableScoutingReport({ teamNumber: '3990' })).toBe(true);
            expect(isSavableScoutingReport({ teamNumber: '' })).toBe(false);
        });
    });
});
