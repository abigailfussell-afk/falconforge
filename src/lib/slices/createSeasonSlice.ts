import type { Season } from '../../types';
import { generateId, queueForSync } from '../offline-db';

export interface SeasonSlice {
    seasons: Season[];
    currentSeasonId: string | null;
    addSeason: (name: string, fieldImageData?: string) => void;
    updateSeason: (id: string, updates: Partial<Season>) => void;
    deleteSeason: (id: string) => void;
    setCurrentSeason: (id: string) => void;
    setSeasons: (seasons: Season[]) => void;
    getCurrentSeason: () => Season | null;
}

export const createSeasonSlice = (set: any, get: any): SeasonSlice => ({
    seasons: [],
    currentSeasonId: null,

    addSeason: (name, fieldImageData = '') => {
        const { currentTeamId } = get();
        const newSeason: Season = {
            id: generateId(),
            name,
            fieldImageData,
            teamId: currentTeamId || undefined,
            createdAt: Date.now()
        };

        set((state: any) => ({
            seasons: [...state.seasons, newSeason],
            currentSeasonId: state.seasons.length === 0 ? newSeason.id : state.currentSeasonId
        }));

        queueForSync('seasons', newSeason.id, 'create', newSeason).catch(console.error);
    },

    updateSeason: (id, updates) => {
        set((state: any) => ({
            seasons: state.seasons.map((s: Season) => s.id === id ? { ...s, ...updates } : s)
        }));

        const season = get().seasons.find((s: Season) => s.id === id);
        if (season) {
            queueForSync('seasons', id, 'update', season).catch(console.error);
        }
    },

    deleteSeason: (id) => {
        set((state: any) => {
            const newSeasons = state.seasons.filter((s: Season) => s.id !== id);
            return {
                seasons: newSeasons,
                currentSeasonId: state.currentSeasonId === id
                    ? (newSeasons.length > 0 ? newSeasons[0].id : null)
                    : state.currentSeasonId
            };
        });
        queueForSync('seasons', id, 'delete', { id }).catch(console.error);
    },

    setCurrentSeason: (id) => set({ currentSeasonId: id }),

    setSeasons: (seasons) => {
        set((state: any) => {
            // Ensure currentSeasonId stays valid if possible
            let newCurrent = state.currentSeasonId;
            if (seasons.length > 0 && !seasons.find((s: Season) => s.id === newCurrent)) {
                newCurrent = seasons[0].id;
            }
            return { seasons, currentSeasonId: newCurrent };
        });
    },

    getCurrentSeason: () => {
        const { seasons, currentSeasonId } = get();
        return seasons.find((s: Season) => s.id === currentSeasonId) || null;
    }
});
