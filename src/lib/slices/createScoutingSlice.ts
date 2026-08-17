import type { ScoutingReport } from '../../types';
import { generateId, queueForSync } from '../offline-db';
import { canWriteToSeason } from '../season-rules';
import type { SliceCreator } from './types';

export interface ScoutingSlice {
    scoutingReports: ScoutingReport[];
    /**
     * Log a report against the CURRENT season.
     *
     * `seasonId` is not a parameter, for the same reason it is not one on `addTask`: a report
     * belonging to a season other than the one on screen is not something the UI can express,
     * and `scouting_reports.season_id` is NOT NULL with a composite `(season_id, team_id)`
     * foreign key, so one created without a season could never be pushed.
     */
    addScoutingReport: (report: Omit<ScoutingReport, 'id' | 'seasonId'>) => void;
    updateScoutingReport: (id: string, updates: Partial<ScoutingReport>) => void;
    deleteScoutingReport: (id: string) => void;
    /** Replace the collection. The read path calls this; it must NOT queue anything back. */
    setScoutingReports: (reports: ScoutingReport[]) => void;
}

export const scoutingInitialState = {
    scoutingReports: [] as ScoutingReport[],
};

export const createScoutingSlice: SliceCreator<ScoutingSlice> = (set, get) => ({
    ...scoutingInitialState,

    addScoutingReport: (reportData) => {
        const state = get();
        if (!state.currentSeasonId) {
            console.warn('[store] addScoutingReport ignored: no season is selected');
            return;
        }
        // A prior season is read-only in the DATABASE (`season_is_open` gates the INSERT).
        // Refusing here is what stops the UI queueing a write the server will refuse, which
        // would otherwise show the report, retry five times and dead-letter.
        if (!canWriteToSeason(state.seasons, state.currentSeasonId, 'addScoutingReport')) return;

        // Resolve the team_members.id for the current auth user. The FK
        // `scouting_reports_created_by_fkey` references team_members(id), NOT auth.users(id).
        const currentMember = state.teamMembers.find((m) => m.userId === state.currentUserId);

        const report: ScoutingReport = {
            ...reportData,
            id: generateId(),
            createdBy: currentMember?.id || undefined,
            seasonId: state.currentSeasonId,
            createdAt: Date.now(),
        };
        set((s) => ({ scoutingReports: [...s.scoutingReports, report] }));
        queueForSync('scouting_reports', report.id, 'create', {
            ...report,
            teamId: state.currentTeamId,
        }).catch(console.error);
    },

    updateScoutingReport: (id, updates) => {
        const state = get();
        const existing = state.scoutingReports.find((r) => r.id === id);
        if (existing && !canWriteToSeason(state.seasons, existing.seasonId, 'updateScoutingReport')) return;

        set((s) => ({
            scoutingReports: s.scoutingReports.map((r) => (r.id === id ? { ...r, ...updates } : r)),
        }));
        const report = get().scoutingReports.find((r) => r.id === id);
        if (report) {
            queueForSync('scouting_reports', id, 'update', {
                ...report,
                ...updates,
                teamId: get().currentTeamId,
            }).catch(console.error);
        }
    },

    deleteScoutingReport: (id) => {
        const state = get();
        const existing = state.scoutingReports.find((r) => r.id === id);
        if (existing && !canWriteToSeason(state.seasons, existing.seasonId, 'deleteScoutingReport')) return;

        set((s) => ({ scoutingReports: s.scoutingReports.filter((r) => r.id !== id) }));
        queueForSync('scouting_reports', id, 'delete', null).catch(console.error);
    },

    setScoutingReports: (scoutingReports) => set({ scoutingReports }),
});
