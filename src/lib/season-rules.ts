/**
 * What a season permits — the pure half.
 *
 * This module deliberately imports nothing from the store. The store and its slices need
 * these predicates to decide whether an edit may be queued, and the React hooks in
 * `season-scope.ts` need them to decide what to render; putting them in either of those
 * places makes the other one a circular import.
 *
 * THE RULE, ONCE
 *
 * A season that has been archived is read-only. Every write path asks the question the same
 * way, and asks it about the SEASON THE RECORD BELONGS TO rather than about the season on
 * screen — editing last year's task is still editing last year's task, whichever season the
 * picker happens to be showing.
 *
 * This is UX in front of a database rule, not the rule itself: `season_is_open()` gates the
 * INSERT/UPDATE/DELETE policy of every season-scoped table. What this file buys is that the
 * client does not QUEUE a write the server is going to refuse — which is the difference
 * between an action that is visibly unavailable and one that appears to work, sits in the
 * queue as "1 pending" with no reason given, and dead-letters nine minutes later.
 */
import type { Season } from '../types';

/**
 * Is this season closed to writes?
 *
 * An unknown season id is treated as NOT archived. The caller has a record referencing a
 * season the client has not pulled yet, and refusing edits on that basis would break the
 * offline case this whole application is built around. The server still decides.
 */
export function isSeasonArchived(seasons: Season[], seasonId: string | null | undefined): boolean {
    if (!seasonId) return false;
    return seasons.find((s) => s.id === seasonId)?.isArchived === true;
}

/**
 * May a record in this season be created, edited or deleted?
 *
 * Logs when it refuses, for the same reason the season-less guards do: a store action that
 * silently does nothing is indistinguishable from a store action that is broken.
 */
export function canWriteToSeason(
    seasons: Season[],
    seasonId: string | null | undefined,
    action: string,
): boolean {
    if (!seasonId) return false;
    if (isSeasonArchived(seasons, seasonId)) {
        console.warn(`[store] ${action} ignored: season ${seasonId} is archived (read-only)`);
        return false;
    }
    return true;
}

/**
 * What to pre-fill the new season's name with, given the season being rolled over.
 *
 * Derived from the OUTGOING season rather than from the clock, because a rollover is a
 * relative move: a team on "2026-2027 Season" is going to "2027-2028 Season" whether they
 * do the rollover at kickoff in September or catch up in November. Reading the calendar
 * instead would offer the same year twice to anyone rolling over early.
 *
 * Falls back to the calendar when the previous name carries no year pair to advance — the
 * FTC season straddles a year boundary, and from August onwards it is the next one being
 * planned.
 */
export function suggestNextSeasonName(previousName?: string, now: Date = new Date()): string {
    const match = previousName?.match(/(\d{4})\s*-\s*(\d{4})/);
    if (match) {
        const from = Number(match[1]) + 1;
        const to = Number(match[2]) + 1;
        return previousName!.replace(match[0], `${from}-${to}`);
    }

    const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    return `${year}-${year + 1} Season`;
}
