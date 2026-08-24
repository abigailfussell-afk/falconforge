import type {
    ChecklistItem, MatchPlan, Meeting, MeetingAttendance, ScoutingReport, Season, SubTeam,
    Task, TeamGameOverride,
} from '../../types';
import type { GamePatch } from '../game-definition';
import { generateId, queueForSync } from '../offline-db';
import { canWriteToSeason } from '../season-rules';
import type { SliceCreator } from './types';

/** What the new-season wizard collects. */
export interface SeasonRolloverInput {
    /** The new season's name, e.g. "2027-2028 Season". */
    name: string;
    /** The FTC game, e.g. "DECODE". Optional; '' means not recorded. */
    gameTitle?: string;
    /**
     * Which bundled `GameDefinition` the new season plays (P-01 phase S).
     *
     * Also decides whether the previous season's form patch travels: a patch written against
     * DECODE means nothing to BIOBUZZ, which is D4's "not silently carried into a new game".
     */
    gameDefinitionId?: string;
    gameDefinitionVersion?: number;
    /**
     * The season to clone STRUCTURE from. Defaults to the current season.
     * Its member assignments are never carried over — see {@link SeasonSlice.rollOverSeason}.
     */
    fromSeasonId?: string;
    /** Clone the source season's sub-teams (names only, no members). */
    cloneSubTeams?: boolean;
    /**
     * Where the new season's pre-match checklist comes from.
     *
     *   `blank`            — no items.
     *   `previous`         — the source season's item texts, all unchecked.
     *   `template:<id>`    — a saved team template.
     */
    checklistSource?: 'blank' | 'previous' | `template:${string}`;
    /** Close the source season to writes. The "fresh start forward" half of a rollover. */
    archivePrevious?: boolean;
}

export interface SeasonSlice {
    seasons: Season[];
    /**
     * The team's scouting-form changes, one per season (D4(b)).
     *
     * IN THE SEASON SLICE RATHER THAN ITS OWN, because the rollover is the whole reason the
     * shape needed deciding — D4 says the patch "must survive a season roll the same way
     * sub-team structure does", and the code that carries it forward lives here beside the code
     * that carries sub-teams. A separate slice would have put the rule and its one hard case in
     * two files.
     */
    gameOverrides: TeamGameOverride[];
    /** Write (or replace) this season's patch. Returns the row id, or null when refused. */
    saveGameOverride: (input: {
        seasonId: string;
        baseDefinitionId: string;
        baseVersion?: number | null;
        patch: GamePatch;
    }) => string | null;
    setGameOverrides: (items: TeamGameOverride[]) => void;

    currentSeasonId: string | null;
    /**
     * `gameDefinitionId` is the fourth argument rather than part of a shape, because the other
     * three are positional and already spelled this way at every call site. Optional: a season
     * created without one falls back to matching `gameTitle`, then to the newest bundle
     * (`gameForSeason`), which is what every season created before P-01 does.
     */
    addSeason: (
        name: string,
        fieldImageData?: string,
        gameTitle?: string,
        game?: { id: string; version?: number },
    ) => string | null;
    updateSeason: (id: string, updates: Partial<Season>) => void;
    deleteSeason: (id: string) => void;
    setCurrentSeason: (id: string) => void;
    setSeasons: (seasons: Season[]) => void;
    getCurrentSeason: () => Season | null;
    /** Close a season to writes, or reopen it. */
    setSeasonArchived: (id: string, isArchived: boolean) => void;
    /**
     * "New season = fresh start." Returns the new season's id, or null if it could not be
     * created.
     */
    rollOverSeason: (input: SeasonRolloverInput) => string | null;
}

export const seasonInitialState = {
    seasons: [] as Season[],
    currentSeasonId: null as string | null,
    gameOverrides: [] as TeamGameOverride[],
};

export const createSeasonSlice: SliceCreator<SeasonSlice> = (set, get) => ({
    ...seasonInitialState,

    setGameOverrides: (gameOverrides) => set({ gameOverrides }),

    /**
     * Write this season's form patch, replacing whatever was there.
     *
     * ONE ROW PER SEASON, matching the table's `UNIQUE (team_id, season_id)`: a second patch
     * for one season is not a thing the product can express, and letting the client create one
     * would produce a push that the database refuses with a 23505 and the queue retries five
     * times before parking. So an existing row is UPDATED in place, keeping its id.
     */
    saveGameOverride: (input) => {
        const state = get();
        const { currentTeamId } = state;
        if (!currentTeamId) {
            console.warn('[store] saveGameOverride ignored: no team is selected');
            return null;
        }
        if (!canWriteToSeason(state.seasons, input.seasonId, 'saveGameOverride')) return null;

        const existing = state.gameOverrides.find((o) => o.seasonId === input.seasonId);
        const row: TeamGameOverride = {
            id: existing?.id ?? generateId(),
            seasonId: input.seasonId,
            baseDefinitionId: input.baseDefinitionId,
            baseVersion: input.baseVersion ?? null,
            patch: input.patch,
            teamId: currentTeamId,
            createdAt: existing?.createdAt ?? Date.now(),
        };

        set((s: any) => ({
            gameOverrides: existing
                ? s.gameOverrides.map((o: TeamGameOverride) => (o.id === row.id ? row : o))
                : [...s.gameOverrides, row],
        }));
        queueForSync(
            'team_game_overrides',
            row.id,
            existing ? 'update' : 'create',
            row,
        ).catch(console.error);
        return row.id;
    },

    addSeason: (name, fieldImageData = '', gameTitle = '', game) => {
        const { currentTeamId } = get();
        // `seasons.team_id` is NOT NULL and every season-scoped row references the season
        // compositely with the team. A season with no team is unpushable, and anything
        // created under it afterwards is unpushable too.
        if (!currentTeamId) {
            console.warn('[store] addSeason ignored: no team is selected');
            return null;
        }

        const newSeason: Season = {
            id: generateId(),
            name,
            gameTitle,
            // P-01 phase S. Which TEMPLATE, as distinct from the free-text label above: the
            // app cannot decide which form to render from a string a coach typed.
            gameDefinitionId: game?.id ?? null,
            gameDefinitionVersion: game?.version ?? null,
            fieldImageData,
            teamId: currentTeamId,
            isArchived: false,
            createdAt: Date.now(),
        };

        set((state: any) => ({
            seasons: [...state.seasons, newSeason],
            currentSeasonId: state.seasons.length === 0 ? newSeason.id : state.currentSeasonId,
        }));

        queueForSync('seasons', newSeason.id, 'create', newSeason).catch(console.error);
        return newSeason.id;
    },

    updateSeason: (id, updates) => {
        // Read BEFORE the set, because the set is what makes it "before" (SYNC-06).
        const existing = get().seasons.find((s: Season) => s.id === id);
        set((state: any) => ({
            seasons: state.seasons.map((s: Season) => (s.id === id ? { ...s, ...updates } : s)),
        }));

        const season = get().seasons.find((s: Season) => s.id === id);
        if (season) {
            queueForSync('seasons', id, 'update', season, existing).catch(console.error);
        }
    },

    setSeasonArchived: (id, isArchived) => {
        // Deliberately routed through updateSeason rather than gated by `canWriteToSeason`.
        // The `seasons` table itself is NOT gated on its own archive flag server-side, for
        // exactly this reason: if archiving locked the season row, archival would be a
        // one-way door and a mistake would be unrecoverable from the UI.
        get().updateSeason(id, { isArchived });
    },

    /**
     * DELETE A SEASON, AND EVERYTHING IT SCOPES.
     *
     * The server cascades: every season-scoped table carries
     * `(season_id, team_id) REFERENCES seasons (id, team_id) ON DELETE CASCADE`, so one
     * DELETE removes the season's tasks, sub-teams, scouting reports, match plans,
     * checklists and meetings. The client did not, and that asymmetry is the bug this
     * fixes — local state kept orphaned records pointing at a season id that no longer
     * existed anywhere. They rendered in no season (every view filters on the current
     * season id), counted towards nothing, and survived every pull, because a full pull
     * replaces a collection with what the server sent and the server had never heard of
     * them.
     *
     * The children are queued as explicit deletes rather than left to the server's cascade,
     * and the ORDER matters. `queueForSync` collapses a delete onto a pending create by
     * dropping both, so a season created offline and deleted before it ever synced takes
     * its unsynced children with it instead of leaving them queued against a season the
     * server will never have. For children that HAVE synced the delete is redundant — the
     * cascade would have got them — but it is issued first, so it lands while the season
     * still exists rather than erroring against a row that has already gone.
     */
    deleteSeason: (id) => {
        const state = get();

        // Computed once and used twice — by the attendance filter and as the meetings list.
        const seasonMeetingIds = new Set<string>(
            state.meetings.filter((m: Meeting) => m.seasonId === id).map((m: Meeting) => m.id),
        );

        const cascade: Array<[table: string, ids: string[]]> = [
            ['tasks', state.tasks.filter((t: Task) => t.seasonId === id).map((t: Task) => t.id)],
            ['sub_teams', state.subTeams.filter((s: SubTeam) => s.seasonId === id).map((s: SubTeam) => s.id)],
            ['scouting_reports', state.scoutingReports.filter((r: ScoutingReport) => r.seasonId === id).map((r: ScoutingReport) => r.id)],
            ['match_plans', state.matchPlans.filter((p: MatchPlan) => p.seasonId === id).map((p: MatchPlan) => p.id)],
            // The checklist row id IS the season id (see `updateChecklist` in store.ts).
            ['checklists', state.checklistsBySeason[id] ? [id] : []],
            /*
             * MEETINGS AND ATTENDANCE (FEAT-10), which this list has been missing since it was
             * written — while the docblock above has said all along that the server cascade
             * removes meetings, and it does.
             *
             * So the rows went from the database and STAYED in the store: meetings pointing at
             * a season id that exists nowhere, and attendance rows pointing at those meetings.
             * They render in no season (every view filters on the current season), survive
             * every pull (a full pull replaces a collection with what the server sent, and the
             * server has never heard of them), and the case the ordered cascade exists for —
             * a season created offline and deleted before it ever synced — left its meetings
             * queued against a season the server will never have.
             *
             * ATTENDANCE FIRST. `meeting_attendance` references `meetings (id, team_id)`, so
             * the child's delete has to land before the parent's or it errors against a row
             * that has already gone. It has no `season_id` of its own — the one season-scoped
             * table without one — so it is found through its meeting.
             */
            ['meeting_attendance', state.meetingAttendance
                .filter((a: MeetingAttendance) => seasonMeetingIds.has(a.meetingId))
                .map((a: MeetingAttendance) => a.id)],
            ['meetings', [...seasonMeetingIds]],
        ];

        set((s: any) => {
            const newSeasons = s.seasons.filter((season: Season) => season.id !== id);
            const { [id]: _removed, ...checklistsBySeason } = s.checklistsBySeason;

            return {
                seasons: newSeasons,
                tasks: s.tasks.filter((t: Task) => t.seasonId !== id),
                subTeams: s.subTeams.filter((st: SubTeam) => st.seasonId !== id),
                scoutingReports: s.scoutingReports.filter((r: ScoutingReport) => r.seasonId !== id),
                matchPlans: s.matchPlans.filter((p: MatchPlan) => p.seasonId !== id),
                meetings: s.meetings.filter((m: Meeting) => m.seasonId !== id),
                meetingAttendance: s.meetingAttendance.filter(
                    (a: MeetingAttendance) => !seasonMeetingIds.has(a.meetingId),
                ),
                checklistsBySeason,
                currentSeasonId:
                    s.currentSeasonId === id
                        ? (newSeasons.length > 0 ? newSeasons[0].id : null)
                        : s.currentSeasonId,
            };
        });

        for (const [table, ids] of cascade) {
            for (const recordId of ids) {
                queueForSync(table, recordId, 'delete', { id: recordId }).catch(console.error);
            }
        }
        queueForSync('seasons', id, 'delete', { id }).catch(console.error);
    },

    setCurrentSeason: (id) => set({ currentSeasonId: id }),

    setSeasons: (seasons) => {
        set((state: any) => {
            // Keep the current season pointing at something real. Prefer an OPEN season:
            // landing a user in a read-only archive because it happened to sort first is a
            // confusing first impression of an app that otherwise lets them edit.
            let newCurrent = state.currentSeasonId;
            if (seasons.length > 0 && !seasons.find((s: Season) => s.id === newCurrent)) {
                newCurrent = (seasons.find((s: Season) => !s.isArchived) ?? seasons[0]).id;
            }
            return { seasons, currentSeasonId: newCurrent };
        });
    },

    getCurrentSeason: () => {
        const { seasons, currentSeasonId } = get();
        return seasons.find((s: Season) => s.id === currentSeasonId) || null;
    },

    /**
     * ROLL OVER TO A NEW SEASON.
     *
     * "Fresh start forward, full history backward": a new season with the previous one's
     * SHAPE and none of its work, and the previous one closed to writes but fully readable.
     *
     * WHAT IS CLONED, AND WHAT IS NOT
     *
     *   sub-teams   names only, with FRESH ids and `memberIds: []`. The roster lives at team
     *               level and persists; sub-team ASSIGNMENTS are a season's decision about
     *               who does what, and carrying them forward would quietly re-assign
     *               students who have left the team or moved to another group. This is the
     *               single most important line of this function.
     *   checklist   blank, the previous season's items unchecked, or a saved team template.
     *   everything  tasks, scouting reports and match plans are NOT cloned. An empty sprint
     *   else        board is the point of a fresh start.
     *
     * WHY THIS IS CLIENT-SIDE RATHER THAN AN RPC
     *
     * `create_team_as_admin` seeds a team's first season server-side in one transaction, and
     * that is the right shape for registration, which cannot happen offline anyway. A
     * rollover can: the exit criteria for this sprint require it to work with no network and
     * sync cleanly afterwards, and an RPC needs a connection at the moment it is called.
     *
     * This is not a second write path. Every row below goes through `queueForSync` and the
     * entity registry exactly as a hand-created season, sub-team and checklist would — it is
     * a composition of three things the store already does, not a new way of doing them. The
     * ids are generated per rollover, so none of the cross-team collision that made the old
     * hardcoded seed constants unpushable applies.
     *
     * ORDERING IS LOAD-BEARING. `season_id` is NOT NULL with a composite foreign key, so the
     * season row must reach the server before anything referencing it. The queue drains in
     * timestamp order (B1) and `queueForSync` issues strictly increasing timestamps at call
     * time, so queueing the season first is what makes one drain enough.
     */
    rollOverSeason: (input) => {
        const state = get();
        const { currentTeamId } = state;
        if (!currentTeamId) {
            console.warn('[store] rollOverSeason ignored: no team is selected');
            return null;
        }

        const name = input.name?.trim();
        if (!name) {
            console.warn('[store] rollOverSeason ignored: a season name is required');
            return null;
        }

        const fromSeasonId = input.fromSeasonId ?? state.currentSeasonId;

        // The season first — see ORDERING above.
        const newSeasonId = state.addSeason(
            name,
            '',
            input.gameTitle?.trim() || '',
            input.gameDefinitionId
                ? { id: input.gameDefinitionId, version: input.gameDefinitionVersion }
                : undefined,
        );
        if (!newSeasonId) return null;

        if (input.cloneSubTeams !== false && fromSeasonId) {
            const source: SubTeam[] = state.subTeams.filter((s: SubTeam) => s.seasonId === fromSeasonId);
            for (const subTeam of source) {
                const clone: SubTeam = {
                    id: generateId(),
                    name: subTeam.name,
                    // NEVER the source's members. See the note above.
                    memberIds: [],
                    seasonId: newSeasonId,
                };
                set((s: any) => ({ subTeams: [...s.subTeams, clone] }));
                queueForSync('sub_teams', clone.id, 'create', {
                    ...clone,
                    teamId: currentTeamId,
                }).catch(console.error);
            }
        }

        /*
         * THE FORM PATCH, CARRIED FORWARD ONLY WHEN THE GAME IS THE SAME (D4(b)).
         *
         * D4: "a team that customised its DECODE form does not want it silently carried into
         * BIOBUZZ, nor silently lost." Both halves are real, and they point opposite ways, so
         * the condition is the game rather than the wizard's checkbox alone:
         *
         *   * same game as the season it came from — the patch still means something, so it
         *     travels, like sub-team NAMES;
         *   * different game — it does not travel, because `hide: ['shotsMissed']` is
         *     meaningless against a form with no such field. It is not deleted either: it
         *     stays on the season it belongs to, which is what "not silently lost" means when
         *     the alternative is applying it somewhere it makes no sense.
         *
         * `cloneSubTeams` gates it, so the wizard's existing "start structure fresh" choice
         * covers this too rather than growing a second checkbox nobody asked for.
         */
        if (input.cloneSubTeams !== false && fromSeasonId) {
            const previous = state.gameOverrides.find((o) => o.seasonId === fromSeasonId);
            const newGameId = input.gameDefinitionId?.trim() || null;
            const sameGame =
                previous && (!newGameId || newGameId === previous.baseDefinitionId);
            if (previous && sameGame) {
                get().saveGameOverride({
                    seasonId: newSeasonId,
                    baseDefinitionId: previous.baseDefinitionId,
                    baseVersion: previous.baseVersion ?? null,
                    patch: previous.patch,
                });
            }
        }

        const items = resolveChecklistItems(state, input, fromSeasonId);
        // Written unconditionally, including when it is empty: a season with no checklist row
        // and a season with an empty checklist look the same to the user, but only the
        // second one survives a pull (B20 — zero rows is not an empty checklist).
        set((s: any) => ({
            checklistsBySeason: { ...s.checklistsBySeason, [newSeasonId]: items },
        }));
        queueForSync('checklists', newSeasonId, 'update', {
            items,
            teamId: currentTeamId,
            seasonId: newSeasonId,
        }).catch(console.error);

        /*
         * Archive last.
         *
         * What actually protects the user's existing work is that the QUEUE APPENDS: every
         * edit made to the outgoing season before this button was pressed already holds an
         * earlier timestamp, so those pushes land while the season is still open and the
         * archive follows. That holds wherever in this function the archive is queued — an
         * earlier version of this comment claimed the position was load-bearing, and moving
         * the call to the top on purpose failed to break a single test, which is how the
         * overclaim was found.
         *
         * It is still written last, for a narrower reason: `setSeasonArchived` mutates the
         * local `seasons` array, and the clone steps above read the pre-rollover snapshot.
         * Nothing between here and there consults `canWriteToSeason` today, but archiving
         * the season everything is being copied FROM before doing the copying is a trap to
         * leave lying around.
         */
        if (input.archivePrevious !== false && fromSeasonId && fromSeasonId !== newSeasonId) {
            get().setSeasonArchived(fromSeasonId, true);
        }

        set({ currentSeasonId: newSeasonId });
        return newSeasonId;
    },
});

/**
 * The new season's checklist items, per the wizard's choice.
 *
 * Items always get FRESH ids and `checked: false`. Reusing the previous season's item ids
 * would put the same id in two seasons' blobs, and `assignedTo` is carried by neither —
 * a checklist line assigned to a sub-team that no longer exists, or to a student who has
 * graduated, is worse than an unassigned one.
 */
function resolveChecklistItems(
    state: any,
    input: SeasonRolloverInput,
    fromSeasonId: string | null,
): ChecklistItem[] {
    const source = input.checklistSource ?? 'previous';

    if (source.startsWith('template:')) {
        const templateId = source.slice('template:'.length);
        const template = state.checklistTemplates?.find((t: { id: string }) => t.id === templateId);
        return (template?.items ?? []).map((item: ChecklistItem) => ({
            id: generateId(),
            text: item.text,
            checked: false,
        }));
    }

    if (source === 'previous' && fromSeasonId) {
        return (state.checklistsBySeason[fromSeasonId] ?? []).map((item: ChecklistItem) => ({
            id: generateId(),
            text: item.text,
            checked: false,
        }));
    }

    return [];
}
