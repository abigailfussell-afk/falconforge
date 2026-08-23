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
     * THIS SEASON accepts writes — a season selected, and not archived.
     *
     * NOT the question a component wants, and it is named at length so that it cannot be
     * mistaken for it. It used to be called `canEdit`, and every content screen in the app
     * disabled its New/Edit/Save controls on it, which meant a team whose LICENCE had lapsed
     * was offered every one of those controls and each write dead-lettered (WALK-B-12).
     * `useAccessState().canEdit` is the composed answer; this is one of its two inputs.
     *
     * There is deliberately no second boolean called `canEdit` anywhere: a component reaching
     * for that name gets the entitlement-aware one, because two booleans with one name that
     * disagree on a team's worst day is `docs/failure-modes.md` §1 waiting to happen.
     */
    seasonAcceptsWrites: boolean;
}

/**
 * The current season and what it permits.
 *
 * Deliberately does NOT consult `team_entitlement`. A lapsed licence and an archived season
 * are different refusals with different fixes ("renew" vs "switch to this year"), and
 * collapsing them into one boolean produces a UI that cannot tell the user which one they
 * are looking at. The season wizard reads entitlement directly for the one action that is
 * gated on it.
 *
 * That separation still holds and is why this file has no import of `entitlement.ts` — which
 * would also be a cycle, since `entitlement.ts` imports this one. What Sprint 16 changed is
 * where the two are JOINED: `useAccessState` composes them into a single `canEdit` plus the
 * reason for the refusal, and every content screen reads that instead. The mistake was never
 * that these two files were separate; it was that the join had no consumers, so the season
 * half was answering a question it could only ever half-answer.
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
            seasonAcceptsWrites: !!currentSeasonId && !isArchived,
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
