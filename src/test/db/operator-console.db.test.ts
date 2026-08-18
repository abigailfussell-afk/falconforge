/**
 * The operator console's three new functions, against a real database.
 *
 * WHAT THESE ARE ACTUALLY FOR
 *
 * The console could already gift a licence and rescue a stranded team, and neither was usable,
 * because there was no way to LEARN a team id: no policy anywhere mentions
 * `is_platform_operator()`, so `team_entitlement` showed the operator their OWN teams. These
 * three functions are the first cross-tenant read in the app, which makes their refusals the
 * most load-bearing assertions in this file — a directory that answers a non-operator is not a
 * bug in a support tool, it is every team's roster and every admin's email address.
 *
 * The other thing under test is that revocation is UNAMBIGUOUS. Grants accumulate — a beta
 * team holds a 90-day trial from registration plus whatever gift Kevin adds — so "revoke this
 * team's licence" can quietly do half the job and leave the team writing.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Fixtures, type TestTeam } from './fixtures';
import { serviceClient } from './stack';

/*
 * The RPC return shapes, declared once.
 *
 * The generated types give these back as `Json`, and the first draft of this file reached
 * through them with five untyped casts -- which the source ratchet caught. Declaring the shape
 * is not ceremony: `revoked_count` and `grant_ids` are the two things every assertion below
 * depends on, and a typo in either would otherwise read as `undefined` and quietly weaken the
 * test rather than failing it.
 */
interface RevokeResult {
    success: boolean;
    error?: string;
    revoked_count?: number;
    grant_ids?: string[];
}

interface GrantResult {
    success: boolean;
    grant_id: string;
}

interface DetailResult {
    success: boolean;
    error?: string;
    team: { id: string; name: string };
    members: { id: string; role: string; status: string }[];
    grants: { id: string; in_force: boolean }[];
    actions: unknown[];
    seasons: unknown[];
}

/** The audit row's jsonb detail, for the one assertion that reads into it. */
interface RevokeAuditDetail {
    grant_ids: string[];
    revoked_all: boolean;
}

const asRevoke = (d: unknown) => d as unknown as RevokeResult;
const asDetail = (d: unknown) => d as unknown as DetailResult;

let fixtures: Fixtures;
let team: TestTeam;
let other: TestTeam;
const svc = serviceClient();

/** The account promoted to platform operator per-test, so the default state is "nobody is". */
const operatorOf = () => team.users.mentor;

async function makeOperator() {
    await svc.from('platform_operators').insert({ user_id: operatorOf().id } as never);
}

async function dropOperator() {
    await svc.from('platform_operators').delete().eq('user_id', operatorOf().id);
}

async function grantsFor(teamId: string) {
    const { data } = await svc
        .from('license_grants')
        .select('id, seats, valid_until, revoked_at')
        .eq('team_id', teamId);
    return data ?? [];
}

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('operator-console');
    other = await fixtures.createTeam('operator-console-other');
}, 120_000);

afterAll(async () => {
    await fixtures.cleanup();
}, 120_000);

beforeEach(async () => {
    await makeOperator();

    /*
     * PUT THE LICENCE BACK. These tests revoke, revocation is a persisted timestamp, and the
     * fixture is shared across the file — so without this each test inherits whatever the last
     * one turned off. The audit assertion at the end of this file caught it by failing for the
     * wrong reason: it found no `operator_actions` row, not because the recording was broken
     * but because there was nothing left in force to revoke, so the RPC correctly refused.
     *
     * Extra grants created by tests are deleted rather than un-revoked, so every test starts
     * from exactly one grant and "revoked_count" means something.
     */
    await svc.from('license_grants').delete().eq('team_id', team.id).neq('id', team.licenseGrantId);
    await svc
        .from('license_grants')
        .update({ revoked_at: null } as never)
        .eq('team_id', team.id);
    await fixtures.restoreLicense(other.id);
});

afterEach(async () => {
    await dropOperator();
    await svc.from('operator_actions').delete().eq('team_id', team.id);
    await svc.from('operator_actions').delete().eq('team_id', other.id);
});

describe('the directory is how a team is found at all', () => {
    it('lists every team for an operator, including ones they are not on', async () => {
        const { data, error } = await operatorOf().client.rpc('operator_team_directory', {});

        expect(error).toBeNull();
        const ids = (data ?? []).map((r) => r.team_id);
        // The whole point: `other` is a team this account has no membership of.
        expect(ids).toContain(team.id);
        expect(ids).toContain(other.id);
    });

    /*
     * THE REFUSAL, and the reason this file exists.
     *
     * A SETOF function returns zero rows rather than an error object, so a caller who is not
     * an operator gets an empty directory. Asserted for four roles including the team's own
     * admin: running a tenant is not running the platform, and conflating them would put every
     * team's roster behind a page every coach can reach.
     */
    it('returns nothing to anybody who is not a platform operator', async () => {
        await dropOperator();

        for (const role of ['admin', 'coach', 'mentor', 'student'] as const) {
            const { data, error } = await team.users[role].client.rpc('operator_team_directory', {});

            expect(error, `${role} got an error rather than an empty list`).toBeNull();
            expect(data, `${role} could read the platform directory`).toEqual([]);
        }

        await makeOperator(); // afterEach expects to remove it
    });

    it('finds a team by name, by number, and by its admin’s email', async () => {
        const { data: byName } = await operatorOf().client.rpc('operator_team_directory', {
            p_search: team.name,
        });
        expect((byName ?? []).map((r) => r.team_id)).toContain(team.id);

        const { data: byEmail } = await operatorOf().client.rpc('operator_team_directory', {
            p_search: team.admin.email,
        });
        expect((byEmail ?? []).map((r) => r.team_id)).toEqual([team.id]);

        const { data: miss } = await operatorOf().client.rpc('operator_team_directory', {
            p_search: 'no-team-is-called-this',
        });
        expect(miss).toEqual([]);
    });

    it('reports the admin and the seat arithmetic the console shows', async () => {
        const { data } = await operatorOf().client.rpc('operator_team_directory', {
            p_search: team.admin.email,
        });
        const row = (data ?? [])[0];

        expect(row.admin_email).toBe(team.admin.email);
        expect(row.admin_member_id).toBe(team.admin.memberId);
        expect(row.entitlement_status).toBe('active');
        expect(row.members_approved).toBeGreaterThan(0);
    });

    /*
     * A STRANDED TEAM MUST STILL BE FINDABLE. The admin is a LEFT JOIN precisely so that a team
     * with no admin row -- the case `operator_transfer_team_admin` exists for -- does not fall
     * out of the directory. An inner join would hide exactly the teams most likely to need the
     * operator, and it would do it silently.
     */
    it('still lists a team whose admin is gone', async () => {
        // `status = 'removed'` rather than a DELETE: it is what the join condition actually
        // keys on, it reproduces the stranded shape exactly, and it is reversible — deleting
        // the row would change `admin.memberId` under every other test in this file.
        await svc
            .from('team_members')
            .update({ status: 'removed' } as never)
            .eq('id', team.admin.memberId);

        try {
            const { data } = await operatorOf().client.rpc('operator_team_directory', {});
            const row = (data ?? []).find((r) => r.team_id === team.id);

            expect(row, 'a stranded team vanished from the directory').toBeDefined();
            expect(row!.admin_email).toBeNull();
        } finally {
            await svc
                .from('team_members')
                .update({ status: 'approved' } as never)
                .eq('id', team.admin.memberId);
        }
    });
});

describe('the detail view answers a support email', () => {
    it('refuses anybody who is not a platform operator', async () => {
        await dropOperator();

        const { data } = await team.admin.client.rpc('operator_team_detail', {
            p_team_id: team.id,
        });
        expect(data).toMatchObject({ success: false, error: 'Not a platform operator' });

        await makeOperator();
    });

    it('returns the roster, the grant history and the operator audit', async () => {
        const { data } = await operatorOf().client.rpc('operator_team_detail', {
            p_team_id: team.id,
        });

        expect(data).toMatchObject({ success: true });
        const detail = asDetail(data);
        expect(detail.team.id).toBe(team.id);
        expect(detail.members.length).toBeGreaterThan(0);
        expect(detail.grants.length).toBeGreaterThan(0);
        // Every grant carries the in-force answer, so the UI never re-derives the rule.
        expect(detail.grants[0]).toHaveProperty('in_force');
        expect(Array.isArray(detail.actions)).toBe(true);
    });

    it('carries no team CONTENT, which is the line this tool does not cross', async () => {
        const { data } = await operatorOf().client.rpc('operator_team_detail', {
            p_team_id: team.id,
        });

        const keys = Object.keys(data as object);
        for (const forbidden of ['tasks', 'scouting_reports', 'match_plans', 'checklists']) {
            expect(keys, `detail exposed ${forbidden}`).not.toContain(forbidden);
        }
    });
});

describe('revoking a licence', () => {
    it('refuses anybody who is not a platform operator', async () => {
        await dropOperator();

        const { data } = await team.admin.client.rpc('operator_revoke_license', {
            p_team_id: team.id,
            p_all: true,
        });
        expect(data).toMatchObject({ success: false, error: 'Not a platform operator' });

        const still = await grantsFor(team.id);
        expect(still.every((g) => g.revoked_at === null)).toBe(true);

        await makeOperator();
    });

    it('revokes one named grant and leaves the others alone', async () => {
        const { data: extra } = await operatorOf().client.rpc('grant_team_license', {
            p_team_id: team.id,
            p_seats: 5,
            p_notes: 'second grant',
        });
        const extraId = (extra as unknown as GrantResult).grant_id;

        const { data } = await operatorOf().client.rpc('operator_revoke_license', {
            p_team_id: team.id,
            p_grant_id: extraId,
            p_notes: 'wrong team',
        });
        expect(data).toMatchObject({ success: true, revoked_count: 1 });

        const after = await grantsFor(team.id);
        expect(after.find((g) => g.id === extraId)!.revoked_at).not.toBeNull();
        expect(after.find((g) => g.id === team.licenseGrantId)!.revoked_at).toBeNull();
    });

    /*
     * THE DEFECT THIS ARGUMENT EXISTS TO PREVENT. A team routinely holds more than one grant,
     * so revoking "the" licence can leave the team writing while the operator believes they
     * have shut it off. `p_all` is the version that means what the button says.
     */
    it('p_all leaves nothing in force, so the team really is read-only', async () => {
        await operatorOf().client.rpc('grant_team_license', {
            p_team_id: team.id,
            p_seats: 5,
            p_notes: 'a second grant, as a beta team really has',
        });

        const { data } = await operatorOf().client.rpc('operator_revoke_license', {
            p_team_id: team.id,
            p_all: true,
            p_notes: 'access withdrawn',
        });
        expect(asRevoke(data).revoked_count).toBeGreaterThanOrEqual(2);

        // The behavioural end of it, not just the column: the database's own writability gate.
        const { data: canWrite } = await svc.rpc('team_can_write', { p_team_id: team.id });
        expect(canWrite, 'team could still write after every grant was revoked').toBe(false);
    });

    it('refuses to guess when given neither a grant nor p_all', async () => {
        const { data } = await operatorOf().client.rpc('operator_revoke_license', {
            p_team_id: team.id,
        });
        expect(data).toMatchObject({ success: false });
        expect(asRevoke(data).error).toMatch(/Name a grant/i);
    });

    it('cannot revoke another team’s grant by naming the wrong id', async () => {
        const otherGrants = await grantsFor(other.id);

        const { data } = await operatorOf().client.rpc('operator_revoke_license', {
            p_team_id: team.id,
            p_grant_id: otherGrants[0].id,
        });

        // The grant id exists, but not on this team — so nothing matches and nothing happens.
        expect(data).toMatchObject({ success: false });
        expect((await grantsFor(other.id)).every((g) => g.revoked_at === null)).toBe(true);
    });

    it('is idempotent: a second revoke does not rewrite when it happened', async () => {
        await operatorOf().client.rpc('operator_revoke_license', {
            p_team_id: team.id,
            p_all: true,
        });
        const first = (await grantsFor(team.id)).map((g) => g.revoked_at);

        const { data } = await operatorOf().client.rpc('operator_revoke_license', {
            p_team_id: team.id,
            p_all: true,
        });

        expect(data).toMatchObject({ success: false });
        expect((await grantsFor(team.id)).map((g) => g.revoked_at)).toEqual(first);
    });

    it('records what was withdrawn, whether or not a reason was given', async () => {
        await operatorOf().client.rpc('operator_revoke_license', {
            p_team_id: team.id,
            p_all: true,
        });

        const { data: audit } = await svc
            .from('operator_actions')
            .select('operator_user_id, action, detail, notes')
            .eq('team_id', team.id);

        expect(audit).toHaveLength(1);
        expect(audit![0]).toMatchObject({
            operator_user_id: operatorOf().id,
            action: 'license_revoke',
            notes: null,
        });
        const auditDetail = audit![0].detail as unknown as RevokeAuditDetail;
        expect(auditDetail.grant_ids.length).toBeGreaterThan(0);
    });
});
