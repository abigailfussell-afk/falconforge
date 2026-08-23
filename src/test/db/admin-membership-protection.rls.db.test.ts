/**
 * SEC-01 — the admin's membership row is not a roster row.
 *
 * WHAT THIS COVERS THAT `tenant-isolation.rls.db.test.ts` DID NOT
 *
 * That file's "capabilities are enforced by the database" block asks whether a coach can
 * reach ANOTHER TENANT and whether they can hand out a licensed seat. It never asked the
 * question a coach with devtools would ask first: what can I do to the row that says who
 * runs *my own* team? `team_members_update_roster` and `team_members_delete_roster` are
 * `USING (can_manage_roster(team_id))`, and `can_manage_roster` is admin **or coach** — so
 * the answer, before `20260824000000_sec_01_protect_admin_membership.sql`, was "anything".
 * Reproduced over PostgREST as a seeded coach: demote the admin (200), promote yourself
 * (200), `can_manage_billing` -> true. That is `docs/failure-modes.md` §6 and §2 at once:
 * the widest-brush capability, and 319 green assertions that never tried the shape.
 *
 * HOW TO READ THE ASSERTIONS
 *
 * Every refusal asserts SQLSTATE `42501` (`insufficient_privilege`) rather than using
 * `expectDenied`, which is satisfied by "no rows changed". A PATCH that matches no row also
 * changes nothing, so the lenient form would pass against a policy that had simply stopped
 * finding the admin's row — a green result meaning the opposite of what it claims.
 *
 * The positive controls at the end are not decoration. A trigger that refused every write to
 * `team_members` would pass every refusal here while making the roster unusable, and the four
 * admin-transfer RPCs are the exact thing this fix is most likely to break (they are the only
 * legitimate writers of `role = 'admin'`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures, type TestTeam } from './fixtures';
import { serviceClient, userClient } from './stack';

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('sec01');
});

afterAll(async () => {
    await fixtures.cleanup();
});

/** The team's current admin, read with the service client — RLS is not what is under test. */
async function adminRow(teamId: string) {
    const { data } = await svc
        .from('team_members')
        .select('id, user_id, role, status')
        .eq('team_id', teamId)
        .eq('role', 'admin')
        .maybeSingle();
    return data as { id: string; user_id: string; role: string; status: string } | null;
}

/**
 * Assert a write was refused BY AUTHORITY, naming the SQLSTATE.
 *
 * `insufficient_privilege` is 42501. Asserting the code distinguishes this trigger's refusal
 * from `enforce_member_role_eligibility`'s `check_violation` (23514) — which is why the
 * trigger is named to sort first — and from a policy that matched no rows at all.
 */
async function expectRefused(
    label: string,
    query: PromiseLike<{ data: unknown; error: unknown }>,
) {
    const { error } = (await query) as { error: { code?: string; message?: string } | null };
    expect(error, `${label} was NOT refused`).not.toBeNull();
    expect(error?.code, `${label} was refused, but not on authority: ${error?.message}`)
        .toBe('42501');
}

describe('SEC-01 — a coach cannot take the team', () => {
    it('cannot demote the admin', async () => {
        const before = await adminRow(team.id);
        expect(before, 'fixture has no admin').not.toBeNull();

        await expectRefused(
            'coach PATCH role=student on the admin row',
            team.coach.client
                .from('team_members')
                .update({ role: 'student' } as never)
                .eq('team_id', team.id)
                .eq('role', 'admin')
                .select(),
        );

        expect((await adminRow(team.id))?.id, 'the admin row moved').toBe(before!.id);
    });

    it('cannot make themselves the admin', async () => {
        await expectRefused(
            'coach PATCH role=admin on their own row',
            team.coach.client
                .from('team_members')
                .update({ role: 'admin' } as never)
                .eq('id', team.coach.memberId)
                .select(),
        );

        const { data } = await svc
            .from('team_members')
            .select('role')
            .eq('id', team.coach.memberId)
            .single();
        expect((data as { role: string }).role).toBe('coach');
    });

    it('cannot delete the admin row and strand the team', async () => {
        await expectRefused(
            'coach DELETE of the admin row',
            team.coach.client
                .from('team_members')
                .delete()
                .eq('team_id', team.id)
                .eq('role', 'admin')
                .select(),
        );

        expect(await adminRow(team.id), 'the team was stranded').not.toBeNull();
    });

    it('cannot repoint the admin row at themselves, or change its status', async () => {
        const admin = (await adminRow(team.id))!;

        await expectRefused(
            'coach PATCH user_id on the admin row',
            team.coach.client
                .from('team_members')
                .update({ user_id: team.coach.id } as never)
                .eq('id', admin.id)
                .select(),
        );

        await expectRefused(
            'coach PATCH status on the admin row',
            team.coach.client
                .from('team_members')
                .update({ status: 'removed' } as never)
                .eq('id', admin.id)
                .select(),
        );

        await expectRefused(
            'coach PATCH managed_profile_id on the admin row',
            team.coach.client
                .from('team_members')
                .update({ managed_profile_id: team.guardian.profileId } as never)
                .eq('id', admin.id)
                .select(),
        );

        const after = (await adminRow(team.id))!;
        expect(after.user_id).toBe(admin.user_id);
        expect(after.status).toBe('approved');
    });

    it('cannot INSERT a second admin onto a team it already has one on', async () => {
        /*
         * The unique index `team_members_one_admin_per_team` would refuse this too, with
         * 23505 — which is why the assertion names 42501. On a STRANDED team (the index is
         * partial on `status <> 'removed'`) the index would not fire at all and the insert
         * would be the whole escalation, so what has to be true is that AUTHORITY refuses
         * first, not that a constraint happens to.
         */
        const outsider = await fixtures.createUser('sec01-outsider');
        await expectRefused(
            'coach INSERT of a new admin row',
            team.coach.client
                .from('team_members')
                .insert({
                    team_id: team.id,
                    user_id: outsider.id,
                    role: 'admin',
                    status: 'approved',
                    full_name: 'Injected Admin',
                    email: outsider.email,
                } as never)
                .select(),
        );
    });
});

describe('SEC-01 — the roster still works, and so do the transfers', () => {
    it('a coach can still move a member between student, mentor and coach', async () => {
        // The mentor fixture is 18+, so `enforce_member_role_eligibility` is not what
        // decides the outcome here.
        const target = team.users.mentor.memberId;

        for (const role of ['coach', 'mentor'] as const) {
            const { error } = await team.coach.client
                .from('team_members')
                .update({ role } as never)
                .eq('id', target)
                .select();
            expect(error, `a coach could not set role=${role}`).toBeNull();
        }
    });

    it('a coach can still remove a non-admin member', async () => {
        const spare = await fixtures.createUser('sec01-spare');
        const { data: created } = await svc
            .from('team_members')
            .insert({
                team_id: team.id,
                user_id: spare.id,
                role: 'student',
                status: 'pending',
                full_name: 'Spare Student',
                email: spare.email,
            } as never)
            .select('id')
            .single();

        const { error } = await team.coach.client
            .from('team_members')
            .delete()
            .eq('id', (created as { id: string }).id)
            .select();
        expect(error, 'a coach could not remove an ordinary member').toBeNull();
    });

    it('the warm path still completes: nominate then accept', async () => {
        const nominate = await team.admin.client.rpc('nominate_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.coach.memberId,
        });
        expect(nominate.data, 'nomination failed').toMatchObject({ success: true });

        // The successor accepts the terms on the acceptance screen; the eligibility trigger
        // requires the attestation, not this test.
        await fixtures.attest(team.coach.id, 'terms', '2.0');

        const accept = await team.coach.client.rpc('accept_team_admin_nomination', {
            p_team_id: team.id,
        });
        expect(accept.data, 'acceptance failed').toMatchObject({ success: true });
        expect((await adminRow(team.id))?.id).toBe(team.coach.memberId);
    });

    it('transfer_team_admin still moves it back', async () => {
        // The coach is the admin after the test above; hand it back to the original admin.
        const back = await team.coach.client.rpc('transfer_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.admin.memberId,
        });
        expect(back.data, 'transfer_team_admin failed').toMatchObject({ success: true });
        expect((await adminRow(team.id))?.id).toBe(team.admin.memberId);
    });

    it('create_team_as_admin still creates a seated founding admin', async () => {
        const founder = await fixtures.createUser('sec01-founder');
        await fixtures.attest(founder.id, 'coach_terms', '2.0');

        const { data } = await userClient(founder.token).rpc('create_team_as_admin', {
            team_name: 'SEC-01 Founding Team',
            season_name: '2026-2027',
        });
        expect(data, 'create_team_as_admin failed').toMatchObject({ success: true });

        const teamId = (data as { team_id: string }).team_id;
        try {
            const { data: member } = await svc
                .from('team_members')
                .select('role, status, seat_assigned')
                .eq('team_id', teamId)
                .single();
            expect(member).toMatchObject({ role: 'admin', status: 'approved', seat_assigned: true });
        } finally {
            // Not created through `Fixtures`, so it is not in the cleanup list.
            await svc.from('teams').delete().eq('id', teamId);
        }
    });

    it('operator_transfer_team_admin still rescues a stranded team', async () => {
        /*
         * The cold path. The team has no admin at all — which is the case the trigger's
         * INSERT and role rules make otherwise unreachable, and therefore the one most worth
         * asserting after adding them.
         */
        const stranded = await fixtures.createTeam('sec01-stranded');
        await svc.from('team_members').delete().eq('id', stranded.admin.memberId);
        expect(await adminRow(stranded.id), 'fixture is not stranded').toBeNull();

        const operator = stranded.coach;
        await svc.from('platform_operators').insert({ user_id: operator.id } as never);
        await fixtures.attest(operator.id, 'terms', '2.0');

        const { data } = await operator.client.rpc('operator_transfer_team_admin', {
            p_team_id: stranded.id,
            p_new_member_id: operator.memberId,
            p_notes: 'SEC-01 regression',
        });
        expect(data, 'the operator rescue failed').toMatchObject({ success: true });
        expect((await adminRow(stranded.id))?.id).toBe(operator.memberId);
    });
});
