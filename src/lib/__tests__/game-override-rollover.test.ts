/**
 * D4(b) — what happens to a team's form changes when the season rolls over.
 *
 * Kevin's decision names both halves and they point opposite ways: *"The override patch is
 * season-scoped and must survive a season roll the same way sub-team structure does — a team
 * that customised its DECODE form does not want it silently carried into BIOBUZZ, nor silently
 * lost."*
 *
 * So the rule is the GAME, not the wizard's checkbox alone: same game, the patch travels; new
 * game, it stays on the season it belongs to. "Not silently lost" does not mean "applied
 * somewhere it makes no sense" — `hide: ['shotsMissed']` against a form with no such field is
 * not a preserved customisation, it is a no-op wearing one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { db } from '@/lib/offline-db';
import type { Season } from '@/types';

const TEAM = 'team-1';
const OLD = 'season-decode';

const season = (over: Partial<Season> = {}): Season => ({
    id: OLD,
    name: '2025-2026 Season',
    gameTitle: 'DECODE',
    gameDefinitionId: 'ftc-2025-decode',
    fieldImageData: '',
    teamId: TEAM,
    isArchived: false,
    createdAt: 1000,
    ...over,
});

const PATCH = {
    hide: ['farShooting'],
    relabel: { shotsTaken: 'Attempts' },
};

beforeEach(async () => {
    await db.syncQueue.clear();
    useAppStore.setState({
        currentTeamId: TEAM,
        currentSeasonId: OLD,
        seasons: [season()],
        subTeams: [],
        gameOverrides: [],
        checklistsBySeason: {},
        checklistTemplates: [],
    });
    useAppStore.getState().saveGameOverride({
        seasonId: OLD,
        baseDefinitionId: 'ftc-2025-decode',
        patch: PATCH,
    });
});

describe('rolling over into the SAME game', () => {
    /*
     * The half that would otherwise be "silently lost". A team playing a second DECODE season —
     * which is what an off-season or a re-run looks like — keeps the form they built.
     */
    it('carries the patch to the new season', () => {
        const newId = useAppStore.getState().rollOverSeason({
            name: '2025-2026 Off-season',
            gameTitle: 'DECODE',
            gameDefinitionId: 'ftc-2025-decode',
        })!;

        const carried = useAppStore.getState().gameOverrides.find((o) => o.seasonId === newId);
        expect(carried, 'the patch was silently lost').toBeDefined();
        expect(carried!.patch).toEqual(PATCH);
        expect(carried!.baseDefinitionId).toBe('ftc-2025-decode');
    });

    /*
     * A NEW ROW, not the old one moved. The previous season keeps its own patch, because an
     * archived season must still render the form its reports were written against — that is
     * the whole reason the patch is season-scoped rather than team-scoped.
     */
    it('leaves the previous season own patch in place', () => {
        useAppStore.getState().rollOverSeason({
            name: '2025-2026 Off-season',
            gameDefinitionId: 'ftc-2025-decode',
        });

        const overrides = useAppStore.getState().gameOverrides;
        expect(overrides).toHaveLength(2);
        expect(overrides.find((o) => o.seasonId === OLD)!.patch).toEqual(PATCH);
    });
});

describe('rolling over into a DIFFERENT game', () => {
    /*
     * The half that would otherwise be "silently carried into BIOBUZZ". `hide: ['farShooting']`
     * means nothing to a form with no such field; carrying it would leave a coach with a patch
     * they cannot see the effect of and did not ask for.
     */
    it('does not carry the patch into the new game', () => {
        const newId = useAppStore.getState().rollOverSeason({
            name: '2026-2027 Season',
            gameTitle: 'BIOBUZZ',
            gameDefinitionId: 'ftc-2026-biobuzz',
        })!;

        expect(
            useAppStore.getState().gameOverrides.find((o) => o.seasonId === newId),
            'a DECODE patch was carried into BIOBUZZ',
        ).toBeUndefined();
    });

    /*
     * ...and it is NOT DELETED. "Not silently lost" is satisfied by the patch still existing on
     * the season it belongs to: the archived DECODE season keeps rendering the form its reports
     * were written against, which is what makes prior seasons readable rather than merely
     * retained.
     */
    it('keeps it on the season it belongs to', () => {
        useAppStore.getState().rollOverSeason({
            name: '2026-2027 Season',
            gameDefinitionId: 'ftc-2026-biobuzz',
        });

        const kept = useAppStore.getState().gameOverrides.find((o) => o.seasonId === OLD);
        expect(kept, 'the previous season lost its own form').toBeDefined();
        expect(kept!.patch).toEqual(PATCH);
    });
});

describe('the wizard structure choice covers it', () => {
    /*
     * `cloneSubTeams: false` is the wizard's existing "start structure fresh" choice, and the
     * form patch follows it rather than growing a second checkbox nobody asked for. A coach who
     * says "fresh start" means it.
     */
    it('a fresh-structure rollover starts the form fresh too', () => {
        const newId = useAppStore.getState().rollOverSeason({
            name: '2025-2026 Off-season',
            gameDefinitionId: 'ftc-2025-decode',
            cloneSubTeams: false,
        })!;

        expect(
            useAppStore.getState().gameOverrides.find((o) => o.seasonId === newId),
        ).toBeUndefined();
    });
});

describe('what reaches the server', () => {
    /*
     * The carried patch is a real row that has to sync, and it references the NEW season — so
     * the season must be queued before it, exactly as sub-teams are. `seasons.id` is the target
     * of a composite foreign key; a patch that arrives first is refused, retried five times and
     * dead-lettered (B1's shape).
     */
    it('queues the new season before the patch that references it', async () => {
        await db.syncQueue.clear();
        useAppStore.getState().rollOverSeason({
            name: '2025-2026 Off-season',
            gameDefinitionId: 'ftc-2025-decode',
        });

        const tables = (await db.syncQueue.orderBy('timestamp').toArray()).map((q) => q.tableName);
        const seasonAt = tables.indexOf('seasons');
        const patchAt = tables.indexOf('team_game_overrides');

        expect(seasonAt).toBeGreaterThanOrEqual(0);
        expect(patchAt).toBeGreaterThan(seasonAt);
    });
});
