/**
 * SEC-16 — the two guardian edges that outlive the guardian.
 *
 * Neither of these produces an error, which is why neither was found by anything failing.
 *
 *   1. A guardian's roster row for a child carries the CHILD's name and the GUARDIAN's email —
 *      the COPPA model made concrete, since a managed child has no address of their own.
 *      `sync_user_to_team_members` filters on `managed_profile_id IS NULL` so that renaming
 *      yourself does not rename every child you are responsible for, which is right; the cost
 *      was that changing your EMAIL never reached them either, and the one contactable address
 *      a coach has for that child went stale silently.
 *
 *   2. `operator_erase_user` deletes `managed_profiles WHERE guardian_user_id = ...`. For a
 *      child who has since claimed their own login that destroys the record the plan says is
 *      retained ("the `managed_profiles` row and its consents are retained as the record of why
 *      the child was rostered") — while their membership and attendance, repointed at their own
 *      user id by `claim_managed_profile`, survive. The team keeps the member and loses the
 *      reason they were ever rostered.
 *
 * WHY db TESTS. Both are a trigger and a SECURITY DEFINER function; a mock can express neither,
 * and `docs/failure-modes.md` §2's worst variant is a test asserting against a mock incapable of
 * representing the property under test.
 *
 * WHAT WOULD MAKE THESE FAIL: reverting either half of
 * `20260831000000_sec_16_guardian_edges.sql`. Both were watched red that way.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures } from './fixtures';
import { serviceClient, userClient } from './stack';

let fixtures: Fixtures;
const svc = serviceClient();

async function makeOperator(label: string) {
    const account = await fixtures.createUser(label);
    await fixtures.attest(account.id);
    await svc.from('platform_operators').insert({ user_id: account.id } as never);
    return { ...account, client: userClient(account.token) };
}

beforeAll(async () => {
    fixtures = new Fixtures();
}, 120_000);

afterAll(async () => {
    await fixtures.cleanup();
}, 120_000);

// =================================================================================================
describe('a guardian changes their email', () => {
    it('carries the new address onto the child’s roster row', async () => {
        const team = await fixtures.createTeam('sec16-email');
        const { user: guardian, memberId } = team.guardian;

        const { data: before } = await svc
            .from('team_members')
            .select('email, full_name')
            .eq('id', memberId)
            .single();
        const childName = (before as { full_name: string }).full_name;
        expect((before as { email: string }).email).toBe(guardian.email);

        const changed = `changed-${guardian.email}`;
        // Through `public.users`, which is where the trigger lives and where a profile edit
        // lands. The auth-side path (`handle_new_user` on UPDATE of `auth.users`) writes the
        // same column, so this is the narrower and stricter of the two entry points.
        const { error } = await svc.from('users').update({ email: changed } as never).eq('id', guardian.id);
        expect(error).toBeNull();

        const { data: after } = await svc
            .from('team_members')
            .select('email, full_name')
            .eq('id', memberId)
            .single();

        expect((after as { email: string }).email, 'the child’s row kept the old address').toBe(
            changed,
        );
        /*
         * And the CHILD'S NAME is untouched, which is the reason the original filter existed.
         * A fix that dropped `managed_profile_id IS NULL` from the first UPDATE would pass the
         * email assertion above and rename every child the guardian is responsible for.
         */
        expect((after as { full_name: string }).full_name, 'the child was renamed').toBe(childName);
    });

    it('carries it through the AUTH path too, which is how a real email change happens', async () => {
        /*
         * There is no in-app email-change screen: a guardian changes their address through
         * Supabase's own auth flow, which updates `auth.users`. `handle_new_user` fires on that
         * UPDATE and copies the address into `public.users`, whose own trigger is the one this
         * migration changed. Two triggers in a row, and the test above only exercises the second
         * — which is `docs/environment-divergences.md`'s thesis in miniature: the path under test
         * was not the path a user takes.
         */
        const team = await fixtures.createTeam('sec16-auth-email');
        const { user: guardian, memberId } = team.guardian;

        const next = `auth-changed-${guardian.email}`;
        const { error } = await svc.auth.admin.updateUserById(guardian.id, {
            email: next,
            email_confirm: true,
        });
        expect(error).toBeNull();

        const { data: after } = await svc
            .from('team_members')
            .select('email')
            .eq('id', memberId)
            .single();
        expect((after as { email: string }).email).toBe(next);
    });

    it('still does not rename a child when the guardian renames themselves', async () => {
        const team = await fixtures.createTeam('sec16-rename');
        const { user: guardian, memberId } = team.guardian;

        const { data: before } = await svc
            .from('team_members')
            .select('full_name, email')
            .eq('id', memberId)
            .single();

        await svc.from('users').update({ full_name: 'Renamed Guardian' } as never).eq('id', guardian.id);

        const { data: after } = await svc
            .from('team_members')
            .select('full_name, email')
            .eq('id', memberId)
            .single();

        expect((after as { full_name: string }).full_name).toBe(
            (before as { full_name: string }).full_name,
        );
        expect((after as { full_name: string }).full_name).not.toBe('Renamed Guardian');
    });
});

// =================================================================================================
describe('erasing a guardian', () => {
    it('takes a child who never graduated with them', async () => {
        // Unchanged behaviour, asserted because the fix narrows the DELETE that does it. A child
        // with no login exists in this product only through their guardian — no account, no
        // address, every field entered by the adult being erased — so they go too.
        const team = await fixtures.createTeam('sec16-erase-managed');
        const operator = await makeOperator('sec16-op-a');
        const { user: guardian, profileId, memberId } = team.guardian;

        const { data } = await operator.client.rpc('operator_erase_user', {
            p_user_id: guardian.id,
        });
        expect(data).toMatchObject({ success: true });

        const { data: profile } = await svc
            .from('managed_profiles')
            .select('id')
            .eq('id', profileId)
            .maybeSingle();
        expect(profile, 'a non-graduated child’s profile survived the erasure').toBeNull();

        const { data: member } = await svc
            .from('team_members')
            .select('id')
            .eq('id', memberId)
            .maybeSingle();
        expect(member).toBeNull();
    });

    it('KEEPS the record for a child who has their own login now', async () => {
        const team = await fixtures.createTeam('sec16-erase-promoted');
        const operator = await makeOperator('sec16-op-b');
        const { user: guardian, profileId, memberId } = team.guardian;

        // Graduate the child: the guardian offers a code and the child redeems it from their own
        // account, which repoints the membership and records the promotion.
        const child = await fixtures.createUser('sec16-child');
        await fixtures.attest(child.id);
        const childClient = userClient(child.token);

        const { data: offer } = await guardian.client.rpc('offer_managed_profile_promotion', {
            p_managed_profile_id: profileId,
        });
        const code = (offer as { success: boolean; code: string }).code;
        const { data: claim } = await childClient.rpc('claim_managed_profile', { p_code: code });
        expect(claim).toMatchObject({ success: true, memberships_moved: 1 });

        // Give the child something to lose, recorded against their own membership.
        await svc.from('managed_profiles').update({ notes: 'Nut allergy' } as never).eq('id', profileId);

        const { data: erased } = await operator.client.rpc('operator_erase_user', {
            p_user_id: guardian.id,
        });
        expect(erased).toMatchObject({ success: true });

        // ---- THE ASSERTION THAT MATTERS ----
        const { data: profile } = await svc
            .from('managed_profiles')
            .select('id, full_name, notes, promoted_to_user_id')
            .eq('id', profileId)
            .maybeSingle();

        expect(profile, 'the graduated child’s record was destroyed with their guardian').not.toBeNull();
        const row = profile as { full_name: string; notes: string; promoted_to_user_id: string };
        expect(row.promoted_to_user_id).toBe(child.id);
        // The child's own name stays — it is theirs, and their account carries it too.
        expect(row.full_name).not.toBe('');
        // The guardian's free text about the child does not. That is what an erasure is for.
        expect(row.notes, 'the guardian’s notes about the child survived the erasure').toBe('');

        // And the consents, which are the point of retaining the row at all.
        const { data: consents } = await svc
            .from('guardian_consents')
            .select('consent_type')
            .eq('managed_profile_id', profileId);
        expect((consents ?? []).length, 'the consent record went with the guardian').toBeGreaterThan(0);

        // The membership is the child's now and survives regardless — asserted so a future
        // change to the DELETE cannot take it without this file noticing.
        const { data: member } = await svc
            .from('team_members')
            .select('id, user_id, managed_profile_id')
            .eq('id', memberId)
            .maybeSingle();
        expect(member).not.toBeNull();
        expect((member as { user_id: string }).user_id).toBe(child.id);
        expect((member as { managed_profile_id: string | null }).managed_profile_id).toBeNull();
    });
});
