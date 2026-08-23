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
