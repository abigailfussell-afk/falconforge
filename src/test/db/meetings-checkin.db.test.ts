/**
 * Sprint 8 — `check_in_with_code`, against a real database and a real clock.
 *
 * This RPC is the only path by which a student's own attendance is ever written, and every
 * property the design asks for lives inside it rather than in the client:
 *
 *   - the code resolves to ONE occurrence, so last week's poster is dead;
 *   - the window is judged against `now()`, so a device with a wound-forward clock gains
 *     nothing;
 *   - a student checks in as themselves and only themselves — the function never takes a
 *     member id, it derives one from `auth.uid()`;
 *   - a check-in cannot be undone or repeated, and a coach's manual status wins over a scan.
 *
 * Each of those is a sentence in the brief and a branch in the function, so each gets a test
 * that fails without it. `p_code` is passed the way a poster prints it (`FF-0842`) in at
 * least one case, because the client is not the only thing that will ever call this.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Fixtures, type TestTeam } from './fixtures';
import { serviceClient } from './stack';

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

/** The meeting every test checks in to: open right now, ends in an hour. */
let openMeetingId: string;
const OPEN_CODE = '0842';

const minutesFromNow = (minutes: number) =>
    new Date(Date.now() + minutes * 60_000).toISOString();

async function createMeeting(values: Record<string, unknown>): Promise<string> {
    const { data, error } = await svc
        .from('meetings')
        .insert({
            team_id: team.id,
            season_id: team.seasonId,
            event_type: 'build',
            ...values,
        } as never)
        .select()
        .single();
    if (error) throw new Error(`createMeeting failed: ${error.message}`);
    return (data as { id: string }).id;
}

/** Call the RPC as a given fixture user and return the parsed result object. */
async function checkIn(
    user: { client: TestTeam['admin']['client'] },
    code: string,
    method: 'qr' | 'code' = 'qr',
    teamId: string = team.id,
): Promise<Record<string, unknown>> {
    const { data, error } = await user.client.rpc('check_in_with_code', {
        p_team_id: teamId,
        p_code: code,
        p_method: method,
    });
    if (error) throw new Error(`check_in_with_code errored: ${error.message}`);
    return data as unknown as Record<string, unknown>;
}

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('checkin');
    openMeetingId = await createMeeting({
        title: 'Build session — chassis rebuild',
        public_code: OPEN_CODE,
        starts_at: minutesFromNow(-10),
        ends_at: minutesFromNow(60),
    });
});

afterAll(async () => {
    await fixtures.cleanup();
});

beforeEach(async () => {
    // Each test starts with nobody checked in to the open meeting. The fixture's own
    // attendance row hangs off a DIFFERENT meeting, so it is untouched.
    await svc.from('meeting_attendance').delete().eq('meeting_id', openMeetingId);
    await svc
        .from('meetings')
        .update({ checkin_opens_at: null, checkin_closes_at: null } as never)
        .eq('id', openMeetingId);
});

describe('the happy path', () => {
    it('records the student as present, by the method they used', async () => {
        const result = await checkIn(team.users.student, OPEN_CODE);

        expect(result.success, `refused: ${result.error}`).toBe(true);
        expect(result.status).toBe('present');
        expect(result.method).toBe('qr');
        expect(result.meeting_title).toBe('Build session — chassis rebuild');

        const { data } = await svc
            .from('meeting_attendance')
            .select('team_member_id, status, method, attested_by')
            .eq('meeting_id', openMeetingId)
            .single();

        expect(data?.team_member_id).toBe(team.users.student.memberId);
        expect(data?.status).toBe('present');
        expect(data?.method).toBe('qr');
        // Attested by themselves: they are the one making the claim. A coach override
        // replaces this with the coach's member id, which is what 1c and 1f surface.
        expect(data?.attested_by).toBe(team.users.student.memberId);
    });

    it('accepts the code exactly as the poster prints it', async () => {
        const result = await checkIn(team.users.student, `FF-${OPEN_CODE}`);
        expect(result.success, `refused: ${result.error}`).toBe(true);
    });

    it('records the typed-code method distinctly from a scan', async () => {
        const result = await checkIn(team.users.student, OPEN_CODE, 'code');
        expect(result.success).toBe(true);

        const { data } = await svc
            .from('meeting_attendance')
            .select('method')
            .eq('meeting_id', openMeetingId)
            .single();
        expect(data?.method).toBe('code');
    });

    it('lets a coach and a mentor check themselves in too', async () => {
        // Nothing about self check-in is student-only. A mentor arriving at a build session
        // is as much "who was here" as a student is.
        for (const user of [team.users.coach, team.users.mentor]) {
            const result = await checkIn(user, OPEN_CODE);
            expect(result.success, `${user.role} refused: ${result.error}`).toBe(true);
        }
    });
});

describe('the window', () => {
    it('refuses a code before check-in opens', async () => {
        const laterId = await createMeeting({
            title: 'Next week',
            public_code: '0849',
            starts_at: minutesFromNow(60 * 24),
            ends_at: minutesFromNow(60 * 26),
        });

        const result = await checkIn(team.users.student, '0849');

        expect(result.success).toBe(false);
        expect(result.reason).toBe('window_not_open');
        // The refusal carries the time it opens, so the UI can say when to come back rather
        // than "no".
        expect(result.opens_at).toBeTruthy();

        await svc.from('meetings').delete().eq('id', laterId);
    });

    it('refuses a code after the meeting has ended', async () => {
        const pastId = await createMeeting({
            title: 'Last week',
            public_code: '0835',
            starts_at: minutesFromNow(-60 * 24 * 7),
            ends_at: minutesFromNow(-60 * 24 * 7 + 120),
        });

        const result = await checkIn(team.users.student, '0835');

        expect(result.success).toBe(false);
        expect(result.reason).toBe('window_closed');

        await svc.from('meetings').delete().eq('id', pastId);
    });

    it('opens 15 minutes before the start by default', async () => {
        // The default is not written into the row — `checkin_opens_at` stays NULL and the
        // predicate applies it — so this is the only place the number is provable.
        const soonId = await createMeeting({
            title: 'Starting in ten minutes',
            public_code: '0851',
            starts_at: minutesFromNow(10),
            ends_at: minutesFromNow(130),
        });

        const result = await checkIn(team.users.student, '0851');
        expect(result.success, `refused inside the default window: ${result.error}`).toBe(true);

        await svc.from('meeting_attendance').delete().eq('meeting_id', soonId);
        await svc.from('meetings').delete().eq('id', soonId);
    });

    it('respects a coach closing check-in early', async () => {
        const closed = await team.coach.client.rpc('close_meeting_checkin', {
            p_team_id: team.id,
            p_meeting_id: openMeetingId,
        });
        expect((closed.data as unknown as { success: boolean }).success).toBe(true);

        const result = await checkIn(team.users.student, OPEN_CODE);
        expect(result.success, 'check-in worked after the coach closed it').toBe(false);
        expect(result.reason).toBe('window_closed');
    });

    it('a student cannot close check-in', async () => {
        const { data } = await team.users.student.client.rpc('close_meeting_checkin', {
            p_team_id: team.id,
            p_meeting_id: openMeetingId,
        });
        const result = data as unknown as { success: boolean; reason: string };

        expect(result.success).toBe(false);
        expect(result.reason).toBe('not_permitted');

        // And the window really is untouched — a refusal that still wrote would be worse
        // than one that errored.
        const { data: meeting } = await svc
            .from('meetings')
            .select('checkin_closes_at')
            .eq('id', openMeetingId)
            .single();
        expect(meeting?.checkin_closes_at).toBeNull();
    });
});

describe('the code', () => {
    it('refuses a code that belongs to no meeting', async () => {
        const result = await checkIn(team.users.student, '9999');
        expect(result.success).toBe(false);
        expect(result.reason).toBe('unknown_code');
    });

    it("refuses another team's code, even a valid one", async () => {
        // The whole reason a four-digit code is enough: it is resolved inside the caller's
        // team. A student of team A holding team B's poster must get nothing.
        const other = await fixtures.createTeam('checkin-other');
        const otherMeetingId = await (async () => {
            const { data } = await svc
                .from('meetings')
                .insert({
                    team_id: other.id,
                    season_id: other.seasonId,
                    event_type: 'build',
                    title: "Other team's session",
                    public_code: OPEN_CODE,
                    starts_at: minutesFromNow(-10),
                    ends_at: minutesFromNow(60),
                } as never)
                .select()
                .single();
            return (data as { id: string }).id;
        })();

        // Same digits, our own team id: resolves to OUR meeting, not theirs.
        const ours = await checkIn(team.users.student, OPEN_CODE);
        expect(ours.meeting_id).toBe(openMeetingId);

        // Naming their team id gets nothing, because we are not a member of it.
        const theirs = await checkIn(team.users.student, OPEN_CODE, 'qr', other.id);
        expect(theirs.success).toBe(false);
        expect(theirs.reason).toBe('not_a_member');

        const { data } = await svc
            .from('meeting_attendance')
            .select('id')
            .eq('meeting_id', otherMeetingId);
        expect(data, "a check-in landed on another team's meeting").toEqual([]);
    });

    it('refuses a caller who is not an approved member', async () => {
        const outsider = await fixtures.createUser('checkin-outsider');
        const { userClient } = await import('./stack');
        const { mintAccessToken } = await import('./fixtures');

        const result = await checkIn(
            { client: userClient(mintAccessToken(outsider.id, outsider.email)) } as never,
            OPEN_CODE,
        );

        expect(result.success).toBe(false);
        expect(result.reason).toBe('not_a_member');
    });

    it('refuses an unrecognised method rather than recording one', async () => {
        const { data } = await team.users.student.client.rpc('check_in_with_code', {
            p_team_id: team.id,
            p_code: OPEN_CODE,
            p_method: 'coach',
        });
        const result = data as unknown as { success: boolean; reason: string };

        // 'coach' is a legitimate value of the column and an illegitimate one HERE: it is
        // what a coach setting a roster records, and a student must not be able to claim it.
        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_method');
    });
});

describe('checking in twice', () => {
    it('reports the first check-in rather than recording a second', async () => {
        const first = await checkIn(team.users.student, OPEN_CODE);
        expect(first.success).toBe(true);

        const second = await checkIn(team.users.student, OPEN_CODE);
        expect(second.success).toBe(false);
        expect(second.reason).toBe('already_recorded');
        expect(second.status).toBe('present');
        // The timestamp reported is the ORIGINAL one. A student who taps twice must not be
        // able to move their own recorded arrival time.
        expect(second.recorded_at).toBe(first.recorded_at);

        const { data } = await svc
            .from('meeting_attendance')
            .select('id')
            .eq('meeting_id', openMeetingId);
        expect(data, 'a second check-in created a second row').toHaveLength(1);
    });

    it("does not overwrite a coach's manual status", async () => {
        // A coach has marked this student Excused ahead of the meeting. The student then
        // scans anyway. The coach is the authority on the record; the scan is evidence.
        await svc.from('meeting_attendance').insert({
            meeting_id: openMeetingId,
            team_id: team.id,
            team_member_id: team.users.student.memberId,
            status: 'excused',
            method: 'coach',
            notes: 'Family trip',
            attested_by: team.coach.memberId,
        } as never);

        const result = await checkIn(team.users.student, OPEN_CODE);

        expect(result.success).toBe(false);
        expect(result.reason).toBe('already_recorded');
        expect(result.status, "a scan overwrote a coach's excusal").toBe('excused');

        const { data } = await svc
            .from('meeting_attendance')
            .select('status, notes, method')
            .eq('meeting_id', openMeetingId)
            .single();
        expect(data?.status).toBe('excused');
        expect(data?.notes).toBe('Family trip');
        expect(data?.method).toBe('coach');
    });

    it('gives a student no way to undo their own check-in', async () => {
        await checkIn(team.users.student, OPEN_CODE);

        const { data: row } = await svc
            .from('meeting_attendance')
            .select('id')
            .eq('meeting_id', openMeetingId)
            .single();

        await team.users.student.client
            .from('meeting_attendance')
            .delete()
            .eq('id', (row as { id: string }).id)
            .select();

        const { data } = await svc
            .from('meeting_attendance')
            .select('id')
            .eq('meeting_id', openMeetingId);
        expect(data, 'a student deleted their own check-in').toHaveLength(1);
    });
});

describe('the states a meeting can be in', () => {
    it('refuses a meeting in an archived season', async () => {
        await svc.from('seasons').update({ is_archived: true } as never).eq('id', team.seasonId);
        try {
            const result = await checkIn(team.users.student, OPEN_CODE);
            expect(result.success).toBe(false);
            expect(result.reason).toBe('season_archived');
        } finally {
            await svc.from('seasons').update({ is_archived: false } as never).eq('id', team.seasonId);
        }
    });

    it('refuses when the team has no licence, and says so', async () => {
        await fixtures.revokeLicense(team.id);
        try {
            const result = await checkIn(team.users.student, OPEN_CODE);
            expect(result.success).toBe(false);
            // Not 'unknown_code'. A student whose team's licence lapsed must not be told
            // their code is wrong — that is a support call about the wrong problem.
            expect(result.reason).toBe('team_read_only');
        } finally {
            await fixtures.restoreLicense(team.id);
        }
    });

    it('never resolves a deadline, because a deadline has no code', async () => {
        // The constraint makes this unreachable through a code lookup; the assertion is that
        // the constraint is what makes it unreachable.
        const { error } = await svc.from('meetings').insert({
            team_id: team.id,
            season_id: team.seasonId,
            event_type: 'deadline',
            title: 'Engineering notebook — week 6',
            public_code: '0860',
            attendance_required: false,
            starts_at: minutesFromNow(-5),
        } as never);

        expect(error, 'a deadline was allowed to carry a check-in code').not.toBeNull();
        expect(error?.message).toContain('meetings_deadline_has_no_attendance');
    });
});

describe('the code is unique per team, and the database is what makes it so', () => {
    it('refuses a second meeting with the same code', async () => {
        // Two coaches, both offline, both drawing 0842 for different meetings. One of those
        // pushes has to fail: a code that resolves to two meetings would let a student check
        // in to whichever one the query happened to return.
        const { error } = await svc.from('meetings').insert({
            team_id: team.id,
            season_id: team.seasonId,
            event_type: 'build',
            title: 'A different session, same code',
            public_code: OPEN_CODE,
            starts_at: minutesFromNow(120),
        } as never);

        expect(error, 'two meetings on one team share a check-in code').not.toBeNull();
        expect(error?.code).toBe('23505');
    });

    it('allows the same digits on a different team', async () => {
        // The scoping is per team, so 0842 being taken here must not exhaust it everywhere.
        const other = await fixtures.createTeam('checkin-codes');
        const { error } = await svc.from('meetings').insert({
            team_id: other.id,
            season_id: other.seasonId,
            event_type: 'build',
            title: 'Same digits, different team',
            public_code: OPEN_CODE,
            starts_at: minutesFromNow(120),
        } as never);

        expect(error, 'the code space is global rather than per team').toBeNull();
    });

    it('rejects a code that is not four digits', async () => {
        const { error } = await svc.from('meetings').insert({
            team_id: team.id,
            season_id: team.seasonId,
            event_type: 'build',
            title: 'Malformed code',
            public_code: 'FF-0842',
            starts_at: minutesFromNow(120),
        } as never);

        expect(error?.message).toContain('meetings_code_shape');
    });
});
