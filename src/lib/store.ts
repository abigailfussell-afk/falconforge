import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { generateId, queueForSync, indexedDBStorage } from './offline-db';
import { supabaseSync, isSupabaseConfigured } from './supabase';
import { DEFAULT_SUBTEAMS } from '../constants';
import { TaskSlice, createTaskSlice } from './slices/createTaskSlice';
import { SubTeamSlice, createSubTeamSlice } from './slices/createSubTeamSlice';
import { SeasonSlice, createSeasonSlice } from './slices/createSeasonSlice';
import {
    transformTaskFromSupabase,
    transformScoutingReportFromSupabase,
    transformMatchPlanFromSupabase,
    transformSeasonFromSupabase,
    transformSubTeamFromSupabase,
} from './transformers';
import type { Team, TeamMember, SubTeam, Season } from '../types';

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

// Types matching the existing app structure
export interface Task {
    id: string;
    title: string;
    description: string;
    status: 'Backlog' | 'To Do' | 'In Progress' | 'Testing' | 'Done' | 'Archived';
    type: 'Feature' | 'Bug';
    assignedTo: string;  // TeamMember ID
    department: string;  // SubTeam ID
    tags: string[];
    checklist: { id: string; text: string; completed: boolean }[];
    timeline: { id: string; type: 'comment' | 'history'; authorId: string; content: string; timestamp: number }[];
    createdAt: number;
    dueDate?: number;
    seasonId?: string;
    archivedAt?: number;
}

export interface ScoutingReport {
    id: string;
    teamNumber: string;
    matchNumber: number;
    eventName?: string;
    hasAutonomous: boolean;
    autoScore: number;
    intakeType: 'No Intake' | 'Human Player' | 'Automatic';
    autoAim: boolean;
    farShooting: boolean;
    shotsTaken: number;
    shotsMissed: number;
    parking: 'No Park' | 'Full Park' | 'Partial Park';
    rating: number;
    endGameNotes: string;
    createdBy?: string;
    seasonId?: string;
    createdAt?: number;
}

export interface ChecklistItem {
    id: string;
    text: string;
    checked: boolean;
    assignedTo?: string;  // TeamMember ID or SubTeam ID
    seasonId?: string;
}

export interface MatchPlan {
    id: string;
    title: string;
    drawingData: any; // SVG path data
    notes: string;
    allianceTeam: string;
    partnerAutonomous: boolean;
    partnerPark: boolean;
    updatedAt: number;
    seasonId?: string;
}

export interface PortfolioEntry {
    id: string;
    content: string;
    createdAt: number;
    taskCount: number;
    seasonId?: string;
}

// Re-export types from types.ts for convenience
export type { Team, TeamMember, SubTeam, Season };

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

interface AppState extends TaskSlice, SubTeamSlice, SeasonSlice {
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
    portfolioHistory: PortfolioEntry[];
    seasons: Season[];
    currentSeasonId: string | null;

    // UI state
    theme: 'light' | 'dark';
    geminiApiKey: string | null;
    isLoading: boolean;

    // Actions
    setTheme: (theme: 'light' | 'dark') => void;
    setGeminiApiKey: (key: string | null) => void;

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

    // Portfolio History actions
    addPortfolioEntry: (content: string, taskCount: number) => void;
    deletePortfolioEntry: (id: string) => void;

    // Data management
    setIsLoading: (isLoading: boolean) => void;
    fetchTeamData: (teamId: string) => Promise<void>;
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
            portfolioHistory: [],
            theme: 'dark',
            geminiApiKey: null,

            // Theme
            setTheme: (theme) => {
                set({ theme });
                if (theme === 'dark') {
                    document.documentElement.classList.add('dark');
                } else {
                    document.documentElement.classList.remove('dark');
                }
            },

            setGeminiApiKey: (key) => set({ geminiApiKey: key }),

            // Team actions (top-level)
            setCurrentTeam: (teamId) => set({ currentTeamId: teamId }),
            setCurrentUserId: (userId) => set({ currentUserId: userId }),
            setTeams: (teams) => set({ teams }),
            setTeamMembers: (members) => set({ teamMembers: members }),

            // Data management
            setIsLoading: (isLoading) => set({ isLoading }),

            fetchTeamData: async (teamId) => {
                // Ensure Supabase is available and not null for TS
                if (!teamId || !isSupabaseConfigured() || !supabaseSync) return;

                set({ isLoading: true });

                try {
                    // 1. Fetch Team Members (required - should always exist)
                    try {
                        const { data: members, error: membersError } = await supabaseSync
                            .from('team_members')
                            .select('*')
                            .eq('team_id', teamId)
                            .eq('status', 'approved');

                        if (!membersError && members) {
                            set({
                                teamMembers: members.map((m: any) => ({
                                    id: m.id,
                                    teamId: m.team_id,
                                    userId: m.user_id,
                                    role: m.role as any,
                                    status: m.status as any,
                                    joinedAt: new Date(m.joined_at).getTime(),
                                    fullName: m.full_name,
                                    email: m.email,
                                    avatarUrl: m.avatar_url,
                                    isBillingActive: m.is_billing_active
                                }))
                            });
                        } else if (membersError) {
                            console.warn('Failed to fetch team_members:', membersError.message);
                        }
                    } catch (err) {
                        console.warn('Error fetching team_members:', err);
                    }

                    // 2. Fetch SubTeams
                    try {
                        const { data: subTeams, error: subTeamsError } = await supabaseSync
                            .from('sub_teams')
                            .select('*')
                            .eq('team_id', teamId);

                        if (!subTeamsError && subTeams) {
                            set({ subTeams: subTeams.map(transformSubTeamFromSupabase) });
                        } else if (subTeamsError) {
                            console.warn('Failed to fetch sub_teams:', subTeamsError.message);
                        }
                    } catch (err) {
                        console.warn('Error fetching sub_teams:', err);
                    }

                    // 3. Fetch Seasons
                    try {
                        const { data: seasons, error: seasonsError } = await supabaseSync
                            .from('seasons')
                            .select('*')
                            .eq('team_id', teamId);

                        if (!seasonsError && seasons && seasons.length > 0) {
                            set({ seasons: seasons.map(transformSeasonFromSupabase) });
                        } else if (seasonsError) {
                            console.warn('Failed to fetch seasons:', seasonsError.message);
                        }
                    } catch (err) {
                        console.warn('Error fetching seasons:', err);
                    }

                    // 4. Fetch Tasks (may not exist if migration not run)
                    try {
                        const { data: tasks, error: tasksError } = await supabaseSync
                            .from('tasks')
                            .select('*')
                            .eq('team_id', teamId);

                        if (!tasksError && tasks) {
                            set({ tasks: tasks.map(transformTaskFromSupabase) });
                        } else if (tasksError) {
                            // Table may not exist yet - this is expected before migration
                            console.warn('Failed to fetch tasks (table may not exist yet):', tasksError.message);
                        }
                    } catch (err) {
                        console.warn('Error fetching tasks:', err);
                    }

                    // 5. Fetch Scouting Reports (may not exist if migration not run)
                    try {
                        const { data: reports, error: reportsError } = await supabaseSync
                            .from('scouting_reports')
                            .select('*')
                            .eq('team_id', teamId);

                        if (!reportsError && reports) {
                            set({ scoutingReports: reports.map(transformScoutingReportFromSupabase) });
                        } else if (reportsError) {
                            console.warn('Failed to fetch scouting_reports (table may not exist yet):', reportsError.message);
                        }
                    } catch (err) {
                        console.warn('Error fetching scouting_reports:', err);
                    }

                    // 6. Fetch Match Plans (may not exist if migration not run)
                    try {
                        const { data: plans, error: plansError } = await supabaseSync
                            .from('match_plans')
                            .select('*')
                            .eq('team_id', teamId);

                        if (!plansError && plans) {
                            set({ matchPlans: plans.map(transformMatchPlanFromSupabase) });
                        } else if (plansError) {
                            console.warn('Failed to fetch match_plans (table may not exist yet):', plansError.message);
                        }
                    } catch (err) {
                        console.warn('Error fetching match_plans:', err);
                    }

                    // 7. Fetch Checklist (may not exist if migration not run)
                    try {
                        const { data: checklists, error: checklistError } = await supabaseSync
                            .from('checklists')
                            .select('*')
                            .eq('team_id', teamId)
                            .limit(1);

                        if (!checklistError && checklists && checklists.length > 0) {
                            const items = (checklists[0] as any).items;
                            if (Array.isArray(items)) {
                                set({ checklist: items });
                            }
                        } else if (checklistError) {
                            console.warn('Failed to fetch checklists (table may not exist yet):', checklistError.message);
                        }
                    } catch (err) {
                        console.warn('Error fetching checklists:', err);
                    }

                    // Note: Portfolio entries are intentionally local-only (not synced to Supabase)

                } catch (err) {
                    console.error('Error fetching team data:', err);
                } finally {
                    set({ isLoading: false });
                }
            },





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

            // Portfolio History
            addPortfolioEntry: (content, taskCount) => {
                const entry: PortfolioEntry = {
                    id: generateId(),
                    content,
                    createdAt: Date.now(),
                    taskCount,
                    seasonId: get().currentSeasonId || undefined,
                };
                set((state) => ({ portfolioHistory: [entry, ...state.portfolioHistory] }));
            },

            deletePortfolioEntry: (id) => {
                set((state) => ({
                    portfolioHistory: state.portfolioHistory.filter((e) => e.id !== id),
                }));
            },



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
                    portfolioHistory: [],
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
                portfolioHistory: state.portfolioHistory,
                seasons: state.seasons,
                currentSeasonId: state.currentSeasonId,
                theme: state.theme,
                // NOTE: geminiApiKey intentionally excluded — not persisted to
                // IndexedDB for security. Users re-enter once per session.
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
