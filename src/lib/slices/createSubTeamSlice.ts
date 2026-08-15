import type { SubTeam } from '../../types';
import { generateId, queueForSync } from '../offline-db';

export interface SubTeamSlice {
    subTeams: SubTeam[];
    setSubTeams: (subTeams: SubTeam[]) => void;
    addSubTeam: (name: string) => void;
    removeSubTeam: (id: string) => void;
    toggleMemberInSubTeam: (subTeamId: string, teamMemberId: string) => void;
}

export const createSubTeamSlice = (set: any, get: any): SubTeamSlice => ({
    subTeams: [],

    setSubTeams: (subTeams: SubTeam[]) => set({ subTeams }),

    addSubTeam: (name: string) => {
        const { currentSeasonId, currentTeamId } = get();
        // `sub_teams.season_id` is NOT NULL and referenced compositely with team_id. A
        // sub-team with no season is unpushable, so it is not created.
        if (!currentSeasonId) {
            console.warn('[store] addSubTeam ignored: no season is selected');
            return;
        }
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

    removeSubTeam: (id: string) => {
        set((state: any) => ({
            subTeams: state.subTeams.filter((t: SubTeam) => t.id !== id)
        }));
        queueForSync('sub_teams', id, 'delete', { id }).catch(console.error);
    },

    toggleMemberInSubTeam: (subTeamId: string, teamMemberId: string) => {
        set((state: any) => {
            const updatedSubTeams = state.subTeams.map((subTeam: SubTeam) => {
                if (subTeam.id === subTeamId) {
                    const isMember = subTeam.memberIds.includes(teamMemberId);
                    const newMemberIds = isMember
                        ? subTeam.memberIds.filter(id => id !== teamMemberId)
                        : [...subTeam.memberIds, teamMemberId];

                    const updatedSubTeam = { ...subTeam, memberIds: newMemberIds };

                    // Queue sync for the team update
                    queueForSync('sub_teams', subTeam.id, 'update', {
                        ...updatedSubTeam,
                        teamId: get().currentTeamId
                    }).catch(console.error);

                    return updatedSubTeam;
                }
                return subTeam;
            });
            return { subTeams: updatedSubTeams };
        });
    }
});
