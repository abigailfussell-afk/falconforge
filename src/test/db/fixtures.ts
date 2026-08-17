/**
 * Two tenants, their people, and the rows they own — built against the real database.
 *
 * Fixtures are created with the service-role client, which bypasses RLS. That is the only
 * legitimate use for it: a test has to be able to create the row it then proves somebody
 * else cannot reach. Assertions always run through {@link TestUser.client}, which carries
 * a real JWT and is subject to policies exactly as the browser is.
 *
 * Note that bypassing RLS does NOT bypass triggers. `enforce_member_role_eligibility` and
 * `enforce_seat_capacity` fire on these inserts just as they would on a real one, which is
 * why the attestation and the licence below are created before the members who need them.
 * If a fixture starts failing, the schema has usually just told you something true.
 *
 * ON MINTING JWTS RATHER THAN SIGNING IN
 *
 * GoTrue's local rate limits (30 sign-ins per window) are low enough that a suite creating
 * ~12 users would start failing on the third run of the afternoon, and a flaky security
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

export type Role = 'admin' | 'coach' | 'mentor' | 'student';

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
    licenseGrantId: string;
    meetingId: string;
    attendanceId: string;
    /** One signed-in user per role. */
    users: Record<Role, TestUser>;
    /** The primary administrator — one per team, and the only one who touches licensing. */
    admin: TestUser;
    /** A coach. Used where "an elevated member who is not the admin" is the point. */
    coach: TestUser;
    /**
     * A guardian: an account with a managed child on this team and NO membership of their
     * own. They are the test of the COPPA model — they must reach their child and nothing
     * else.
     */
    guardian: {
        user: { id: string; email: string; client: SupabaseClient<Database> };
        profileId: string;
        /** The child's team_members row: user_id is the guardian, managed_profile_id is set. */
        memberId: string;
        consentId: string;
    };
}

const base64url = (input: Buffer | string): string =>
    Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

/**
 * Sign an HS256 JWT with the stack's secret — the same algorithm and secret GoTrue uses.
 *
 * Exported because the data-layer suites sign the APP's own Supabase client in as a fixture
 * user (`signInAppClientAs`), rather than asserting through `TestUser.client`. They each
 * used to carry their own copy of this; one definition means the claim set cannot drift
 * between the client a test asserts with and the client the code under test uses.
 */
export function mintAccessToken(userId: string, email: string): string {
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
     * Record an attestation. The admin role is refused without one.
     *
     * Idempotent: several tests in a suite may need the same person to have accepted the same
     * terms, and "they have already agreed" is not a failure. Sprint 6 widened the unique key
     * to (user_id, attestation_type, version) so that a version bump keeps the older
     * acceptance, which turned a repeat call from a silent overwrite into a 23505.
     */
    async attest(userId: string, type = 'coach_terms', version = '1.0'): Promise<void> {
        const { error } = await this.svc
            .from('user_attestations')
            .upsert({ user_id: userId, attestation_type: type, version } as never, {
                onConflict: 'user_id,attestation_type,version',
                ignoreDuplicates: true,
            });
        if (error) throw new Error(`attest(${type}@${version}) failed: ${error.message}`);
    }

    /**
     * A complete tenant: a team, one member per role, a licence, a guardian with a managed
     * child, a season, and one row in every season-scoped table so the isolation suite has
     * something concrete to fail to reach.
     */
    async createTeam(label: string): Promise<TestTeam> {
        const roles: Role[] = ['admin', 'coach', 'mentor', 'student'];
        const accounts = await Promise.all(roles.map((role) => this.createUser(`${label}-${role}`)));

        const owner = accounts[0];
        // The admin role is refused to an account that has not accepted the terms.
        await this.attest(owner.id);

        const team = await this.insert('teams', {
            name: `${label} Robotics`,
            team_number: '9999',
            owner_id: owner.id,
        });
        this.created.teamIds.push(team.id);

        // Before any member: `enforce_seat_capacity` consults the team's entitlement, and
        // every content write policy requires one. A team with no licence is read-only.
        const grant = await this.insert('license_grants', {
            team_id: team.id,
            source: 'gift',
            seats: null,
            created_by: owner.id,
            notes: `${label} test licence`,
        });

        const users = {} as Record<Role, TestUser>;
        for (const [index, role] of roles.entries()) {
            const account = accounts[index];
            const member = await this.insert('team_members', {
                team_id: team.id,
                user_id: account.id,
                role,
                status: 'approved',
                seat_assigned: true,
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
        // The row id IS the season id — see `updateChecklist` in store.ts. Fixtures follow
        // the same convention the client does, so a test that pushes a checklist through
        // the real drain lands on this row rather than creating a second one.
        const checklist = await this.insert('checklists', {
            id: season.id,
            team_id: team.id,
            season_id: season.id,
            name: `${label} checklist`,
            items: [{ id: '1', text: 'Charge battery', checked: false }],
        });
        const meeting = await this.insert('meetings', {
            team_id: team.id,
            season_id: season.id,
            title: `${label} build session`,
            starts_at: new Date('2026-09-01T18:00:00Z').toISOString(),
            ends_at: new Date('2026-09-01T20:00:00Z').toISOString(),
            created_by: users.coach.memberId,
        });
        const attendance = await this.insert('meeting_attendance', {
            meeting_id: meeting.id,
            team_id: team.id,
            team_member_id: users.student.memberId,
            status: 'present',
            attested_by: users.coach.memberId,
            attested_at: new Date('2026-09-01T18:05:00Z').toISOString(),
        });
        const inviteCode = `INV${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const invite = await this.insert('invites', {
            team_id: team.id,
            code: inviteCode,
            created_by: owner.id,
        });

        const guardian = await this.createGuardian(label, team.id);

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
            licenseGrantId: grant.id,
            meetingId: meeting.id,
            attendanceId: attendance.id,
            users,
            admin: users.admin,
            coach: users.coach,
            guardian,
        };
    }

    /**
     * A guardian account holding one managed child on the given team.
     *
     * The guardian has NO membership of their own, which is the interesting case: the
     * child's `team_members` row carries the guardian's `user_id`, so every
     * `user_id = auth.uid()` policy reaches it — while `get_user_team_ids` deliberately
     * excludes managed rows, so the guardian is not thereby a member of the team.
     */
    private async createGuardian(label: string, teamId: string): Promise<TestTeam['guardian']> {
        const account = await this.createUser(`${label}-guardian`);

        const profile = await this.insert('managed_profiles', {
            guardian_user_id: account.id,
            full_name: `${label} child`,
        });
        const consent = await this.insert('guardian_consents', {
            managed_profile_id: profile.id,
            guardian_user_id: account.id,
            consent_type: 'coppa_data_collection',
            // Stated explicitly because the column's DEFAULT was dropped in
            // `20260822000000_guardian_schema_cleanup.sql`. The client owns the version, so a
            // fixture is a client like any other -- and an omitted version is now an error
            // rather than a silent '1.0'.
            version: '1.0',
        });
        const member = await this.insert('team_members', {
            team_id: teamId,
            user_id: account.id,
            managed_profile_id: profile.id,
            role: 'student',
            status: 'approved',
            full_name: `${label} child`,
        });

        return {
            user: { id: account.id, email: account.email, client: userClient(account.token) },
            profileId: profile.id,
            memberId: member.id,
            consentId: consent.id,
        };
    }

    /**
     * Take a team's licence away, leaving it read-only.
     *
     * Revocation rather than deletion, because that is what the product does: an expired or
     * withdrawn licence never removes data, and the grant row is the audit trail behind
     * "why can my team suddenly not edit anything".
     */
    async revokeLicense(teamId: string): Promise<void> {
        const { error } = await this.svc
            .from('license_grants')
            .update({ revoked_at: new Date().toISOString() } as never)
            .eq('team_id', teamId);
        if (error) throw new Error(`revokeLicense failed: ${error.message}`);
    }

    /** Restore a revoked licence, so one test's revocation does not leak into the next. */
    async restoreLicense(teamId: string): Promise<void> {
        const { error } = await this.svc
            .from('license_grants')
            .update({ revoked_at: null } as never)
            .eq('team_id', teamId);
        if (error) throw new Error(`restoreLicense failed: ${error.message}`);
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
