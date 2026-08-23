/**
 * SEC-03 — removing somebody from a team keeps their history.
 *
 * `MemberManager.removeMember` and `rejectMember` both called `.delete()`, while
 * `FALCONFORGE_V2_PLAN.md` §8 and `docs/beta-ops.md` both stated that the app never deletes a
 * member and that the foreign-key problem was therefore "masked completely today". The prose
 * was wrong and the code was the bug — `docs/failure-modes.md` §3, in the form the hand-off
 * warns about: when the code and the prose disagree, the code is the fact.
 *
 * The first test here is the one that fails against the old implementation, and it fails with
 * the DATABASE's error rather than an assertion about intent: `23502`. That is deliberate.
 * `expect(update).toHaveBeenCalledWith({status:'removed'})` would be a test of the component's
 * spelling; this is a test that the operation a coach performs in October, on a student who has
 * been assigned work since September, actually completes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures, type TestTeam } from './fixtures';
import { serviceClient, userClient } from './stack';

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('sec03');
});

afterAll(async () => {
    await fixtures.cleanup();
});

/** Give a member the references a real mid-season student has. */
async function giveHistory(memberId: string) {
    const { data: task, error: taskError } = await svc
        .from('tasks')
        .insert({
            team_id: team.id,
            season_id: team.seasonId,
            title: 'SEC-03 assigned work',
            status: 'To Do',
            assigned_to: memberId,
        } as never)
        .select('id')
        .single();
    if (taskError) throw new Error(`fixture task failed: ${taskError.message}`);

    const { data: attendance, error: attendanceError } = await svc
        .from('meeting_attendance')
        .insert({
            team_id: team.id,
            meeting_id: team.meetingId,
            team_member_id: memberId,
            status: 'present',
            method: 'coach',
        } as never)
        .select('id')
        .single();
    if (attendanceError) throw new Error(`fixture attendance failed: ${attendanceError.message}`);

    return {
        taskId: (task as { id: string }).id,
        attendanceId: (attendance as { id: string }).id,
    };
}

describe('SEC-03 — the DELETE that could not work', () => {
    it('a coach DELETEing a member with an assigned task is still refused by the schema', async () => {
        /*
         * NOT a regression test for the fix — a record of why the fix is a status change.
         * The composite FKs are untouched (per-column `ON DELETE SET NULL` is the schema half
         * of SEC-03 and a separate item), so this refusal is still there, waiting for anything
         * that reaches for `.delete()` again.
         */
        const spare = await fixtures.createUser('sec03-doomed');
        const { data: member } = await svc
            .from('team_members')
            .insert({
                team_id: team.id,
                user_id: spare.id,
                role: 'student',
                status: 'approved',
                full_name: 'Doomed Student',
                email: spare.email,
            } as never)
            .select('id')
            .single();
        const memberId = (member as { id: string }).id;
        await giveHistory(memberId);

        const { error } = await team.coach.client
            .from('team_members')
            .delete()
            .eq('id', memberId)
            .select();

        expect(error?.code, 'the composite FKs no longer refuse a DELETE — SEC-03s schema half may have landed')
            .toBe('23502');
    });
});

describe('SEC-03 — removing a member as the app now does it', () => {
    it('succeeds for a member with an assigned task, and keeps the task and the attendance', async () => {
        const spare = await fixtures.createUser('sec03-leaver');
        const { data: member } = await svc
            .from('team_members')
            .insert({
                team_id: team.id,
                user_id: spare.id,
                role: 'student',
                status: 'approved',
                seat_assigned: true,
                full_name: 'Departing Student',
                email: spare.email,
            } as never)
            .select('id')
            .single();
        const memberId = (member as { id: string }).id;
        const { taskId, attendanceId } = await giveHistory(memberId);

        // Exactly what `MemberManager.setMemberRemoved` sends.
        const { error } = await team.coach.client
            .from('team_members')
            .update({ status: 'removed', seat_assigned: false } as never)
            .eq('id', memberId)
            .select();

        expect(error, 'a coach could not remove a student who had been assigned work').toBeNull();

        const { data: after } = await svc
            .from('team_members')
            .select('status, seat_assigned, full_name')
            .eq('id', memberId)
            .single();
        expect(after).toMatchObject({ status: 'removed', seat_assigned: false });
        expect((after as { full_name: string }).full_name, 'the name went with them')
            .toBe('Departing Student');

        const { data: task } = await svc
            .from('tasks')
            .select('assigned_to')
            .eq('id', taskId)
            .single();
        expect(
            (task as { assigned_to: string | null }).assigned_to,
            'the assignment was dropped — the task should keep naming who held it',
        ).toBe(memberId);

        const { data: attendance } = await svc
            .from('meeting_attendance')
            .select('id')
            .eq('id', attendanceId);
        expect(attendance ?? [], 'the attendance record was destroyed').toHaveLength(1);
    });

    it('frees the seat, so the licence count goes back down', async () => {
        const before = await svc.rpc('team_seats_remaining', { p_team_id: team.id });
        expect(before.error).toBeNull();
        // The fixture licence is unlimited (`seats: null`), so remaining is NULL and the
        // arithmetic is not what is under test — the flag on the row is.
        const { data } = await svc
            .from('team_members')
            .select('seat_assigned')
            .eq('team_id', team.id)
            .eq('status', 'removed');

        // `.every()` over an empty array is true, so the count is asserted first — otherwise
        // this passes on a team nobody has been removed from (failure-modes §2).
        const removed = (data ?? []) as { seat_assigned: boolean }[];
        expect(removed.length, 'no member has been removed, so this asserts nothing')
            .toBeGreaterThan(0);
        expect(
            removed.every((m) => m.seat_assigned === false),
            'a removed member is still holding a licensed seat',
        ).toBe(true);
    });

    it('lets them rejoin with a code, onto the SAME team_members row', async () => {
        /*
         * The reason the status exists. `join_team_with_invite` has had a `removed -> pending`
         * branch since Sprint 3 and nothing could ever reach it, because the row was gone.
         * Rejoining onto the same `id` is what keeps their old task assignments and attendance
         * pointing at them instead of at a stranger.
         */
        const returner = await fixtures.createUser('sec03-returner', '13_to_17');
        const { data: member } = await svc
            .from('team_members')
            .insert({
                team_id: team.id,
                user_id: returner.id,
                role: 'student',
                status: 'removed',
                full_name: 'Returning Student',
                email: returner.email,
            } as never)
            .select('id')
            .single();
        const memberId = (member as { id: string }).id;

        const { data } = await userClient(returner.token).rpc('join_team_with_invite', {
            invite_code: team.inviteCode,
        });

        expect(data).toMatchObject({ success: true, status: 'pending' });
        expect(
            (data as { member_id: string }).member_id,
            'rejoining created a new row, so their history now belongs to nobody',
        ).toBe(memberId);
    });
});
