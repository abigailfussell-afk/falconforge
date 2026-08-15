import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { generateId, queueForSync, indexedDBStorage } from './offline-db';
import { TaskSlice, createTaskSlice } from './slices/createTaskSlice';
import { SubTeamSlice, createSubTeamSlice } from './slices/createSubTeamSlice';
import { SeasonSlice, createSeasonSlice } from './slices/createSeasonSlice';
import { canWriteToSeason } from './season-rules';
import type {
    Team, TeamMember, SubTeam, Season,
    Task, ScoutingReport, ChecklistItem, ChecklistTemplate, MatchPlan,
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
    Task, ScoutingReport, ChecklistItem, ChecklistTemplate, MatchPlan,
};

/**
 * What `team_entitlement` says about the current team.
 *
 * Read-only on the client — the view is the server's answer to "may this team write", and
 * every write policy consults `team_can_write` independently. This copy exists so the UI can
 * stop OFFERING an action the server would refuse, which is the narrow half of the
 * enforcement work; the full read-only banner and lock screens are Sprint 6.
 *
 * Persisted, deliberately. A team that has just gone offline should still know its licence
 * lapsed rather than treating the absence of an answer as permission.
 */
export interface TeamEntitlement {
    teamId: string;
    /** `active` — may write. `read_only` — expired, revoked, or never licensed. */
    status: 'active' | 'read_only';
    seatsTotal: number | null;
    seatsUnlimited: boolean;
    seatsUsed: number;
    /** ISO timestamp, or null for open-ended. */
    validUntil: string | null;
    /** ISO timestamp of when cover last ran out, for a read-only team's message. */
    lapsedAt: string | null;
}

/*
 * NO SEED DATA LIVES HERE ANY MORE.
 *
 * There used to be a `DEFAULT_SEASON`, a `DEFAULT_CHECKLIST_ITEMS` and (in constants.ts) a
 * `DEFAULT_SUBTEAMS`, all with hardcoded uuids so every device would agree on them. Every
 * TEAM agreed on them too, which is the bug: the second team to push sub-team
 * `657c8820-…` upserts onto the first team's row, RLS refuses it, and their sub-teams
 * dead-letter permanently. A seeded SEASON is worse under the V2 schema — `season_id` is
 * NOT NULL with a composite foreign key, so every task created under a season that exists
 * only in local state is unpushable too.
 *
 * `create_team_as_admin` now creates the first season, its sub-teams and its checklist
 * server-side, with per-team uuids, in the transaction that creates the team. They arrive
 * on the first pull like any other row.
 */

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
    /**
     * Checklists keyed by season id — one list per season (C6).
     *
     * V1 held a single `checklist` array for the whole team, so a new season inherited the
     * previous one's items and the "fresh start" was not one. Read it with
     * {@link selectChecklist} rather than reaching in: nothing outside this module should
     * have to remember which season is current.
     */
    checklistsBySeason: Record<string, ChecklistItem[]>;
    /**
     * Saved checklists a new season can start from — `checklists` rows with
     * `is_template = true`, which the working-checklist uniqueness index exempts.
     */
    checklistTemplates: ChecklistTemplate[];
    matchPlans: MatchPlan[];
    seasons: Season[];
    currentSeasonId: string | null;
    /** The current team's licensing state, or null if it has not been read yet. */
    entitlement: TeamEntitlement | null;

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

    // Scouting actions. Like tasks, the season comes from the store rather than the caller.
    addScoutingReport: (report: Omit<ScoutingReport, 'id' | 'seasonId'>) => void;
    updateScoutingReport: (id: string, updates: Partial<ScoutingReport>) => void;
    deleteScoutingReport: (id: string) => void;
    setScoutingReports: (reports: ScoutingReport[]) => void;

    // Checklist actions. All of them act on the CURRENT season and do nothing without one.
    toggleChecklistItem: (id: string) => void;
    resetChecklist: () => void;
    addChecklistItem: (text: string) => void;
    deleteChecklistItem: (id: string) => void;
    updateChecklistAssignment: (id: string, assignedTo: string) => void;
    moveChecklistItem: (id: string, direction: 'up' | 'down') => void;
    /** Replace one season's checklist. The read path calls this per row it receives. */
    setChecklistForSeason: (seasonId: string, items: ChecklistItem[]) => void;

    // Checklist templates — the team-level library a new season can start from.
    /** Save the CURRENT season's checklist as a reusable template. Returns its id. */
    saveChecklistAsTemplate: (name: string) => string | null;
    deleteChecklistTemplate: (id: string) => void;
    /** Replace the template library. The read path calls this. */
    setChecklistTemplates: (templates: ChecklistTemplate[]) => void;

    /** Record the current team's licensing state. Server writes only. */
    setEntitlement: (entitlement: TeamEntitlement | null) => void;

    // Match Plan actions
    addMatchPlan: (plan: Omit<MatchPlan, 'id' | 'updatedAt' | 'seasonId'>) => void;
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

/**
 * The current season's checklist.
 *
 * Use this rather than reading `checklistsBySeason` directly, so that "which season am I
 * looking at" is answered in exactly one place.
 */
export function selectChecklist(state: AppState): ChecklistItem[] {
    return (state.currentSeasonId && state.checklistsBySeason[state.currentSeasonId]) || EMPTY_CHECKLIST;
}

/**
 * A shared frozen empty array.
 *
 * `selectChecklist` is used as a Zustand selector, and returning a fresh `[]` on every call
 * would make the component re-render on every store change — the selector's result is
 * compared by reference.
 */
const EMPTY_CHECKLIST: ChecklistItem[] = [];

/**
 * Apply a change to the current season's checklist and queue the result.
 *
 * WHY THE RECORD ID IS THE SEASON ID
 *
 * Checklists are blob-synced: the whole item array is one row, so there is no per-record
 * identity to merge on and two devices editing offline must agree on the row id without
 * being able to talk to each other. Deriving it from the season is what makes their upserts
 * converge on one row rather than racing to create two, and `checklists_one_per_season` in
 * the schema is the other half of that promise.
 *
 * V1 used the TEAM id, which is the same trick one level too high: it gave every season the
 * same checklist (C6). It also wrote `seasonId || null` into a NOT NULL column, so a change
 * made with no season selected queued a push that could never succeed, retried five times
 * and parked in the dead-letter store. Now, with nowhere to put a change, nothing is
 * changed and nothing is queued.
 */
function updateChecklist(
    state: AppState,
    set: (partial: Partial<AppState>) => void,
    change: (items: ChecklistItem[]) => ChecklistItem[],
): void {
    const seasonId = state.currentSeasonId;
    if (!seasonId) return;
    // A prior season's checklist is history, and `season_is_open` refuses the upsert. The
    // ticks would appear, never sync, and dead-letter (Sprint 4).
    if (!canWriteToSeason(state.seasons, seasonId, 'updateChecklist')) return;

    const items = change(state.checklistsBySeason[seasonId] || []);
    set({ checklistsBySeason: { ...state.checklistsBySeason, [seasonId]: items } });

    if (!state.currentTeamId) return;
    queueForSync('checklists', seasonId, 'update', {
        items,
        teamId: state.currentTeamId,
        seasonId,
    });
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
            checklistsBySeason: {},
            checklistTemplates: [],
            matchPlans: [],
            entitlement: null,
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
                if (!state.currentSeasonId) {
                    console.warn('[store] addScoutingReport ignored: no season is selected');
                    return;
                }
                if (!canWriteToSeason(state.seasons, state.currentSeasonId, 'addScoutingReport')) return;
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
                    seasonId: state.currentSeasonId,
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
                const state = get();
                const existing = state.scoutingReports.find(r => r.id === id);
                if (existing && !canWriteToSeason(state.seasons, existing.seasonId, 'updateScoutingReport')) return;

                set((s) => ({
                    scoutingReports: s.scoutingReports.map((r) =>
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
                const state = get();
                const existing = state.scoutingReports.find(r => r.id === id);
                if (existing && !canWriteToSeason(state.seasons, existing.seasonId, 'deleteScoutingReport')) return;

                set((s) => ({
                    scoutingReports: s.scoutingReports.filter((r) => r.id !== id),
                }));
                queueForSync('scouting_reports', id, 'delete', null);
            },

            setScoutingReports: (scoutingReports) => set({ scoutingReports }),

            // Checklist. Every one of these is the same shape: describe the change, let
            // `updateChecklist` decide which season it lands in and whether it can be
            // queued. V1 spelled the season, the record id and the queue call out six
            // times over, and they had drifted.
            toggleChecklistItem: (id) => {
                updateChecklist(get(), set, (items) =>
                    items.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)),
                );
            },

            resetChecklist: () => {
                updateChecklist(get(), set, (items) =>
                    items.map((item) => ({ ...item, checked: false })),
                );
            },

            addChecklistItem: (text) => {
                updateChecklist(get(), set, (items) => [
                    ...items,
                    { id: generateId(), text, checked: false },
                ]);
            },

            deleteChecklistItem: (id) => {
                updateChecklist(get(), set, (items) => items.filter((item) => item.id !== id));
            },

            updateChecklistAssignment: (id, assignedTo) => {
                updateChecklist(get(), set, (items) =>
                    items.map((item) => (item.id === id ? { ...item, assignedTo } : item)),
                );
            },

            moveChecklistItem: (id, direction) => {
                updateChecklist(get(), set, (items) => {
                    const index = items.findIndex((item) => item.id === id);
                    if (index === -1) return items;
                    const target = direction === 'up' ? index - 1 : index + 1;
                    if (target < 0 || target >= items.length) return items;

                    const next = [...items];
                    [next[index], next[target]] = [next[target], next[index]];
                    return next;
                });
            },

            // Server writes, not user edits: this is how a pull lands, so it must NOT queue
            // anything back to the server.
            setChecklistForSeason: (seasonId, items) =>
                set((state) => ({
                    checklistsBySeason: { ...state.checklistsBySeason, [seasonId]: items },
                })),

            /*
             * Capture the current season's checklist as a reusable template.
             *
             * A template is a `checklists` row with `is_template = true`, which is exempt
             * from `checklists_one_per_season` -- so a team may keep several while still
             * having exactly one WORKING checklist per season.
             *
             * It carries a GENERATED id rather than the season-derived one working
             * checklists use. That convention exists so two offline devices editing the same
             * season's list converge on one row instead of racing to create two; a template
             * is created once, deliberately, by one person, so there is nothing to converge
             * on -- and using the season id would collide with the working checklist that
             * already owns it.
             *
             * Items are stored unchecked. A template records what a team checks, never the
             * state of one particular match.
             */
            saveChecklistAsTemplate: (name) => {
                const state = get();
                const trimmed = name.trim();
                if (!trimmed) {
                    console.warn('[store] saveChecklistAsTemplate ignored: a name is required');
                    return null;
                }
                if (!state.currentTeamId || !state.currentSeasonId) {
                    console.warn('[store] saveChecklistAsTemplate ignored: no team or season');
                    return null;
                }

                const template: ChecklistTemplate = {
                    id: generateId(),
                    name: trimmed,
                    seasonId: state.currentSeasonId,
                    items: selectChecklist(state).map((item) => ({
                        id: generateId(),
                        text: item.text,
                        checked: false,
                    })),
                };

                set((s) => ({ checklistTemplates: [...s.checklistTemplates, template] }));
                queueForSync('checklists', template.id, 'create', {
                    ...template,
                    teamId: state.currentTeamId,
                    isTemplate: true,
                });
                return template.id;
            },

            deleteChecklistTemplate: (id) => {
                set((state) => ({
                    checklistTemplates: state.checklistTemplates.filter((t) => t.id !== id),
                }));
                queueForSync('checklists', id, 'delete', { id });
            },

            setChecklistTemplates: (checklistTemplates) => set({ checklistTemplates }),

            setEntitlement: (entitlement) => set({ entitlement }),

            // Match Plans
            addMatchPlan: (planData) => {
                const state = get();
                if (!state.currentSeasonId) {
                    console.warn('[store] addMatchPlan ignored: no season is selected');
                    return;
                }
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
                });
            },

            deleteMatchPlan: (id) => {
                const state = get();
                const existing = state.matchPlans.find((p) => p.id === id);
                if (existing && !canWriteToSeason(state.seasons, existing.seasonId, 'deleteMatchPlan')) return;

                set((s) => ({
                    matchPlans: s.matchPlans.filter((p) => p.id !== id),
                }));
                queueForSync('match_plans', id, 'delete', null);
            },

            updateMatchPlan: (id, updates) => {
                const current = get();
                const existing = current.matchPlans.find((p) => p.id === id);
                if (existing && !canWriteToSeason(current.seasons, existing.seasonId, 'updateMatchPlan')) return;

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
                    checklistsBySeason: {},
                    checklistTemplates: [],
                    matchPlans: [],
                    teamMembers: [],
                    entitlement: null,
                    isLoading: false,

                    // Reset slices to initial values. Empty, not seeded: a team's seasons,
                    // sub-teams and checklist are created server-side by
                    // `create_team_as_admin` and arrive on the first pull.
                    tasks: [],
                    subTeams: [],
                    seasons: [],
                    currentSeasonId: null,
                });
            },
        }),
        {
            name: 'falconforge-storage',
            storage: createJSONStorage(() => indexedDBStorage),
            /**
             * v1 -> v2: `checklist` (one array per team) becomes `checklistsBySeason`.
             *
             * Without this, everyone with the app already installed loses the pre-match
             * checklist they have been maintaining — persisted state is read back as an
             * object with a key the store no longer has, and the new key is simply absent.
             * The old array belonged to whichever season was current when it was written,
             * which is exactly where it is put back.
             *
             * v2 -> v3: every persisted season gains `isArchived: false`.
             *
             * `Season.isArchived` is required on the type, mirroring `NOT NULL` in the
             * schema — but a season persisted before Sprint 4 has no such property, and a
             * type is not a runtime guarantee about data read back off disk. Without this,
             * `season.isArchived` is `undefined` on every installed copy of the app until
             * the first pull replaces the collection, and the type says otherwise. Backfill
             * to `false`: nothing was archived before archival existed.
             */
            version: 3,
            migrate: (persisted: any, version: number) => {
                if (!persisted) return persisted;

                let state = persisted;

                if (version < 2) {
                    const { checklist, currentSeasonId, ...rest } = state;
                    state = {
                        ...rest,
                        currentSeasonId,
                        checklistsBySeason:
                            currentSeasonId && Array.isArray(checklist)
                                ? { [currentSeasonId]: checklist }
                                : {},
                    };
                }

                if (version < 3) {
                    state = {
                        ...state,
                        seasons: Array.isArray(state.seasons)
                            ? state.seasons.map((s: any) => ({
                                gameTitle: '',
                                ...s,
                                isArchived: s?.isArchived ?? false,
                            }))
                            : state.seasons,
                        checklistTemplates: state.checklistTemplates ?? [],
                    };
                }

                return state;
            },
            partialize: (state) => ({
                currentTeamId: state.currentTeamId,
                teams: state.teams,
                teamMembers: state.teamMembers,
                tasks: state.tasks,
                subTeams: state.subTeams,
                scoutingReports: state.scoutingReports,
                checklistsBySeason: state.checklistsBySeason,
                checklistTemplates: state.checklistTemplates,
                matchPlans: state.matchPlans,
                seasons: state.seasons,
                currentSeasonId: state.currentSeasonId,
                // Persisted so a team that goes offline still knows its licence lapsed,
                // rather than reading the absence of an answer as permission.
                entitlement: state.entitlement,
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
