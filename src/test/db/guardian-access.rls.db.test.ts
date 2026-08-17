/**
 * What Sprint 9 opened up for a guardian, and everything it deliberately did not.
 *
 * THE RISK THIS FILE EXISTS TO HOLD DOWN.
 *
 * Section 3 requires a guardian to see their children's meetings and attendance, so access had
 * to widen. The cheap way to do that is one line — make a guardian an `is_team_member` — and it
 * would hand them the full roster (every adult's and every child's name and email), every OTHER
 * managed child's profile, the team's invite codes, which are credentials, and every season,
 * task, scouting report and match plan the team owns.
 *
 * `docs/failure-modes.md` §6 is five sprints of exactly that: the widest-brush default, granted
 * to unblock something, narrowed only later. Both of this project's privilege escalations came
 * out of it. So the widening is a THIRD predicate (`is_team_guardian`) used on three tables, and
 * `is_team_member` / `get_user_team_ids` are untouched — and this file's job is to prove that the
 * boundary is where the migration claims, by trying to cross it.
 *
 * WRITTEN FROM THE LEAST-PRIVILEGED ROLE THAT CAN REACH EACH TABLE, per §6's closing rule, and
 * including the attack that names the attacker's OWN id rather than the victim's — the shape that
 * survived 180 isolation assertions as B21.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures, type TestTeam } from './fixtures';
import { serviceClient } from './stack';

let fixtures: Fixtures;
let teamA: TestTeam;
let teamB: TestTeam;
const svc = serviceClient();

/** A meeting on team A, and an attendance row for team A's managed child. */
let meetingId: string;
let childAttendanceId: string;
let coachAttendanceId: string;

beforeAll(async () => {
    fixtures = new Fixtures();
    teamA = await fixtures.createTeam('guardian-access-a');
    teamB = await fixtures.createTeam('guardian-access-b');

    meetingId = teamA.meetingId;

    // The child's own attendance, and a teammate's, so "reads their child's" can be
    // distinguished from "reads the table".
    const { data: childRow } = await svc
        .from('meeting_attendance')
        .insert({
            team_id: teamA.id,
            meeting_id: meetingId,
            team_member_id: teamA.guardian.memberId,
            status: 'present',
            method: 'coach',
        } as never)
        .select('id')
        .single();
    childAttendanceId = (childRow as { id: string }).id;

    const { data: coachRow } = await svc
        .from('meeting_attendance')
        .select('id')
        .eq('id', teamA.attendanceId)
        .single();
    coachAttendanceId = (coachRow as { id: string }).id;
});

afterAll(async () => {
    await fixtures.cleanup();
});

describe('what a guardian gained', () => {
    it('reads the schedule of the team their child is on', async () => {
        const { data, error } = await teamA.guardian.user.client
            .from('meetings')
            .select('id')
            .eq('team_id', teamA.id);

        expect(error).toBeNull();
        expect(data?.map((m: { id: string }) => m.id))
            .toContain(meetingId);
    });

    it("reads their own child's attendance", async () => {
        const { data } = await teamA.guardian.user.client
            .from('meeting_attendance')
            .select('id')
            .eq('id', childAttendanceId);

        expect(data, "a guardian could not read their own child's attendance").toHaveLength(1);
    });
});

describe('what a guardian still cannot reach', () => {
    it("cannot read another member's attendance record", async () => {
        /*
         * These are minors' records, and Sprint 8 narrowed this policy for exactly that reason
         * ("attendance SELECT was `is_team_member`, so every student could read every other
         * student's record over the API"). The guardian branch added in Sprint 9 must not have
         * quietly re-widened it.
         */
        const { data } = await teamA.guardian.user.client
            .from('meeting_attendance')
            .select('id')
            .eq('id', coachAttendanceId);

        expect(data ?? [], "a guardian read another member's attendance").toEqual([]);
    });

    it('cannot read the whole attendance table for the team', async () => {
        const { data } = await teamA.guardian.user.client
            .from('meeting_attendance')
            .select('id')
            .eq('team_id', teamA.id);

        // Exactly their child's row, not the team's.
        expect(data?.map((r: { id: string }) => r.id)).toEqual([childAttendanceId]);
    });

    it('cannot read another team’s schedule', async () => {
        const { data } = await teamA.guardian.user.client
            .from('meetings')
            .select('id')
            .eq('team_id', teamB.id);

        expect(data ?? [], 'a guardian read another tenant’s schedule').toEqual([]);
    });

    it('still cannot read the roster, invite codes, or the team’s work', async () => {
        // Re-asserted here rather than only in `tenant-isolation` because THIS is the file
        // somebody will edit when they next widen guardian access.
        const roster = await teamA.guardian.user.client
            .from('team_members')
            .select('id')
            .eq('team_id', teamA.id);
        expect(roster.data?.map((r: { id: string }) => r.id)).toEqual([teamA.guardian.memberId]);

        const invites = await teamA.guardian.user.client.from('invites').select('code');
        expect(invites.data ?? [], 'a guardian read the team’s invite codes').toEqual([]);

        const tasks = await teamA.guardian.user.client.from('tasks').select('id');
        expect(tasks.data ?? [], 'a guardian read the team’s tasks').toEqual([]);

        const seasons = await teamA.guardian.user.client.from('seasons').select('id');
        expect(seasons.data ?? [], 'a guardian read the team’s seasons').toEqual([]);
    });

    it('cannot write attendance for their own child', async () => {
        /*
         * Reading is the whole grant. A guardian marking their own child present would make
         * attendance self-attested, which is the one property the record exists to deny —
         * `attested_by`/`attested_at` are there so that "who says so" has an answer three weeks
         * later.
         */
        const { error } = await teamA.guardian.user.client
            .from('meeting_attendance')
            .update({ status: 'present' } as never)
            .eq('id', childAttendanceId)
            .select();

        // RLS refuses by matching no rows on UPDATE, so "no error and nothing changed" is the
        // shape here — assert the DATA, not the error, or this passes on a policy that allows it.
        const { data: after } = await svc
            .from('meeting_attendance')
            .select('attested_by')
            .eq('id', childAttendanceId)
            .single();
        expect((after as { attested_by: string | null }).attested_by).toBeNull();
        expect(error).toBeNull();
    });
});

describe('the sibling case the old policy got wrong', () => {
    it('reads BOTH children’s attendance, not whichever one LIMIT 1 returned', async () => {
        /*
         * `current_team_member_id` is `... AND user_id = auth.uid() AND status = 'approved'
         * LIMIT 1` with no ORDER BY, and it does not exclude managed rows. For a guardian with
         * two children on one team it therefore returned an arbitrary one — so the pre-Sprint-9
         * attendance policy granted access to one child and refused the other, and which one
         * could differ between two runs of the same query. `docs/failure-modes.md` §13.
         *
         * The hand-off confirms siblings are supported: there is no unique constraint on
         * `(team_id, user_id)`, "so one guardian can hold two children on the same team".
         */
        const { data: sibling } = await svc
            .from('managed_profiles')
            .insert({
                guardian_user_id: teamA.guardian.user.id,
                full_name: 'The second child',
            } as never)
            .select('id')
            .single();
        const siblingProfileId = (sibling as { id: string }).id;

        const { data: siblingMember } = await svc
            .from('team_members')
            .insert({
                team_id: teamA.id,
                user_id: teamA.guardian.user.id,
                managed_profile_id: siblingProfileId,
                role: 'student',
                status: 'approved',
                full_name: 'The second child',
            } as never)
            .select('id')
            .single();
        const siblingMemberId = (siblingMember as { id: string }).id;

        const { data: siblingAttendance } = await svc
            .from('meeting_attendance')
            .insert({
                team_id: teamA.id,
                meeting_id: meetingId,
                team_member_id: siblingMemberId,
                status: 'excused',
                method: 'coach',
            } as never)
            .select('id')
            .single();
        const siblingAttendanceId = (siblingAttendance as { id: string }).id;

        const { data } = await teamA.guardian.user.client
            .from('meeting_attendance')
            .select('id')
            .eq('team_id', teamA.id);

        const ids = (data ?? []).map((r: { id: string }) => r.id);
        expect(ids, 'a guardian could not see both of their children').toEqual(
            expect.arrayContaining([childAttendanceId, siblingAttendanceId]),
        );
        expect(ids).toHaveLength(2);
    });
});

describe('the promotion code is a credential the client cannot choose', () => {
    it('lets a guardian READ their own child’s code', async () => {
        await svc
            .from('managed_profiles')
            .update({ promotion_code: 'ABCD2345' } as never)
            .eq('id', teamA.guardian.profileId);

        const { data } = await teamA.guardian.user.client
            .from('managed_profiles')
            .select('promotion_code')
            .eq('id', teamA.guardian.profileId)
            .single();

        expect((data as { promotion_code: string | null })?.promotion_code).toBe('ABCD2345');
    });

    it('REFUSES a guardian setting the code directly', async () => {
        /*
         * `managed_profiles_guardian_all` is `FOR ALL USING (guardian_user_id = auth.uid())`,
         * so RLS alone would permit this — a guardian owns the row. A claim code is a
         * credential, though, and whoever redeems it takes the child's place on the roster, so
         * a guardian able to set 'AAAAAAAA' is a stranger one guess away from a team.
         *
         * RLS cannot express a column; the GRANT does. This is the assertion that proves the
         * column-level grant list in the migration is actually in force — a catalogue check
         * would not (environment-divergences §5).
         */
        const { error } = await teamA.guardian.user.client
            .from('managed_profiles')
            .update({ promotion_code: 'AAAAAAAA' } as never)
            .eq('id', teamA.guardian.profileId);

        expect(error, 'a guardian was allowed to choose their child’s claim code').not.toBeNull();
        expect(error?.message).toMatch(/permission|denied|promotion_code/i);

        const { data: after } = await svc
            .from('managed_profiles')
            .select('promotion_code')
            .eq('id', teamA.guardian.profileId)
            .single();
        expect((after as { promotion_code: string | null }).promotion_code).toBe('ABCD2345');
    });

    it('still lets a guardian edit the columns they own', async () => {
        /*
         * The other half, and the one that catches the mistake this change could actually make:
         * the migration revokes table-level INSERT/UPDATE and re-grants per column, which is a
         * hand-maintained list (failure-modes §12). If a column is left off it, the guardian
         * silently loses the ability to edit their own child. So the editable columns are
         * exercised rather than assumed.
         */
        const { error } = await teamA.guardian.user.client
            .from('managed_profiles')
            .update({ full_name: 'Renamed by their guardian', notes: 'New pickup time' } as never)
            .eq('id', teamA.guardian.profileId);

        expect(error, 'a guardian lost the ability to edit their own child').toBeNull();

        const { data } = await svc
            .from('managed_profiles')
            .select('full_name, notes')
            .eq('id', teamA.guardian.profileId)
            .single();
        expect(data).toMatchObject({
            full_name: 'Renamed by their guardian',
            notes: 'New pickup time',
        });
    });
});
