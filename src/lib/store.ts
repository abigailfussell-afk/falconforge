import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { db, generateId, queueForSync } from './offline-db';
import { isSupabaseConfigured } from './supabase';

/**
 * Main application store using Zustand
 * Data is persisted to IndexedDB for offline support
 * Changes are queued for sync when online
 */

// Types matching the existing app structure
export interface Task {
    id: string;
    title: string;
    description: string;
    status: 'Backlog' | 'To Do' | 'In Progress' | 'Validation' | 'Done';
    type: 'Feature' | 'Bug';
    assignedTo: string;
    department: string;
    tags: string[];
    checklist: { id: string; text: string; completed: boolean }[];
    timeline: { id: string; type: 'comment' | 'history'; authorId: string; content: string; timestamp: number }[];
    createdAt: number;
    dueDate?: number;
}

export interface Member {
    id: string;
    firstName: string;
    lastNameInitial: string;
}

export interface Team {
    id: string;
    name: string;
    memberIds: string[];
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
}

export interface ChecklistItem {
    id: string;
    text: string;
    checked: boolean;
    assignedTo?: string;
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
}

// Default data for new users/demo mode
const DEFAULT_MEMBERS: Member[] = [
    { id: 'm1', firstName: 'Abby', lastNameInitial: 'B' },
    { id: 'm2', firstName: 'Ben', lastNameInitial: 'C' },
    { id: 'm3', firstName: 'Charlie', lastNameInitial: 'D' },
    { id: 'm4', firstName: 'Dana', lastNameInitial: 'E' },
    { id: 'm5', firstName: 'Evan', lastNameInitial: 'F' },
];

const DEFAULT_TEAMS: Team[] = [
    { id: 't1', name: 'Programming', memberIds: ['m1'] },
    { id: 't2', name: 'Build', memberIds: ['m2'] },
    { id: 't3', name: 'Drive', memberIds: ['m3'] },
    { id: 't4', name: 'Scouting', memberIds: ['m5'] },
    { id: 't5', name: 'Outreach', memberIds: ['m4'] },
];

const DEFAULT_CHECKLIST: ChecklistItem[] = [
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
    // Organization context
    currentOrganizationId: string | null;
    isDemoMode: boolean;

    // Core data
    tasks: Task[];
    members: Member[];
    teams: Team[];
    scoutingReports: ScoutingReport[];
    checklist: ChecklistItem[];
    matchPlans: MatchPlan[];

    // UI state
    theme: 'light' | 'dark';

    // Actions
    setTheme: (theme: 'light' | 'dark') => void;

    // Task actions
    addTask: (task: Omit<Task, 'id' | 'createdAt' | 'timeline'>) => void;
    updateTask: (id: string, updates: Partial<Task>) => void;
    deleteTask: (id: string) => void;

    // Member actions
    addMember: (firstName: string, lastNameInitial: string) => void;
    removeMember: (id: string) => void;
    setMembers: (members: Member[]) => void;

    // Team actions
    addTeam: (name: string) => void;
    removeTeam: (id: string) => void;
    toggleMemberInTeam: (teamId: string, memberId: string) => void;
    setTeams: (teams: Team[]) => void;

    // Scouting actions
    addScoutingReport: (report: Omit<ScoutingReport, 'id'>) => void;

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

    // Data management
    initializeStore: () => Promise<void>;
    resetToDefaults: () => void;
}

export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            // Initial state
            currentOrganizationId: null,
            isDemoMode: !isSupabaseConfigured(),
            tasks: [],
            members: DEFAULT_MEMBERS,
            teams: DEFAULT_TEAMS,
            scoutingReports: [],
            checklist: DEFAULT_CHECKLIST,
            matchPlans: [],
            theme: 'light',

            // Theme
            setTheme: (theme) => {
                set({ theme });
                if (theme === 'dark') {
                    document.documentElement.classList.add('dark');
                } else {
                    document.documentElement.classList.remove('dark');
                }
            },

            // Tasks
            addTask: (taskData) => {
                const task: Task = {
                    ...taskData,
                    id: generateId(),
                    createdAt: Date.now(),
                    timeline: [{
                        id: generateId(),
                        type: 'history',
                        authorId: 'System',
                        content: 'Task created',
                        timestamp: Date.now(),
                    }],
                };

                set((state) => ({ tasks: [...state.tasks, task] }));

                // Queue for sync if online mode
                if (!get().isDemoMode) {
                    queueForSync('tasks', task.id, 'create', task);
                }
            },

            updateTask: (id, updates) => {
                set((state) => ({
                    tasks: state.tasks.map((t) =>
                        t.id === id ? { ...t, ...updates } : t
                    ),
                }));

                if (!get().isDemoMode) {
                    const task = get().tasks.find(t => t.id === id);
                    if (task) {
                        queueForSync('tasks', id, 'update', { ...task, ...updates });
                    }
                }
            },

            deleteTask: (id) => {
                set((state) => ({
                    tasks: state.tasks.filter((t) => t.id !== id),
                }));

                if (!get().isDemoMode) {
                    queueForSync('tasks', id, 'delete', null);
                }
            },

            // Members
            addMember: (firstName, lastNameInitial) => {
                const member: Member = {
                    id: generateId(),
                    firstName,
                    lastNameInitial,
                };
                set((state) => ({ members: [...state.members, member] }));
            },

            removeMember: (id) => {
                set((state) => ({
                    members: state.members.filter((m) => m.id !== id),
                    teams: state.teams.map((t) => ({
                        ...t,
                        memberIds: t.memberIds.filter((mid) => mid !== id),
                    })),
                }));
            },

            setMembers: (members) => set({ members }),

            // Teams
            addTeam: (name) => {
                const team: Team = {
                    id: generateId(),
                    name,
                    memberIds: [],
                };
                set((state) => ({ teams: [...state.teams, team] }));
            },

            removeTeam: (id) => {
                set((state) => ({
                    teams: state.teams.filter((t) => t.id !== id),
                }));
            },

            toggleMemberInTeam: (teamId, memberId) => {
                set((state) => ({
                    teams: state.teams.map((t) => {
                        if (t.id !== teamId) return t;
                        const memberIds = t.memberIds.includes(memberId)
                            ? t.memberIds.filter((id) => id !== memberId)
                            : [...t.memberIds, memberId];
                        return { ...t, memberIds };
                    }),
                }));
            },

            setTeams: (teams) => set({ teams }),

            // Scouting
            addScoutingReport: (reportData) => {
                const report: ScoutingReport = {
                    ...reportData,
                    id: generateId(),
                };
                set((state) => ({
                    scoutingReports: [...state.scoutingReports, report],
                }));
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
                };
                set((state) => ({ matchPlans: [...state.matchPlans, plan] }));

                if (!get().isDemoMode) {
                    queueForSync('matchPlans', plan.id, 'create', plan);
                }
            },

            deleteMatchPlan: (id) => {
                set((state) => ({
                    matchPlans: state.matchPlans.filter((p) => p.id !== id),
                }));

                if (!get().isDemoMode) {
                    queueForSync('matchPlans', id, 'delete', null);
                }
            },

            updateMatchPlan: (id, updates) => {
                set((state) => ({
                    matchPlans: state.matchPlans.map((p) =>
                        p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
                    ),
                }));

                if (!get().isDemoMode) {
                    const plan = get().matchPlans.find(p => p.id === id);
                    if (plan) {
                        queueForSync('matchPlans', id, 'update', { ...plan, ...updates });
                    }
                }
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
                                status: t.status as "Backlog" | "To Do" | "In Progress" | "Validation" | "Done",
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
                    members: DEFAULT_MEMBERS,
                    teams: DEFAULT_TEAMS,
                    scoutingReports: [],
                    checklist: DEFAULT_CHECKLIST,
                    matchPlans: [],
                });
            },
        }),
        {
            name: 'ftc-team-manager-storage',
            partialize: (state) => ({
                tasks: state.tasks,
                members: state.members,
                teams: state.teams,
                scoutingReports: state.scoutingReports,
                checklist: state.checklist,
                matchPlans: state.matchPlans,
                theme: state.theme,
            }),
        }
    )
);

// Initialize theme on load
if (typeof window !== 'undefined') {
    const storedTheme = localStorage.getItem('ftc-team-manager-storage');
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
