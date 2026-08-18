/**
 * C7 — behavioural tenant isolation.
 *
 * Until now the repo asserted only that a policy *exists* (`schema_assertions.sql` checks
 * `relrowsecurity`). Nothing proved that Team A cannot read Team B's rows. That is not a
 * hypothetical gap: this repo's own history contains a real invite-exposure hole, where
 * `invites_select_all USING (true)` let any authenticated user read every team's invite
 * codes for months. A policy existing tells you nothing about what it permits.
 *
 * So this suite asks the only question that matters, of a real database: with a real JWT
 * for a member of Team A, what can I actually do to Team B's rows?
 *
 * Two teams, all four roles, plus an unauthenticated client. Every table gets SELECT,
 * INSERT, UPDATE and DELETE attempted across the tenant boundary.
 *
 * THE POSITIVE CONTROLS MATTER AS MUCH AS THE NEGATIVE ONES. A database with RLS enabled
 * and no policies at all would pass every isolation assertion below while being completely
 * broken. The `same-team access still works` block is what stops this suite from being
 * satisfied by an app nobody can use.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { Fixtures, type TestTeam, type Role } from './fixtures';
import { anonClient } from './stack';

const ROLES: Role[] = ['admin', 'coach', 'mentor', 'student'];

let fixtures: Fixtures;
let teamA: TestTeam;
let teamB: TestTeam;
let anon: SupabaseClient<Database>;

beforeAll(async () => {
    fixtures = new Fixtures();
    // Sequential: team A's creation must finish before B's, so a failure names one team.
    teamA = await fixtures.createTeam('alpha');
    teamB = await fixtures.createTeam('bravo');
    anon = anonClient();
});

afterAll(async () => {
    await fixtures.cleanup();
});

/**
 * Every table, with the row in team B that a team A user must not be able to touch, and a
 * row they must not be able to create there.
 */
function crossTenantCases() {
    return [
        {
            table: 'tasks',
            id: () => teamB.taskId,
            update: { title: 'stolen' },
            insert: () => ({
                team_id: teamB.id,
                season_id: teamB.seasonId,
                title: 'injected task',
            }),
        },
        {
            table: 'scouting_reports',
            id: () => teamB.scoutingReportId,
            update: { event_name: 'stolen' },
            insert: () => ({
                team_id: teamB.id,
                season_id: teamB.seasonId,
                opponent_team_number: '1111',
                match_number: 9,
            }),
        },
        {
            table: 'match_plans',
            id: () => teamB.matchPlanId,
            update: { notes: 'stolen' },
            insert: () => ({
                team_id: teamB.id,
                season_id: teamB.seasonId,
                title: 'injected plan',
                match_number: 9,
            }),
        },
        {
            table: 'checklists',
            id: () => teamB.checklistId,
            update: { name: 'stolen' },
            insert: () => ({
                team_id: teamB.id,
                season_id: teamB.seasonId,
                name: 'injected checklist',
                items: [],
            }),
        },
        {
            table: 'sub_teams',
            id: () => teamB.subTeamId,
            update: { name: 'stolen' },
            insert: () => ({ team_id: teamB.id, season_id: teamB.seasonId, name: 'injected' }),
        },
        {
            table: 'seasons',
            id: () => teamB.seasonId,
            update: { name: 'stolen' },
            insert: () => ({ team_id: teamB.id, name: 'injected season' }),
        },
        {
            table: 'teams',
            id: () => teamB.id,
            update: { name: 'stolen' },
            // teams_insert_owner requires owner_id = auth.uid(); the cross-tenant attempt
            // is claiming somebody else as owner.
            insert: () => ({ name: 'injected team', owner_id: teamB.coach.id }),
        },
        {
            table: 'team_members',
            id: () => teamB.users.student.memberId,
            update: { role: 'coach' },
            insert: () => ({
                team_id: teamB.id,
                user_id: teamB.users.student.id,
                role: 'coach',
                status: 'approved',
            }),
        },
        {
            table: 'invites',
            id: () => teamB.inviteId,
            update: { code: 'STOLEN01' },
            insert: () => ({ team_id: teamB.id, code: 'INJECTED', created_by: teamB.coach.id }),
        },
        {
            table: 'license_grants',
            id: () => teamB.licenseGrantId,
            update: { notes: 'stolen' },
            insert: () => ({ team_id: teamB.id, source: 'gift', seats: 99 }),
        },
        {
            table: 'meetings',
            id: () => teamB.meetingId,
            update: { title: 'stolen' },
            insert: () => ({
                team_id: teamB.id,
                season_id: teamB.seasonId,
                title: 'injected meeting',
                starts_at: new Date('2026-10-01T18:00:00Z').toISOString(),
            }),
        },
        {
            table: 'meeting_attendance',
            id: () => teamB.attendanceId,
            update: { status: 'absent' },
            insert: () => ({
                meeting_id: teamB.meetingId,
                team_id: teamB.id,
                team_member_id: teamB.users.student.memberId,
                status: 'absent',
            }),
        },
    ] as const;
}

/**
 * "Denied" is either an error or an empty result.
 *
 * PostgREST reports an RLS refusal two different ways depending on the verb: INSERT hits
 * the WITH CHECK and errors (42501), while SELECT/UPDATE/DELETE are filtered by the USING
 * clause and simply match no rows. Both are denials; asserting on only one of them would
 * miss half the surface.
 *
 * An empty result from UPDATE/DELETE is weaker evidence than it looks, because the
 * RETURNING clause is itself filtered by the SELECT policy — so a write that succeeded
 * could report zero rows. That is what the "leaves every one of team B's rows exactly as
 * it found them" test below exists for: it asks the database directly, with RLS bypassed.
 *
 * (Verified separately: with a restrictive SELECT policy, even a wide-open
 * `FOR DELETE USING (true)` is not exploitable through a WHERE clause — Postgres applies
 * SELECT policies to the rows an UPDATE or DELETE references. SELECT is the load-bearing
 * policy, which is why the assertions here lean on it hardest.)
 */
async function expectDenied(
    label: string,
    query: PromiseLike<{ data: unknown[] | null; error: unknown }>,
) {
    const { data, error } = await query;
    if (error) return; // refused outright
    expect(data ?? [], `${label} was NOT denied — it affected rows`).toEqual([]);
}

describe('cross-tenant isolation: a member of team A cannot reach team B', () => {
    for (const role of ROLES) {
        describe(`as ${role}`, () => {
            for (const testCase of crossTenantCases()) {
                const { table } = testCase;

                it(`cannot SELECT ${table}`, async () => {
                    const client = teamA.users[role].client;
                    const { data, error } = await client
                        .from(table)
                        .select('*')
                        .eq('id', testCase.id());

                    expect(error).toBeNull();
                    expect(data, `${role} read team B's ${table}`).toEqual([]);
                });

                it(`cannot INSERT into ${table}`, async () => {
                    const client = teamA.users[role].client;
                    await expectDenied(
                        `${role} INSERT into team B's ${table}`,
                        client.from(table).insert(testCase.insert() as never).select(),
                    );
                });

                it(`cannot UPDATE ${table}`, async () => {
                    const client = teamA.users[role].client;
                    await expectDenied(
                        `${role} UPDATE of team B's ${table}`,
                        client
                            .from(table)
                            .update(testCase.update as never)
                            .eq('id', testCase.id())
                            .select(),
                    );
                });

                it(`cannot DELETE ${table}`, async () => {
                    const client = teamA.users[role].client;
                    await expectDenied(
                        `${role} DELETE of team B's ${table}`,
                        client.from(table).delete().eq('id', testCase.id()).select(),
                    );
                });
            }
        });
    }

    it('cannot enumerate team B by listing a table unfiltered', async () => {
        // The per-id checks above would pass against a policy that leaks on a bare
        // `select('*')` but happens to filter on `eq('id', ...)`. This asks the broader
        // question: what does an unfiltered read return?
        for (const testCase of crossTenantCases()) {
            const { data, error } = await teamA.users.student.client
                .from(testCase.table)
                .select('id');

            expect(error, `listing ${testCase.table} errored`).toBeNull();
            const ids = (data ?? []).map((row: { id: string }) => row.id);
            expect(ids, `${testCase.table} leaked team B's row`).not.toContain(testCase.id());
        }
    });

    it("leaves every one of team B's rows exactly as it found them", async () => {
        // A backstop against the tests above masking each other. If one role's DELETE
        // succeeded, the next role's SELECT would find nothing and pass for the wrong
        // reason. This asks the database directly, with RLS bypassed, whether team B is
        // still intact — the one assertion that cannot be fooled by test ordering.
        const { serviceClient } = await import('./stack');
        const svc = serviceClient();

        const survivors: [string, string][] = [
            ['tasks', teamB.taskId],
            ['scouting_reports', teamB.scoutingReportId],
            ['match_plans', teamB.matchPlanId],
            ['checklists', teamB.checklistId],
            ['sub_teams', teamB.subTeamId],
            ['seasons', teamB.seasonId],
            ['teams', teamB.id],
            ['invites', teamB.inviteId],
            ['team_members', teamB.users.student.memberId],
            ['license_grants', teamB.licenseGrantId],
            ['meetings', teamB.meetingId],
            ['meeting_attendance', teamB.attendanceId],
        ];

        for (const [table, id] of survivors) {
            const { data } = await svc.from(table as never).select('*').eq('id', id);
            expect(data, `team B's ${table} row was destroyed by a cross-tenant write`)
                .toHaveLength(1);
        }

        // Nothing was renamed either: every `update` payload above writes 'stolen'.
        const task = await svc.from('tasks').select('title').eq('id', teamB.taskId).single();
        expect(task.data?.title).toBe('bravo task');

        const invite = await svc.from('invites').select('code').eq('id', teamB.inviteId).single();
        expect(invite.data?.code).toBe(teamB.inviteCode);

        const member = await svc
            .from('team_members')
            .select('role')
            .eq('id', teamB.users.student.memberId)
            .single();
        expect(member.data?.role, "a cross-tenant write escalated team B's student to coach")
            .toBe('student');
    });

    it('cannot read team B users through the users table', async () => {
        const { data, error } = await teamA.users.student.client
            .from('users')
            .select('id, email')
            .eq('id', teamB.coach.id);

        expect(error).toBeNull();
        expect(data, "team B's user profile leaked").toEqual([]);
    });

    it("cannot read another user's attestations", async () => {
        const { data, error } = await teamA.users.student.client
            .from('user_attestations')
            .select('*')
            .eq('user_id', teamB.coach.id);

        expect(error).toBeNull();
        expect(data).toEqual([]);
    });

    it("cannot read team B's invite codes (the hole this repo actually shipped)", async () => {
        const { data, error } = await teamA.users.coach.client
            .from('invites')
            .select('code');

        expect(error).toBeNull();
        const codes = (data ?? []).map((row: { code: string }) => row.code);
        expect(codes).not.toContain(teamB.inviteCode);
    });
});

describe('an unauthenticated client can reach nothing', () => {
    for (const testCase of crossTenantCases()) {
        const { table } = testCase;

        it(`anon cannot SELECT ${table}`, async () => {
            const { data, error } = await anon.from(table).select('*');
            // Either refused or empty; never rows.
            if (!error) expect(data, `anon read ${table}`).toEqual([]);
        });

        it(`anon cannot INSERT into ${table}`, async () => {
            await expectDenied(
                `anon INSERT into ${table}`,
                anon.from(table).insert(testCase.insert() as never).select(),
            );
        });

        it(`anon cannot DELETE from ${table}`, async () => {
            await expectDenied(
                `anon DELETE from ${table}`,
                anon.from(table).delete().eq('id', testCase.id()).select(),
            );
        });
    }

    it('anon cannot read users or attestations', async () => {
        const users = await anon.from('users').select('*');
        if (!users.error) expect(users.data).toEqual([]);

        const attestations = await anon.from('user_attestations').select('*');
        if (!attestations.error) expect(attestations.data).toEqual([]);
    });
});

describe('same-team access still works (the control that stops this suite being vacuous)', () => {
    it('every role can read their own team’s data', async () => {
        for (const role of ROLES) {
            const client = teamA.users[role].client;

            const tasks = await client.from('tasks').select('id').eq('id', teamA.taskId);
            expect(tasks.error, `${role} tasks`).toBeNull();
            expect(tasks.data, `${role} cannot read their own team's tasks`).toHaveLength(1);

            const reports = await client
                .from('scouting_reports')
                .select('id')
                .eq('id', teamA.scoutingReportId);
            expect(reports.data, `${role} cannot read their own scouting reports`).toHaveLength(1);

            const plans = await client
                .from('match_plans')
                .select('id')
                .eq('id', teamA.matchPlanId);
            expect(plans.data, `${role} cannot read their own match plans`).toHaveLength(1);

            const checklists = await client
                .from('checklists')
                .select('id')
                .eq('id', teamA.checklistId);
            expect(checklists.data, `${role} cannot read their own checklist`).toHaveLength(1);

            const seasons = await client.from('seasons').select('id').eq('id', teamA.seasonId);
            expect(seasons.data, `${role} cannot read their own seasons`).toHaveLength(1);

            const subTeams = await client.from('sub_teams').select('id').eq('id', teamA.subTeamId);
            expect(subTeams.data, `${role} cannot read their own sub-teams`).toHaveLength(1);

            const team = await client.from('teams').select('id').eq('id', teamA.id);
            expect(team.data, `${role} cannot read their own team`).toHaveLength(1);

            // Four roles plus the guardian-managed child, who is a person on the roster.
            const members = await client.from('team_members').select('id').eq('team_id', teamA.id);
            expect(members.data?.length, `${role} cannot read their own roster`).toBe(ROLES.length + 1);
        }
    });

    /*
     * THE UNFILTERED SELECT, WHICH IS NOW A READ PATH RATHER THAN A HYPOTHETICAL.
     *
     * `teams` became an entity registry entity with `scope: 'rls'`, which means the pull sends
     * `.select('*')` with NO predicate at all and lets the policy decide the row set. Every
     * other assertion about `teams` in this file filters by id first, so all of them would
     * still pass if the policy returned every team on the platform — they only ever ask "can I
     * read the one I already named".
     *
     * This asks the question the client now actually asks. It is the whole justification for
     * deleting `pullGuardianTeams` and its merge-by-id: one unfiltered select is supposed to
     * return a member's own teams and a guardian's children's teams and nothing else.
     */
    it('an unfiltered teams select returns only the caller’s own teams', async () => {
        for (const role of ROLES) {
            const client = teamA.users[role].client;

            const teams = await client.from('teams').select('id');

            expect(
                teams.data?.map((t: { id: string }) => t.id),
                `${role} saw a team that is not theirs`,
            ).toEqual([teamA.id]);
        }
    });

    it('a member can write their own team’s data', async () => {
        const { data, error } = await teamA.users.student.client
            .from('tasks')
            .insert({
                team_id: teamA.id,
                season_id: teamA.seasonId,
                title: 'written by a student',
            })
            .select()
            .single();

        expect(error).toBeNull();
        expect(data?.title).toBe('written by a student');

        // Clean up through the same RLS-subject client, proving delete works too.
        const removed = await teamA.users.student.client
            .from('tasks')
            .delete()
            .eq('id', data!.id)
            .select();
        expect(removed.data).toHaveLength(1);
    });

    it('a pending member is not yet a member', async () => {
        // `get_user_team_ids` and every membership policy require status = 'approved'.
        // Someone who has used an invite code but not been approved must see nothing.
        const pending = await fixtures.createUser('pending');
        const { userClient } = await import('./stack');
        const client = userClient(pending.token);

        const tasks = await client.from('tasks').select('id').eq('id', teamA.taskId);
        expect(tasks.data, 'an unapproved user could read team data').toEqual([]);
    });
});

describe('B21 — a user cannot insert themselves into somebody else’s team', () => {
    /*
     * THE HOLE THIS REPO SHIPPED, AND THE ONE THE FIRST VERSION OF THIS SUITE MISSED.
     *
     * V1's policy was `WITH CHECK (user_id = auth.uid() OR is_team_coach(...))`. The first
     * branch let ANY authenticated user insert a row naming THEMSELVES, into ANY team, with
     * any role and status = 'approved'. Knowing a team's uuid was the whole attack.
     *
     * Every cross-tenant INSERT case above names the VICTIM's user id, which the policy
     * correctly refused — which is exactly why 180 assertions went green over a schema
     * anyone could join if they could read a team id out of a URL.
     *
     * Verified against the V1 schema before it was replaced: this INSERT succeeded, and the
     * next SELECT returned team B's tasks.
     */
    it('cannot join a team by inserting their own membership row', async () => {
        const attacker = teamA.users.student;

        const { error } = await attacker.client.from('team_members').insert({
            team_id: teamB.id,
            user_id: attacker.id,
            role: 'coach',
            status: 'approved',
        } as never);

        expect(error, 'a user inserted themselves into another team').not.toBeNull();

        // And the escalation it was for did not happen.
        const tasks = await attacker.client.from('tasks').select('id').eq('team_id', teamB.id);
        expect(tasks.data, "team B's tasks were readable after a self-insert").toEqual([]);
    });

    it('cannot promote themselves inside their own team either', async () => {
        // The same shape one level down: a student is not a coach, so `can_manage_roster`
        // refuses the UPDATE and the role stays put.
        const student = teamA.users.student;

        await student.client
            .from('team_members')
            .update({ role: 'coach' } as never)
            .eq('id', student.memberId);

        const { serviceClient } = await import('./stack');
        const after = await serviceClient()
            .from('team_members')
            .select('role')
            .eq('id', student.memberId)
            .single();
        expect(after.data?.role, 'a student promoted themselves').toBe('student');
    });
});

describe('B25 — a capability that answers NULL is not a refusal', () => {
    /*
     * B21'S CLASS, FOUND AGAIN THREE SPRINTS LATER, AND FOR THE SAME REASON: A CHECK THAT
     * READS AS AIRTIGHT AND IS NOT EVALUATED.
     *
     * `can_manage_billing(team)` was `SELECT current_team_role(team) = 'admin'`, and
     * `current_team_role` is NULL for somebody who is not an approved member of that team.
     * `NULL = 'admin'` is NULL, so the capability returned NULL, and `NOT NULL` is NULL rather
     * than true. Every plpgsql guard shaped like
     *
     *     IF NOT can_manage_billing(p_team_id) THEN RETURN error; END IF;
     *
     * was therefore SKIPPED for a non-member. `transfer_team_admin` is that shape, is
     * SECURITY DEFINER (so its writes do not meet RLS), and is EXECUTE-granted to
     * `authenticated` and `anon` by the schema's default privileges.
     *
     * Why no policy was ever wrong, and why that hid it: RLS coerces a NULL `USING` result to
     * false, so `USING (can_manage_billing(id))` denied a non-member correctly the whole time.
     * The 261-assertion isolation suite exercises policies, and every one of them was right.
     * The bug lived exclusively in the RPC guards, and the one RPC with the vulnerable shape
     * had no caller in the UI — so nothing in the app or the suite ever executed it.
     *
     * Found by a Sprint 6 test that expected another team's admin to be refused a nomination
     * and got `success: true` back. Fixed with `coalesce(..., false)` in the three affected
     * capability functions, which corrects every guard at once rather than one at a time.
     */
    it('a non-member gets false, not NULL, from every capability function', async () => {
        const { serviceClient } = await import('./stack');
        const svc = serviceClient();

        for (const fn of ['can_manage_billing', 'can_manage_roster', 'can_manage_structure', 'can_manage_content'] as const) {
            const { data } = await svc.rpc(fn, { p_team_id: teamB.id });
            expect(data, `${fn} answered NULL for a caller with no membership (B25)`).toBe(false);
        }
    });

    /*
     * The exploit the NULL enabled, asserted end to end rather than through the helper above.
     * Team A's admin is a non-member of team B, so `can_manage_billing(teamB)` was NULL for
     * them and the guard was skipped — they could hand team B's admin role to a member of
     * team B of their choosing.
     *
     * THE TARGET IS ATTESTED FIRST, DELIBERATELY. Without that, the vulnerable version fails
     * anyway — at `enforce_member_role_eligibility`, because a coach who has never accepted the
     * terms cannot hold the admin role — and the test would pass for a reason unrelated to the
     * bug it is named for. That is exactly how a regression test rots into a tautology. The
     * real precondition for the exploit is a target who HAS attested somewhere (anyone who has
     * ever created a team, or accepted a handover), so the test constructs that.
     */
    it('another team\'s admin cannot transfer this team\'s admin role', async () => {
        const { serviceClient } = await import('./stack');
        const svc = serviceClient();
        await fixtures.attest(teamB.coach.id, 'terms');

        const { data } = await teamA.admin.client.rpc('transfer_team_admin', {
            p_team_id: teamB.id,
            p_new_member_id: teamB.coach.memberId,
        });

        expect(data, 'transfer_team_admin accepted an outsider').toMatchObject({ success: false });

        const after = await svc
            .from('team_members')
            .select('role')
            .eq('id', teamB.admin.memberId)
            .single();
        expect(after.data?.role, "team B's admin role was moved by an outsider").toBe('admin');
    });

    it('an outsider cannot nominate a successor for this team', async () => {
        const { data } = await teamA.admin.client.rpc('nominate_team_admin', {
            p_team_id: teamB.id,
            p_new_member_id: teamB.coach.memberId,
        });

        // The specific refusal, not merely `success: false`. Any number of unrelated reasons
        // produce a falsy result — "already the admin", "not approved yet" — and a test that
        // accepts any of them would pass on the vulnerable build if an earlier case had
        // already moved the role.
        expect(data).toMatchObject({
            success: false,
            error: 'Only the team admin can nominate a successor',
        });
    });

    /*
     * A student IS an approved member, so `current_team_role` returned 'student' and the
     * comparison was a real false — the guard fired. Included as the control that shows B25
     * was specifically about NON-membership, which is why every in-team test passed.
     */
    it('a student was always refused, which is why this stayed hidden', async () => {
        const { data } = await teamA.users.student.client.rpc('transfer_team_admin', {
            p_team_id: teamA.id,
            p_new_member_id: teamA.users.student.memberId,
        });

        expect(data).toMatchObject({ success: false });
    });
});

describe('capabilities are enforced by the database, not by the sidebar', () => {
    it('a student cannot create a season or a sub-team (can_manage_structure)', async () => {
        await expectDenied(
            'student INSERT into seasons',
            teamA.users.student.client
                .from('seasons')
                .insert({ team_id: teamA.id, name: 'student season' } as never)
                .select(),
        );

        await expectDenied(
            'student INSERT into sub_teams',
            teamA.users.student.client
                .from('sub_teams')
                .insert({ team_id: teamA.id, season_id: teamA.seasonId, name: 'student sub-team' } as never)
                .select(),
        );
    });

    it('a coach can — the control that stops the assertion above being vacuous', async () => {
        const { data, error } = await teamA.coach.client
            .from('sub_teams')
            .insert({ team_id: teamA.id, season_id: teamA.seasonId, name: 'coach sub-team' } as never)
            .select('id')
            .single<{ id: string }>();

        expect(error).toBeNull();
        expect(data).not.toBeNull();
        await teamA.coach.client.from('sub_teams').delete().eq('id', data!.id);
    });

    it('a mentor is elevated but does not manage the roster', async () => {
        await expectDenied(
            'mentor UPDATE of a teammate',
            teamA.users.mentor.client
                .from('team_members')
                .update({ role: 'coach' } as never)
                .eq('id', teamA.users.student.memberId)
                .select(),
        );
    });

    it('nobody can grant their own team a licence, not even the admin', async () => {
        // license_grants has a SELECT policy and no write policy at all. Gifting goes
        // through grant_team_license, which checks is_platform_operator(); Stripe will
        // write with the service role. An admin who can licence themselves is not a
        // licensing model.
        await expectDenied(
            'admin INSERT into license_grants',
            teamA.admin.client
                .from('license_grants')
                .insert({ team_id: teamA.id, source: 'gift', seats: 100 } as never)
                .select(),
        );

        await expectDenied(
            'admin UPDATE of their own licence',
            teamA.admin.client
                .from('license_grants')
                .update({ valid_until: null } as never)
                .eq('id', teamA.licenseGrantId)
                .select(),
        );
    });

    it('a coach can edit the roster but cannot hand out licensed seats', async () => {
        /*
         * Seats are a billing decision, and billing belongs to the admin alone. RLS cannot
         * express this — a policy decides whether a ROW may be written, and `seat_assigned`
         * is one column of a row a coach is otherwise entitled to edit — so it lives in
         * `enforce_seat_capacity`.
         *
         * The positive half first, or the negative one proves nothing: a coach really can
         * edit this row.
         */
        const target = teamA.users.mentor.memberId;

        const rename = await teamA.coach.client
            .from('team_members')
            .update({ full_name: 'Renamed by the coach' } as never)
            .eq('id', target)
            .select();
        expect(rename.error, 'a coach could not edit the roster at all').toBeNull();
        expect(rename.data, 'a coach could not edit the roster at all').toHaveLength(1);

        // Same row, same coach, one column further.
        const seat = await teamA.coach.client
            .from('team_members')
            .update({ seat_assigned: false } as never)
            .eq('id', target)
            .select();
        expect(seat.error).toBeNull();  // releasing a seat is not a billing decision

        const regrant = await teamA.coach.client
            .from('team_members')
            .update({ seat_assigned: true } as never)
            .eq('id', target)
            .select();
        expect(regrant.error, 'a coach assigned a licensed seat').not.toBeNull();

        // And the admin can, which is what makes the refusal above about authority rather
        // than about the column being unwritable.
        const byAdmin = await teamA.admin.client
            .from('team_members')
            .update({ seat_assigned: true } as never)
            .eq('id', target)
            .select();
        expect(byAdmin.error, 'the admin could not assign a seat').toBeNull();
        expect(byAdmin.data).toHaveLength(1);
    });

    it('a team cannot assign more seats than it has been granted', async () => {
        // The fixtures' licence is unlimited, so this needs a bounded one. Revoke, grant two
        // seats, and try to seat a third member.
        const { serviceClient } = await import('./stack');
        const svc = serviceClient();

        await fixtures.revokeLicense(teamB.id);
        await svc.from('license_grants').insert({
            team_id: teamB.id,
            source: 'gift',
            seats: 2,
            notes: 'seat capacity probe',
        } as never);
        // Fixtures seat all four roles; drop to two so the grant is exactly filled.
        await svc
            .from('team_members')
            .update({ seat_assigned: false } as never)
            .in('id', [teamB.users.mentor.memberId, teamB.users.student.memberId]);

        const { error } = await teamB.admin.client
            .from('team_members')
            .update({ seat_assigned: true } as never)
            .eq('id', teamB.users.student.memberId)
            .select();

        expect(error, 'a third seat was assigned against a two-seat grant').not.toBeNull();
        expect(error?.message).toMatch(/no licensed seats available/i);

        // Restore team B for anything that runs after this.
        await svc.from('license_grants').delete().eq('notes', 'seat capacity probe');
        await fixtures.restoreLicense(teamB.id);
        await svc
            .from('team_members')
            .update({ seat_assigned: true } as never)
            .in('id', [teamB.users.mentor.memberId, teamB.users.student.memberId]);
    });

    it('the operator table cannot be joined through the API', async () => {
        await expectDenied(
            'admin INSERT into platform_operators',
            teamA.admin.client
                .from('platform_operators')
                .insert({ user_id: teamA.admin.id } as never)
                .select(),
        );

        const { data } = await teamA.admin.client.from('platform_operators').select('*');
        expect(data ?? [], 'a non-operator could see the operator list').toEqual([]);
    });

    it('grant_team_license refuses a caller who is not the platform operator', async () => {
        const { data } = await teamA.admin.client.rpc('grant_team_license', {
            p_team_id: teamA.id,
            p_seats: 500,
        });

        // The RPC returns json, which the generated types widen to `Json`.
        const result = data as { success: boolean; error?: string } | null;
        expect(result?.success, 'a team admin gifted themselves a licence').toBe(false);
    });
});

describe('an unlicensed team is read-only, and loses nothing', () => {
    // "Expiry behaviour: read-only grace mode, never data deletion." Enforced by
    // `team_can_write`, which every content write policy consults — not by a banner.
    beforeAll(async () => {
        await fixtures.revokeLicense(teamA.id);
    });

    afterAll(async () => {
        await fixtures.restoreLicense(teamA.id);
    });

    it('reports read_only through team_entitlement', async () => {
        const { data } = await teamA.admin.client
            .from('team_entitlement')
            .select('status')
            .eq('team_id', teamA.id)
            .single<{ status: string }>();

        expect(data?.status).toBe('read_only');
    });

    it('refuses every content write', async () => {
        await expectDenied(
            'INSERT a task into an unlicensed team',
            teamA.users.student.client
                .from('tasks')
                .insert({ team_id: teamA.id, season_id: teamA.seasonId, title: 'unlicensed' } as never)
                .select(),
        );

        await expectDenied(
            'UPDATE a task in an unlicensed team',
            teamA.users.student.client
                .from('tasks')
                .update({ title: 'unlicensed edit' } as never)
                .eq('id', teamA.taskId)
                .select(),
        );

        await expectDenied(
            'DELETE a task from an unlicensed team',
            teamA.users.student.client.from('tasks').delete().eq('id', teamA.taskId).select(),
        );
    });

    it('still allows every read — the data is all still there', async () => {
        const tasks = await teamA.users.student.client
            .from('tasks')
            .select('id, title')
            .eq('id', teamA.taskId)
            .returns<{ id: string; title: string }[]>();

        expect(tasks.error).toBeNull();
        expect(tasks.data, 'an unlicensed team lost access to its own data').toHaveLength(1);
        expect(tasks.data![0].title).toBe('alpha task');
    });

    it('refuses a season rollover', async () => {
        /*
         * Sprint 4's required guard. A rollover is a WRITE gated on entitlement — seasons
         * and sub-teams go through `can_manage_structure`, which requires `team_can_write` —
         * so a lapsed team pressing "Start New Season" gets a 403 from every statement.
         *
         * This is asserted server-side because that is where it is enforced. The wizard also
         * disables the action when `team_entitlement.status = 'read_only'` (covered in
         * `SeasonManager.test.tsx`), and that half is what stops the team queueing a
         * rollover it cannot complete — Sprint 3 verified in a browser that such a write
         * shows the row, is refused, and reports only "1 pending" with no reason. The two
         * halves are not interchangeable: the button covers the client that knows, the
         * policy covers every client that does not.
         */
        const admin = teamA.admin.client;

        await expectDenied(
            'INSERT a new season into an unlicensed team',
            admin.from('seasons')
                .insert({ team_id: teamA.id, name: '2027-2028 Season', game_title: 'DECODE' } as never)
                .select(),
        );

        // The other two writes a rollover makes, for completeness: cloning the sub-team
        // structure into the new season, and archiving the outgoing one.
        await expectDenied(
            'INSERT a cloned sub-team into an unlicensed team',
            admin.from('sub_teams')
                .insert({ team_id: teamA.id, season_id: teamA.seasonId, name: 'Build' } as never)
                .select(),
        );

        await expectDenied(
            'ARCHIVE the outgoing season of an unlicensed team',
            admin.from('seasons')
                .update({ is_archived: true } as never)
                .eq('id', teamA.seasonId)
                .select(),
        );

        // Nothing landed. An empty result from UPDATE is weaker evidence than it looks
        // (RETURNING is filtered by the SELECT policy), so this asks the database directly.
        const { serviceClient } = await import('./stack');
        const { data: seasons } = await serviceClient()
            .from('seasons')
            .select('id, is_archived')
            .eq('team_id', teamA.id)
            .returns<{ id: string; is_archived: boolean }[]>();

        expect(seasons, 'an unlicensed team created a season').toHaveLength(1);
        expect(seasons![0].is_archived, 'an unlicensed team archived a season').toBe(false);
    });

    it('still allows the admin to manage the roster, so the problem is fixable', async () => {
        // can_manage_roster is deliberately NOT gated on entitlement. Locking an admin out
        // of their own membership list is how a billing problem becomes a support ticket
        // nobody can resolve.
        const { error } = await teamA.admin.client
            .from('team_members')
            .update({ full_name: 'Renamed while unlicensed' } as never)
            .eq('id', teamA.users.student.memberId)
            .select();

        expect(error).toBeNull();
    });
});

describe('guardians reach their own child, and nothing else', () => {
    /*
     * The COPPA model: a child under 13 has no login. Their membership row carries the
     * GUARDIAN's user_id plus a managed_profile_id, which is what lets every existing
     * `user_id = auth.uid()` policy do the right thing for them.
     *
     * The other half is that being responsible for a child on a team does not make the
     * guardian a member of it — `get_user_team_ids` excludes managed rows on purpose.
     */
    it('can read their own managed profile and consent', async () => {
        const profile = await teamA.guardian.user.client
            .from('managed_profiles')
            .select('id, full_name')
            .eq('id', teamA.guardian.profileId);

        expect(profile.error).toBeNull();
        expect(profile.data, 'a guardian could not read their own child profile').toHaveLength(1);

        const consent = await teamA.guardian.user.client
            .from('guardian_consents')
            .select('id')
            .eq('id', teamA.guardian.consentId);
        expect(consent.data).toHaveLength(1);
    });

    it('can see their child’s membership row', async () => {
        const { data } = await teamA.guardian.user.client
            .from('team_members')
            .select('id')
            .eq('id', teamA.guardian.memberId);

        expect(data, 'a guardian could not see their child’s membership').toHaveLength(1);
    });

    it('cannot read the team’s content just because their child is on it', async () => {
        const tasks = await teamA.guardian.user.client
            .from('tasks')
            .select('id')
            .eq('id', teamA.taskId);
        expect(tasks.data, 'a guardian read the team’s tasks').toEqual([]);

        const reports = await teamA.guardian.user.client.from('scouting_reports').select('id');
        expect(reports.data ?? []).toEqual([]);

        const invites = await teamA.guardian.user.client.from('invites').select('code');
        expect(invites.data ?? [], 'a guardian read the team’s invite codes').toEqual([]);
    });

    it('cannot read another guardian’s profiles or consents', async () => {
        const profiles = await teamA.guardian.user.client
            .from('managed_profiles')
            .select('id')
            .eq('id', teamB.guardian.profileId);
        expect(profiles.data, 'another family’s child profile leaked').toEqual([]);

        const consents = await teamA.guardian.user.client
            .from('guardian_consents')
            .select('id')
            .eq('id', teamB.guardian.consentId);
        expect(consents.data).toEqual([]);
    });

    it('owns the profile: the child’s own team can see it but not change it', async () => {
        const visible = await teamA.coach.client
            .from('managed_profiles')
            .select('id')
            .eq('id', teamA.guardian.profileId);
        expect(visible.data, 'the roster could not see a managed member').toHaveLength(1);

        await expectDenied(
            'coach UPDATE of a managed profile',
            teamA.coach.client
                .from('managed_profiles')
                .update({ full_name: 'renamed by the coach' } as never)
                .eq('id', teamA.guardian.profileId)
                .select(),
        );
    });

    it('sees their child’s team and no other, without becoming a member of it', async () => {
        /*
         * CHANGED DELIBERATELY IN SPRINT 9, and this is the assertion the plan's parking lot
         * asked to have re-checked when guardian access widened.
         *
         * It used to require the guardian to see NO teams at all. Section 3 settles that a
         * guardian sees "their children — consents given, upcoming meetings, attendance", and a
         * screen that cannot name the team a child belongs to cannot show any of that. So
         * `teams_select_member` now also admits `is_team_guardian`.
         *
         * What matters is that the widening is exactly one team wide. `is_team_member` and
         * `get_user_team_ids` were NOT touched — a third predicate was added instead — so the
         * guardian is still not a member: the roster, other children's profiles, invite codes
         * and every content table stay shut, which the tests around this one assert
         * individually and which 264 other assertions in this file cover for the roles that
         * should reach them.
         */
        const teams = await teamA.guardian.user.client.from('teams').select('id');

        expect(
            teams.data?.map((t: { id: string }) => t.id),
            'a guardian saw a team other than their child’s',
        ).toEqual([teamA.id]);

        // Seeing the team's NAME is not membership. The roster is the thing that would make it
        // membership, and it is still one row — their own child's.
        const roster = await teamA.guardian.user.client
            .from('team_members')
            .select('id')
            .eq('team_id', teamA.id);
        expect(roster.data?.map((r: { id: string }) => r.id)).toEqual([teamA.guardian.memberId]);
    });

    it('cannot read the other people on the team', async () => {
        /*
         * FOUND BY ADVERSARIAL VERIFICATION, not by writing the test first.
         *
         * The guardian exclusion lives in TWO predicates — `get_user_team_ids` and
         * `is_team_member` — and both have to be wrong before anything leaks, which is why
         * dropping the `managed_profile_id IS NULL` clause from one of them left every
         * assertion above green.
         *
         * Drop it from both, which is what a tidy-up of "these two functions are nearly the
         * same" would do, and this is what goes: `users_select_teammates` and
         * `managed_profiles_select_teammates` would hand a guardian the name and email
         * address of every adult and every child on their child's team. The other guardian
         * tests here catch the content side; nothing was watching the roster side.
         */
        const teammates = await teamA.guardian.user.client
            .from('users')
            .select('id, email')
            .eq('id', teamA.coach.id);
        expect(teammates.data, 'a guardian read a teammate’s profile and email').toEqual([]);

        // And their own membership row is the only one they can see on the roster.
        const roster = await teamA.guardian.user.client
            .from('team_members')
            .select('id')
            .eq('team_id', teamA.id);
        expect(roster.data?.map((r: { id: string }) => r.id), 'a guardian read the whole roster')
            .toEqual([teamA.guardian.memberId]);
    });
});

describe('team_entitlement does not leak across tenants', () => {
    it('shows a member only their own team', async () => {
        const { data, error } = await teamA.users.student.client
            .from('team_entitlement')
            .select('team_id');

        expect(error).toBeNull();
        const ids = (data ?? []).map((row: any) => row.team_id);
        expect(ids, 'the entitlement view leaked another team’s licensing state')
            .not.toContain(teamB.id);
        expect(ids).toContain(teamA.id);
    });

    it('shows an anonymous client nothing', async () => {
        const { data, error } = await anon.from('team_entitlement').select('team_id');
        if (!error) expect(data ?? []).toEqual([]);
    });
});
