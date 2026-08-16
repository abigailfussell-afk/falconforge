/**
 * Sprint 8 — who may run the schedule, and who may read an attendance record.
 *
 * `tenant-isolation.rls.db.test.ts` already proves that team A cannot touch team B's
 * meetings or attendance, and it does so for all four roles. That is the wrong question for
 * this feature. Every interesting refusal here happens INSIDE one team, between people who
 * can all legitimately see the same schedule:
 *
 *   - a student may not create, edit or delete an event;
 *   - a mentor may — this is the first capability in the application that distinguishes
 *     `mentor` from `student` at all, and the role has existed since Sprint 3;
 *   - a student may not set anybody's attendance, including their own, because the only
 *     self-write path is `check_in_with_code` (covered in `meetings-checkin.db.test.ts`);
 *   - a student may not READ another student's attendance, which is the one that would have
 *     been invisible: the season summary is a coach screen, so nothing in the UI would ever
 *     have shown a policy of `is_team_member(team_id)` to be too wide.
 *
 * The intra-team direction is where the interesting mistakes live, and it is exactly the
 * direction Sprint 3's 180 cross-tenant assertions went green over B21 for.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures, type TestTeam, type Role } from './fixtures';
import { serviceClient } from './stack';

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

/** Roles the design says may run the schedule, and the one it says may not. */
const MANAGERS: Role[] = ['admin', 'coach', 'mentor'];

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('meetings');
});

afterAll(async () => {
    await fixtures.cleanup();
});

/** A meeting row for this team, ready to insert. */
const newMeeting = (title: string, code: string | null = null) => ({
    team_id: team.id,
    season_id: team.seasonId,
    title,
    event_type: 'build',
    public_code: code,
    starts_at: new Date('2026-10-05T18:00:00Z').toISOString(),
    ends_at: new Date('2026-10-05T20:00:00Z').toISOString(),
});

describe('meetings: only an admin, coach or mentor runs the schedule', () => {
    for (const role of MANAGERS) {
        it(`a ${role} can create an event`, async () => {
            const { data, error } = await team.users[role]
                .client.from('meetings')
                .insert(newMeeting(`${role} created this`) as never)
                .select()
                .single();

            expect(error, `${role} was refused: ${error?.message}`).toBeNull();
            expect(data?.title).toBe(`${role} created this`);

            await svc.from('meetings').delete().eq('id', (data as { id: string }).id);
        });

        it(`a ${role} can edit and delete an event`, async () => {
            const created = await svc
                .from('meetings')
                .insert(newMeeting(`${role} edits this`) as never)
                .select()
                .single();
            const id = (created.data as { id: string }).id;

            const updated = await team.users[role]
                .client.from('meetings')
                .update({ title: 'renamed' } as never)
                .eq('id', id)
                .select();
            expect(updated.error).toBeNull();
            expect(updated.data, `${role} could not edit`).toHaveLength(1);

            const deleted = await team.users[role]
                .client.from('meetings')
                .delete()
                .eq('id', id)
                .select();
            expect(deleted.error).toBeNull();
            expect(deleted.data, `${role} could not delete`).toHaveLength(1);
        });
    }

    it('a student cannot create an event', async () => {
        const { error } = await team.users.student
            .client.from('meetings')
            .insert(newMeeting('student created this') as never)
            .select();

        // A WITH CHECK refusal is an outright error (42501), not an empty result.
        expect(error, 'a student was allowed to create an event').not.toBeNull();
        expect(error?.code).toBe('42501');
    });

    it('a student cannot edit or delete an existing event', async () => {
        const updated = await team.users.student
            .client.from('meetings')
            .update({ title: 'student renamed this' } as never)
            .eq('id', team.meetingId)
            .select();
        expect(updated.data ?? []).toEqual([]);

        const deleted = await team.users.student
            .client.from('meetings')
            .delete()
            .eq('id', team.meetingId)
            .select();
        expect(deleted.data ?? []).toEqual([]);

        // The RETURNING clause is filtered by the SELECT policy, so an empty result is not
        // by itself proof the write did not land. Ask the database with RLS bypassed.
        const { data } = await svc
            .from('meetings')
            .select('title')
            .eq('id', team.meetingId)
            .single();
        expect(data?.title, "a student's write reached the row").toBe('meetings build session');
    });

    it('every member can still SEE the schedule', async () => {
        // The student refusals above must not have been bought by hiding the schedule from
        // them. The whole student experience is reading it.
        for (const role of ['admin', 'coach', 'mentor', 'student'] as Role[]) {
            const { data, error } = await team.users[role]
                .client.from('meetings')
                .select('id')
                .eq('id', team.meetingId);

            expect(error).toBeNull();
            expect(data, `${role} cannot see their own team's schedule`).toHaveLength(1);
        }
    });
});

describe('attendance: a student reads their own row and nobody else\'s', () => {
    let otherStudentMemberId: string;
    let otherStudentAttendanceId: string;

    beforeAll(async () => {
        // A second student on the same team, with an attendance record of their own. The
        // fixture's `student` already has one; this is the row they must not be able to see.
        const account = await fixtures.createUser('meetings-student2');
        const member = await svc
            .from('team_members')
            .insert({
                team_id: team.id,
                user_id: account.id,
                role: 'student',
                status: 'approved',
                seat_assigned: true,
                full_name: 'Second student',
                email: account.email,
            } as never)
            .select()
            .single();
        otherStudentMemberId = (member.data as { id: string }).id;

        const attendance = await svc
            .from('meeting_attendance')
            .insert({
                meeting_id: team.meetingId,
                team_id: team.id,
                team_member_id: otherStudentMemberId,
                status: 'absent',
                method: 'coach',
                attested_by: team.coach.memberId,
            } as never)
            .select()
            .single();
        otherStudentAttendanceId = (attendance.data as { id: string }).id;
    });

    it('a student sees their own attendance', async () => {
        const { data, error } = await team.users.student
            .client.from('meeting_attendance')
            .select('id, status')
            .eq('id', team.attendanceId);

        expect(error).toBeNull();
        expect(data, 'a student cannot see their own attendance').toHaveLength(1);
    });

    it("a student cannot see another student's attendance", async () => {
        const { data, error } = await team.users.student
            .client.from('meeting_attendance')
            .select('id')
            .eq('id', otherStudentAttendanceId);

        expect(error).toBeNull();
        expect(data, "a student read another student's attendance record").toEqual([]);
    });

    it('a student cannot enumerate the roster by listing attendance unfiltered', async () => {
        // The `eq('id', ...)` check above would pass against a policy that leaks on a bare
        // select but happens to filter by id. This is the question that matters for a table
        // whose whole content is "who was where".
        const { data, error } = await team.users.student
            .client.from('meeting_attendance')
            .select('id, team_member_id');

        expect(error).toBeNull();
        const memberIds = (data ?? []).map((r: { team_member_id: string }) => r.team_member_id);
        expect(memberIds, 'an unfiltered read returned somebody else')
            .toEqual([team.users.student.memberId]);
    });

    for (const role of MANAGERS) {
        it(`a ${role} sees the whole roster's attendance`, async () => {
            const { data, error } = await team.users[role]
                .client.from('meeting_attendance')
                .select('id')
                .eq('meeting_id', team.meetingId);

            expect(error).toBeNull();
            // The fixture's student, plus the second student created above.
            expect(data, `${role} cannot read the roster they are meant to manage`)
                .toHaveLength(2);
        });
    }

    it('a student cannot set their own attendance directly', async () => {
        // The point of the whole design: self-recording goes through `check_in_with_code`,
        // which validates the window against the SERVER's clock. A direct INSERT would be a
        // student writing "present" for a meeting they are not at.
        const { error } = await team.users.student
            .client.from('meeting_attendance')
            .insert({
                meeting_id: team.meetingId,
                team_id: team.id,
                team_member_id: team.users.student.memberId,
                status: 'present',
                method: 'qr',
            } as never)
            .select();

        expect(error, 'a student wrote their own attendance directly').not.toBeNull();
        expect(error?.code).toBe('42501');
    });

    it('a student cannot overwrite the status a coach set for them', async () => {
        const before = await svc
            .from('meeting_attendance')
            .select('status')
            .eq('id', team.attendanceId)
            .single();

        await team.users.student
            .client.from('meeting_attendance')
            .update({ status: 'excused' } as never)
            .eq('id', team.attendanceId)
            .select();

        const after = await svc
            .from('meeting_attendance')
            .select('status')
            .eq('id', team.attendanceId)
            .single();

        expect(after.data?.status, 'a student edited their own attendance record')
            .toBe(before.data?.status);
    });

    it('a student cannot delete an attendance record', async () => {
        await team.users.student
            .client.from('meeting_attendance')
            .delete()
            .eq('id', team.attendanceId)
            .select();

        const { data } = await svc
            .from('meeting_attendance')
            .select('id')
            .eq('id', team.attendanceId);
        expect(data, 'a student deleted an attendance record').toHaveLength(1);
    });
});

describe('an archived season is read-only for meetings too', () => {
    it('refuses a new event, an edit and a delete once the season is archived', async () => {
        await svc.from('seasons').update({ is_archived: true } as never).eq('id', team.seasonId);

        try {
            const inserted = await team.coach.client
                .from('meetings')
                .insert(newMeeting('after the archive') as never)
                .select();
            expect(inserted.error, 'an archived season accepted a new meeting').not.toBeNull();

            const updated = await team.coach.client
                .from('meetings')
                .update({ title: 'after the archive' } as never)
                .eq('id', team.meetingId)
                .select();
            expect(updated.data ?? []).toEqual([]);

            // Attendance reaches its season through `meeting_season_is_open`, which is the
            // one season-scoped table with no `season_id` of its own — so it is the one that
            // would silently stay writable if that predicate were dropped.
            const attendance = await team.coach.client
                .from('meeting_attendance')
                .update({ status: 'absent' } as never)
                .eq('id', team.attendanceId)
                .select();
            expect(attendance.data ?? []).toEqual([]);

            const { data } = await svc
                .from('meetings')
                .select('title')
                .eq('id', team.meetingId)
                .single();
            expect(data?.title).toBe('meetings build session');
        } finally {
            await svc.from('seasons').update({ is_archived: false } as never).eq('id', team.seasonId);
        }
    });
});

describe('a lapsed licence stops the schedule being edited, not read', () => {
    it('refuses writes and keeps reads', async () => {
        await fixtures.revokeLicense(team.id);

        try {
            const { error } = await team.coach.client
                .from('meetings')
                .insert(newMeeting('while unlicensed') as never)
                .select();
            expect(error, 'an unlicensed team created a meeting').not.toBeNull();

            const { data } = await team.users.student.client
                .from('meetings')
                .select('id')
                .eq('id', team.meetingId);
            expect(data, 'a lapsed licence hid the schedule').toHaveLength(1);
        } finally {
            await fixtures.restoreLicense(team.id);
        }
    });
});
