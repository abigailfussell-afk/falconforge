import type { ChecklistItem, ChecklistTemplate } from '../../types';
import { generateId, queueForSync } from '../offline-db';
import { canWriteToSeason } from '../season-rules';
import type { AppState } from '../store';
import type { SliceCreator, SliceSet } from './types';

export interface ChecklistSlice {
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

    // All of these act on the CURRENT season and do nothing without one.
    toggleChecklistItem: (id: string) => void;
    resetChecklist: () => void;
    addChecklistItem: (text: string) => void;
    deleteChecklistItem: (id: string) => void;
    updateChecklistAssignment: (id: string, assignedTo: string) => void;
    moveChecklistItem: (id: string, direction: 'up' | 'down') => void;
    /** Replace one season's checklist. The read path calls this per row it receives. */
    setChecklistForSeason: (seasonId: string, items: ChecklistItem[]) => void;

    /** Save the CURRENT season's checklist as a reusable template. Returns its id. */
    saveChecklistAsTemplate: (name: string) => string | null;
    deleteChecklistTemplate: (id: string) => void;
    /** Replace the template library. The read path calls this. */
    setChecklistTemplates: (templates: ChecklistTemplate[]) => void;
}

export const checklistInitialState = {
    checklistsBySeason: {} as Record<string, ChecklistItem[]>,
    checklistTemplates: [] as ChecklistTemplate[],
};

/**
 * A shared frozen empty array.
 *
 * `selectChecklist` is used as a Zustand selector, and returning a fresh `[]` on every call
 * would make the component re-render on every store change — the selector's result is
 * compared by reference.
 */
const EMPTY_CHECKLIST: ChecklistItem[] = [];

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
    set: SliceSet,
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
    }).catch(console.error);
}

export const createChecklistSlice: SliceCreator<ChecklistSlice> = (set, get) => ({
    ...checklistInitialState,

    // Every one of these is the same shape: describe the change, and let `updateChecklist`
    // decide which season it lands in and whether it can be queued. V1 spelled the season,
    // the record id and the queue call out six times over, and they had drifted.
    toggleChecklistItem: (id) => {
        updateChecklist(get(), set, (items) =>
            items.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)),
        );
    },

    resetChecklist: () => {
        updateChecklist(get(), set, (items) => items.map((item) => ({ ...item, checked: false })));
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

    // Server writes, not user edits: this is how a pull lands, so it must NOT queue anything
    // back to the server.
    setChecklistForSeason: (seasonId, items) =>
        set((state) => ({
            checklistsBySeason: { ...state.checklistsBySeason, [seasonId]: items },
        })),

    /*
     * Capture the current season's checklist as a reusable template.
     *
     * A template is a `checklists` row with `is_template = true`, which is exempt from
     * `checklists_one_per_season` -- so a team may keep several while still having exactly
     * one WORKING checklist per season.
     *
     * It carries a GENERATED id rather than the season-derived one working checklists use.
     * That convention exists so two offline devices editing the same season's list converge
     * on one row instead of racing to create two; a template is created once, deliberately,
     * by one person, so there is nothing to converge on -- and using the season id would
     * collide with the working checklist that already owns it.
     *
     * Items are stored unchecked. A template records what a team checks, never the state of
     * one particular match.
     *
     * NO `canWriteToSeason` GUARD HERE, AND THAT IS DELIBERATE. A template records which
     * season it was captured FROM, not which season it belongs to, and the `checklists`
     * write policies read `is_template OR season_is_open(...)` for exactly this reason:
     * looking back at the checklist a team spent a season refining is the single most likely
     * moment to want to save one. Sprint 4 learned this by shipping the opposite and
     * watching the server refuse the write. Do not "fix" this by adding the guard.
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
        }).catch(console.error);
        return template.id;
    },

    deleteChecklistTemplate: (id) => {
        set((state) => ({
            checklistTemplates: state.checklistTemplates.filter((t) => t.id !== id),
        }));
        queueForSync('checklists', id, 'delete', { id }).catch(console.error);
    },

    setChecklistTemplates: (checklistTemplates) => set({ checklistTemplates }),
});
