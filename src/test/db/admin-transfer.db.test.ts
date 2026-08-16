/**
 * Sprint 6 — ownership transfer and seat capacity, against a real database.
 *
 * WHY THIS FILE EXISTS
 *
 * The scenario the sprint was asked to solve is a teacher who retires. Two versions of it,
 * and only one was reachable before this sprint:
 *
 *   WARM — they hand over first. `transfer_team_admin` (Sprint 3) could already do this and
 *          had no caller. The part that was missing is that the successor must have ACCEPTED
 *          THE TERMS: `enforce_member_role_eligibility` refuses `role = 'admin'` without an
 *          attestation, and nothing in the app ever wrote one for an existing member, so the
 *          gate was armed with no way through it. Hence a handshake — nominate, then accept.
 *
 *   COLD — they are already gone. Every warm path runs through `can_manage_billing`, which
 *          only the departed admin satisfied, and the one-admin partial index blocks
 *          promoting anyone while their row still holds the role. The team keeps all its data
 *          and NO API call can produce an admin. `operator_transfer_team_admin` is the only
 *          way out, which is why it is gated like `grant_team_license`.
 *
 * The assertions that matter most here are the refusals. A handshake that any coach can
 * complete on their own behalf is not a handshake, and the escalation is two ordinary REST
 * requests rather than anything exotic — see "a coach cannot nominate themselves".
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Fixtures, type TestTeam } from './fixtures';
import { serviceClient } from './stack';

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

/** Read the team's nomination state with the service client (RLS is not what is under test). */
async function nomination(teamId: string) {
    const { data } = await svc
        .from('teams')
        .select('pending_admin_member_id, pending_admin_nominated_at, pending_admin_nominated_by')
        .eq('id', teamId)
        .single();
    return data!;
}

async function roleOf(memberId: string): Promise<string> {
    const { data } = await svc.from('team_members').select('role').eq('id', memberId).single();
    return data!.role;
}

/** Put the roster and the nomination back, so each test starts from the fixture's shape. */
async function resetAdmin() {
    await svc
        .from('teams')
        .update({
            pending_admin_member_id: null,
            pending_admin_nominated_at: null,
            pending_admin_nominated_by: null,
        } as never)
        .eq('id', team.id);

    if ((await roleOf(team.admin.memberId)) !== 'admin') {
        // Demote whoever holds it before restoring, or the partial unique index refuses.
        await svc
            .from('team_members')
            .update({ role: 'coach' } as never)
            .eq('team_id', team.id)
            .eq('role', 'admin');
        await svc
            .from('team_members')
            .update({ role: 'admin' } as never)
            .eq('id', team.admin.memberId);
    }
    await svc.from('team_members').update({ role: 'coach' } as never).eq('id', team.coach.memberId);
    await svc
        .from('team_members')
        .update({ role: 'student' } as never)
        .eq('id', team.users.student.memberId);
}

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('handover');
});

afterAll(async () => {
    await fixtures.cleanup();
});

beforeEach(async () => {
    await resetAdmin();
});

describe('the warm path — nominate, then accept', () => {
    it('the admin nominates a coach, and the nomination is recorded with its author', async () => {
        const { data } = await team.admin.client.rpc('nominate_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.coach.memberId,
        });

        expect(data).toMatchObject({ success: true, pending_admin_member_id: team.coach.memberId });

        const state = await nomination(team.id);
        expect(state.pending_admin_member_id).toBe(team.coach.memberId);
        expect(state.pending_admin_nominated_by).toBe(team.admin.id);
        expect(state.pending_admin_nominated_at).not.toBeNull();
    });

    it('nominating does not move the role — the successor has not agreed to anything yet', async () => {
        await team.admin.client.rpc('nominate_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.coach.memberId,
        });

        expect(await roleOf(team.admin.memberId)).toBe('admin');
        expect(await roleOf(team.coach.memberId)).toBe('coach');
    });

    /*
     * THE GATE THAT HAD NO DOOR.
     *
     * `enforce_member_role_eligibility` requires a `coach_terms` or `terms` attestation to
     * hold the admin role. The fixture attests only for the original admin, so the coach here
     * is in exactly the state every real successor starts in — and acceptance must fail until
     * they have agreed. This is what the UI turns into the attestation step.
     */
    it('acceptance is refused while the nominee has accepted no terms', async () => {
        await team.admin.client.rpc('nominate_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.coach.memberId,
        });

        const { error } = await team.coach.client.rpc('accept_team_admin_nomination', {
            p_team_id: team.id,
        });

        expect(error?.message).toMatch(/must accept the terms/i);
        expect(await roleOf(team.admin.memberId)).toBe('admin');
        expect(await roleOf(team.coach.memberId)).toBe('coach');
    });

    it('once the nominee attests, acceptance moves the role and clears the nomination', async () => {
        await fixtures.attest(team.coach.id, 'terms');
        await team.admin.client.rpc('nominate_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.coach.memberId,
        });

        const { data } = await team.coach.client.rpc('accept_team_admin_nomination', {
            p_team_id: team.id,
        });

        expect(data).toMatchObject({
            success: true,
            admin_member_id: team.coach.memberId,
            previous_admin_member_id: team.admin.memberId,
        });
        expect(await roleOf(team.coach.memberId)).toBe('admin');
        // Demoted to coach, NOT removed: a retiring teacher may still be around for weeks.
        expect(await roleOf(team.admin.memberId)).toBe('coach');
        expect((await nomination(team.id)).pending_admin_member_id).toBeNull();
    });

    it('the team never has two admins, nor none, at any point in the transfer', async () => {
        await fixtures.attest(team.coach.id, 'terms');
        await team.admin.client.rpc('nominate_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.coach.memberId,
        });
        await team.coach.client.rpc('accept_team_admin_nomination', { p_team_id: team.id });

        const { data } = await svc
            .from('team_members')
            .select('id')
            .eq('team_id', team.id)
            .eq('role', 'admin')
            .neq('status', 'removed');

        expect(data).toHaveLength(1);
    });

    it('the nominee may decline, which withdraws the nomination without moving the role', async () => {
        await team.admin.client.rpc('nominate_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.coach.memberId,
        });

        const { data } = await team.coach.client.rpc('cancel_team_admin_nomination', {
            p_team_id: team.id,
        });

        expect(data).toMatchObject({ success: true });
        expect((await nomination(team.id)).pending_admin_member_id).toBeNull();
        expect(await roleOf(team.admin.memberId)).toBe('admin');
    });

    it('an expired nomination is refused rather than honoured late', async () => {
        await fixtures.attest(team.coach.id, 'terms');
        await team.admin.client.rpc('nominate_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.coach.memberId,
        });
        // 14-day TTL; backdate past it with the service client.
        await svc
            .from('teams')
            .update({
                pending_admin_nominated_at: new Date(Date.now() - 15 * 864e5).toISOString(),
            } as never)
            .eq('id', team.id);

        const { data } = await team.coach.client.rpc('accept_team_admin_nomination', {
            p_team_id: team.id,
        });

        expect(data).toMatchObject({ success: false });
        expect((data as { error: string }).error).toMatch(/expired/i);
        expect(await roleOf(team.coach.memberId)).toBe('coach');
    });
});

describe('the warm path — who may do what', () => {
    /*
     * THE ESCALATION THIS SPRINT ALMOST SHIPPED.
     *
     * `teams_update_manager` grants UPDATE on `teams` to `can_manage_roster`, which is admin
     * OR COACH. So the column deciding who may become admin is writable over plain REST by
     * somebody who must not decide it: PATCH `pending_admin_member_id` to your own member row,
     * then call `accept_team_admin_nomination`, and you are the team admin in two ordinary
     * requests without either RPC's authority check ever running.
     *
     * `enforce_admin_nomination_authority` is the rule; the RPCs are ergonomics in front of
     * it. This test asserts the boundary where it actually lives.
     */
    it('a coach cannot nominate themselves by writing the column directly', async () => {
        const { error } = await team.coach.client
            .from('teams')
            .update({ pending_admin_member_id: team.coach.memberId } as never)
            .eq('id', team.id);

        expect(error).not.toBeNull();
        expect(error!.message).toMatch(/only the team admin can nominate/i);
        expect((await nomination(team.id)).pending_admin_member_id).toBeNull();
    });

    it('a coach cannot nominate themselves through the RPC either', async () => {
        const { data } = await team.coach.client.rpc('nominate_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.coach.memberId,
        });

        expect(data).toMatchObject({ success: false });
        expect((data as { error: string }).error).toMatch(/only the team admin/i);
    });

    it('a student cannot accept a nomination that names somebody else', async () => {
        await team.admin.client.rpc('nominate_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.coach.memberId,
        });

        const { data } = await team.users.student.client.rpc('accept_team_admin_nomination', {
            p_team_id: team.id,
        });

        expect(data).toMatchObject({ success: false });
        expect((data as { error: string }).error).toMatch(/not the nominee/i);
        expect(await roleOf(team.coach.memberId)).toBe('coach');
    });

    it('accepting with no nomination in flight is refused', async () => {
        const { data } = await team.coach.client.rpc('accept_team_admin_nomination', {
            p_team_id: team.id,
        });

        expect(data).toMatchObject({ success: false });
        expect((data as { error: string }).error).toMatch(/no admin nomination/i);
    });

    it('a member of another team cannot nominate into this one', async () => {
        const other = await fixtures.createTeam('bystander');

        const { data } = await other.admin.client.rpc('nominate_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.coach.memberId,
        });

        expect(data).toMatchObject({ success: false });
        expect((await nomination(team.id)).pending_admin_member_id).toBeNull();
    });

    /*
     * NOMINATION REFUSES AN UNDER-18 UP FRONT, and this test exists because the first version did
     * not.
     *
     * Found by running the console: the successor dropdown offered eleven 13-to-17 students,
     * because `team_members` carries no age column so the client cannot filter them. The
     * nomination SUCCEEDED and the refusal landed on the student at acceptance — leaving the admin
     * believing they had handed the team over, and the refusal in front of the one person who
     * could neither act on it nor explain it.
     */
    it('a student under 18 cannot be nominated, and the admin is told at nomination time', async () => {
        const minor = await fixtures.createUser('minor', '13_to_17');
        const { data: member } = await svc
            .from('team_members')
            .insert({
                team_id: team.id,
                user_id: minor.id,
                role: 'student',
                status: 'approved',
                seat_assigned: true,
                full_name: 'Minor Student',
                email: minor.email,
            } as never)
            .select()
            .single();
        const memberId = (member as { id: string }).id;

        // Even with the terms accepted, age alone must refuse it.
        await fixtures.attest(minor.id, 'terms');

        const { data } = await team.admin.client.rpc('nominate_team_admin', {
            p_team_id: team.id,
            p_new_member_id: memberId,
        });

        expect(data).toMatchObject({ success: false });
        expect((data as { error: string }).error).toMatch(/18 or over/i);
        // And nothing was recorded, so the admin is not left with a nomination that can never
        // complete.
        expect((await nomination(team.id)).pending_admin_member_id).toBeNull();
        expect(await roleOf(memberId)).toBe('student');

        await svc.from('team_members').delete().eq('id', memberId);
    });

    /*
     * The trigger remains the authority. If a nomination somehow existed for an under-18 member —
     * an older row, or a direct write by the service role — promotion must still be refused.
     */
    it('and the eligibility trigger still refuses the promotion regardless', async () => {
        const minor = await fixtures.createUser('minor-direct', '13_to_17');
        const { data: member } = await svc
            .from('team_members')
            .insert({
                team_id: team.id,
                user_id: minor.id,
                role: 'student',
                status: 'approved',
                seat_assigned: true,
                full_name: 'Minor Direct',
                email: minor.email,
            } as never)
            .select()
            .single();
        const memberId = (member as { id: string }).id;

        const { error } = await svc
            .from('team_members')
            .update({ role: 'admin' } as never)
            .eq('id', memberId);

        expect(error?.message).toMatch(/requires an 18\+ account/i);
        expect(await roleOf(memberId)).toBe('student');

        await svc.from('team_members').delete().eq('id', memberId);
    });
});

describe('the cold path — the admin is already gone', () => {
    /**
     * Strand the team: delete the admin's membership outright, as would happen if their
     * account were removed. Their `teams.owner_id` reference is untouched, which is what makes
     * this recoverable at all.
     */
    async function strandTeam() {
        await svc.from('team_members').delete().eq('id', team.admin.memberId);
    }

    async function unstrandTeam() {
        await svc.from('team_members').delete().eq('team_id', team.id).eq('role', 'admin');
        await svc
            .from('team_members')
            .insert({
                id: team.admin.memberId,
                team_id: team.id,
                user_id: team.admin.id,
                role: 'admin',
                status: 'approved',
                seat_assigned: true,
                full_name: 'handover admin',
                email: team.admin.email,
            } as never);
    }

    it('a stranded team really is stuck — no warm path can produce an admin', async () => {
        await strandTeam();
        try {
            const { data: nominated } = await team.coach.client.rpc('nominate_team_admin', {
                p_team_id: team.id,
                p_new_member_id: team.coach.memberId,
            });
            expect(nominated).toMatchObject({ success: false });

            const { data: transferred } = await team.coach.client.rpc('transfer_team_admin', {
                p_team_id: team.id,
                p_new_member_id: team.coach.memberId,
            });
            expect(transferred).toMatchObject({ success: false });

            const { data } = await svc
                .from('team_members')
                .select('id')
                .eq('team_id', team.id)
                .eq('role', 'admin');
            expect(data).toHaveLength(0);
        } finally {
            await unstrandTeam();
        }
    });

    it('the platform operator can reassign a stranded team, and the successor keeps its rules', async () => {
        await fixtures.attest(team.coach.id, 'terms');
        await svc.from('platform_operators').insert({ user_id: team.users.mentor.id } as never);
        await strandTeam();

        try {
            const { data } = await team.users.mentor.client.rpc('operator_transfer_team_admin', {
                p_team_id: team.id,
                p_new_member_id: team.coach.memberId,
                p_notes: 'coach retired; successor confirmed by email',
            });

            expect(data).toMatchObject({ success: true, admin_member_id: team.coach.memberId });
            expect(await roleOf(team.coach.memberId)).toBe('admin');

            // The override leaves a trail, and it records that the team was stranded — the
            // fact that justifies the operator having acted at all.
            const { data: audit } = await svc
                .from('operator_actions')
                .select('operator_user_id, action, detail, notes')
                .eq('team_id', team.id);
            expect(audit).toHaveLength(1);
            expect(audit![0]).toMatchObject({
                operator_user_id: team.users.mentor.id,
                action: 'admin_transfer',
                notes: 'coach retired; successor confirmed by email',
            });
            expect(audit![0].detail).toMatchObject({
                new_admin_member_id: team.coach.memberId,
                team_was_stranded: true,
            });
        } finally {
            await svc.from('platform_operators').delete().eq('user_id', team.users.mentor.id);
            await svc.from('operator_actions').delete().eq('team_id', team.id);
            await svc.from('team_members').update({ role: 'coach' } as never).eq('id', team.coach.memberId);
            await unstrandTeam();
        }
    });

    /*
     * An audit trail a caller can append to is not evidence. The table has a SELECT policy and
     * nothing else, on purpose, and the rows come from a SECURITY DEFINER function.
     */
    it('the audit trail is operator-readable and nobody-writable through the API', async () => {
        await svc.from('platform_operators').insert({ user_id: team.users.mentor.id } as never);
        try {
            const { error: insertRefused } = await team.users.mentor.client
                .from('operator_actions')
                .insert({
                    operator_user_id: team.users.mentor.id,
                    team_id: team.id,
                    action: 'admin_transfer',
                } as never);
            expect(insertRefused).not.toBeNull();

            // ...and the team's own admin cannot read platform decisions about them.
            const { data: asAdmin } = await team.admin.client.from('operator_actions').select('id');
            expect(asAdmin).toEqual([]);
        } finally {
            await svc.from('platform_operators').delete().eq('user_id', team.users.mentor.id);
        }
    });

    it('a non-operator cannot use the operator transfer, even as the team admin', async () => {
        const { data } = await team.admin.client.rpc('operator_transfer_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.coach.memberId,
        });

        expect(data).toMatchObject({ success: false, error: 'Not a platform operator' });
        expect(await roleOf(team.coach.memberId)).toBe('coach');
    });

    it('the operator cannot promote somebody the eligibility rules refuse', async () => {
        await svc.from('platform_operators').insert({ user_id: team.users.mentor.id } as never);
        try {
            // The student has attested to nothing, so the trigger refuses the promotion and
            // the operator's elevated identity does not change that.
            const { error } = await team.users.mentor.client.rpc('operator_transfer_team_admin', {
                p_team_id: team.id,
                p_new_member_id: team.users.student.memberId,
            });

            expect(error).not.toBeNull();
            expect(await roleOf(team.users.student.memberId)).toBe('student');
            expect(await roleOf(team.admin.memberId)).toBe('admin');
        } finally {
            await svc.from('platform_operators').delete().eq('user_id', team.users.mentor.id);
        }
    });
});

describe('an existing admin is never re-validated', () => {
    /*
     * THE TRAP THIS SPRINT WAS WARNED ABOUT.
     *
     * Sprint 6 rewrites the legal documents and bumps their versions, which means every
     * existing attestation becomes an OLD version. If holding the admin role were re-checked
     * on any write to the member row, bumping a version would lock every current admin --
     * including Kevin, on the one production team -- out of the console that could fix it.
     *
     * `enforce_member_role_eligibility` short-circuits when `role` and `user_id` are both
     * unchanged, so an ordinary UPDATE never re-asks. That property is load-bearing and
     * nothing else in the suite covers it.
     */
    it('an unrelated update to the admin\'s own row does not re-check their attestation', async () => {
        await svc.from('user_attestations').delete().eq('user_id', team.admin.id);

        try {
            const { error } = await svc
                .from('team_members')
                .update({ full_name: 'Renamed Admin' } as never)
                .eq('id', team.admin.memberId);

            expect(error).toBeNull();
            expect(await roleOf(team.admin.memberId)).toBe('admin');
        } finally {
            await fixtures.attest(team.admin.id, 'coach_terms');
        }
    });

    it('but granting the admin role afresh still requires one', async () => {
        await svc.from('user_attestations').delete().eq('user_id', team.users.mentor.id);

        const { error } = await svc
            .from('team_members')
            .update({ role: 'admin' } as never)
            .eq('id', team.users.mentor.memberId);

        expect(error).not.toBeNull();
        expect(await roleOf(team.users.mentor.memberId)).toBe('mentor');
    });
});

describe('attestations keep their history across a version bump', () => {
    /*
     * The old unique key was (user_id, attestation_type), and `recordAttestation` upserts on
     * it -- so accepting v2 of the terms DELETED the record of having accepted v1. Widening
     * the key to include `version` is what makes "which version did they accept, and when" an
     * answerable question, which is the only thing an attestation exists for.
     */
    it('accepting a new version keeps the old row rather than replacing it', async () => {
        const user = await fixtures.createUser('versioned');

        await svc
            .from('user_attestations')
            .insert({ user_id: user.id, attestation_type: 'terms', version: '1.0' } as never);
        await svc
            .from('user_attestations')
            .insert({ user_id: user.id, attestation_type: 'terms', version: '2.0' } as never);

        const { data } = await svc
            .from('user_attestations')
            .select('version')
            .eq('user_id', user.id)
            .eq('attestation_type', 'terms')
            .order('version');

        expect(data?.map((r) => r.version)).toEqual(['1.0', '2.0']);
    });

    it('the same version twice is still refused — one acceptance per version', async () => {
        const user = await fixtures.createUser('idempotent');

        await svc
            .from('user_attestations')
            .insert({ user_id: user.id, attestation_type: 'terms', version: '1.0' } as never);
        const { error } = await svc
            .from('user_attestations')
            .insert({ user_id: user.id, attestation_type: 'terms', version: '1.0' } as never);

        expect(error?.code).toBe('23505');
    });
});

describe('seat capacity is the approval gate', () => {
    /** Members these tests add, removed after each one so seat arithmetic stays legible. */
    let addedMemberIds: string[] = [];

    /**
     * Count the seats the team is actually consuming right now.
     *
     * Read rather than assumed. The fixture's exact seated headcount is an implementation
     * detail of `createTeam` (four roles are seated; the guardian's child is not), and a test
     * that hardcodes it fails for a reason that has nothing to do with what it is testing.
     */
    async function seatsInUse(): Promise<number> {
        const { count } = await svc
            .from('team_members')
            .select('id', { count: 'exact', head: true })
            .eq('team_id', team.id)
            .eq('status', 'approved')
            .eq('seat_assigned', true);
        return count ?? 0;
    }

    /**
     * Give the team a grant sized to leave exactly `spare` seats free, replacing the
     * fixture's unlimited one. Returns a restore function.
     */
    async function withSpareSeats(spare: number) {
        const total = (await seatsInUse()) + spare;
        await svc
            .from('license_grants')
            .update({ revoked_at: new Date().toISOString() } as never)
            .eq('team_id', team.id);
        const { data, error } = await svc
            .from('license_grants')
            .insert({
                team_id: team.id,
                source: 'gift',
                seats: total,
                created_by: team.admin.id,
                notes: 'capacity test',
            } as never)
            .select()
            .single();
        if (error) throw new Error(`withSpareSeats(${spare}) failed: ${error.message}`);

        return async () => {
            await svc.from('license_grants').delete().eq('id', (data as { id: string }).id);
            await svc
                .from('license_grants')
                .update({ revoked_at: null } as never)
                .eq('team_id', team.id);
        };
    }

    /** A pending member, as `join_team_with_invite` would leave them. */
    async function addPendingMember(label: string) {
        const account = await fixtures.createUser(label);
        const { data, error } = await svc
            .from('team_members')
            .insert({
                team_id: team.id,
                user_id: account.id,
                role: 'student',
                status: 'pending',
                seat_assigned: false,
                full_name: label,
                email: account.email,
            } as never)
            .select()
            .single();
        if (error) throw new Error(`addPendingMember(${label}) failed: ${error.message}`);
        const id = (data as { id: string }).id;
        addedMemberIds.push(id);
        return id;
    }

    afterEach(async () => {
        for (const id of addedMemberIds) {
            await svc.from('team_members').delete().eq('id', id);
        }
        addedMemberIds = [];
    });

    it('a pending member occupies no seat', async () => {
        const restore = await withSpareSeats(5);
        try {
            const before = await svc.rpc('team_seats_remaining', { p_team_id: team.id });
            await addPendingMember('uncounted');
            const after = await svc.rpc('team_seats_remaining', { p_team_id: team.id });

            expect(after.data).toBe(before.data);
        } finally {
            await restore();
        }
    });

    /*
     * The whole model in one test. Share the code with more people than you have seats and
     * the extras pile up as pending requests; the refusal lands at APPROVAL, which is an
     * action an admin takes online and deliberately, rather than in the write path of a
     * student's phone at a competition.
     */
    it('approval is refused once the seats are gone, and the member stays pending', async () => {
        const restore = await withSpareSeats(0);
        try {
            const memberId = await addPendingMember('one-too-many');

            const { error } = await team.admin.client
                .from('team_members')
                .update({ status: 'approved', seat_assigned: true } as never)
                .eq('id', memberId);

            expect(error).not.toBeNull();
            expect(error!.message).toMatch(/no licensed seats available/i);

            const { data } = await svc
                .from('team_members')
                .select('status, seat_assigned')
                .eq('id', memberId)
                .single();
            expect(data).toMatchObject({ status: 'pending', seat_assigned: false });
        } finally {
            await restore();
        }
    });

    it('approval succeeds when a seat is free, and consumes it', async () => {
        const restore = await withSpareSeats(1);
        try {
            const memberId = await addPendingMember('welcome');
            expect((await svc.rpc('team_seats_remaining', { p_team_id: team.id })).data).toBe(1);

            const { error } = await team.admin.client
                .from('team_members')
                .update({ status: 'approved', seat_assigned: true } as never)
                .eq('id', memberId);

            expect(error).toBeNull();
            expect((await svc.rpc('team_seats_remaining', { p_team_id: team.id })).data).toBe(0);
        } finally {
            await restore();
        }
    });

    it('removing a member frees their seat again', async () => {
        const restore = await withSpareSeats(1);
        try {
            const memberId = await addPendingMember('transient');
            await team.admin.client
                .from('team_members')
                .update({ status: 'approved', seat_assigned: true } as never)
                .eq('id', memberId);
            expect((await svc.rpc('team_seats_remaining', { p_team_id: team.id })).data).toBe(0);

            const { error } = await team.admin.client
                .from('team_members')
                .delete()
                .eq('id', memberId);

            expect(error).toBeNull();
            expect((await svc.rpc('team_seats_remaining', { p_team_id: team.id })).data).toBe(1);
        } finally {
            await restore();
        }
    });

    it('a coach cannot approve — seats are the admin\'s alone', async () => {
        const restore = await withSpareSeats(5);
        try {
            const memberId = await addPendingMember('coach-approved');

            const { error } = await team.coach.client
                .from('team_members')
                .update({ status: 'approved', seat_assigned: true } as never)
                .eq('id', memberId);

            expect(error).not.toBeNull();
            expect(error!.message).toMatch(/only the team admin can assign a licensed seat/i);
        } finally {
            await restore();
        }
    });

    /*
     * An unlimited grant reports NULL remaining rather than a large number. The distinction
     * matters to the console, which has to render "unlimited" rather than "2147483647 left",
     * and to any caller tempted to compare with `< 1`.
     */
    it('an unlimited grant reports no limit rather than a big number', async () => {
        const { data } = await svc.rpc('team_seats_remaining', { p_team_id: team.id });
        expect(data).toBeNull();
    });

    /*
     * The team whose grant expired YESTERDAY. `enforce_seat_capacity` sums only in-force
     * grants, so an expired one contributes nothing and there is no seat to approve into --
     * which is the correct answer, and different from "this team has no grants at all" only
     * in what the UI should say about it.
     */
    it('a grant that expired yesterday leaves no seats to approve into', async () => {
        await svc
            .from('license_grants')
            .update({ revoked_at: new Date().toISOString() } as never)
            .eq('team_id', team.id);
        // `license_grants_valid_range` requires valid_until > valid_from, so a grant that
        // ended yesterday must also have STARTED in the past — which is what a real expiry
        // looks like anyway.
        const { data: expired, error: insertError } = await svc
            .from('license_grants')
            .insert({
                team_id: team.id,
                source: 'gift',
                seats: 20,
                valid_from: new Date(Date.now() - 30 * 864e5).toISOString(),
                valid_until: new Date(Date.now() - 864e5).toISOString(),
                created_by: team.admin.id,
                notes: 'expired yesterday',
            } as never)
            .select()
            .single();
        if (insertError) throw new Error(`expired grant insert failed: ${insertError.message}`);

        try {
            expect((await svc.rpc('team_seats_remaining', { p_team_id: team.id })).data).toBe(0);

            const account = await fixtures.createUser('too-late');
            const { data: pending } = await svc
                .from('team_members')
                .insert({
                    team_id: team.id,
                    user_id: account.id,
                    role: 'student',
                    status: 'pending',
                    full_name: 'too-late',
                    email: account.email,
                } as never)
                .select()
                .single();

            const { error } = await team.admin.client
                .from('team_members')
                .update({ status: 'approved', seat_assigned: true } as never)
                .eq('id', (pending as { id: string }).id);
            expect(error).not.toBeNull();

            await svc.from('team_members').delete().eq('id', (pending as { id: string }).id);
        } finally {
            await svc.from('license_grants').delete().eq('id', (expired as { id: string }).id);
            await svc.from('license_grants').update({ revoked_at: null } as never).eq('team_id', team.id);
        }
    });
});
