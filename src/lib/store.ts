import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { generateId, queueForSync, indexedDBStorage } from './offline-db';
import { DEFAULT_SUBTEAMS } from '../constants';
import { TaskSlice, createTaskSlice } from './slices/createTaskSlice';
import { SubTeamSlice, createSubTeamSlice } from './slices/createSubTeamSlice';
import { SeasonSlice, createSeasonSlice } from './slices/createSeasonSlice';
import type {
    Team, TeamMember, SubTeam, Season,
    Task, ScoutingReport, ChecklistItem, MatchPlan,
} from '../types';

/**
 * Main application store using Zustand
 * Data is persisted to IndexedDB for offline support
 * Changes are queued for sync when online
 * 
 * ENTITY RENAME (2026-01-05):
 * - Team = Top-level FTC team organization (new)
 * - TeamMember = Supabase users belonging to a Team (replaces Member)
 * - SubTeam = Working groups (Build, Programming, etc.) - renamed from Team
 */

// Re-export types from types.ts for convenience
// (consumers can import { ScoutingReport } from '../lib/store' or from '../types')
export type {
    Team, TeamMember, SubTeam, Season,
    Task, ScoutingReport, ChecklistItem, MatchPlan,
};

// Default season for migration
const DEFAULT_SEASON: Season = {
    id: 'season-2025-2026',
    name: '2025-2026 Decode',
    fieldImageData: '',
    createdAt: Date.now(),
};

// Default data for new users/demo mode
const DEFAULT_CHECKLIST_ITEMS: ChecklistItem[] = [
    { id: '1', text: 'Turn off robot', checked: false },
    { id: '2', text: 'Swap main battery', checked: false },
    { id: '3', text: 'Charge old battery', checked: false },
    { id: '4', text: 'Charge Driver Hub', checked: false },
    { id: '5', text: 'Tighten chassis screws', checked: false },
    { id: '6', text: 'Check wiring connections', checked: false },
    { id: '7', text: 'Clean wheels', checked: false },
    { id: '8', text: 'Reset servo positions', checked: false },
];

export interface AppState extends TaskSlice, SubTeamSlice, SeasonSlice {
    // Team context (top-level organization)
    currentTeamId: string | null;
    currentUserId: string | null;  // Authenticated user's Supabase UID
    teams: Team[];  // Teams the user belongs to
    teamMembers: TeamMember[];  // Members of the current team (cached from Supabase)

    // Core data
    tasks: Task[];
    subTeams: SubTeam[];  // Renamed from teams
    scoutingReports: ScoutingReport[];
    checklist: ChecklistItem[];
    matchPlans: MatchPlan[];
    seasons: Season[];
    currentSeasonId: string | null;

    // UI state
    theme: 'light' | 'dark';
    isLoading: boolean;

    // Actions
    setTheme: (theme: 'light' | 'dark') => void;

    // Team actions (top-level)
    setCurrentTeam: (teamId: string | null) => void;
    setCurrentUserId: (userId: string | null) => void;
    setTeams: (teams: Team[]) => void;
    setTeamMembers: (members: TeamMember[]) => void;

    // Scouting actions
    addScoutingReport: (report: Omit<ScoutingReport, 'id'>) => void;
    updateScoutingReport: (id: string, updates: Partial<ScoutingReport>) => void;
    deleteScoutingReport: (id: string) => void;
    setScoutingReports: (reports: ScoutingReport[]) => void;

    // Checklist actions
    toggleChecklistItem: (id: string) => void;
    resetChecklist: () => void;
    addChecklistItem: (text: string) => void;
    deleteChecklistItem: (id: string) => void;
    updateChecklistAssignment: (id: string, assignedTo: string) => void;
    moveChecklistItem: (id: string, direction: 'up' | 'down') => void;
    setChecklist: (items: ChecklistItem[]) => void;

    // Match Plan actions
    addMatchPlan: (plan: Omit<MatchPlan, 'id' | 'updatedAt'>) => void;
    deleteMatchPlan: (id: string) => void;
    updateMatchPlan: (id: string, updates: Partial<MatchPlan>) => void;
    setMatchPlans: (plans: MatchPlan[]) => void;

    // Data management.
    //
    // Loading team data is deliberately NOT an action here. It used to be `fetchTeamData`,
    // 145 lines of copy-pasted fetches that replaced every collection wholesale and had
    // never heard of the sync queue -- a second read path that silently discarded offline
    // work (C3). It now lives in `server-pull.ts` with every other server read.
    setIsLoading: (isLoading: boolean) => void;
    initializeStore: () => Promise<void>;
    resetToDefaults: () => void;
}

export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            // Initial state
            ...createTaskSlice(set, get),
            ...createSubTeamSlice(set, get),
            ...createSeasonSlice(set, get),

            currentTeamId: null,
            currentUserId: null,
            isLoading: false,
            teams: [],
            teamMembers: [],
            scoutingReports: [],
            checklist: DEFAULT_CHECKLIST_ITEMS,
            matchPlans: [],
            theme: 'dark',

            // Theme
            setTheme: (theme) => {
                set({ theme });
                if (theme === 'dark') {
                    document.documentElement.classList.add('dark');
                } else {
                    document.documentElement.classList.remove('dark');
                }
            },

            // Team actions (top-level)
            setCurrentTeam: (teamId) => set({ currentTeamId: teamId }),
            setCurrentUserId: (userId) => set({ currentUserId: userId }),
            setTeams: (teams) => set({ teams }),
            setTeamMembers: (members) => set({ teamMembers: members }),

            // Data management
            setIsLoading: (isLoading) => set({ isLoading }),

            // Scouting
            addScoutingReport: (reportData) => {
                const state = get();
                // Resolve the team_members.id for the current auth user.
                // The DB FK `scouting_reports_created_by_fkey` references
                // team_members(id), NOT auth.users(id).
                const currentMember = state.teamMembers.find(
                    (m) => m.userId === state.currentUserId
                );
                const report: ScoutingReport = {
                    ...reportData,
                    id: generateId(),
                    createdBy: currentMember?.id || undefined,
                    seasonId: state.currentSeasonId || undefined,
                    createdAt: Date.now(),
                };
                set((s) => ({
                    scoutingReports: [...s.scoutingReports, report],
                }));
                queueForSync('scouting_reports', report.id, 'create', {
                    ...report,
                    teamId: state.currentTeamId,
                });
            },

            updateScoutingReport: (id, updates) => {
                set((state) => ({
                    scoutingReports: state.scoutingReports.map((r) =>
                        r.id === id ? { ...r, ...updates } : r
                    ),
                }));
                const report = get().scoutingReports.find(r => r.id === id);
                if (report) {
                    queueForSync('scouting_reports', id, 'update', {
                        ...report,
                        ...updates,
                        teamId: get().currentTeamId,
                    });
                }
            },

            deleteScoutingReport: (id) => {
                set((state) => ({
                    scoutingReports: state.scoutingReports.filter((r) => r.id !== id),
                }));
                queueForSync('scouting_reports', id, 'delete', null);
            },

            setScoutingReports: (scoutingReports) => set({ scoutingReports }),

            // Checklist
            toggleChecklistItem: (id) => {
                const state = get();
                const newChecklist = state.checklist.map((item) =>
                    item.id === id ? { ...item, checked: !item.checked } : item
                );
                set({ checklist: newChecklist });
                // Sync entire checklist as blob
                queueForSync('checklists', state.currentTeamId || 'default', 'update', {
                    items: newChecklist,
                    teamId: state.currentTeamId,
                    seasonId: state.currentSeasonId,
                });
            },

            resetChecklist: () => {
                set((state) => ({
                    checklist: state.checklist.map((item) => ({ ...item, checked: false })),
                }));
                // Sync entire checklist as blob
                const state = get();
                queueForSync('checklists', state.currentTeamId || 'default', 'update', {
                    items: state.checklist.map((item) => ({ ...item, checked: false })),
                    teamId: state.currentTeamId,
                    seasonId: state.currentSeasonId,
                });
            },

            addChecklistItem: (text) => {
                const state = get();
                const item: ChecklistItem = {
                    id: generateId(),
                    text,
                    checked: false,
                    seasonId: state.currentSeasonId || undefined,
                };
                const newChecklist = [...state.checklist, item];
                set({ checklist: newChecklist });
                // Sync entire checklist as blob
                queueForSync('checklists', state.currentTeamId || 'default', 'update', {
                    items: newChecklist,
                    teamId: state.currentTeamId,
                    seasonId: state.currentSeasonId,
                });
            },

            deleteChecklistItem: (id) => {
                const state = get();
                const newChecklist = state.checklist.filter((item) => item.id !== id);
                set({ checklist: newChecklist });
                // Sync entire checklist as blob
                queueForSync('checklists', state.currentTeamId || 'default', 'update', {
                    items: newChecklist,
                    teamId: state.currentTeamId,
                    seasonId: state.currentSeasonId,
                });
            },

            updateChecklistAssignment: (id, assignedTo) => {
                const state = get();
                const newChecklist = state.checklist.map((item) =>
                    item.id === id ? { ...item, assignedTo } : item
                );
                set({ checklist: newChecklist });
                // Sync entire checklist as blob
                queueForSync('checklists', state.currentTeamId || 'default', 'update', {
                    items: newChecklist,
                    teamId: state.currentTeamId,
                    seasonId: state.currentSeasonId,
                });
            },

            moveChecklistItem: (id, direction) => {
                const state = get();
                const index = state.checklist.findIndex(item => item.id === id);
                if (index === -1) return;
                if (direction === 'up' && index === 0) return;
                if (direction === 'down' && index === state.checklist.length - 1) return;

                const newChecklist = [...state.checklist];
                const targetIndex = direction === 'up' ? index - 1 : index + 1;
                [newChecklist[index], newChecklist[targetIndex]] = [newChecklist[targetIndex], newChecklist[index]];

                set({ checklist: newChecklist });
                // Sync entire checklist as blob
                queueForSync('checklists', state.currentTeamId || 'default', 'update', {
                    items: newChecklist,
                    teamId: state.currentTeamId,
                    seasonId: state.currentSeasonId,
                });
            },

            setChecklist: (checklist) => set({ checklist }),

            // Match Plans
            addMatchPlan: (planData) => {
                const state = get();
                const plan: MatchPlan = {
                    ...planData,
                    id: generateId(),
                    updatedAt: Date.now(),
                    seasonId: state.currentSeasonId || undefined,
                };
                set((s) => ({ matchPlans: [...s.matchPlans, plan] }));
                queueForSync('match_plans', plan.id, 'create', {
                    ...plan,
                    teamId: state.currentTeamId,
                });
            },

            deleteMatchPlan: (id) => {
                set((state) => ({
                    matchPlans: state.matchPlans.filter((p) => p.id !== id),
                }));
                queueForSync('match_plans', id, 'delete', null);
            },

            updateMatchPlan: (id, updates) => {
                set((state) => ({
                    matchPlans: state.matchPlans.map((p) =>
                        p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
                    ),
                }));
                const plan = get().matchPlans.find(p => p.id === id);
                if (plan) {
                    queueForSync('match_plans', id, 'update', {
                        ...plan,
                        ...updates,
                        teamId: get().currentTeamId,
                    });
                }
            },

            setMatchPlans: (matchPlans) => set({ matchPlans }),


            // Data management
            initializeStore: async () => {
                // One-time migration: move persisted state from localStorage to IndexedDB
                if (typeof window !== 'undefined') {
                    const legacy = localStorage.getItem('falconforge-storage');
                    if (legacy) {
                        try {
                            await indexedDBStorage.setItem('falconforge-storage', legacy);
                            localStorage.removeItem('falconforge-storage');
                            console.log('[store] Migrated persisted state from localStorage → IndexedDB');
                        } catch (e) {
                            console.warn('[store] Failed to migrate localStorage to IndexedDB:', e);
                        }
                    }
                }
            },

            resetToDefaults: () => {
                set({
                    currentTeamId: null,
                    currentUserId: null,
                    teams: [],
                    scoutingReports: [],
                    checklist: DEFAULT_CHECKLIST_ITEMS,
                    matchPlans: [],
                    teamMembers: [],
                    isLoading: false,

                    // Reset slices to initial values
                    tasks: [],
                    subTeams: DEFAULT_SUBTEAMS,
                    seasons: [DEFAULT_SEASON],
                    currentSeasonId: DEFAULT_SEASON.id,
                });
            },
        }),
        {
            name: 'falconforge-storage',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                currentTeamId: state.currentTeamId,
                teams: state.teams,
                teamMembers: state.teamMembers,
                tasks: state.tasks,
                subTeams: state.subTeams,
                scoutingReports: state.scoutingReports,
                checklist: state.checklist,
                matchPlans: state.matchPlans,
                seasons: state.seasons,
                currentSeasonId: state.currentSeasonId,
                theme: state.theme,
            }),
            onRehydrateStorage: () => (state) => {
                // Apply theme as soon as persisted state is rehydrated from IndexedDB
                if (state?.theme === 'dark') {
                    document.documentElement.classList.add('dark');
                } else {
                    document.documentElement.classList.remove('dark');
                }
            },
        }
    )
);

// Theme is now applied via onRehydrateStorage callback (async from IndexedDB).
// As a fallback, we default to dark mode until rehydration completes to prevent
// a flash of light mode.
if (typeof window !== 'undefined') {
    document.documentElement.classList.add('dark');
}
