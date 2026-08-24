import type { SubTeam } from '../../types';
import { generateId, queueForSync } from '../offline-db';
import { canWriteToSeason } from '../season-rules';
import type { SliceCreator } from './types';

export interface SubTeamSlice {
    subTeams: SubTeam[];
    setSubTeams: (subTeams: SubTeam[]) => void;
    addSubTeam: (name: string) => void;
    renameSubTeam: (id: string, name: string) => void;
    removeSubTeam: (id: string) => void;
    toggleMemberInSubTeam: (subTeamId: string, teamMemberId: string) => void;
}

export const subTeamInitialState = {
    subTeams: [] as SubTeam[],
};

export const createSubTeamSlice: SliceCreator<SubTeamSlice> = (set, get) => ({
    ...subTeamInitialState,

    setSubTeams: (subTeams: SubTeam[]) => set({ subTeams }),

    addSubTeam: (name: string) => {
        const { currentSeasonId, currentTeamId, seasons } = get();
        // `sub_teams.season_id` is NOT NULL and referenced compositely with team_id. A
        // sub-team with no season is unpushable, so it is not created.
        if (!currentSeasonId) {
            console.warn('[store] addSubTeam ignored: no season is selected');
            return;
        }
        // A prior season's sub-teams are history; `season_is_open` refuses the INSERT.
        if (!canWriteToSeason(seasons, currentSeasonId, 'addSubTeam')) return;

        const newSubTeam: SubTeam = {
            id: generateId(),
            name,
            memberIds: [],
            seasonId: currentSeasonId
        };
        set((state: any) => ({
            subTeams: [...state.subTeams, newSubTeam]
        }));
        // Queue for sync requires 4 parameters: table, id, action, data (optional)
        queueForSync('sub_teams', newSubTeam.id, 'create', {
            ...newSubTeam,
            teamId: currentTeamId
        }).catch(console.error);
    },

    /**
     * Rename a sub-team in place (FEAT-14).
     *
     * There was no way to do this. A typo in "Programing" meant deleting the sub-team and
     * making a new one, and deleting it takes its member assignments with it — so the cost of
     * a one-character mistake was re-assigning everybody on the team.
     *
     * The name is trimmed here rather than only at the input, because this is the store's
     * contract and the input is not the only thing that could ever call it. An empty or
     * unchanged name is a no-op: queueing an update that changes nothing would still be a
     * push, a round trip and a coalesce, and on venue wifi that is not free.
     */
    renameSubTeam: (id: string, name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return;

        const state = get();
        const existing = state.subTeams.find((t: SubTeam) => t.id === id);
        if (!existing) return;
        // Same guard as every other write here: a prior season's sub-teams are history, and
        // `season_is_open` refuses the UPDATE server-side regardless.
        if (!canWriteToSeason(state.seasons, existing.seasonId, 'renameSubTeam')) return;
        if (existing.name === trimmed) return;

        const updated: SubTeam = { ...existing, name: trimmed };
        set((s: any) => ({
            subTeams: s.subTeams.map((t: SubTeam) => (t.id === id ? updated : t)),
        }));
        queueForSync(
            'sub_teams',
            id,
            'update',
            { ...updated, teamId: state.currentTeamId },
            { ...existing, teamId: state.currentTeamId },
        ).catch(console.error);
    },

    removeSubTeam: (id: string) => {
        const state = get();
        const existing = state.subTeams.find((t: SubTeam) => t.id === id);
        if (existing && !canWriteToSeason(state.seasons, existing.seasonId, 'removeSubTeam')) return;

        set((s: any) => ({
            subTeams: s.subTeams.filter((t: SubTeam) => t.id !== id)
        }));
        queueForSync('sub_teams', id, 'delete', { id }).catch(console.error);
    },

    toggleMemberInSubTeam: (subTeamId: string, teamMemberId: string) => {
        const current = get();
        const target = current.subTeams.find((t: SubTeam) => t.id === subTeamId);
        if (target && !canWriteToSeason(current.seasons, target.seasonId, 'toggleMemberInSubTeam')) {
            return;
        }

        set((state: any) => {
            const updatedSubTeams = state.subTeams.map((subTeam: SubTeam) => {
                if (subTeam.id === subTeamId) {
                    const isMember = subTeam.memberIds.includes(teamMemberId);
                    const newMemberIds = isMember
                        ? subTeam.memberIds.filter(id => id !== teamMemberId)
                        : [...subTeam.memberIds, teamMemberId];

                    const updatedSubTeam = { ...subTeam, memberIds: newMemberIds };

                    // Queue sync for the team update. `subTeam` is the row before the
                    // toggle — the map has not replaced it yet (SYNC-06).
                    queueForSync(
                        'sub_teams',
                        subTeam.id,
                        'update',
                        { ...updatedSubTeam, teamId: get().currentTeamId },
                        { ...subTeam, teamId: get().currentTeamId },
                    ).catch(console.error);

                    return updatedSubTeam;
                }
                return subTeam;
            });
            return { subTeams: updatedSubTeams };
        });
    }
});
