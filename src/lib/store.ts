import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { db, generateId, queueForSync } from './offline-db';
import { DEFAULT_SUBTEAMS } from '../constants';
import type { Team, TeamMember, SubTeam } from '../types';

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
    status: 'Backlog' | 'To Do' | 'In Progress' | 'Testing' | 'Done';
    type: 'Feature' | 'Bug';
    assignedTo: string;  // TeamMember ID
    department: string;  // SubTeam ID
    tags: string[];
    checklist: { id: string; text: string; completed: boolean }[];
    timeline: { id: string; type: 'comment' | 'history'; authorId: string; content: string; timestamp: number }[];
    createdAt: number;
    dueDate?: number;
    seasonId?: string;
}

export interface ScoutingReport {
    id: string;
    teamNumber: string;
    matchNumber: number;
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
    seasonId?: string;
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

export interface Season {
    id: string;
    name: string;
    fieldImageUrl: string;
    teamId?: string;  // Scoped to Team
    createdAt: number;
}

// Re-export types from types.ts for convenience
export type { Team, TeamMember, SubTeam };

// Default season for migration
const DEFAULT_SEASON: Season = {
    id: 'season-2025-2026',
    name: '2025-2026 Decode',
    fieldImageUrl: '',
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

interface AppState {
    // Team context (top-level organization)
    currentTeamId: string | null;
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

    // Actions
    setTheme: (theme: 'light' | 'dark') => void;
    setGeminiApiKey: (key: string | null) => void;

    // Team actions (top-level)
    setCurrentTeam: (teamId: string | null) => void;
    setTeams: (teams: Team[]) => void;
    setTeamMembers: (members: TeamMember[]) => void;

    // Task actions
    addTask: (task: Omit<Task, 'id' | 'createdAt' | 'timeline'>) => void;
    updateTask: (id: string, updates: Partial<Task>) => void;
    deleteTask: (id: string) => void;

    // SubTeam actions (renamed from Team actions)
    addSubTeam: (name: string) => void;
    removeSubTeam: (id: string) => void;
    toggleMemberInSubTeam: (subTeamId: string, teamMemberId: string) => void;
    setSubTeams: (subTeams: SubTeam[]) => void;

    // Scouting actions
    addScoutingReport: (report: Omit<ScoutingReport, 'id'>) => void;
    deleteScoutingReport: (id: string) => void;

    // Checklist actions
    toggleChecklistItem: (id: string) => void;
    resetChecklist: () => void;
    addChecklistItem: (text: string) => void;
    deleteChecklistItem: (id: string) => void;
    updateChecklistAssignment: (id: string, assignedTo: string) => void;

    // Match Plan actions
    addMatchPlan: (plan: Omit<MatchPlan, 'id' | 'updatedAt'>) => void;
    deleteMatchPlan: (id: string) => void;
    updateMatchPlan: (id: string, updates: Partial<MatchPlan>) => void;

    // Portfolio History actions
    addPortfolioEntry: (content: string, taskCount: number) => void;
    deletePortfolioEntry: (id: string) => void;

    // Season actions
    addSeason: (name: string, fieldImageUrl?: string) => void;
    updateSeason: (id: string, updates: Partial<Season>) => void;
    deleteSeason: (id: string) => void;
    setCurrentSeason: (id: string | null) => void;
    getCurrentSeason: () => Season | null;

    // Data management
    initializeStore: () => Promise<void>;
    resetToDefaults: () => void;
}

export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            // Initial state
            currentTeamId: null,
            teams: [],
            teamMembers: [],
            tasks: [],
            subTeams: DEFAULT_SUBTEAMS,
            scoutingReports: [],
            checklist: DEFAULT_CHECKLIST_ITEMS,
            matchPlans: [],
            portfolioHistory: [],
            seasons: [DEFAULT_SEASON],
            currentSeasonId: DEFAULT_SEASON.id,
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
            setTeams: (teams) => set({ teams }),
            setTeamMembers: (members) => set({ teamMembers: members }),

            // Tasks
            addTask: (taskData) => {
                const task: Task = {
                    ...taskData,
                    id: generateId(),
                    createdAt: Date.now(),
                    seasonId: get().currentSeasonId || undefined,
                    timeline: [{
                        id: generateId(),
                        type: 'history',
                        authorId: 'System',
                        content: 'Task created',
                        timestamp: Date.now(),
                    }],
                };

                set((state) => ({ tasks: [...state.tasks, task] }));

                // Queue for sync
                queueForSync('tasks', task.id, 'create', task);
            },

            updateTask: (id, updates) => {
                set((state) => ({
                    tasks: state.tasks.map((t) =>
                        t.id === id ? { ...t, ...updates } : t
                    ),
                }));

                const task = get().tasks.find(t => t.id === id);
                if (task) {
                    queueForSync('tasks', id, 'update', { ...task, ...updates });
                }
            },

            deleteTask: (id) => {
                set((state) => ({
                    tasks: state.tasks.filter((t) => t.id !== id),
                }));

                queueForSync('tasks', id, 'delete', null);
            },

            // SubTeams (renamed from Teams)
            addSubTeam: (name) => {
                const subTeam: SubTeam = {
                    id: generateId(),
                    name,
                    memberIds: [],
                    seasonId: get().currentSeasonId || undefined,
                };
                set((state) => ({ subTeams: [...state.subTeams, subTeam] }));
            },

            removeSubTeam: (id) => {
                set((state) => ({
                    subTeams: state.subTeams.filter((t) => t.id !== id),
                }));
            },

            toggleMemberInSubTeam: (subTeamId, teamMemberId) => {
                set((state) => ({
                    subTeams: state.subTeams.map((t) => {
                        if (t.id !== subTeamId) return t;
                        const memberIds = t.memberIds.includes(teamMemberId)
                            ? t.memberIds.filter((id) => id !== teamMemberId)
                            : [...t.memberIds, teamMemberId];
                        return { ...t, memberIds };
                    }),
                }));
            },

            setSubTeams: (subTeams) => set({ subTeams }),

            // Scouting
            addScoutingReport: (reportData) => {
                const report: ScoutingReport = {
                    ...reportData,
                    id: generateId(),
                    seasonId: get().currentSeasonId || undefined,
                };
                set((state) => ({
                    scoutingReports: [...state.scoutingReports, report],
                }));
                queueForSync('scoutingReports', report.id, 'create', report);
            },

            deleteScoutingReport: (id) => {
                set((state) => ({
                    scoutingReports: state.scoutingReports.filter((r) => r.id !== id),
                }));
                queueForSync('scoutingReports', id, 'delete', null);
            },

            // Checklist
            toggleChecklistItem: (id) => {
                set((state) => ({
                    checklist: state.checklist.map((item) =>
                        item.id === id ? { ...item, checked: !item.checked } : item
                    ),
                }));
            },

            resetChecklist: () => {
                set((state) => ({
                    checklist: state.checklist.map((item) => ({ ...item, checked: false })),
                }));
            },

            addChecklistItem: (text) => {
                const item: ChecklistItem = {
                    id: generateId(),
                    text,
                    checked: false,
                    seasonId: get().currentSeasonId || undefined,
                };
                set((state) => ({ checklist: [...state.checklist, item] }));
            },

            deleteChecklistItem: (id) => {
                set((state) => ({
                    checklist: state.checklist.filter((item) => item.id !== id),
                }));
            },

            updateChecklistAssignment: (id, assignedTo) => {
                set((state) => ({
                    checklist: state.checklist.map((item) =>
                        item.id === id ? { ...item, assignedTo } : item
                    ),
                }));
            },

            // Match Plans
            addMatchPlan: (planData) => {
                const plan: MatchPlan = {
                    ...planData,
                    id: generateId(),
                    updatedAt: Date.now(),
                    seasonId: get().currentSeasonId || undefined,
                };
                set((state) => ({ matchPlans: [...state.matchPlans, plan] }));
                queueForSync('matchPlans', plan.id, 'create', plan);
            },

            deleteMatchPlan: (id) => {
                set((state) => ({
                    matchPlans: state.matchPlans.filter((p) => p.id !== id),
                }));
                queueForSync('matchPlans', id, 'delete', null);
            },

            updateMatchPlan: (id, updates) => {
                set((state) => ({
                    matchPlans: state.matchPlans.map((p) =>
                        p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
                    ),
                }));
                const plan = get().matchPlans.find(p => p.id === id);
                if (plan) {
                    queueForSync('matchPlans', id, 'update', { ...plan, ...updates });
                }
            },

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

            // Seasons
            addSeason: (name, fieldImageUrl = '') => {
                const season: Season = {
                    id: generateId(),
                    name,
                    fieldImageUrl,
                    teamId: get().currentTeamId || undefined,
                    createdAt: Date.now(),
                };
                set((state) => ({
                    seasons: [...state.seasons, season],
                    currentSeasonId: season.id, // Auto-switch to new season
                }));
            },

            updateSeason: (id, updates) => {
                set((state) => ({
                    seasons: state.seasons.map((s) =>
                        s.id === id ? { ...s, ...updates } : s
                    ),
                }));
            },

            deleteSeason: (id) => {
                const state = get();
                // Don't allow deleting the last season
                if (state.seasons.length <= 1) return;

                // Delete all data associated with this season
                set((s) => ({
                    seasons: s.seasons.filter((season) => season.id !== id),
                    tasks: s.tasks.filter((t) => t.seasonId !== id),
                    subTeams: s.subTeams.filter((t) => t.seasonId !== id),
                    scoutingReports: s.scoutingReports.filter((r) => r.seasonId !== id),
                    checklist: s.checklist.filter((c) => c.seasonId !== id),
                    matchPlans: s.matchPlans.filter((p) => p.seasonId !== id),
                    portfolioHistory: s.portfolioHistory.filter((p) => p.seasonId !== id),
                    // Switch to another season if this was the current one
                    currentSeasonId: s.currentSeasonId === id
                        ? s.seasons.find((season) => season.id !== id)?.id || null
                        : s.currentSeasonId,
                }));
            },

            setCurrentSeason: (id) => set({ currentSeasonId: id }),

            getCurrentSeason: () => {
                const state = get();
                return state.seasons.find((s) => s.id === state.currentSeasonId) || null;
            },

            // Data management
            initializeStore: async () => {
                // Load data from IndexedDB if available
                try {
                    const tasks = await db.tasks.toArray();
                    if (tasks.length > 0) {
                        set({
                            tasks: tasks.map(t => ({
                                id: t.id,
                                title: t.title,
                                description: t.description || '',
                                status: t.status as "Backlog" | "To Do" | "In Progress" | "Testing" | "Done",
                                type: t.type as "Feature" | "Bug",
                                assignedTo: t.assignedTo || '',
                                department: t.teamId || '',
                                tags: t.tags,
                                checklist: t.checklist,
                                timeline: Array.isArray(t.timeline) ? t.timeline.map((tl: any) => ({
                                    ...tl,
                                    type: tl.type as "comment" | "history"
                                })) : [],
                                createdAt: t.createdAt,
                                dueDate: t.dueDate,
                            })),
                        });
                    }

                    const matchPlans = await db.matchPlans.toArray();
                    if (matchPlans.length > 0) {
                        set({
                            matchPlans: matchPlans.map(p => ({
                                id: p.id,
                                title: (p as any).title || `Match ${p.matchNumber || '?'}`, // Fallback for backward compat
                                drawingData: p.drawingData,
                                notes: p.notes || '',
                                allianceTeam: p.allianceTeam || '',
                                partnerAutonomous: (p as any).partnerAutonomous || false,
                                partnerPark: (p as any).partnerPark || false,
                                updatedAt: p.updatedAt
                            })),
                        });
                    }
                } catch (err) {
                    console.warn('Failed to load from IndexedDB:', err);
                }
            },

            resetToDefaults: () => {
                set({
                    tasks: [],
                    subTeams: DEFAULT_SUBTEAMS,
                    scoutingReports: [],
                    checklist: DEFAULT_CHECKLIST_ITEMS,
                    matchPlans: [],
                    teamMembers: [],
                });
            },
        }),
        {
            name: 'falconforge-storage',
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
                geminiApiKey: state.geminiApiKey,
            }),
        }
    )
);

// Initialize theme on load
if (typeof window !== 'undefined') {
    const storedTheme = localStorage.getItem('falconforge-storage');
    if (storedTheme) {
        try {
            const { state } = JSON.parse(storedTheme);
            if (state?.theme === 'dark') {
                document.documentElement.classList.add('dark');
            }
        } catch (e) {
            // Ignore parse errors
        }
    }
}
