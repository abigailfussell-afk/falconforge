/**
 * WALK-B-03 — the promotion leaves a record, so the guardian is not told their child was
 *             dropped from the team.
 * WALK-B-05 — an approved member arriving at `/join/CODE` learns WHICH team.
 *
 * `guardian-promotion.db.test.ts` already proves the graduation keeps the membership row and
 * its attendance. What it could not prove — because there was nothing to prove it with — is
 * that anything RECORDED the graduation. `managed_profiles` had no such column, so
 * `GuardianView` inferred "no memberships → not on a team yet" and showed the parent who had
 * just handed the account over that their child had apparently been dropped, with a fresh
 * "Give them their own login" button underneath contradicting the "Nothing is lost" copy
 * beside it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures, mintAccessToken, type TestTeam } from './fixtures';
import { serviceClient, userClient } from './stack';

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('promotion-record');
}, 120_000);

afterAll(async () => {
    await fixtures.cleanup();
}, 120_000);

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

interface Offer {
    success: boolean;
    error?: string;
    code?: string;
}

/** Offer, then redeem, and return the child's account. */
async function graduate(label: string) {
    const guardian = team.guardian;
    const child = await createTeenAccount(label);

    const { data: offer } = await guardian.user.client.rpc('offer_managed_profile_promotion', {
        p_managed_profile_id: guardian.profileId,
    });
    const code = (offer as unknown as Offer).code!;
    expect(code, 'the guardian could not mint a code').toHaveLength(8);

    const { data: claim } = await child.client.rpc('claim_managed_profile', { p_code: code });
    expect(claim).toMatchObject({ success: true });

    return child;
}

describe('WALK-B-03 — the promotion is recorded', () => {
    /*
     * THE RED TEST. Without the two columns and the UPDATE that writes them, `promoted_at` is
     * null and `GuardianView` has no way to tell "handed over" from "never joined". Watched
     * red with the UPDATE's two new SET clauses removed.
     */
    it('writes promoted_to_user_id and promoted_at on the profile', async () => {
        const child = await graduate('recorded');

        const { data: profile } = await svc
            .from('managed_profiles')
            .select('promoted_to_user_id, promoted_at, promotion_code')
            .eq('id', team.guardian.profileId)
            .single();

        expect(profile!.promoted_to_user_id).toBe(child.id);
        expect(profile!.promoted_at).not.toBeNull();
        // The code is still single-use, as it was before.
        expect(profile!.promotion_code).toBeNull();
    });

    /*
     * The walkthrough found the "Give them their own login" button still offered afterwards,
     * and recorded that it did NOT test what a second account redeeming that code would get.
     * With this refusal the question stops needing an answer — and it is enforced on the
     * server, not only by hiding the button: `docs/failure-modes.md` §7 is four sprints of
     * rules that lived in exactly one of those two places.
     */
    it('the guardian cannot mint a second code afterwards', async () => {
        const { data } = await team.guardian.user.client.rpc('offer_managed_profile_promotion', {
            p_managed_profile_id: team.guardian.profileId,
        });

        const result = data as unknown as Offer;
        expect(result.success).toBe(false);
        expect(result.error).toContain('already has their own login');
        expect(result.code).toBeUndefined();

        // And nothing was written, so a refusal cannot be turned into a code by ignoring it.
        const { data: profile } = await svc
            .from('managed_profiles')
            .select('promotion_code')
            .eq('id', team.guardian.profileId)
            .single();
        expect(profile!.promotion_code).toBeNull();
    });

    /*
     * The consents survive, and that is a COPPA artefact rather than a nicety: plan §3 says
     * "the `managed_profiles` row and its consents are retained as the record of why the child
     * was rostered". A CASCADE on the new FK would have taken them with the account.
     */
    it('keeps the profile and its consents', async () => {
        const { data: profile } = await svc
            .from('managed_profiles')
            .select('id, full_name')
            .eq('id', team.guardian.profileId)
            .maybeSingle();
        expect(profile, 'the profile was deleted by the promotion').not.toBeNull();

        const { count } = await svc
            .from('guardian_consents')
            .select('id', { count: 'exact', head: true })
            .eq('managed_profile_id', team.guardian.profileId);
        expect(count).toBeGreaterThan(0);
    });

    /*
     * The column is server-written. A guardian PATCHing it directly would be claiming their
     * child had graduated without any account existing to graduate to — which would hide the
     * membership from their own view and offer nothing in its place. Checked behaviourally as
     * the real role over PostgREST, never over the catalogue
     * (`docs/environment-divergences.md` §5).
     */
    it('a guardian cannot write it themselves', async () => {
        const { error } = await team.guardian.user.client
            .from('managed_profiles')
            .update({ promoted_to_user_id: null } as never)
            .eq('id', team.guardian.profileId);

        expect(error, 'a guardian could rewrite the promotion record').not.toBeNull();
        expect(error!.code).toBe('42501');
    });
});

describe('WALK-B-05 — an approved member arriving with a code', () => {
    /*
     * THE RED TEST. The refusal is unchanged — an invite code does not re-add anybody — but it
     * used to say only "You are already a member of this team", which left the student on a
     * join form with no route into the team except knowing to type an `/app` URL. The exit
     * criterion is that they are SENT INTO the team, and the client cannot do that without the
     * id.
     */
    it('is told which team, so the client can put them in it', async () => {
        const { data: invite } = await svc
            .from('invites')
            .insert({
                team_id: team.id,
                code: `B05${Math.floor(Math.random() * 100000)}`,
                created_by: team.users.admin.id,
            } as never)
            .select('code')
            .single();

        const { data } = await team.users.student.client.rpc('join_team_with_invite', {
            invite_code: (invite as { code: string }).code,
        });

        const result = data as unknown as {
            success: boolean;
            error_code?: string;
            team_id?: string;
            team_name?: string;
            status?: string;
        };

        // Still a refusal: a code does not re-add anybody, and the membership is untouched.
        expect(result.success).toBe(false);
        expect(result.error_code).toBe('already_member');
        // ...but it now names the team.
        expect(result.team_id).toBe(team.id);
        expect(result.team_name).toBeTruthy();
        expect(result.status).toBe('approved');
    });

    /*
     * THE LINE THIS MUST NOT CROSS, and it gets its own test because "return more from the
     * error" is the kind of change that spreads. D3's `team_number_taken` deliberately
     * withholds the team id from a caller who is NOT on the team — B21's "knowing a team's
     * uuid is the entire attack". Returning it here is safe ONLY because the caller is already
     * a member and holds a valid code; a stranger with a code gets the ordinary pending join,
     * not an id.
     */
    it('a non-member with the same code still just joins, pending', async () => {
        const outsider = await fixtures.createUser('b05-outsider');
        const outsiderClient = userClient(outsider.token);

        const { data: invite } = await svc
            .from('invites')
            .insert({
                team_id: team.id,
                code: `B05O${Math.floor(Math.random() * 10000)}`,
                created_by: team.users.admin.id,
            } as never)
            .select('code')
            .single();

        const { data } = await outsiderClient.rpc('join_team_with_invite', {
            invite_code: (invite as { code: string }).code,
        });

        const result = data as unknown as { success: boolean; status?: string; error_code?: string };
        expect(result.success).toBe(true);
        expect(result.status).toBe('pending');
        expect(result.error_code).toBeUndefined();
    });
});
