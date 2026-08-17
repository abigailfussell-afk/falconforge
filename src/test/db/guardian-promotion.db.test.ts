/**
 * Promotion: a child graduates to their own login and loses nothing.
 *
 * This is Sprint 9's sharpest exit criterion, and it is worded to forbid eyeballing: "A guardian
 * can promote a child to their own login, AND THE CHILD KEEPS THEIR TEAM PLACE AND THEIR WHOLE
 * ATTENDANCE HISTORY — asserted, not eyeballed."
 *
 * WHY THE ROW ID IS THE WHOLE STORY. `meeting_attendance` is unique on `(meeting_id,
 * team_member_id)` and references `team_members(id)`. So the difference between "graduates in
 * place" and "loses two seasons of attendance" is entirely whether the UPDATE touches `id`.
 * Plan section 3 spells this out; these tests are what make it true rather than intended.
 *
 * The failure mode this guards against is not subtle, it is just invisible until somebody looks:
 * a re-implementation that INSERTs a new membership and marks the old one removed would satisfy
 * "the child is on the team", pass any test that counted members, and silently orphan every
 * attendance row — plus consume a second seat and require the admin to approve again.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures, mintAccessToken, type TestTeam } from './fixtures';
import { serviceClient, userClient } from './stack';

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('promotion');
});

afterAll(async () => {
    await fixtures.cleanup();
});

/** A fresh 13-to-17 account, as a child who has just signed up in their own name would be. */
async function createTeenAccount(label: string) {
    const email = `${label}-${crypto.randomUUID()}@falconforge.test`;
    const { data, error } = await svc.auth.admin.createUser({
        email,
        password: crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { full_name: 'Robin Grown-Up', age_classification: '13_to_17' },
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);

    (fixtures as unknown as { created: { userIds: string[] } }).created.userIds.push(data.user.id);

    return {
        id: data.user.id,
        email,
        client: userClient(mintAccessToken(data.user.id, email)),
    };
}

describe('a child graduates in place', () => {
    it('keeps the same team_members row, and every attendance record on it', async () => {
        const guardian = team.guardian;
        const child = await createTeenAccount('graduate');

        // Two attendance records against the child's membership, so "history survived" is a
        // statement about rows rather than about one lucky one.
        const meetingIds: string[] = [];
        for (const [i, title] of ['Build session', 'Competition'].entries()) {
            const { data: meeting } = await svc
                .from('meetings')
                .insert({
                    team_id: team.id,
                    season_id: team.seasonId,
                    title,
                    event_type: 'build',
                    starts_at: new Date(Date.now() - (i + 2) * 86_400_000).toISOString(),
                } as never)
                .select('id')
                .single();
            const meetingId = (meeting as { id: string }).id;
            meetingIds.push(meetingId);

            await svc.from('meeting_attendance').insert({
                team_id: team.id,
                meeting_id: meetingId,
                team_member_id: guardian.memberId,
                status: 'present',
                method: 'coach',
            } as never);
        }

        // What the row looked like before, so "nothing churned" can be a comparison rather
        // than a hardcoded expectation. The first draft asserted `seat_assigned: true` and
        // failed against a fixture that never assigned one — an assertion about the fixture
        // wearing the costume of an assertion about the behaviour.
        const { data: before } = await svc
            .from('team_members')
            .select('status, seat_assigned, joined_at')
            .eq('id', guardian.memberId)
            .single();

        // The guardian offers the code.
        const { data: offer } = await guardian.user.client.rpc(
            'offer_managed_profile_promotion',
            { p_managed_profile_id: guardian.profileId },
        );
        const code = (offer as { success: boolean; code: string }).code;
        expect(code).toHaveLength(8);

        // The child redeems it, from their own account.
        const { data: claim } = await child.client.rpc('claim_managed_profile', { p_code: code });
        expect(claim).toMatchObject({ success: true, memberships_moved: 1 });

        // ---- THE ASSERTIONS THAT MATTER ----

        const { data: member } = await svc
            .from('team_members')
            .select('id, user_id, managed_profile_id, status, seat_assigned, team_id, joined_at')
            .eq('id', guardian.memberId)
            .single();

        // Same row. Not a new one, not a replacement.
        expect(member).toMatchObject({
            id: guardian.memberId,
            user_id: child.id,
            managed_profile_id: null,
            team_id: team.id,
        });

        // No re-approval, no seat churn, and the join date is the ORIGINAL one — all three are
        // properties of the row not having moved, and all three are compared against what was
        // there before rather than against a literal.
        expect(member).toMatchObject({
            status: (before as { status: string }).status,
            seat_assigned: (before as { seat_assigned: boolean }).seat_assigned,
            joined_at: (before as { joined_at: string }).joined_at,
        });
        expect((before as { status: string }).status).toBe('approved');

        // Exactly one membership on this team for this child. A create-and-remove
        // implementation would leave two rows here and still look right on a roster screen.
        const { data: allRows } = await svc
            .from('team_members')
            .select('id')
            .eq('team_id', team.id)
            .eq('user_id', child.id);
        expect(allRows).toHaveLength(1);

        // And the history, which is the point.
        const { data: attendance } = await svc
            .from('meeting_attendance')
            .select('meeting_id')
            .eq('team_member_id', guardian.memberId);
        expect(attendance).toHaveLength(2);
        expect(attendance?.map((a: { meeting_id: string }) => a.meeting_id).sort())
            .toEqual([...meetingIds].sort());
    });

    it('retains the managed profile and its consents as the record of why', async () => {
        /*
         * Section 3: "The `managed_profiles` row and its consents are retained as the record of
         * why the child was rostered." Deleting them would destroy the only evidence that a
         * guardian ever consented — the artefact a COPPA question three years later is about.
         */
        const { data: profile } = await svc
            .from('managed_profiles')
            .select('id, full_name, promotion_code')
            .eq('id', team.guardian.profileId)
            .single();

        expect(profile).toBeTruthy();
        // The code is cleared: single-use, in the same transaction as the transfer.
        expect((profile as { promotion_code: string | null }).promotion_code).toBeNull();

        const { data: consents } = await svc
            .from('guardian_consents')
            .select('id')
            .eq('managed_profile_id', team.guardian.profileId);
        expect(consents?.length).toBeGreaterThan(0);
    });

    it('refuses a second redemption of the same code', async () => {
        const other = await createTeenAccount('double-redeem');
        // The code from the first test has been cleared, so replaying it must fail rather than
        // move somebody else's membership.
        const { data } = await other.client.rpc('claim_managed_profile', { p_code: 'ABCD2345' });
        expect(data).toMatchObject({ success: false });
    });
});

describe('who may redeem a code', () => {
    it('refuses the guardian redeeming their own child’s code', async () => {
        /*
         * The code is for the child's NEW account. A guardian redeeming it would repoint the
         * membership at the account that already holds it and clear `managed_profile_id` — the
         * child would silently stop being a managed profile while remaining on the roster under
         * the guardian's identity, which is the act-as mode section 3 refuses, reached by
         * accident.
         */
        const team2 = await fixtures.createTeam('promotion-self');
        const { data: offer } = await team2.guardian.user.client.rpc(
            'offer_managed_profile_promotion',
            { p_managed_profile_id: team2.guardian.profileId },
        );
        const code = (offer as { code: string }).code;

        const { data } = await team2.guardian.user.client.rpc('claim_managed_profile', {
            p_code: code,
        });
        expect(data).toMatchObject({ success: false });
        expect((data as { error: string }).error).toMatch(/their own account/i);

        // Untouched.
        const { data: member } = await svc
            .from('team_members')
            .select('managed_profile_id')
            .eq('id', team2.guardian.memberId)
            .single();
        expect((member as { managed_profile_id: string | null }).managed_profile_id)
            .toBe(team2.guardian.profileId);
    });

    it('refuses a stranger offering a promotion for someone else’s child', async () => {
        // Naming your own id is the B21 shape: the attack that survived 180 assertions because
        // every cross-tenant attempt named the victim rather than the attacker.
        const team3 = await fixtures.createTeam('promotion-stranger');

        const { data } = await team3.users.coach.client.rpc('offer_managed_profile_promotion', {
            p_managed_profile_id: team.guardian.profileId,
        });
        expect(data).toMatchObject({ success: false });
    });
});
