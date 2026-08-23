import type { ParsedMatch } from './schedule-parse';
import type { AppState } from './store';

/**
 * Writing a confirmed schedule into the store (D2).
 *
 * SEPARATE FROM THE PARSER AND FROM THE SCREEN, and both separations are load-bearing.
 *
 * From the parser, because the parser must never write: D2 says *"the preview-and-confirm step
 * is load-bearing and an import must never write silently"*, and the cheapest way to guarantee
 * that is a parser that has no way to. `schedule-parse.ts` imports nothing.
 *
 * From the screen, because the ORDER matters and a component is a bad place to keep an ordering
 * rule. `event_matches` carries a composite foreign key into `competition_events(id, team_id)`
 * and `match_participants` into `event_matches(id, team_id)`, so a child that reaches the
 * server before its parent is refused, retried five times and dead-lettered. The queue drains
 * strictly in timestamp order (B1) and `queueForSync` allocates its timestamp before entering
 * its Dexie transaction (B1, fixed twice) — so queueing parent before child HERE is what makes
 * one drain enough. The season rollover has the same rule for the same reason and says so.
 */

export interface ImportResult {
    eventId: string | null;
    matchesCreated: number;
    participantsCreated: number;
    /** Matches skipped because the event already had one with that phase and number. */
    duplicatesSkipped: number;
}

export interface ImportInput {
    /** An existing event to add to, or the details of one to create. */
    eventId?: string;
    newEvent?: { name: string; eventCode?: string; startsOn?: string; location?: string };
    matches: ParsedMatch[];
}

/**
 * Apply a confirmed import.
 *
 * Takes the store as an argument rather than reaching for it, so the whole thing is testable
 * without a React tree and so the ordering above is visible in one function instead of spread
 * across a component's handlers.
 */
export function importSchedule(store: AppState, input: ImportInput): ImportResult {
    const result: ImportResult = {
        eventId: null,
        matchesCreated: 0,
        participantsCreated: 0,
        duplicatesSkipped: 0,
    };

    // ---------------------------------------------------------------- the event
    let eventId = input.eventId ?? null;
    if (!eventId) {
        if (!input.newEvent?.name?.trim()) return result;
        eventId = store.addCompetitionEvent({
            name: input.newEvent.name,
            eventCode: input.newEvent.eventCode,
            startsOn: input.newEvent.startsOn,
            location: input.newEvent.location,
        });
        if (!eventId) return result;
    }
    result.eventId = eventId;

    /*
     * WHAT THIS EVENT ALREADY HAS, computed once before the loop.
     *
     * A second paste against the same event is not an error — it is what a coach does when the
     * schedule changes, which D2 says is routine. Re-importing must not double every match, so
     * (phase, number) is treated as the natural key WITHIN an event. It is not a database
     * constraint, deliberately: a genuine replay of a match number happens, and a UNIQUE would
     * turn that into a push that dead-letters rather than a row a coach can correct.
     *
     * Read from the store rather than tracked as the loop goes, so it also sees the matches
     * that were already there before this import began.
     */
    const existing = new Set(
        store.eventMatches
            .filter((m) => m.eventId === eventId)
            .map((m) => `${m.phase}:${m.matchNumber}`),
    );

    for (const parsed of input.matches) {
        const key = `${parsed.phase}:${parsed.matchNumber}`;
        if (existing.has(key)) {
            result.duplicatesSkipped += 1;
            continue;
        }
        existing.add(key);

        // Parent first. See the ordering note at the top of this file.
        const matchId = store.addEventMatch({
            eventId,
            phase: parsed.phase,
            matchNumber: parsed.matchNumber,
            /*
             * THE TIME IS NOT PARSED, and that is a decision rather than a shortcut.
             *
             * `Sat 2/21 - 11:42 AM` has no year and no timezone. Guessing either is how
             * `docs/failure-modes.md` §10 happens — six defects, in both directions, from
             * times computed off the wrong clock or from wall-clock parts. A coach who wants a
             * real time can set it by hand on the match, which D2 requires anyway ("every
             * field the parser fills must be enterable and editable by hand"); what the import
             * keeps is the schedule's own words, in `notes`, so nothing is lost.
             */
            scheduledAt: undefined,
            notes: parsed.scheduledText || undefined,
        });
        if (!matchId) continue;
        result.matchesCreated += 1;

        for (const participant of parsed.participants) {
            const id = store.addMatchParticipant({
                matchId,
                alliance: participant.alliance,
                station: participant.station,
                teamNumber: participant.teamNumber,
                teamName: participant.teamName || undefined,
                isSurrogate: participant.isSurrogate,
            });
            if (id) result.participantsCreated += 1;
        }
    }

    return result;
}
