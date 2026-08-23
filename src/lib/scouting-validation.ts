/**
 * What a scouting report is allowed to contain (WALK-A-06).
 *
 * The walkthrough put three values into the form that it should not have accepted, and the form
 * took all three:
 *
 *   - Team #  `-12345678901234567890 🦅`  — stored verbatim, and wide enough on the card to shove
 *                                           the "No match #" badge out past the card's edge.
 *   - Match # `-5`                        — silently became "No match #". Not an error, not the
 *                                           number: the entry simply disappeared into a label
 *                                           that also means "the scout did not record one".
 *   - Notes   5,000 characters            — rendered unbounded, one report filling the grid.
 *
 * The second is the one worth dwelling on. `-5` was not rejected; it was accepted, discarded, and
 * reported as absent — `docs/failure-modes.md` §4, absence used as a value, which is the same
 * shape as B18's fabricated "Match 0" that the save handler already guards against. A scout at a
 * venue types the number, sees the card say "No match #", and has no way to tell whether the app
 * refused it or they mistyped.
 *
 * So the rule here is: say no out loud, or store what was typed. Never both accept and drop.
 *
 * These live in a module rather than inline in the form because the form is not the only writer —
 * the sync engine replays queued reports, and a rule that only exists in an `onChange` handler is
 * a rule the round trip does not have.
 */

import type { GameDefinition, GameField } from './game-definition';
import { allFields, isTeamField, MAX_TEAM_FIELDS, TEAM_FIELD_PREFIX } from './game-definition';

/** FTC team numbers are 1–5 digits. 99999 is comfortably past the highest issued number. */
export const TEAM_NUMBER_MAX_DIGITS = 5;

/**
 * 500 characters is roughly a full phone screen of text and about four times the longest note in
 * the review seed. The cap exists to stop one report owning the grid, not to ration what a scout
 * has to say — so it is enforced with a visible counter rather than a silent truncation.
 */
export const NOTES_MAX_LENGTH = 500;

export interface FieldCheck {
    /** `undefined` when the value is acceptable. Otherwise the sentence to show the scout. */
    error?: string;
}

/**
 * Team number: required, digits only, 1–5 of them.
 *
 * Deliberately NOT coerced to a number. Some teams write theirs with a leading zero on a pit
 * board and it is stored as text elsewhere in this app; parsing here would make `0123` and `123`
 * the same report, which they are not.
 */
export const checkTeamNumber = (raw: string | undefined): FieldCheck => {
    const value = (raw ?? '').trim();
    if (!value) return { error: 'Enter a team number' };
    if (!/^[0-9]+$/.test(value)) return { error: 'Digits only — no spaces, signs or symbols' };
    if (value.length > TEAM_NUMBER_MAX_DIGITS) {
        return { error: `Team numbers are at most ${TEAM_NUMBER_MAX_DIGITS} digits` };
    }
    return {};
};

/**
 * Match number: optional, and when given, a whole number of at least 1.
 *
 * `undefined` is a legitimate value — "the scout did not record a match" — which is why the
 * blank case returns no error. `NaN` is what a cleared `<input type="number">` parses to and is
 * treated as blank rather than as a violation (B18).
 */
export const checkMatchNumber = (raw: number | undefined): FieldCheck => {
    if (raw === undefined || Number.isNaN(raw)) return {};
    if (!Number.isInteger(raw)) return { error: 'Match numbers are whole numbers' };
    if (raw < 1) return { error: 'Match numbers start at 1' };
    return {};
};

export const checkNotes = (raw: string | undefined): FieldCheck => {
    const value = raw ?? '';
    if (value.length > NOTES_MAX_LENGTH) {
        return { error: `Notes are capped at ${NOTES_MAX_LENGTH} characters` };
    }
    return {};
};

export interface ScoutingDraft {
    teamNumber?: string;
    matchNumber?: number;
    endGameNotes?: string;
}

export interface ScoutingErrors {
    teamNumber?: string;
    matchNumber?: string;
    endGameNotes?: string;
}

/**
 * Every rule in one call, so the Save button and any future writer ask the same question.
 *
 * Returns a record with a key per offending field; an empty object means the draft may be saved.
 * `Object.keys(...).length === 0` is the check, not truthiness — `{}` is truthy.
 */
export const scoutingReportErrors = (draft: ScoutingDraft): ScoutingErrors => {
    const errors: ScoutingErrors = {};
    const team = checkTeamNumber(draft.teamNumber);
    if (team.error) errors.teamNumber = team.error;
    const match = checkMatchNumber(draft.matchNumber);
    if (match.error) errors.matchNumber = match.error;
    const notes = checkNotes(draft.endGameNotes);
    if (notes.error) errors.endGameNotes = notes.error;
    return errors;
};

export const isSavableScoutingReport = (draft: ScoutingDraft): boolean =>
    Object.keys(scoutingReportErrors(draft)).length === 0;

// ===========================================================================
// The GAME's own fields (D4(b))
// ===========================================================================
//
// Kevin, 2026-08-23: *"The validation surface widens — a per-team field needs the same
// treatment WALK-A-06 just gave the fixed ones, so the rules belong in `scouting-validation.ts`
// with the rest."*
//
// WHY THIS IS NOT "one validator per field type, written next to the form". The rules above
// exist in a module rather than in an `onChange` handler because the form is not the only
// writer — the sync engine replays queued reports, and a rule that only exists in a handler is
// a rule the round trip does not have. That argument does not weaken when the fields become
// data; it gets stronger, because a TEAM can now add a field and the only place its rule can
// live is here.
//
// The types are ours (D4 rules out a form builder), so this list is finite and stays finite.


/** A team's own field label, capped so a relabel cannot push the form off a phone. */
export const FIELD_LABEL_MAX_LENGTH = 40;

/** Default cap for a team-added text field that did not name one. */
export const TEAM_TEXT_MAX_LENGTH = 500;

/**
 * One value, against the field that defines it.
 *
 * Returns the sentence to show, or undefined. Deliberately LENIENT about type mismatches on
 * read — a number where a string is expected renders as that number rather than erroring —
 * because a report written by another build, or under a template that has since changed, must
 * still open. What it refuses is a value the scout has just typed and could fix.
 */
export function fieldError(field: GameField, value: unknown): string | undefined {
    switch (field.type) {
        case 'int':
        case 'counter': {
            if (value === undefined || value === null || value === '') {
                // Absent is allowed. A counter's UI never produces it; an `int` cleared to
                // blank does, and "not recorded" is a legitimate answer (failure-modes §4).
                return undefined;
            }
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                return 'Enter a number';
            }
            if (!Number.isInteger(value)) return 'Whole numbers only';
            if (field.min !== undefined && value < field.min) {
                return `At least ${field.min}`;
            }
            if (field.max !== undefined && value > field.max) {
                return `At most ${field.max}`;
            }
            return undefined;
        }
        case 'rating': {
            if (value === undefined || value === null) return undefined;
            if (typeof value !== 'number' || !Number.isFinite(value)) return 'Pick a rating';
            const min = field.min ?? 1;
            const max = field.max ?? 5;
            if (value < min || value > max) return `Between ${min} and ${max}`;
            return undefined;
        }
        case 'select': {
            if (value === undefined || value === null || value === '') return undefined;
            /*
             * An UNKNOWN OPTION IS NOT AN ERROR, and that is a decision rather than an
             * oversight. A report saved under last September's template can hold an option
             * this September's does not list, and refusing it would make an archived season's
             * data un-openable — which is the opposite of what "prior seasons are read-only
             * but readable" promises. The form shows the stored value; nobody is asked to fix
             * a report they wrote a year ago.
             */
            return undefined;
        }
        case 'text':
        case 'textarea': {
            if (typeof value !== 'string') return undefined;
            const cap = field.maxLength ?? (isTeamField(field.key) ? TEAM_TEXT_MAX_LENGTH : undefined);
            if (cap !== undefined && value.length > cap) {
                return `Capped at ${cap} characters`;
            }
            return undefined;
        }
        default:
            return undefined;
    }
}

/** Every field of a report's `data` bag, checked against the schema it was written under. */
export function gameDataErrors(
    game: GameDefinition,
    data: Record<string, unknown>,
): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const field of allFields(game)) {
        const error = fieldError(field, data[field.key]);
        if (error) errors[field.key] = error;
    }
    return errors;
}

// ===========================================================================
// What a team may do to a template (D4(b))
// ===========================================================================

export interface PatchIssue {
    /** Which part of the patch, for the settings screen to point at. */
    where: string;
    message: string;
}

/**
 * Is this patch something we will render?
 *
 * Checked on SAVE, in the UI that writes it — not on read. `resolveGame` is deliberately
 * forgiving about a malformed patch (it returns the base unchanged rather than throwing),
 * because a form that refuses to render takes the scouting screen down at a venue. These rules
 * are what stop a bad patch being written in the first place; the leniency is what stops one
 * that got in anyway from being fatal. Both halves, as with every other rule in this project
 * that exists in two places on purpose.
 */
export function patchIssues(
    base: GameDefinition,
    patch: {
        add?: { section: string; field: GameField }[];
        hide?: string[];
        relabel?: Record<string, string>;
    },
): PatchIssue[] {
    const issues: PatchIssue[] = [];
    const baseKeys = new Set(allFields(base).map((f) => f.key));
    const added = Array.isArray(patch.add) ? patch.add : [];

    if (added.length > MAX_TEAM_FIELDS) {
        issues.push({
            where: 'add',
            message: `You can add up to ${MAX_TEAM_FIELDS} fields of your own.`,
        });
    }

    const seen = new Set<string>();
    for (const entry of added) {
        const field = entry?.field;
        if (!field?.key) {
            issues.push({ where: 'add', message: 'A field needs a name.' });
            continue;
        }
        if (!isTeamField(field.key)) {
            /*
             * The namespace is the whole safety property. Without it a team's `climb` and next
             * September's official `climb` become one key in one jsonb bag, and last season's
             * hand-typed value silently becomes this season's official field — an identity
             * chosen for one property and wrong for another (`docs/failure-modes.md` §9).
             */
            issues.push({
                where: field.key,
                message: `Your own fields are stored under "${TEAM_FIELD_PREFIX}" so they can never clash with the official ones.`,
            });
        }
        if (baseKeys.has(field.key)) {
            issues.push({ where: field.key, message: 'That field already exists on the form.' });
        }
        if (seen.has(field.key)) {
            issues.push({ where: field.key, message: 'You have added that field twice.' });
        }
        seen.add(field.key);

        if (!field.label?.trim()) {
            issues.push({ where: field.key, message: 'Give the field a label.' });
        } else if (field.label.length > FIELD_LABEL_MAX_LENGTH) {
            issues.push({
                where: field.key,
                message: `Labels are capped at ${FIELD_LABEL_MAX_LENGTH} characters.`,
            });
        }
        if (field.type === 'select' && !(field.options ?? []).some((o) => o.trim())) {
            issues.push({ where: field.key, message: 'A choice field needs at least one option.' });
        }
    }

    for (const key of Array.isArray(patch.hide) ? patch.hide : []) {
        if (!baseKeys.has(key) && !seen.has(key)) {
            issues.push({ where: key, message: 'That field is not on this form.' });
        }
    }

    for (const [key, label] of Object.entries(patch.relabel ?? {})) {
        if (!baseKeys.has(key) && !seen.has(key)) {
            issues.push({ where: key, message: 'That field is not on this form.' });
        }
        if (typeof label !== 'string' || !label.trim()) {
            issues.push({ where: key, message: 'A new label cannot be blank.' });
        } else if (label.length > FIELD_LABEL_MAX_LENGTH) {
            issues.push({
                where: key,
                message: `Labels are capped at ${FIELD_LABEL_MAX_LENGTH} characters.`,
            });
        }
    }

    return issues;
}
