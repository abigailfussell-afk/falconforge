/**
 * Writing a confirmed schedule (D2), and the two rules that make it safe to press twice.
 *
 * The parser has its own file. This is about what happens AFTER the coach has looked at the
 * preview and pressed Import — the half D2 calls out as the one that must never happen
 * silently, and the half where the ordering rules live.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/lib/store';
import { db } from '@/lib/offline-db';
import { importSchedule } from '@/lib/event-import';
import { parseSchedule } from '@/lib/schedule-parse';
import type { Season } from '@/types';

const TEAM = 'team-1';
const SEASON = 'season-1';

const season = (over: Partial<Season> = {}): Season => ({
    id: SEASON,
    name: '2026-2027 Season',
    gameTitle: 'DECODE',
    fieldImageData: '',
    teamId: TEAM,
    isArchived: false,
    createdAt: 1000,
    ...over,
});

const REAL_PASTE = [
    'Qualification 1 Sat 2/21 - 11:42 AM 22857 Mechanical Mustangs 8424 Cyber Eagles 15654 Nanoknights 25756 Nano Ninjas 108 11',
    'Qualification 2 Sat 2/21 - 11:55 AM 111 Alpha 222 Beta 333 Gamma 444 Delta',
].join('\n');

beforeEach(async () => {
    await db.syncQueue.clear();
    useAppStore.setState({
        currentTeamId: TEAM,
        currentSeasonId: SEASON,
        seasons: [season()],
        competitionEvents: [],
        eventMatches: [],
        matchParticipants: [],
    });
});

const runImport = (text = REAL_PASTE, eventName = 'State Championship') =>
    importSchedule(useAppStore.getState(), {
        newEvent: { name: eventName },
        matches: parseSchedule(text, 2).matches,
    });

describe('importing a confirmed schedule', () => {
    it('creates the event, its matches and every participant', () => {
        const result = runImport();
        const store = useAppStore.getState();

        expect(result.matchesCreated).toBe(2);
        expect(result.participantsCreated).toBe(8);
        expect(store.competitionEvents).toHaveLength(1);
        expect(store.eventMatches).toHaveLength(2);
        expect(store.matchParticipants).toHaveLength(8);
    });

    it('keeps red and blue, and the stations, as the schedule had them', () => {
        runImport();
        const store = useAppStore.getState();
        const match = store.eventMatches.find((m) => m.matchNumber === 1)!;
        const people = store.matchParticipants
            .filter((p) => p.matchId === match.id)
            .sort((a, b) => (a.alliance === 'red' ? 0 : 1) - (b.alliance === 'red' ? 0 : 1) || a.station - b.station);

        expect(people.map((p) => `${p.alliance}${p.station}:${p.teamNumber}`)).toEqual([
            'red1:22857',
            'red2:8424',
            'blue1:15654',
            'blue2:25756',
        ]);
    });

    /*
     * THE TIME IS KEPT AS TEXT, NOT PARSED. `Sat 2/21 - 11:42 AM` has no year and no timezone,
     * and guessing either is how `docs/failure-modes.md` §10 happens — six defects from times
     * computed off the wrong clock or from wall-clock parts. The schedule's own words survive
     * in `notes`, so nothing is lost and nothing is invented.
     */
    it('keeps the schedule time as words rather than inventing a timestamp', () => {
        runImport();
        const match = useAppStore.getState().eventMatches.find((m) => m.matchNumber === 1)!;

        expect(match.scheduledAt).toBeUndefined();
        expect(match.notes).toBe('Sat 2/21 - 11:42 AM');
    });

    /*
     * A SECOND PASTE IS NOT AN ERROR — it is what a coach does when the schedule changes, which
     * D2 calls routine. Re-importing must not double every match. Without this, a coach who
     * pastes twice at a venue gets sixty duplicate rows and no way to tell which is which.
     */
    it('a second paste of the same schedule adds nothing', () => {
        const first = runImport();
        const second = importSchedule(useAppStore.getState(), {
            eventId: first.eventId!,
            matches: parseSchedule(REAL_PASTE, 2).matches,
        });

        expect(second.matchesCreated).toBe(0);
        expect(second.duplicatesSkipped).toBe(2);
        expect(useAppStore.getState().eventMatches).toHaveLength(2);
    });

    it('a second paste with a new match adds only the new one', () => {
        const first = runImport();
        const withExtra =
            REAL_PASTE +
            '\nQualification 3 Sat 2/21 - 12:08 PM 999 Echo 888 Foxtrot 777 Golf 666 Hotel';

        const second = importSchedule(useAppStore.getState(), {
            eventId: first.eventId!,
            matches: parseSchedule(withExtra, 2).matches,
        });

        expect(second.matchesCreated).toBe(1);
        expect(second.duplicatesSkipped).toBe(2);
        expect(useAppStore.getState().eventMatches).toHaveLength(3);
    });

    /*
     * (phase, number) is the natural key WITHIN an event, so the same number in two phases is
     * two matches. A playoff 1 and a qualification 1 are different matches, and treating the
     * number alone as the key would silently drop one of them.
     */
    it('the same number in another phase is a different match', () => {
        const first = runImport();
        const playoff =
            'Playoff 1 Sun 2/22 - 2:00 PM 22857 Mechanical Mustangs 8424 Cyber Eagles 15654 Nanoknights 25756 Nano Ninjas';

        const second = importSchedule(useAppStore.getState(), {
            eventId: first.eventId!,
            matches: parseSchedule(playoff, 2).matches,
        });

        expect(second.matchesCreated).toBe(1);
        expect(useAppStore.getState().eventMatches).toHaveLength(3);
    });

    it('carries a surrogate through, rather than flattening it', () => {
        const line =
            'Qualification 9 Sat 2/21 - 1:00 PM 22857 Mechanical Mustangs 8424 *Cyber Eagles 15654 Nanoknights 25756 Nano Ninjas';
        importSchedule(useAppStore.getState(), {
            newEvent: { name: 'Surrogate test' },
            matches: parseSchedule(line, 2).matches,
        });

        const surrogate = useAppStore.getState().matchParticipants.find((p) => p.teamNumber === '8424')!;
        expect(surrogate.isSurrogate).toBe(true);
    });
});

describe('what the import queues, and in what order', () => {
    /*
     * ORDERING IS LOAD-BEARING AND HAS BITTEN THIS PROJECT TWICE (B1, fixed twice).
     *
     * `event_matches` carries a composite FK into `competition_events(id, team_id)` and
     * `match_participants` into `event_matches(id, team_id)`, so a child that reaches the
     * server before its parent is refused, retried five times and dead-lettered. The drain
     * pushes strictly by queue timestamp, so the order things are QUEUED in is the order they
     * arrive in — which makes this assertion the one that keeps an import working offline.
     */
    it('queues the event, then its matches, then their participants', async () => {
        runImport();

        const queued = await db.syncQueue.orderBy('timestamp').toArray();
        const tables = queued.map((q) => q.tableName);

        const firstEvent = tables.indexOf('competition_events');
        const firstMatch = tables.indexOf('event_matches');
        const firstParticipant = tables.indexOf('match_participants');

        expect(firstEvent).toBeGreaterThanOrEqual(0);
        expect(firstMatch).toBeGreaterThan(firstEvent);
        expect(firstParticipant).toBeGreaterThan(firstMatch);

        // ...and every participant follows the match it belongs to, not just the first one.
        const lastMatch = tables.lastIndexOf('event_matches');
        const lastParticipantOfFirstMatch = tables.indexOf('match_participants');
        expect(lastMatch).toBeLessThan(tables.length);
        expect(lastParticipantOfFirstMatch).toBeGreaterThan(firstMatch);
    });
});

describe('what it refuses', () => {
    /*
     * A prior season is read-only in the DATABASE. Refusing here is what stops the UI queueing
     * an import the server will refuse — which would show sixty matches, retry each five times,
     * and dead-letter the lot.
     */
    it('writes nothing to an archived season', () => {
        useAppStore.setState({ seasons: [season({ isArchived: true })] });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = runImport();

        expect(result.eventId).toBeNull();
        expect(result.matchesCreated).toBe(0);
        expect(useAppStore.getState().competitionEvents).toEqual([]);
        warn.mockRestore();
    });

    it('does nothing without an event name or an existing event', () => {
        const result = importSchedule(useAppStore.getState(), {
            newEvent: { name: '   ' },
            matches: parseSchedule(REAL_PASTE, 2).matches,
        });

        expect(result.eventId).toBeNull();
        expect(useAppStore.getState().eventMatches).toEqual([]);
    });

    /*
     * THE CONTROL FOR THE WHOLE FILE. Three tests asserting "nothing was written" are all
     * satisfied by an import that never writes anything, which would be a worse bug than the
     * one they guard against.
     */
    it('an empty parse writes the event and no matches — not an error', () => {
        const result = importSchedule(useAppStore.getState(), {
            newEvent: { name: 'Empty' },
            matches: [],
        });

        expect(result.eventId).not.toBeNull();
        expect(result.matchesCreated).toBe(0);
        expect(useAppStore.getState().competitionEvents).toHaveLength(1);
    });
});
