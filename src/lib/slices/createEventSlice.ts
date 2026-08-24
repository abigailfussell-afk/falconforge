import type { CompetitionEvent, EventMatch, MatchParticipant } from '../../types';
import { generateId, queueForSync } from '../offline-db';
import { canWriteToSeason } from '../season-rules';
import type { SliceCreator } from './types';

/**
 * Competition events, their matches, and who is in each match (D2).
 *
 * THREE COLLECTIONS RATHER THAN ONE NESTED TREE. An event holding its matches holding their
 * participants would be a single blob, and this project has one of those already — the
 * checklist — with the notes to prove what it costs: a blob has no per-record identity, so two
 * offline devices editing different matches at the same event produce two whole-event writes,
 * one of which wins. At a venue, on two phones, that is the normal case rather than the edge
 * one, and the thing being lost is a correction somebody made because a schedule changed.
 *
 * So each level is its own registry entity with its own id, and the offline queue merges them
 * the way it merges everything else.
 *
 * ORDERING IS LOAD-BEARING, exactly as it is for the season rollover. `event_matches` carries a
 * composite FK into `competition_events(id, team_id)` and `match_participants` into
 * `event_matches(id, team_id)`, so a child that reaches the server first is refused. The drain
 * pushes strictly in queue-timestamp order (B1) and `queueForSync` allocates its timestamp
 * BEFORE entering its Dexie transaction (B1, the second time it was fixed) — so queueing parent
 * before child here is what makes one drain enough.
 */
export interface EventSlice {
    competitionEvents: CompetitionEvent[];
    eventMatches: EventMatch[];
    matchParticipants: MatchParticipant[];

    /** Create an event in the CURRENT season. Returns its id, or null when refused. */
    addCompetitionEvent: (
        input: Omit<CompetitionEvent, 'id' | 'seasonId' | 'teamId' | 'createdAt'>,
    ) => string | null;
    updateCompetitionEvent: (id: string, updates: Partial<CompetitionEvent>) => void;
    /** Deletes the event; matches and participants cascade server-side and locally. */
    deleteCompetitionEvent: (id: string) => void;

    addEventMatch: (input: Omit<EventMatch, 'id' | 'teamId'>) => string | null;
    updateEventMatch: (id: string, updates: Partial<EventMatch>) => void;
    deleteEventMatch: (id: string) => void;

    addMatchParticipant: (input: Omit<MatchParticipant, 'id' | 'teamId'>) => string | null;
    updateMatchParticipant: (id: string, updates: Partial<MatchParticipant>) => void;
    deleteMatchParticipant: (id: string) => void;

    setCompetitionEvents: (items: CompetitionEvent[]) => void;
    setEventMatches: (items: EventMatch[]) => void;
    setMatchParticipants: (items: MatchParticipant[]) => void;
}

export const eventInitialState = {
    competitionEvents: [] as CompetitionEvent[],
    eventMatches: [] as EventMatch[],
    matchParticipants: [] as MatchParticipant[],
};

export const createEventSlice: SliceCreator<EventSlice> = (set, get) => ({
    ...eventInitialState,

    addCompetitionEvent: (input) => {
        const state = get();
        if (!state.currentSeasonId) {
            console.warn('[store] addCompetitionEvent ignored: no season is selected');
            return null;
        }
        // A prior season is read-only in the DATABASE. Refusing here is what stops the UI
        // queueing a write the server will refuse, which would show the event, retry five
        // times and dead-letter.
        if (!canWriteToSeason(state.seasons, state.currentSeasonId, 'addCompetitionEvent')) {
            return null;
        }
        if (!input.name?.trim()) {
            console.warn('[store] addCompetitionEvent ignored: a name is required');
            return null;
        }

        const event: CompetitionEvent = {
            ...input,
            name: input.name.trim(),
            id: generateId(),
            seasonId: state.currentSeasonId,
            teamId: state.currentTeamId ?? undefined,
            createdAt: Date.now(),
        };
        set((s) => ({ competitionEvents: [...s.competitionEvents, event] }));
        queueForSync('competition_events', event.id, 'create', event).catch(console.error);
        return event.id;
    },

    updateCompetitionEvent: (id, updates) => {
        const state = get();
        const existing = state.competitionEvents.find((e) => e.id === id);
        if (!existing) return;
        if (!canWriteToSeason(state.seasons, existing.seasonId, 'updateCompetitionEvent')) return;

        set((s) => ({
            competitionEvents: s.competitionEvents.map((e) =>
                e.id === id ? { ...e, ...updates } : e,
            ),
        }));
        const next = get().competitionEvents.find((e) => e.id === id);
        // `existing` is the row before this edit (SYNC-06).
        if (next) queueForSync('competition_events', id, 'update', next, existing).catch(console.error);
    },

    deleteCompetitionEvent: (id) => {
        const state = get();
        const existing = state.competitionEvents.find((e) => e.id === id);
        if (existing && !canWriteToSeason(state.seasons, existing.seasonId, 'deleteCompetitionEvent')) {
            return;
        }

        /*
         * THE LOCAL CASCADE MIRRORS THE SERVER'S, and is not a second delete path.
         *
         * `ON DELETE CASCADE` removes the matches and participants server-side; without doing
         * the same locally the device keeps orphans that the next full pull would remove
         * anyway — but "anyway" is minutes away at a venue, and in between the schedule screen
         * lists matches for an event that is gone. Only the EVENT is queued: queueing the
         * children too would send deletes for rows the server has already removed, each of
         * which succeeds vacuously and lengthens a drain that happens on a bad connection.
         */
        const matchIds = new Set(
            state.eventMatches.filter((m) => m.eventId === id).map((m) => m.id),
        );
        set((s) => ({
            competitionEvents: s.competitionEvents.filter((e) => e.id !== id),
            eventMatches: s.eventMatches.filter((m) => m.eventId !== id),
            matchParticipants: s.matchParticipants.filter((p) => !matchIds.has(p.matchId)),
        }));
        queueForSync('competition_events', id, 'delete', null).catch(console.error);
    },

    addEventMatch: (input) => {
        const state = get();
        const event = state.competitionEvents.find((e) => e.id === input.eventId);
        if (!event) {
            console.warn('[store] addEventMatch ignored: no such event');
            return null;
        }
        if (!canWriteToSeason(state.seasons, event.seasonId, 'addEventMatch')) return null;

        const match: EventMatch = {
            ...input,
            id: generateId(),
            teamId: state.currentTeamId ?? undefined,
        };
        set((s) => ({ eventMatches: [...s.eventMatches, match] }));
        queueForSync('event_matches', match.id, 'create', match).catch(console.error);
        return match.id;
    },

    updateEventMatch: (id, updates) => {
        const state = get();
        const existing = state.eventMatches.find((m) => m.id === id);
        if (!existing) return;
        const event = state.competitionEvents.find((e) => e.id === existing.eventId);
        if (event && !canWriteToSeason(state.seasons, event.seasonId, 'updateEventMatch')) return;

        set((s) => ({
            eventMatches: s.eventMatches.map((m) => (m.id === id ? { ...m, ...updates } : m)),
        }));
        const next = get().eventMatches.find((m) => m.id === id);
        if (next) queueForSync('event_matches', id, 'update', next, existing).catch(console.error);
    },

    deleteEventMatch: (id) => {
        const state = get();
        const existing = state.eventMatches.find((m) => m.id === id);
        if (existing) {
            const event = state.competitionEvents.find((e) => e.id === existing.eventId);
            if (event && !canWriteToSeason(state.seasons, event.seasonId, 'deleteEventMatch')) {
                return;
            }
        }
        set((s) => ({
            eventMatches: s.eventMatches.filter((m) => m.id !== id),
            matchParticipants: s.matchParticipants.filter((p) => p.matchId !== id),
        }));
        queueForSync('event_matches', id, 'delete', null).catch(console.error);
    },

    addMatchParticipant: (input) => {
        const state = get();
        const match = state.eventMatches.find((m) => m.id === input.matchId);
        if (!match) {
            console.warn('[store] addMatchParticipant ignored: no such match');
            return null;
        }
        const event = state.competitionEvents.find((e) => e.id === match.eventId);
        if (event && !canWriteToSeason(state.seasons, event.seasonId, 'addMatchParticipant')) {
            return null;
        }

        const participant: MatchParticipant = {
            ...input,
            id: generateId(),
            teamId: state.currentTeamId ?? undefined,
        };
        set((s) => ({ matchParticipants: [...s.matchParticipants, participant] }));
        queueForSync('match_participants', participant.id, 'create', participant).catch(
            console.error,
        );
        return participant.id;
    },

    updateMatchParticipant: (id, updates) => {
        // Read BEFORE the set, because the set is what makes it "before" (SYNC-06).
        const existing = get().matchParticipants.find((p) => p.id === id);
        set((s) => ({
            matchParticipants: s.matchParticipants.map((p) =>
                p.id === id ? { ...p, ...updates } : p,
            ),
        }));
        const next = get().matchParticipants.find((p) => p.id === id);
        if (next) queueForSync('match_participants', id, 'update', next, existing).catch(console.error);
    },

    deleteMatchParticipant: (id) => {
        set((s) => ({ matchParticipants: s.matchParticipants.filter((p) => p.id !== id) }));
        queueForSync('match_participants', id, 'delete', null).catch(console.error);
    },

    setCompetitionEvents: (competitionEvents) => set({ competitionEvents }),
    setEventMatches: (eventMatches) => set({ eventMatches }),
    setMatchParticipants: (matchParticipants) => set({ matchParticipants }),
});
