/**
 * SEC-17 — one invite-code generator, and it is a CSPRNG.
 *
 * There were two. `InviteManager.generateInviteCode()` used `Math.random()` over a 32-symbol
 * confusable-free alphabet; `create_team_as_admin` used `upper(substr(md5(random()::text), 1, 8))`
 * — 8 HEX characters, a different alphabet and eight fewer bits. One concept, two
 * implementations, drifting (CLAUDE.md principle 9), and this exact table had already been bitten
 * by the same shape in SEC-09's `expires_at`.
 *
 * The defect that mattered is the RNG rather than the length. An invite code is a bearer
 * credential — it lands whoever types it in a team's roster as `pending` — and neither
 * `Math.random()` (V8's xorshift128+, state recoverable from a handful of outputs) nor Postgres
 * `random()` is cryptographic.
 *
 * WHAT THESE TESTS ARE FOR, since "it uses gen_random_bytes now" is readable in the migration and
 * proves nothing:
 *
 *   1. The two paths agree, compared against each other rather than against a literal — the
 *      structure SEC-09's suite established, and the only shape that fails if a later change
 *      gives one path its own generator back.
 *   2. The privilege actually holds. The first draft of the migration wrote
 *      `REVOKE INSERT (code) ...` against a role holding TABLE-level INSERT, which is a no-op:
 *      `has_column_privilege` still answered true and the control read as applied while doing
 *      nothing. So this asks a real client to set a real code and requires a refusal.
 *   3. The alphabet and the length are what a person at a venue has to type.
 *
 * Statistical quality is NOT tested here and deliberately so: a test that samples a CSPRNG and
 * asserts it looks random passes for a `Math.random()` implementation too, which is precisely the
 * defect being fixed. What can be checked is that the codes are drawn uniformly from the intended
 * alphabet and do not repeat — everything past that is an argument about the source, and the
 * source is named in one place now.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures } from './fixtures';
import { serviceClient, userClient } from './stack';

let fixtures: Fixtures;
const svc = serviceClient();

/*
 * TEAMS THE RPC CREATES, TRACKED BY HAND — Sprint 17's lesson, verbatim, and Sprint 19's
 * parking lot is the reason it is repeated rather than assumed. `Fixtures` only cleans up what
 * it inserted itself, so a team made by `create_team_as_admin` survives the run and the NEXT
 * run collides on `UNIQUE (program, team_number)` with an error about the fixture rather than
 * about the test. Deleted BEFORE `fixtures.cleanup()`, because `teams.owner_id` references
 * `users(id)` with no cascade.
 */
const createdTeamIds: string[] = [];

/** 32 symbols with I, O, 0 and 1 removed — the set a code is read off a screen and typed from. */
const ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

beforeAll(() => {
    fixtures = new Fixtures();
});

afterAll(async () => {
    for (const id of createdTeamIds) await svc.from('teams').delete().eq('id', id);
    await fixtures.cleanup();
}, 120_000);

describe('SEC-17 — the invite code the database chooses', () => {
    it('arrives without the client asking for one', async () => {
        const team = await fixtures.createTeam('sec17-default');

        /*
         * No `code` in the insert at all. Before this change that was a NOT NULL violation, which
         * is why both call sites had to mint their own — the column had no DEFAULT to fall back
         * on and so every writer needed an opinion.
         */
        const { data, error } = await svc
            .from('invites')
            .insert({ team_id: team.id, created_by: team.admin.id } as never)
            .select('code')
            .single();

        expect(error, 'inserting an invite without a code was refused').toBeNull();
        expect((data as { code: string }).code).toMatch(ALPHABET);
    });

    /*
     * THE INVITE PANEL'S OWN WRITE, AS THE ROLE THAT MAKES IT.
     *
     * The test above inserts as `service_role`, and so did every other successful insert in this
     * file — which is how SEC-17 shipped a DEFAULT that no signed-in user could evaluate. The
     * generator was SECURITY DEFINER with EXECUTE revoked from `authenticated`, on the belief
     * that a DEFAULT "is evaluated by the server" and needs no privilege. It is evaluated AS THE
     * INSERTING ROLE, and EXECUTE is checked: every "Generate invite" click in production from
     * 2026-08-28 to 2026-09-14 returned `permission denied for function generate_invite_code`,
     * and the panel said only "Failed to create invite". Found by a coach, not by 229 lines of
     * tests about invite codes.
     *
     * So: the exact columns `InviteManager.createInvite` sends, through the admin's own client,
     * reading the row back with `.select()` the way the panel does.
     */
    it('can be created by a roster manager from the invite panel', async () => {
        const team = await fixtures.createTeam('sec17-panel');

        const { data, error } = await team.admin.client
            .from('invites')
            .insert({ team_id: team.id, created_by: team.admin.id, max_uses: 5 } as never)
            .select()
            .single();

        expect(error, `the invite panel's insert was refused: ${error?.message}`).toBeNull();
        const row = data as { code: string; max_uses: number; expires_at: string };
        expect(row.code).toMatch(ALPHABET);
        expect(row.max_uses).toBe(5);
        expect(row.expires_at, 'the lifetime DEFAULT did not apply').toBeTruthy();
    });

    /*
     * And the policy is what refuses a student now, not a missing function grant.
     *
     * While the generator was unexecutable, EVERY client insert died on it before RLS was
     * consulted — so the cross-tenant INSERT cases for `invites` were green for the wrong reason
     * for sixteen days, and `invites_insert_roster` was not being tested at all.
     */
    it('is still refused to a member who cannot manage the roster, by RLS', async () => {
        const team = await fixtures.createTeam('sec17-student');
        const student = team.users.student;

        const { error } = await student.client
            .from('invites')
            .insert({ team_id: team.id, created_by: student.id } as never);

        expect(error, 'a student created an invite').not.toBeNull();
        expect(error?.message ?? '', `refused for the wrong reason: ${error?.message}`).not.toMatch(
            /generate_invite_code/,
        );
        expect(error?.message ?? '').toMatch(/row-level security/i);
    });

    /*
     * THE TWO PATHS, COMPARED WITH EACH OTHER.
     *
     * Not "both match /^[A-Z2-9]{8}$/" — that assertion passes on two different generators that
     * happen to share a shape, which is the state this finding describes. The point is that there
     * is one generator, so the strongest available check is that the registration path produces a
     * code indistinguishable from the panel path by every property the panel path has.
     */
    it('is the same generator on the registration screen as in the invite panel', async () => {
        const admin = await fixtures.createUser('sec17-rpc-admin');
        await fixtures.attest(admin.id);
        const client = userClient(admin.token);

        const { data: created, error: rpcError } = await client.rpc('create_team_as_admin', {
            team_name: 'SEC17 Registration Robotics',
            season_name: '2026-2027',
            team_number: String(41000 + Math.floor(Math.random() * 900)),
        });
        expect(rpcError, 'create_team_as_admin failed').toBeNull();

        const result = created as { team_id: string; invite_code: string };
        createdTeamIds.push(result.team_id);

        // The code the success screen prints.
        expect(result.invite_code, 'the RPC returned no invite code').toBeTruthy();
        expect(result.invite_code).toMatch(ALPHABET);

        /*
         * AND IT IS THE ROW'S CODE, not a second value the RPC computed and happened to store.
         * `RETURNING code INTO` is what makes those the same string; a future edit that goes back
         * to computing it locally would still return something matching the alphabet above, and
         * this is the assertion that would notice.
         */
        const { data: row } = await svc
            .from('invites')
            .select('code')
            .eq('team_id', result.team_id)
            .single();
        expect((row as { code: string }).code).toBe(result.invite_code);

        // The panel path, on the same database, for comparison.
        const { data: panel } = await svc
            .from('invites')
            .insert({ team_id: result.team_id, created_by: admin.id } as never)
            .select('code')
            .single();
        const panelCode = (panel as { code: string }).code;

        expect(panelCode).toMatch(ALPHABET);
        expect(panelCode.length, 'the two paths disagree about length').toBe(
            result.invite_code.length,
        );
        expect(panelCode, 'two paths produced the same code, which is not a generator').not.toBe(
            result.invite_code,
        );
    });

    /*
     * THE PRIVILEGE, ASKED AS A CLIENT RATHER THAN READ FROM A CATALOGUE.
     *
     * `has_column_privilege` answered TRUE for the first draft of this migration and the control
     * did nothing, because a column REVOKE cannot subtract from a table-level grant. A catalogue
     * assertion would have agreed with the broken version. This one issues the write.
     */
    it('cannot be chosen by the client — the code column is not writable', async () => {
        const team = await fixtures.createTeam('sec17-privilege');

        const { error } = await team.admin.client
            .from('invites')
            .insert({
                team_id: team.id,
                created_by: team.admin.id,
                code: 'ATTACKER',
            } as never);

        expect(error, 'an admin was allowed to choose their own invite code').not.toBeNull();
        expect(
            `${error?.message} ${error?.code}`,
            `refused, but for the wrong reason: ${error?.message}`,
        ).toMatch(/permission denied|42501/i);
        /*
         * "permission denied" alone is satisfied by the generator being unexecutable too — which
         * is the state this very file shipped in, and why this test was green over a broken panel.
         * The refusal must be about the COLUMN.
         */
        expect(error?.message ?? '', `refused by the generator, not the column: ${error?.message}`).not.toMatch(
            /function/,
        );
    });

    it('cannot be edited after the fact either — rotation is revoke-and-generate', async () => {
        const team = await fixtures.createTeam('sec17-update');

        const { error } = await team.admin.client
            .from('invites')
            .update({ code: 'REWRITTN' } as never)
            .eq('id', team.inviteId);

        expect(error, 'an admin was allowed to rewrite an existing code').not.toBeNull();
        expect(`${error?.message} ${error?.code}`).toMatch(/permission denied|42501/i);
    });

    /*
     * The one write on this table that a roster manager legitimately has, kept working.
     *
     * Revoking UPDATE outright would have been simpler and would have left `invites_update_roster`
     * as a policy guarding a door nobody can reach. This is the assertion that says the narrowing
     * was a narrowing rather than a removal.
     */
    it('still lets a roster manager change the seat cap', async () => {
        const team = await fixtures.createTeam('sec17-maxuses');

        const { error } = await team.admin.client
            .from('invites')
            .update({ max_uses: 3 } as never)
            .eq('id', team.inviteId);

        expect(error, `changing max_uses was refused: ${error?.message}`).toBeNull();

        const { data } = await svc
            .from('invites')
            .select('max_uses')
            .eq('id', team.inviteId)
            .single();
        expect((data as { max_uses: number }).max_uses).toBe(3);
    });

    /*
     * Uniqueness, at a sample size where a repeat would mean the generator is broken rather than
     * unlucky. 500 draws from 32^8 (~1.1e12) have a birthday-collision probability of about one
     * in nine million; a duplicate here is a stuck RNG, not a coincidence.
     */
    it('does not repeat itself across 500 codes', async () => {
        const team = await fixtures.createTeam('sec17-unique');

        const rows = Array.from({ length: 500 }, () => ({
            team_id: team.id,
            created_by: team.admin.id,
        }));
        const { data, error } = await svc.from('invites').insert(rows as never).select('code');

        expect(error, `bulk insert failed: ${error?.message}`).toBeNull();
        const codes = (data as { code: string }[]).map((r) => r.code);

        expect(codes).toHaveLength(500);
        expect(new Set(codes).size, 'two of 500 generated codes were identical').toBe(500);
        expect(codes.every((c) => ALPHABET.test(c)), 'a code left the alphabet').toBe(true);

        /*
         * Every symbol reachable. A generator that masked the wrong number of bits — five is
         * correct for a 32-symbol alphabet — would still produce plausible-looking codes while
         * silently using only half the alphabet, which no other assertion here would catch.
         */
        const seen = new Set(codes.join('').split(''));
        expect(seen.size, `only ${seen.size} of 32 symbols appeared in 4000 draws`).toBe(32);
    });
});
