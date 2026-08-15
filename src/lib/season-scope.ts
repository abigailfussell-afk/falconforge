/**
 * Season scoping, in one place.
 *
 * WHY THIS EXISTS
 *
 * `x.seasonId === currentSeasonId` was written out six times across three components. That
 * is the surviving half of a worse problem: until Sprint 3 the same line read
 * `!x.seasonId || x.seasonId === currentSeasonId` in five places, and the `!x.seasonId` half
 * leaked every season-less record into EVERY season — the exact opposite of the fresh start
 * a new season is supposed to be. `season_id NOT NULL` killed that half; this kills the
 * duplication that let five copies drift in the first place.
 *
 * It matters more now than it did then. Sprint 4 makes a prior season READ-ONLY, so "which
 * season am I looking at" and "may I edit it" are the same question asked twice, and a
 * component that answers the first inline is a component that will forget to ask the second.
 */
import { useMemo } from 'react';
import { useAppStore } from './store';
import type { Season } from '../types';

export interface SeasonScope {
    /** The season everything on screen belongs to, or null before one is chosen. */
    season: Season | null;
    currentSeasonId: string | null;
    /**
     * This season accepts no writes. Enforced by `season_is_open()` in the database; this
     * is what stops the UI offering an edit that would be refused and left "1 pending".
     */
    isArchived: boolean;
    /**
     * Safe to create, edit or delete records in this season. False with no season selected,
     * which is the condition "New Item" has been disabled on since Sprint 3.
     */
    canEdit: boolean;
}

/**
 * The current season and what it permits.
 *
 * Deliberately does NOT consult `team_entitlement`. A lapsed licence and an archived season
 * are different refusals with different fixes ("renew" vs "switch to this year"), and
 * collapsing them into one boolean produces a UI that cannot tell the user which one they
 * are looking at. The season wizard reads entitlement directly for the one action that is
 * gated on it.
 */
export function useSeasonScope(): SeasonScope {
    const currentSeasonId = useAppStore((s) => s.currentSeasonId);
    const seasons = useAppStore((s) => s.seasons);

    return useMemo(() => {
        const season = seasons.find((s) => s.id === currentSeasonId) ?? null;
        const isArchived = season?.isArchived === true;
        return {
            season,
            currentSeasonId,
            isArchived,
            canEdit: !!currentSeasonId && !isArchived,
        };
    }, [seasons, currentSeasonId]);
}

/**
 * The subset of a collection belonging to the current season.
 *
 * Takes the collection rather than reading it from the store so it composes with props —
 * `Dashboard` already filters the roster by team before handing it down, and a hook that
 * insisted on doing its own read could not be used there.
 *
 * Memoised on the array identity: a fresh `[]` from a Zustand selector on every store change
 * would re-render every consumer, since selector results are compared by reference.
 */
export function useSeasonScoped<T extends { seasonId: string }>(items: T[]): T[] {
    const currentSeasonId = useAppStore((s) => s.currentSeasonId);
    return useMemo(
        () => items.filter((item) => item.seasonId === currentSeasonId),
        [items, currentSeasonId],
    );
}
