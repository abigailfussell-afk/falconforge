/**
 * Two tenants, five real users, and the rows they own — built against the real database.
 *
 * Fixtures are created with the service-role client, which bypasses RLS. That is the only
 * legitimate use for it: a test has to be able to create the row it then proves somebody
 * else cannot reach. Assertions always run through {@link TestUser.client}, which carries
 * a real JWT and is subject to policies exactly as the browser is.
 *
 * ON MINTING JWTS RATHER THAN SIGNING IN
 *
 * GoTrue's local rate limits (30 sign-ins per window) are low enough that a suite creating
 * ~10 users would start failing on the third run of the afternoon, and a flaky security
 * suite is a security suite people learn to ignore. The tokens here are signed with the
 * stack's own JWT secret and carry the claim set GoTrue emits, so PostgREST validates them
 * identically and `auth.uid()` / `auth.role()` see exactly what they would in production.
 * The auth *flow* is not what this suite tests — the *policies* are. Client-side session
 * handling is covered by `src/lib/__tests__/auth.test.tsx`.
 */
import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { serviceClient, userClient, stackCredentials, assertLocalStack } from './stack';

export type Role = 'coach' | 'assistant_coach' | 'mentor' | 'student';

export interface TestUser {
    /** auth.users.id, and therefore `auth.uid()` inside every policy. */
    id: string;
    email: string;
    /** team_members.id for this user in their team (absent for a user with no team). */
    memberId: string;
    role: Role;
    /** RLS-subject client. Assert through this, never through the service client. */
    client: SupabaseClient<Database>;
}

export interface TestTeam {
    id: string;
    name: string;
    seasonId: string;
    subTeamId: string;
    taskId: string;
    scoutingReportId: string;
    matchPlanId: string;
    checklistId: string;
    inviteId: string;
    inviteCode: string;
    /** One signed-in user per role. */
    users: Record<Role, TestUser>;
    /** Any member — used where the specific role does not matter. */
    coach: TestUser;
}

const base64url = (input: Buffer | string): string =>
    Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

/** Sign an HS256 JWT with the stack's secret — the same algorithm and secret GoTrue uses. */
function mintAccessToken(userId: string, email: string): string {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) throw new Error('SUPABASE_JWT_SECRET missing; is globalSetup running?');

    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(
        JSON.stringify({
            sub: userId,
            email,
            role: 'authenticated',
            aud: 'authenticated',
            iat: now,
            exp: now + 3600,
        }),
    );
    const signature = base64url(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
    return `${header}.${payload}.${signature}`;
}

/** Everything a run created, so it can be removed again. */
interface Created {
    teamIds: string[];
    userIds: string[];
}

export class Fixtures {
    private readonly svc = serviceClient();
    private readonly created: Created = { teamIds: [], userIds: [] };

    /**
     * Create an auth user and its public.users row.
     *
     * `handle_new_user` fires on the auth.users insert and creates the profile, so this
     * exercises the same trigger a real signup does.
     */
    async createUser(label: string, ageClassification = '18_plus'): Promise<{ id: string; email: string; token: string }> {
        const email = `${label}-${crypto.randomUUID()}@falconforge.test`;
        const { data, error } = await this.svc.auth.admin.createUser({
            email,
            password: crypto.randomUUID(),
            email_confirm: true,
            user_metadata: { full_name: label, age_classification: ageClassification },
        });
        if (error || !data.user) throw new Error(`createUser(${label}) failed: ${error?.message}`);

        this.created.userIds.push(data.user.id);
        return { id: data.user.id, email, token: mintAccessToken(data.user.id, email) };
    }

    /**
     * A complete tenant: a team, one member per role, a season, and one row in every
     * season-scoped table so the isolation suite has something concrete to fail to reach.
     */
    async createTeam(label: string): Promise<TestTeam> {
        const roles: Role[] = ['coach', 'assistant_coach', 'mentor', 'student'];
        const accounts = await Promise.all(roles.map((role) => this.createUser(`${label}-${role}`)));

        const owner = accounts[0];
        const team = await this.insert('teams', {
            name: `${label} Robotics`,
            team_number: '9999',
            owner_id: owner.id,
        });
        this.created.teamIds.push(team.id);

        const users = {} as Record<Role, TestUser>;
        for (const [index, role] of roles.entries()) {
            const account = accounts[index];
            const member = await this.insert('team_members', {
                team_id: team.id,
                user_id: account.id,
                role,
                status: 'approved',
                full_name: `${label} ${role}`,
                email: account.email,
            });
            users[role] = {
                id: account.id,
                email: account.email,
                memberId: member.id,
                role,
                client: userClient(account.token),
            };
        }

        const season = await this.insert('seasons', { team_id: team.id, name: `${label} Season` });
        const subTeam = await this.insert('sub_teams', {
            team_id: team.id,
            season_id: season.id,
            name: 'Build',
        });
        const task = await this.insert('tasks', {
            team_id: team.id,
            season_id: season.id,
            sub_team_id: subTeam.id,
            title: `${label} task`,
        });
        const report = await this.insert('scouting_reports', {
            team_id: team.id,
            season_id: season.id,
            opponent_team_number: '4242',
            match_number: 3,
            created_by: users.coach.memberId,
        });
        const plan = await this.insert('match_plans', {
            team_id: team.id,
            season_id: season.id,
            title: `${label} plan`,
            match_number: 3,
        });
        const checklist = await this.insert('checklists', {
            team_id: team.id,
            season_id: season.id,
            name: `${label} checklist`,
            items: [{ id: '1', text: 'Charge battery', checked: false }],
        });
        const inviteCode = `INV${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const invite = await this.insert('invites', {
            team_id: team.id,
            code: inviteCode,
            created_by: owner.id,
        });

        return {
            id: team.id,
            name: team.name,
            seasonId: season.id,
            subTeamId: subTeam.id,
            taskId: task.id,
            scoutingReportId: report.id,
            matchPlanId: plan.id,
            checklistId: checklist.id,
            inviteId: invite.id,
            inviteCode,
            users,
            coach: users.coach,
        };
    }

    /** Service-role insert returning the created row. Fixture setup only. */
    private async insert(table: string, values: Record<string, unknown>): Promise<any> {
        const { data, error } = await this.svc
            .from(table as never)
            .insert(values as never)
            .select()
            .single();
        if (error) throw new Error(`fixture insert into ${table} failed: ${error.message}`);
        return data;
    }

    /**
     * Remove everything this run created.
     *
     * Teams first: `teams.owner_id` references users with no ON DELETE action, so deleting
     * the owner while their team exists fails. Everything else cascades from the team.
     */
    async cleanup(): Promise<void> {
        assertLocalStack(stackCredentials().apiUrl);

        for (const teamId of this.created.teamIds) {
            await this.svc.from('teams').delete().eq('id', teamId);
        }
        for (const userId of this.created.userIds) {
            await this.svc.auth.admin.deleteUser(userId);
        }
        this.created.teamIds.length = 0;
        this.created.userIds.length = 0;
    }
}
