/**
 * Default-deny for the RPC surface: an unauthenticated caller cannot EXECUTE the admin RPCs.
 *
 * The schema grants EXECUTE on every function to `anon` (`GRANT ALL ON ALL FUNCTIONS`, plus
 * ALTER DEFAULT PRIVILEGES so new ones inherit it), which is how `transfer_team_admin` --
 * SECURITY DEFINER, and the RPC B25 turned into a working cross-tenant escalation -- came to be
 * callable from the open internet. B25 itself is fixed at the root, so these calls were already
 * being refused by their own guards. This asserts they are refused ONE STEP EARLIER, at the
 * privilege check, where a mistake in a guard cannot reach.
 *
 * Asserted behaviourally rather than by reading `pg_proc` ACLs, for the same reason schema
 * assertion 20 asserts B25's behaviour rather than the function text: an ACL that looks right
 * and a call that is actually refused are different claims, and only one of them is the
 * security property.
 *
 * THE NEGATIVE SPACE IS ASSERTED TOO. Revoking the wrong thing here would be worse than
 * revoking nothing: the capability functions are called inside RLS policies and evaluated as
 * the calling role, so taking them from anon would turn every anonymous SELECT into "permission
 * denied for function" rather than the empty set. Sprint 3 verified anon gets `200 []` from
 * every table, and the last block below is what keeps that true.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { Fixtures, type TestTeam } from './fixtures';
import { anonClient } from './stack';

let fixtures: Fixtures;
let team: TestTeam;
let anon: SupabaseClient<Database>;

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('anonexec');
    anon = anonClient();
});

afterAll(async () => {
    await fixtures.cleanup();
});

/**
 * PostgREST reports a missing EXECUTE privilege as 42501 (insufficient_privilege), the same
 * SQLSTATE an RLS refusal uses -- so the message is what distinguishes them. Either shape is a
 * refusal at the privilege layer; what must NOT happen is the function running and answering.
 */
function expectRefused(error: { code?: string; message?: string } | null, fn: string) {
    expect(error, `${fn} answered an anonymous caller instead of refusing it`).not.toBeNull();
    const refused =
        error?.code === '42501' ||
        /permission denied|not find the function|does not exist/i.test(error?.message ?? '');
    expect(refused, `${fn} failed for the wrong reason: ${error?.code} ${error?.message}`).toBe(true);
}

describe('anon holds no EXECUTE on the administration RPCs', () => {
    it('cannot call transfer_team_admin — the RPC B25 made exploitable', async () => {
        const { error } = await anon.rpc('transfer_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.coach.memberId,
        });
        expectRefused(error, 'transfer_team_admin');
    });

    it('cannot call nominate_team_admin', async () => {
        const { error } = await anon.rpc('nominate_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.coach.memberId,
        });
        expectRefused(error, 'nominate_team_admin');
    });

    it('cannot call cancel_team_admin_nomination', async () => {
        const { error } = await anon.rpc('cancel_team_admin_nomination', { p_team_id: team.id });
        expectRefused(error, 'cancel_team_admin_nomination');
    });

    it('cannot call accept_team_admin_nomination', async () => {
        const { error } = await anon.rpc('accept_team_admin_nomination', { p_team_id: team.id });
        expectRefused(error, 'accept_team_admin_nomination');
    });

    it('cannot call operator_transfer_team_admin — the operator rescue path', async () => {
        const { error } = await anon.rpc('operator_transfer_team_admin', {
            p_team_id: team.id,
            p_new_member_id: team.coach.memberId,
            p_notes: 'anon should never get here',
        });
        expectRefused(error, 'operator_transfer_team_admin');
    });

    it('cannot call grant_team_license — the operator gifting path', async () => {
        const { error } = await anon.rpc('grant_team_license', {
            p_team_id: team.id,
            p_seats: 99,
            // undefined omits the argument so the function's DEFAULT applies; the generated
            // signature is `p_valid_until?: string`, not nullable.
            p_valid_until: undefined,
            p_notes: 'anon should never get here',
        });
        expectRefused(error, 'grant_team_license');
    });

    it('cannot call create_team_as_admin', async () => {
        const { error } = await anon.rpc('create_team_as_admin', {
            team_name: 'Anonymous Robotics',
            season_name: '2026-2027 Season',
        });
        expectRefused(error, 'create_team_as_admin');
    });

    it('cannot call join_team_with_invite', async () => {
        const { error } = await anon.rpc('join_team_with_invite', { invite_code: 'ABCD1234' });
        expectRefused(error, 'join_team_with_invite');
    });

    it('cannot call update_user_age_classification', async () => {
        const { error } = await anon.rpc('update_user_age_classification', { classification: '18_plus' });
        expectRefused(error, 'update_user_age_classification');
    });
});

describe('the policy predicates keep their grant, so anon still reads an empty app', () => {
    /*
     * These are the assertions that would fail if the revoke had been done with a wildcard.
     * An anonymous visitor must get the EMPTY SET from every table, not an error: the landing
     * page and the join-by-link page are both reachable signed out.
     */
    it.each(['teams', 'team_members', 'tasks', 'seasons', 'sub_teams', 'scouting_reports'])(
        'anon SELECT on %s returns an empty result rather than an error',
        async (table) => {
            const { data, error } = await anon.from(table as 'teams').select('*').limit(1);
            expect(error, `anon SELECT on ${table} errored: ${error?.message}`).toBeNull();
            expect(data).toEqual([]);
        },
    );

    it('anon can still read team_entitlement, which every policy predicate feeds', async () => {
        const { data, error } = await anon.from('team_entitlement').select('*').limit(1);
        expect(error, `anon SELECT on team_entitlement errored: ${error?.message}`).toBeNull();
        expect(data).toEqual([]);
    });
});

describe('anon holds no EXECUTE on the guardian RPCs', () => {
    /*
     * SPRINT 9 SHIPPED THESE REACHABLE, and the hosted project proved it: all four answered an
     * anonymous caller with 200 after the migration landed.
     *
     * `20260822000200_guardian_access.sql` ended with `REVOKE ALL ... FROM PUBLIC`, which is
     * the careful-looking half of the incantation and does nothing on its own.
     * `20260816000500_v2_grants.sql` sets ALTER DEFAULT PRIVILEGES granting every new function
     * to `anon`, so each one arrives with its OWN acl entry independent of PUBLIC's —
     * `20260819000000_revoke_anon_execute.sql` says exactly this in its header and revokes
     * `FROM PUBLIC, anon`. Sprint 9 read the header and wrote half the fix.
     *
     * Not exploitable: every one is SECURITY DEFINER and asks who the caller is on its first
     * executable line, and `auth.uid()` is NULL for anon. What was missing is the layer BEFORE
     * the guard, which is the whole point — "the guard is code, and code is what was wrong the
     * first time" (B25).
     */
    it('cannot call join_team_with_invite_for_child', async () => {
        const { error } = await anon.rpc('join_team_with_invite_for_child', {
            invite_code: team.inviteCode,
            p_managed_profile_id: team.guardian.profileId,
        });
        expectRefused(error, 'join_team_with_invite_for_child');
    });

    it('cannot call offer_managed_profile_promotion', async () => {
        const { error } = await anon.rpc('offer_managed_profile_promotion', {
            p_managed_profile_id: team.guardian.profileId,
        });
        expectRefused(error, 'offer_managed_profile_promotion');
    });

    it('cannot call withdraw_managed_profile_promotion', async () => {
        const { error } = await anon.rpc('withdraw_managed_profile_promotion', {
            p_managed_profile_id: team.guardian.profileId,
        });
        expectRefused(error, 'withdraw_managed_profile_promotion');
    });

    it('cannot call claim_managed_profile', async () => {
        // The one that takes over a roster place. An anonymous caller must not reach the code
        // that decides whether a claim code is valid, however well that code behaves.
        const { error } = await anon.rpc('claim_managed_profile', { p_code: 'ABCD2345' });
        expectRefused(error, 'claim_managed_profile');
    });
});

describe('anon holds no EXECUTE on the operator console RPCs', () => {
    /*
     * The console's three cross-tenant reads. `operator_team_directory` is the one that would
     * matter most if this were ever wrong: it is a SETOF function whose whole job is to return
     * every team on the platform with its admin's name and email, and its in-function guard is
     * `is_platform_operator()` -- which answers `false` for an anonymous caller, so the guard
     * alone would already refuse.
     *
     * That is exactly why the grant is tested too, and it is the B25 lesson rather than
     * belt-and-braces: "the guard is code, and code is what was wrong the first time". Sprint 9
     * shipped four RPCs anon could EXECUTE and they were safe only because each one asked who
     * the caller was on its first line. The privilege layer is the one that does not depend on
     * anybody having remembered.
     */
    it('cannot call operator_team_directory — the platform-wide team list', async () => {
        const { error } = await anon.rpc('operator_team_directory', {});
        expectRefused(error, 'operator_team_directory');
    });

    it('cannot call operator_team_detail', async () => {
        const { error } = await anon.rpc('operator_team_detail', { p_team_id: team.id });
        expectRefused(error, 'operator_team_detail');
    });

    it('cannot call operator_revoke_license', async () => {
        const { error } = await anon.rpc('operator_revoke_license', {
            p_team_id: team.id,
            p_all: true,
        });
        expectRefused(error, 'operator_revoke_license');
    });
});

describe('the guardian PREDICATES keep their anon grant, deliberately', () => {
    /*
     * THE NEGATIVE SPACE, and revoking these would be worse than revoking nothing.
     *
     * `is_team_guardian` and `guardian_member_ids` are called INSIDE the `teams`, `meetings`
     * and `meeting_attendance` SELECT policies, and a policy is evaluated as the CALLING role.
     * Take them from anon and every anonymous SELECT on those three tables raises "permission
     * denied for function" instead of returning `200 []` — which is what makes a signed-out
     * visitor see an empty app rather than an error page. Sprint 3 verified that property; this
     * is what keeps it true through Sprint 9's additions.
     */
    it('still answers anon with an empty set on the tables those predicates gate', async () => {
        for (const table of ['teams', 'meetings', 'meeting_attendance'] as const) {
            const { data, error } = await anon.from(table).select('id');
            expect(error, `anon got an error rather than an empty set from ${table}`).toBeNull();
            expect(data, `${table} leaked rows to anon`).toEqual([]);
        }
    });
});

