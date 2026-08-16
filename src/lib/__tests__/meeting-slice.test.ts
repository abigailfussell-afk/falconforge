/**
 * Sprint 8 — the schedule at the store level.
 *
 * The server half is `src/test/db/meetings.rls.db.test.ts` and `meetings-checkin.db.test.ts`,
 * against real Postgres. This file pins the client's half: what gets queued, in what order,
 * and — the two that would be silent failures — that a series never shares a code, and that
 * an edit never rewrites one that has already been printed on a wall.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { db } from '@/lib/offline-db';
import { checkinWindow } from '@/lib/meetings';
import type { Season, Meeting } from '@/types';

const TEAM = 'team-1';
const S1 = 'season-1';
const USER = 'user-1';
const MEMBER = 'member-1';

const season = (over: Partial<Season> = {}): Season => ({
    id: S1,
    name: '2026-2027 Season',
    gameTitle: '',
    fieldImageData: '',
    teamId: TEAM,
    isArchived: false,
    createdAt: 1000,
    ...over,
});

/** The fields `addMeeting` does not derive for itself. */
const draft = (over: Partial<Meeting> = {}) => ({
    title: 'Build session — chassis rebuild',
    description: '',
    location: 'Room 214',
    eventType: 'build' as const,
    attendanceRequired: true,
    startsAt: new Date(2026, 7, 17, 18, 0).getTime(),
    endsAt: new Date(2026, 7, 17, 20, 30).getTime(),
    ...over,
});

/** Everything the queue holds, oldest first — the order a drain would push it in (B1). */
async function queued() {
    await settle();
    const items = await db.syncQueue.orderBy('timestamp').toArray();
    return items.map((i) => ({ table: i.tableName, id: i.recordId, op: i.operation, data: i.data }));
}

/**
 * Let the fire-and-forget queue writes land.
 *
 * Store actions call `queueForSync(...)` without awaiting it — deliberately, so the UI never
 * waits on IndexedDB — which means the Dexie writes are still in flight when the action
 * returns. Anything that reads OR CLEARS the queue has to settle first: the first draft of
 * this file cleared it in `beforeEach` without settling, so five creates from the setup
 * landed AFTER the clear and every assertion about queue length in the file was counting
 * them. It failed loudly, which is the good version of that mistake.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** Empty the queue, once everything already asked for has actually reached it. */
async function resetQueue() {
    await settle();
    await db.syncQueue.clear();
}

const meetings = () => useAppStore.getState().meetings;

beforeEach(async () => {
    await resetQueue();
    useAppStore.setState({
        currentTeamId: TEAM,
        currentSeasonId: S1,
        currentUserId: USER,
        seasons: [season()],
        teamMembers: [
            {
                id: MEMBER,
                teamId: TEAM,
                userId: USER,
                role: 'coach',
                status: 'approved',
                seatAssigned: true,
                fullName: 'Coach Whitlock',
                email: 'coach@example.com',
                avatarUrl: null,
                joinedAt: 0,
            },
        ],
        meetings: [],
        meetingAttendance: [],
    });
});

describe('creating an event', () => {
    it('queues one meeting with a four-digit code', async () => {
        const [id] = useAppStore.getState().addMeeting(draft());

        expect(meetings()).toHaveLength(1);
        expect(meetings()[0].publicCode).toMatch(/^\d{4}$/);
        expect(meetings()[0].seasonId).toBe(S1);
        expect(meetings()[0].createdBy).toBe(MEMBER);

        const q = await queued();
        expect(q).toHaveLength(1);
        expect(q[0]).toMatchObject({ table: 'meetings', id, op: 'create' });
        expect((q[0].data as { teamId: string }).teamId).toBe(TEAM);
    });

    it('gives a deadline no code and no attendance requirement', async () => {
        // Both halves of the CHECK constraint, refused here so the push is never attempted.
        useAppStore.getState().addMeeting(
            draft({ eventType: 'deadline', title: 'Notebook — week 6', attendanceRequired: true }),
        );

        expect(meetings()[0].publicCode).toBe('');
        expect(meetings()[0].attendanceRequired).toBe(false);
    });

    it('refuses with no season selected', async () => {
        useAppStore.setState({ currentSeasonId: null });
        expect(useAppStore.getState().addMeeting(draft())).toEqual([]);
        expect(meetings()).toHaveLength(0);
        expect(await queued()).toHaveLength(0);
    });

    it('refuses in an archived season rather than queueing a write the server will reject', async () => {
        useAppStore.setState({ seasons: [season({ isArchived: true })] });
        expect(useAppStore.getState().addMeeting(draft())).toEqual([]);
        expect(await queued()).toHaveLength(0);
    });
});

describe('a recurring series', () => {
    const until = new Date(2026, 8, 14, 23, 59).getTime();

    it('creates one row per occurrence, each with its own code', async () => {
        /*
         * THE ASSERTION THE WHOLE FEATURE RESTS ON.
         *
         * A shared code — or one derived from the series — would mean a student who
         * photographed the first poster could check in to every remaining session of the
         * term without attending one of them. The design says the codes run FF-0842,
         * FF-0849, FF-0856; what it means is that they are unrelated.
         */
        const ids = useAppStore.getState().addMeeting(draft(), { frequency: 'weekly', until });

        expect(ids).toHaveLength(5);
        const codes = meetings().map((m) => m.publicCode);
        expect(new Set(codes).size, 'two occurrences share a check-in code').toBe(5);
        for (const code of codes) expect(code).toMatch(/^\d{4}$/);

        expect(await queued()).toHaveLength(5);
    });

    it('shares a series id and a rule, and keeps the duration of each occurrence', () => {
        useAppStore.getState().addMeeting(draft(), { frequency: 'weekly', until });
        const all = meetings();

        expect(new Set(all.map((m) => m.seriesId)).size).toBe(1);
        expect(all[0].seriesId).not.toBe('');
        expect(all[0].recurrenceRule).toContain('FREQ=WEEKLY');
        for (const m of all) expect(m.endsAt! - m.startsAt).toBe(2.5 * 60 * 60_000);
    });

    it('does not draw a code twice within one save', () => {
        // The codes are added to the taken set as they are drawn, so a series cannot collide
        // with itself before any of it has reached the store.
        useAppStore.getState().addMeeting(draft(), {
            frequency: 'weekly',
            until: new Date(2027, 6, 1).getTime(),
        });
        const codes = meetings().map((m) => m.publicCode);
        expect(new Set(codes).size).toBe(codes.length);
    });

    it('leaves a one-off with no series id at all', () => {
        useAppStore.getState().addMeeting(draft());
        expect(meetings()[0].seriesId).toBe('');
        expect(meetings()[0].recurrenceRule).toBe('');
    });

    it('avoids codes the team already used in a previous season', () => {
        // The unique index is `(team_id, public_code)` with no season in it, so drawing only
        // from the current season would eventually collide with a code retired years ago.
        const existing: Meeting[] = Array.from({ length: 9_990 }, (_, n) => ({
            id: `old-${n}`,
            title: 'Old',
            description: '',
            location: '',
            eventType: 'build',
            publicCode: String(n).padStart(4, '0'),
            attendanceRequired: true,
            startsAt: 0,
            recurrenceRule: '',
            seriesId: '',
            createdBy: '',
            seasonId: 'season-0',
        }));
        useAppStore.setState({ meetings: existing });

        useAppStore.getState().addMeeting(draft());
        const created = meetings().find((m) => m.seasonId === S1)!;
        expect(Number(created.publicCode)).toBeGreaterThanOrEqual(9_990);
    });
});

describe('editing an occurrence or a series', () => {
    const until = new Date(2026, 8, 14, 23, 59).getTime();
    let ids: string[];

    beforeEach(async () => {
        ids = useAppStore.getState().addMeeting(draft(), { frequency: 'weekly', until });
        await resetQueue();
    });

    it('never rewrites an already-issued code, at any scope', async () => {
        /*
         * A poster on a wall does not update itself. If editing the series could reissue
         * codes, the students standing in front of last week's printout would be locked out
         * by a change nobody told them about.
         */
        const before = meetings().map((m) => m.publicCode);

        for (const scope of ['occurrence', 'future', 'series'] as const) {
            useAppStore.getState().updateMeeting(ids[0], { publicCode: '9999' }, scope);
        }

        expect(meetings().map((m) => m.publicCode)).toEqual(before);
    });

    it('applies "this occurrence only" to one row and forks it from the series', async () => {
        useAppStore.getState().updateMeeting(ids[2], { title: 'Special session' }, 'occurrence');

        const all = meetings();
        expect(all.filter((m) => m.title === 'Special session')).toHaveLength(1);

        const forked = all.find((m) => m.id === ids[2])!;
        expect(forked.seriesId, 'the edited occurrence still claims to be one of its siblings')
            .toBe('');
        expect(forked.recurrenceRule).toBe('');

        const q = await queued();
        expect(q).toHaveLength(1);
        expect(q[0].id).toBe(ids[2]);
    });

    it('applies "this and all future" forward only', async () => {
        useAppStore.getState().updateMeeting(ids[2], { location: 'Main gym' }, 'future');

        const all = meetings();
        expect(all.slice(0, 2).every((m) => m.location === 'Room 214')).toBe(true);
        expect(all.slice(2).every((m) => m.location === 'Main gym')).toBe(true);

        expect(await queued()).toHaveLength(3);
    });

    it('applies "every occurrence" to the whole series', async () => {
        useAppStore.getState().updateMeeting(ids[2], { location: 'Main gym' }, 'series');
        expect(meetings().every((m) => m.location === 'Main gym')).toBe(true);
        expect(await queued()).toHaveLength(5);
    });

    it('shifts a series by the delta rather than stacking it on one date', () => {
        // Assigning `startsAt` wholesale would put all five occurrences on the same evening,
        // which is a data-loss-shaped bug wearing a scheduling costume.
        const originals = meetings().map((m) => m.startsAt);
        const shifted = originals[0] + 60 * 60_000;

        useAppStore.getState().updateMeeting(ids[0], { startsAt: shifted }, 'series');

        expect(meetings().map((m) => m.startsAt)).toEqual(originals.map((s) => s + 60 * 60_000));
        // And the end times moved with them, so nothing became a five-hour meeting.
        for (const m of meetings()) expect(m.endsAt! - m.startsAt).toBe(2.5 * 60 * 60_000);
    });

    it("does not let a forked occurrence be caught by the series' next edit", () => {
        useAppStore.getState().updateMeeting(ids[1], { title: 'Deliberately different' }, 'occurrence');
        useAppStore.getState().updateMeeting(ids[0], { title: 'Renamed' }, 'series');

        expect(meetings().find((m) => m.id === ids[1])!.title).toBe('Deliberately different');
    });

    it('treats every scope as "just this one" for a meeting with no series', async () => {
        useAppStore.setState({ meetings: [], meetingAttendance: [] });
        await resetQueue();
        const [only] = useAppStore.getState().addMeeting(draft());
        await resetQueue();

        useAppStore.getState().updateMeeting(only, { title: 'Renamed' }, 'series');
        expect(await queued()).toHaveLength(1);
    });

    it('leaves the check-in window derived unless it is set explicitly', () => {
        const m = meetings()[0];
        expect(m.checkinOpensAt).toBeUndefined();
        expect(checkinWindow(m).opensAt).toBe(m.startsAt - 15 * 60_000);

        useAppStore.getState().updateMeeting(m.id, { checkinOpensAt: m.startsAt - 60 * 60_000 });
        expect(checkinWindow(meetings()[0]).opensAt).toBe(m.startsAt - 60 * 60_000);
    });
});

describe('deleting', () => {
    it('takes the local attendance with it, matching the server cascade', async () => {
        const [id] = useAppStore.getState().addMeeting(draft());
        useAppStore.getState().setAttendance(id, MEMBER, 'present');
        await resetQueue();

        useAppStore.getState().deleteMeeting(id);

        expect(meetings()).toHaveLength(0);
        // A local record pointing at a deleted parent is a row nothing cleans up and every
        // tally counts — Sprint 4 found exactly this on seasons.
        expect(useAppStore.getState().meetingAttendance).toHaveLength(0);

        const q = await queued();
        expect(q.filter((i) => i.table === 'meetings')).toHaveLength(1);
    });

    it('deletes a whole series when asked to', async () => {
        const ids = useAppStore.getState().addMeeting(draft(), {
            frequency: 'weekly',
            until: new Date(2026, 8, 14, 23, 59).getTime(),
        });
        await resetQueue();

        useAppStore.getState().deleteMeeting(ids[2], 'series');
        expect(meetings()).toHaveLength(0);
        expect(await queued()).toHaveLength(5);
    });
});

describe('a coach setting attendance', () => {
    let meetingId: string;

    beforeEach(async () => {
        [meetingId] = useAppStore.getState().addMeeting(draft());
        await resetQueue();
    });

    it('records who set it, when, and that it was set by hand', async () => {
        useAppStore.getState().setAttendance(meetingId, 'member-9', 'excused', 'Family trip');

        const [record] = useAppStore.getState().meetingAttendance;
        expect(record).toMatchObject({
            meetingId,
            teamMemberId: 'member-9',
            status: 'excused',
            // Never 'qr' or 'code'. Only the RPC may claim a scan happened, because only the
            // server can tell whether one did.
            method: 'coach',
            notes: 'Family trip',
            attestedBy: MEMBER,
        });
        expect(record.attestedAt).toBeGreaterThan(0);

        const q = await queued();
        expect(q).toHaveLength(1);
        expect(q[0]).toMatchObject({ table: 'meeting_attendance', op: 'create' });
    });

    it('updates the existing row rather than creating a second for the same member', async () => {
        useAppStore.getState().setAttendance(meetingId, 'member-9', 'present');
        const firstId = useAppStore.getState().meetingAttendance[0].id;
        await resetQueue();

        useAppStore.getState().setAttendance(meetingId, 'member-9', 'absent');

        // The unique key is (meeting_id, team_member_id), not the primary key: a second row
        // for the same pair is refused by the database rather than upserted over.
        expect(useAppStore.getState().meetingAttendance).toHaveLength(1);
        expect(useAppStore.getState().meetingAttendance[0].id).toBe(firstId);

        const q = await queued();
        expect(q[0]).toMatchObject({ id: firstId, op: 'update' });
    });

    it("overrides a student's own check-in in place", async () => {
        // The row arrived from the server with its own id, created by `check_in_with_code`.
        // The coach's override has to find it rather than queue a colliding insert.
        useAppStore.setState({
            meetingAttendance: [
                {
                    id: 'server-generated-id',
                    meetingId,
                    teamMemberId: 'member-9',
                    status: 'present',
                    method: 'qr',
                    notes: '',
                    attestedBy: 'member-9',
                    attestedAt: 1000,
                },
            ],
        });

        useAppStore.getState().setAttendance(meetingId, 'member-9', 'excused', 'Left early');

        expect(useAppStore.getState().meetingAttendance).toHaveLength(1);
        expect(useAppStore.getState().meetingAttendance[0].id).toBe('server-generated-id');
        expect(useAppStore.getState().meetingAttendance[0].method).toBe('coach');
        expect((await queued())[0]).toMatchObject({ id: 'server-generated-id', op: 'update' });
    });

    it('keeps an existing note when the status changes without one', () => {
        useAppStore.getState().setAttendance(meetingId, 'member-9', 'excused', 'Family trip');
        useAppStore.getState().setAttendance(meetingId, 'member-9', 'absent');
        expect(useAppStore.getState().meetingAttendance[0].notes).toBe('Family trip');
    });

    it('clears a record back to unrecorded, which is not the same as absent', async () => {
        useAppStore.getState().setAttendance(meetingId, 'member-9', 'present');
        const id = useAppStore.getState().meetingAttendance[0].id;
        await resetQueue();

        useAppStore.getState().clearAttendance(meetingId, 'member-9');

        expect(useAppStore.getState().meetingAttendance).toHaveLength(0);
        expect((await queued())[0]).toMatchObject({ table: 'meeting_attendance', id, op: 'delete' });
    });

    it('refuses to touch a roster in an archived season', async () => {
        useAppStore.setState({ seasons: [season({ isArchived: true })] });
        useAppStore.getState().setAttendance(meetingId, 'member-9', 'present');

        expect(useAppStore.getState().meetingAttendance).toHaveLength(0);
        expect(await queued()).toHaveLength(0);
    });
});
