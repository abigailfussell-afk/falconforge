import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { indexedDBStorage } from './offline-db';
import { TaskSlice, createTaskSlice, taskInitialState } from './slices/createTaskSlice';
import { SubTeamSlice, createSubTeamSlice, subTeamInitialState } from './slices/createSubTeamSlice';
import { SeasonSlice, createSeasonSlice, seasonInitialState } from './slices/createSeasonSlice';
import { TeamSlice, createTeamSlice, teamInitialState } from './slices/createTeamSlice';
import { ScoutingSlice, createScoutingSlice, scoutingInitialState } from './slices/createScoutingSlice';
import { ChecklistSlice, createChecklistSlice, checklistInitialState } from './slices/createChecklistSlice';
import { MatchPlanSlice, createMatchPlanSlice, matchPlanInitialState } from './slices/createMatchPlanSlice';
import { MeetingSlice, createMeetingSlice, meetingInitialState } from './slices/createMeetingSlice';
import { GuardianSlice, createGuardianSlice, guardianInitialState } from './slices/createGuardianSlice';
import { EventSlice, createEventSlice, eventInitialState } from './slices/createEventSlice';
import type {
    Team, TeamMember, SubTeam, Season,
    Task, ScoutingReport, ChecklistItem, ChecklistTemplate, MatchPlan,
    Meeting, MeetingAttendance,
    ManagedProfile, GuardianConsent,
} from '../types';

/**
 * Main application store using Zustand.
 *
 * Data is persisted to IndexedDB for offline support; changes are queued for sync when
 * online. What is left in THIS file is only what belongs to the store as a whole — the
 * theme, the persist configuration and its migrations, and the reset. Every data domain
 * lives in `slices/`.
 *
 * The plan called this a "god file": 593 lines with three slices extracted and about six
 * domains still inline. The remaining six are out now (team/entitlement, scouting,
 * checklist, match plans), which matters beyond tidiness — Sprint 4's archived-season write
 * guards are per-domain, and a domain that lives in a slice carries its own guard next to
 * the action it protects rather than in the middle of a six-hundred-line object literal.
 *
 * ENTITY RENAME (2026-01-05):
 * - Team = Top-level FTC team organization
 * - TeamMember = Supabase users belonging to a Team (replaces Member)
 * - SubTeam = Working groups (Build, Programming, etc.) - renamed from Team
 */

// Re-export types from types.ts for convenience
// (consumers can import { ScoutingReport } from '../lib/store' or from '../types')
export type {
    Team, TeamMember, SubTeam, Season,
    Task, ScoutingReport, ChecklistItem, ChecklistTemplate, MatchPlan,
    Meeting, MeetingAttendance,
    ManagedProfile, GuardianConsent,
};

// Re-exported so the many existing `import { selectChecklist, TeamEntitlement } from './store'`
// call sites keep working — the split is an internal reorganisation, not an API change.
export { selectChecklist } from './slices/createChecklistSlice';
export type { TeamEntitlement } from './slices/createTeamSlice';

/**
 * Apply the persisted theme to the document, if there is a document.
 *
 * The guard is the point. This runs from `onRehydrateStorage`, which fires when zustand has
 * finished reading persisted state out of IndexedDB — and that is ASYNCHRONOUS, so it can land
 * at a moment nobody scheduled. Under Vitest that moment is sometimes after the test file's
 * jsdom environment has been torn down, and the callback then threw
 *
 *     ReferenceError: document is not defined
 *
 * as an UNHANDLED error rather than a failed assertion, which fails the whole run while every
 * test still reports as passing. It is a race against teardown, so it depends on how quickly
 * rehydration completes: green on a fast developer machine, red on a two-core CI runner.
 *
 * Found by the first CI run that ever covered this code — `ci.yml` did not trigger on sprint
 * branches until Sprint 7, so the six sprints of work merged before it had never been through a
 * GitHub runner at all.
 *
 * The fallback a few lines below the store already guards with `typeof window !== 'undefined'`
 * for exactly this reason; this callback simply did not.
 */
export function applyPersistedTheme(theme: string | undefined): void {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
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

export interface AppState extends
    TaskSlice,
    SubTeamSlice,
    SeasonSlice,
    TeamSlice,
    ScoutingSlice,
    ChecklistSlice,
    MatchPlanSlice,
    MeetingSlice,
    GuardianSlice,
    EventSlice {
    // UI state
    theme: 'light' | 'dark';
    isLoading: boolean;

    setTheme: (theme: 'light' | 'dark') => void;

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
 * Everything a sign-out must clear, assembled from the slices themselves.
 *
 * `resetToDefaults` used to spell out fourteen keys by hand. That is a list which has to be
 * edited every time a slice gains a field, and forgetting is not a cosmetic bug: on a shared
 * team laptop an un-reset collection is the previous user's data still on screen after
 * someone else signs in. Composing it from each slice's own initial state means a new field
 * is covered by construction.
 *
 * `theme` is deliberately absent — it is a device preference, not team data, and resetting it
 * would flip the app to light mode every time anyone signs out.
 */
const INITIAL_DATA_STATE = {
    ...taskInitialState,
    ...subTeamInitialState,
    ...seasonInitialState,
    ...teamInitialState,
    ...scoutingInitialState,
    ...checklistInitialState,
    ...matchPlanInitialState,
    ...meetingInitialState,
    ...guardianInitialState,
    ...eventInitialState,
    isLoading: false,
};

export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            ...createTaskSlice(set, get),
            ...createSubTeamSlice(set, get),
            ...createSeasonSlice(set, get),
            ...createTeamSlice(set, get),
            ...createScoutingSlice(set, get),
            ...createChecklistSlice(set, get),
            ...createMatchPlanSlice(set, get),
            ...createMeetingSlice(set, get),
            ...createGuardianSlice(set, get),
            ...createEventSlice(set, get),

            theme: 'dark',
            isLoading: false,

            setTheme: (theme) => {
                set({ theme });
                document.documentElement.classList.toggle('dark', theme === 'dark');
            },

            setIsLoading: (isLoading) => set({ isLoading }),

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

            // Empty, not seeded: a team's seasons, sub-teams and checklist are created
            // server-side by `create_team_as_admin` and arrive on the first pull.
            resetToDefaults: () => set({ ...INITIAL_DATA_STATE }),
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
                // The whole schedule and every attendance record, persisted like every other
                // collection -- a student opening the app in a car park with no signal has to
                // be able to read what time the meeting starts, and a coach has to be able to
                // take the roster at a venue that has none.
                meetings: state.meetings,
                meetingAttendance: state.meetingAttendance,
                seasons: state.seasons,
                currentSeasonId: state.currentSeasonId,
                // Persisted so a team that goes offline still knows its licence lapsed,
                // rather than reading the absence of an answer as permission.
                entitlement: state.entitlement,
                // Persisted because the whole point is to outlive the join: the student closes
                // the app and comes back the next evening to see whether they were approved.
                // Held in memory only, this would be "Unknown Team" again on the second visit.
                pendingTeamNames: state.pendingTeamNames,
                theme: state.theme,
            }),
            onRehydrateStorage: () => (state) => {
                // Apply theme as soon as persisted state is rehydrated from IndexedDB.
                applyPersistedTheme(state?.theme);
            },
        }
    )
);

/**
 * Has persisted state finished coming back from IndexedDB?
 *
 * WHY A ROUTE NEEDS TO KNOW
 *
 * Rehydration is asynchronous, so on a COLD LOAD of a deep link — `#/app/meetings/<uuid>`,
 * which is what a bookmark and a shared link are — there is a window in which the store is
 * genuinely empty and a lookup by id genuinely finds nothing. A route that renders "that
 * event is not on this device" from that is telling the user something false, and it does it
 * on exactly the path somebody followed deliberately.
 *
 * Found by the capture script, which screenshots at whatever moment it is ready rather than
 * when the app is: the 768px roster capture came out as the not-found state. In a browser the
 * window is short enough to read as a flicker, which is precisely why nobody had noticed it.
 *
 * `persist.hasHydrated()` is zustand's own answer rather than a timer — `AppShell` waits out a
 * flat 1000ms for the same class of problem, and a timer is either too short on a cold phone
 * or too long on a laptop.
 */
export function useStoreHydrated(): boolean {
    const [hydrated, setHydrated] = useState(() => useAppStore.persist.hasHydrated());

    useEffect(() => {
        if (hydrated) return;
        // Both callbacks: `onFinishHydration` fires for a hydration still in flight, and the
        // `hasHydrated` check above covers one that finished before this component mounted.
        const unsub = useAppStore.persist.onFinishHydration(() => setHydrated(true));
        if (useAppStore.persist.hasHydrated()) setHydrated(true);
        return unsub;
    }, [hydrated]);

    return hydrated;
}

// Theme is now applied via onRehydrateStorage callback (async from IndexedDB).
// As a fallback, we default to dark mode until rehydration completes to prevent
// a flash of light mode.
if (typeof window !== 'undefined') {
    document.documentElement.classList.add('dark');
}
