import type { MatchPlan } from '../../types';
import { generateId, queueForSync } from '../offline-db';
import { canWriteToSeason } from '../season-rules';
import type { SliceCreator } from './types';

export interface MatchPlanSlice {
    matchPlans: MatchPlan[];
    /** Create a plan in the CURRENT season — `match_plans.season_id` is NOT NULL. */
    addMatchPlan: (plan: Omit<MatchPlan, 'id' | 'updatedAt' | 'seasonId'>) => void;
    deleteMatchPlan: (id: string) => void;
    updateMatchPlan: (id: string, updates: Partial<MatchPlan>) => void;
    /** Replace the collection. The read path calls this; it must NOT queue anything back. */
    setMatchPlans: (plans: MatchPlan[]) => void;
}

export const matchPlanInitialState = {
    matchPlans: [] as MatchPlan[],
};

export const createMatchPlanSlice: SliceCreator<MatchPlanSlice> = (set, get) => ({
    ...matchPlanInitialState,

    addMatchPlan: (planData) => {
        const state = get();
        if (!state.currentSeasonId) {
            console.warn('[store] addMatchPlan ignored: no season is selected');
            return;
        }
        // A prior season is read-only in the database; refusing here is what stops the UI
        // queueing a write `season_is_open` will refuse.
        if (!canWriteToSeason(state.seasons, state.currentSeasonId, 'addMatchPlan')) return;

        const plan: MatchPlan = {
            ...planData,
            id: generateId(),
            updatedAt: Date.now(),
            seasonId: state.currentSeasonId,
        };
        set((s) => ({ matchPlans: [...s.matchPlans, plan] }));
        queueForSync('match_plans', plan.id, 'create', {
            ...plan,
            teamId: state.currentTeamId,
        }).catch(console.error);
    },

    deleteMatchPlan: (id) => {
        const state = get();
        const existing = state.matchPlans.find((p) => p.id === id);
        if (existing && !canWriteToSeason(state.seasons, existing.seasonId, 'deleteMatchPlan')) return;

        set((s) => ({ matchPlans: s.matchPlans.filter((p) => p.id !== id) }));
        queueForSync('match_plans', id, 'delete', null).catch(console.error);
    },

    updateMatchPlan: (id, updates) => {
        const current = get();
        const existing = current.matchPlans.find((p) => p.id === id);
        if (existing && !canWriteToSeason(current.seasons, existing.seasonId, 'updateMatchPlan')) return;

        set((state) => ({
            matchPlans: state.matchPlans.map((p) =>
                p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p,
            ),
        }));
        const plan = get().matchPlans.find((p) => p.id === id);
        if (plan) {
            queueForSync(
                'match_plans',
                id,
                'update',
                { ...plan, ...updates, teamId: get().currentTeamId },
                existing ? { ...existing, teamId: get().currentTeamId } : undefined,
            ).catch(console.error);
        }
    },

    setMatchPlans: (matchPlans) => set({ matchPlans }),
});
