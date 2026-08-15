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

const ROLES: Role[] = ['coach', 'assistant_coach', 'mentor', 'student'];

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

            const members = await client.from('team_members').select('id').eq('team_id', teamA.id);
            expect(members.data?.length, `${role} cannot read their own roster`).toBe(ROLES.length);
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
