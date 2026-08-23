/**
 * D3 — the 30-day probation and the two controls that replaced the licence as the anti-abuse
 * mechanism, against a real database.
 *
 * The decision's own argument is what these tests are shaped around: withholding a licence
 * stops neither a fake team nor a stolen number, and delays only real coaches. So the licence
 * gets shorter and less important, and two structural rules do the work —
 * `UNIQUE (program, team_number)` and one auto-created team per account.
 *
 * WHY THESE ARE db TESTS AND NOT UNIT TESTS. Every rule here is enforced by
 * `create_team_as_admin` running as SECURITY DEFINER, or by an index. A mock cannot represent
 * either. `docs/failure-modes.md` §2's worst variant is a test that asserts against a mock
 * incapable of expressing the property under test, and "the second INSERT is refused" is
 * exactly such a property.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures } from './fixtures';
import { serviceClient, userClient } from './stack';

/** `create_team_as_admin`'s return shape. `error_code` is new; the client branches on it. */
interface CreateResult {
    success: boolean;
    error?: string;
    error_code?: string;
    team_id?: string;
    team_name?: string;
    team_number?: string;
    invite_code?: string;
    trial_days?: number;
}

interface GrantExtraResult {
    success: boolean;
    error?: string;
    grant_id?: string;
    already_had_one?: boolean;
}

interface ExtendResult {
    success: boolean;
    error?: string;
    grant_id?: string;
    valid_until?: string;
}

const asCreate = (d: unknown) => d as unknown as CreateResult;

let fixtures: Fixtures;
const svc = serviceClient();

/** A fresh 18+, attested account that owns nothing — the state a real coach registers from. */
async function newCoach(label: string) {
    const user = await fixtures.createUser(label);
    await fixtures.attest(user.id);
    return { ...user, client: userClient(user.token) };
}

let seq = 50_000;
const freshNumber = () => String(++seq);

/*
 * EVERY TEAM THIS FILE CREATES, TRACKED BY HAND.
 *
 * `Fixtures` only cleans up what it inserted itself, and almost every team here is created by
 * `create_team_as_admin` — so nothing was tearing them down. The first full-suite run made
 * that unmissable in exactly the way this sprint's own feature is designed to: the second run
 * reused `#50001`, `create_team_as_admin` correctly answered "already registered", and eleven
 * tests failed with the fixture's leftovers rather than with anything under test. A suite that
 * passes only on a fresh database is a suite that will fail on CI's second attempt.
 *
 * Deleted BEFORE `fixtures.cleanup()`, because `teams.owner_id` references `users(id)` with no
 * cascade: removing the user first would fail on the team, and a cleanup that fails quietly is
 * how the leftovers got here.
 */
const createdTeamIds: string[] = [];

/** A team inserted directly, for the tests that deliberately bypass the RPC. */
async function insertTeam(row: Record<string, unknown>) {
    const { data, error } = await svc.from('teams').insert(row as never).select('id').single();
    if (data?.id) createdTeamIds.push(data.id);
    return { error };
}

async function createTeamAs(
    coach: { client: ReturnType<typeof userClient> },
    args: { team_name: string; season_name: string; team_number?: string },
): Promise<CreateResult> {
    const { data } = await coach.client.rpc('create_team_as_admin', args);
    const result = asCreate(data);
    if (result?.team_id) createdTeamIds.push(result.team_id);
    return result;
}

beforeAll(async () => {
    fixtures = new Fixtures();
}, 120_000);

afterAll(async () => {
    for (const id of createdTeamIds) await svc.from('teams').delete().eq('id', id);
    await fixtures.cleanup();
}, 120_000);

// ===========================================================================
describe('the probation is 30 days, not 90 (D3)', () => {
    /*
     * THE RED TEST for the headline change. `v_trial_days constant integer := 90` gave a team
     * registering at kickoff cover until roughly 5 December — the middle of the league-meet
     * window — which is SEC-07's original complaint. Thirty days is a probation the operator
     * extends, not a trial that runs out during a competition.
     *
     * Asserted as a RANGE around 30 days rather than an exact timestamp, because the row is
     * written with the server's `now()` and read back over the wire; an exact comparison here
     * would be a test about clock skew.
     */
    it('grants cover ending about 30 days out', async () => {
        const coach = await newCoach('probation-length');
        const data = await createTeamAs(coach, {
            team_name: 'Probation Robotics',
            season_name: '2026-2027',
            team_number: freshNumber(),
        });
        const result = data;
        expect(result.success, result.error).toBe(true);
        expect(result.trial_days).toBe(30);

        const { data: grants } = await svc
            .from('license_grants')
            .select('valid_until, notes, seats')
            .eq('team_id', result.team_id!);

        expect(grants).toHaveLength(1);
        const days = (new Date(grants![0].valid_until!).getTime() - Date.now()) / 86_400_000;
        expect(days).toBeGreaterThan(29);
        expect(days).toBeLessThan(31);
        // Unlimited seats stays: the probation is about TIME, not headcount, and a coach
        // rostering fifteen students on day one must not hit a seat wall as well.
        expect(grants![0].seats).toBeNull();
    });

    /*
     * WALK-B-09's server half. The admin panel labelled every `source='gift'` grant "Gifted
     * licence", and a coach who had just registered themselves was told they had been given a
     * gift they never received — next to step 1's "you will be billed monthly". The label now
     * keys on this text, so the text is part of the contract and gets an assertion.
     */
    it('says "probation" in the notes, which is what the admin panel labels it from', async () => {
        const coach = await newCoach('probation-notes');
        const data = await createTeamAs(coach, {
            team_name: 'Notes Robotics',
            season_name: '2026-2027',
            team_number: freshNumber(),
        });
        const result = data;
        expect(result.success, result.error).toBe(true);

        const { data: grants } = await svc
            .from('license_grants')
            .select('notes')
            .eq('team_id', result.team_id!);

        expect(grants![0].notes).toBe(
            'Automatic 30-day beta probation issued at team registration',
        );
    });
});

// ===========================================================================
describe('one team per (program, number)', () => {
    /*
     * THE RED TEST. Without the uniqueness check, the second call SUCCEEDS and two teams hold
     * #12345 — which is not a hypothetical: two coaches from the same team both registering,
     * and typo'd numbers, are the reasons D3 calls this "certain" rather than defensive.
     */
    it('refuses a number another team already holds, and names the team', async () => {
        const number = freshNumber();
        const first = await newCoach('number-first');
        const a = await createTeamAs(first, {
            team_name: 'Iron Falcons',
            season_name: '2026-2027',
            team_number: number,
        });
        expect(a.success, a.error).toBe(true);

        const second = await newCoach('number-second');
        const b = await createTeamAs(second, {
            team_name: 'Also Iron Falcons',
            season_name: '2026-2027',
            team_number: number,
        });
        const result = b;

        expect(result.success).toBe(false);
        expect(result.error_code).toBe('team_number_taken');
        expect(result.team_name).toBe('Iron Falcons');
        expect(result.error).toContain('invite code');

        // Nothing was created. A refusal that leaves a half-built team behind is worse than
        // the duplicate it prevented.
        const { count } = await svc
            .from('teams')
            .select('id', { count: 'exact', head: true })
            .eq('team_number', number);
        expect(count).toBe(1);
    });

    /*
     * THE ASYMMETRY THAT IS THE SECURITY LINE, and it gets its own test because it is the kind
     * of thing a later "helpful" change quietly undoes. The refusal returns the team's NAME so
     * the coach can recognise their own team; it must not return the id. B21's lesson was that
     * "knowing a team's uuid is the entire attack" when a membership can be built from it, and
     * a number is far easier to guess than a uuid.
     */
    it('does not hand the caller the id of a team they are not on', async () => {
        const number = freshNumber();
        const first = await newCoach('number-leak-first');
        await createTeamAs(first, {
            team_name: 'Private Falcons',
            season_name: '2026-2027',
            team_number: number,
        });

        const stranger = await newCoach('number-leak-stranger');
        const data = await createTeamAs(stranger, {
            team_name: 'Not Yours',
            season_name: '2026-2027',
            team_number: number,
        });
        const result = data;

        expect(result.error_code).toBe('team_number_taken');
        expect(result.team_id).toBeUndefined();
    });

    /*
     * "You are already on this team" is a different sentence from "somebody else has it", and
     * telling them apart is most of the feature's value: the commonest real collision is a
     * coach registering their own team twice, and sending a team's own admin into a
     * request-to-join queue for their own team would be absurd.
     */
    it('tells a member of that team to switch to it instead', async () => {
        const number = freshNumber();
        const coach = await newCoach('number-own');
        const a = await createTeamAs(coach, {
            team_name: 'My Own Falcons',
            season_name: '2026-2027',
            team_number: number,
        });
        const created = a;
        expect(created.success, created.error).toBe(true);

        // Give them the extra-team grant, so the ONLY thing that can refuse the second call is
        // the number. Without this the one-team rule would refuse first and this test would
        // pass while asserting nothing about numbers at all -- failure-modes §2's
        // "precondition short-circuits before the assertion" variant.
        const operator = await newCoach('number-own-operator');
        await svc.from('platform_operators').insert({ user_id: operator.id } as never);
        await operator.client.rpc('operator_grant_extra_team', { p_user_id: coach.id });
        await svc.from('platform_operators').delete().eq('user_id', operator.id);

        const b = await createTeamAs(coach, {
            team_name: 'My Own Falcons Again',
            season_name: '2026-2027',
            team_number: number,
        });
        const result = b;

        expect(result.error_code).toBe('already_on_team');
        // Their OWN team's id is fine to return -- they are on it, and the client uses it to
        // switch them into it.
        expect(result.team_id).toBe(created.team_id);
    });

    /*
     * A team with no number is a real case in September, before FIRST has issued one, and two
     * of them must not collide with each other. This is why the index is PARTIAL and why the
     * RPC normalises '' to NULL — '' is not distinct from '' in an index, and the create-team
     * wizard can produce one.
     */
    it('lets several teams have no number at all', async () => {
        for (const label of ['no-number-a', 'no-number-b']) {
            const coach = await newCoach(label);
            const data = await createTeamAs(coach, {
                team_name: `${label} Robotics`,
                season_name: '2026-2027',
                team_number: '   ',
            });
            const result = data;
            expect(result.success, result.error).toBe(true);

            const { data: team } = await svc
                .from('teams')
                .select('team_number, program')
                .eq('id', result.team_id!)
                .single();
            expect(team!.team_number).toBeNull();
            expect(team!.program).toBe('ftc');
        }
    });

    it('trims the number rather than storing the spaces around it', async () => {
        const number = freshNumber();
        const coach = await newCoach('number-trim');
        const data = await createTeamAs(coach, {
            team_name: 'Trimmed Robotics',
            season_name: '2026-2027',
            team_number: `  ${number} `,
        });
        const result = data;
        expect(result.success, result.error).toBe(true);

        const { data: team } = await svc
            .from('teams')
            .select('team_number')
            .eq('id', result.team_id!)
            .single();
        expect(team!.team_number).toBe(number);
    });

    /*
     * THE INDEX ITSELF, not the RPC's check. The RPC is ergonomics; the index is the rule. A
     * direct INSERT with the service key bypasses `create_team_as_admin` entirely, which is
     * what a future feature, a seed script or a support script would do — and all three have
     * happened in this repo.
     */
    it('the database refuses a duplicate even when the RPC is bypassed', async () => {
        const number = freshNumber();
        const owner = await newCoach('number-index');
        await insertTeam({ name: 'Index Falcons', team_number: number, owner_id: owner.id });

        const { error } = await insertTeam({
            name: 'Index Falcons Two',
            team_number: number,
            owner_id: owner.id,
        });

        expect(error, 'the unique index did not fire').not.toBeNull();
        expect(error!.code).toBe('23505');
    });

    /*
     * FRC is planned and the numbers overlap, which is the entire reason `program` is a column
     * rather than an `"FTC-12345"` string. No FRC behaviour is built, so this asserts the
     * SHAPE is right and nothing more: the same number in two programs is two teams.
     */
    it('the same number in another program is a different team', async () => {
        const number = freshNumber();
        const owner = await newCoach('number-program');
        await insertTeam({ name: 'FTC Falcons', team_number: number, owner_id: owner.id });

        const { error } = await insertTeam({
            name: 'FRC Falcons', team_number: number, program: 'frc', owner_id: owner.id,
        });

        expect(error, error?.message).toBeNull();
    });
});

// ===========================================================================
describe('one auto-created team per account (SEC-08)', () => {
    /*
     * THE RED TEST for SEC-08's trial chaining. Before this, one account could register a team
     * every day for ever, each with a fresh unlimited-seat grant, which "defeats billing
     * forever" the moment Stripe exists.
     */
    it('refuses a second team, and says how to ask', async () => {
        const coach = await newCoach('one-team');
        const a = await createTeamAs(coach, {
            team_name: 'First Team', season_name: '2026-2027', team_number: freshNumber(),
        });
        expect(a.success, a.error).toBe(true);

        const b = await createTeamAs(coach, {
            team_name: 'Second Team', season_name: '2026-2027', team_number: freshNumber(),
        });
        const result = b;

        expect(result.success).toBe(false);
        expect(result.error_code).toBe('one_team_per_account');
        // The refusal must reach somebody who can satisfy it (failure-modes §8). A coach who
        // genuinely runs two teams needs to know the door exists.
        expect(result.error).toContain('support@falcon-forge.com');
    });

    it('an operator grant buys exactly one more, and only one', async () => {
        const coach = await newCoach('extra-grant');
        await createTeamAs(coach, {
            team_name: 'Team One', season_name: '2026-2027', team_number: freshNumber(),
        });

        const operator = await newCoach('extra-grant-operator');
        await svc.from('platform_operators').insert({ user_id: operator.id } as never);
        const { data: granted } = await operator.client.rpc('operator_grant_extra_team', {
            p_user_id: coach.id,
            p_notes: 'Runs two teams at the same school',
        });
        expect((granted as unknown as GrantExtraResult).success).toBe(true);

        const second = await createTeamAs(coach, {
            team_name: 'Team Two', season_name: '2026-2027', team_number: freshNumber(),
        });
        expect(second.success, second.error).toBe(true);

        // ...and the grant is spent. An operator who helped once has not handed out a
        // standing exemption.
        const third = await createTeamAs(coach, {
            team_name: 'Team Three', season_name: '2026-2027', team_number: freshNumber(),
        });
        expect(third.error_code).toBe('one_team_per_account');

        await svc.from('platform_operators').delete().eq('user_id', operator.id);
    });

    /*
     * Granting twice must not buy two teams. An operator saying yes once and then losing the
     * tab is a support interaction, not a second entitlement.
     */
    it('granting twice is idempotent', async () => {
        const coach = await newCoach('extra-grant-twice');
        const operator = await newCoach('extra-grant-twice-op');
        await svc.from('platform_operators').insert({ user_id: operator.id } as never);

        const first = await operator.client.rpc('operator_grant_extra_team', { p_user_id: coach.id });
        const second = await operator.client.rpc('operator_grant_extra_team', { p_user_id: coach.id });

        expect((first.data as unknown as GrantExtraResult).already_had_one).toBe(false);
        expect((second.data as unknown as GrantExtraResult).already_had_one).toBe(true);
        expect((second.data as unknown as GrantExtraResult).grant_id).toBe(
            (first.data as unknown as GrantExtraResult).grant_id,
        );

        const { count } = await svc
            .from('extra_team_grants')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', coach.id);
        expect(count).toBe(1);

        await svc.from('platform_operators').delete().eq('user_id', operator.id);
    });

    /*
     * THE REFUSAL, written from the least-privileged role that can reach it, and naming their
     * OWN id rather than the victim's — `docs/failure-modes.md` §6's closing line, which is
     * how B21 survived 180 green assertions.
     */
    it('a non-operator cannot grant themselves an extra team', async () => {
        const coach = await newCoach('extra-grant-self');
        const { data } = await coach.client.rpc('operator_grant_extra_team', {
            p_user_id: coach.id,
        });

        expect((data as unknown as GrantExtraResult).success).toBe(false);
        expect((data as unknown as GrantExtraResult).error).toBe('Not authorized');

        const { count } = await svc
            .from('extra_team_grants')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', coach.id);
        expect(count).toBe(0);
    });

    /*
     * The grant table names a platform decision about a person, so the person it names must not
     * read it — the same rule `operator_actions` follows. Checked behaviourally over PostgREST
     * as the real role, never over the catalogue: `docs/environment-divergences.md` §5.
     */
    it('the grant table is invisible to the user it names', async () => {
        const coach = await newCoach('extra-grant-read');
        const operator = await newCoach('extra-grant-read-op');
        await svc.from('platform_operators').insert({ user_id: operator.id } as never);
        await operator.client.rpc('operator_grant_extra_team', { p_user_id: coach.id });
        await svc.from('platform_operators').delete().eq('user_id', operator.id);

        const { data, error } = await coach.client.from('extra_team_grants').select('*');

        expect(error).toBeNull();
        expect(data, 'a user could read the platform decision about them').toEqual([]);
    });
});

// ===========================================================================
describe('the operator sees the new teams and can extend them', () => {
    it('lists a brand-new team with its age, and says it has not been used', async () => {
        const coach = await newCoach('new-team-list');
        const number = freshNumber();
        const created = await createTeamAs(coach, {
            team_name: 'Brand New Robotics', season_name: '2026-2027', team_number: number,
        });
        const teamId = created.team_id!;

        const operator = await newCoach('new-team-list-op');
        await svc.from('platform_operators').insert({ user_id: operator.id } as never);
        const { data: rows } = await operator.client.rpc('operator_new_teams', { p_limit: 100 });
        await svc.from('platform_operators').delete().eq('user_id', operator.id);

        const row = (rows ?? []).find((r) => r.team_id === teamId);
        expect(row, 'the brand-new team was not in the new-team list').toBeDefined();
        expect(row!.team_number).toBe(number);
        expect(row!.program).toBe('ftc');
        expect(row!.age_days).toBe(0);
        expect(row!.members_total).toBe(1);
        expect(row!.content_rows).toBe(0);
        // The one field that carries the decision: a fake team and a real one look identical
        // on number, name and age.
        expect(row!.has_been_used).toBe(false);
        expect(row!.is_probation).toBe(true);
    });

    /*
     * "Used" has to be generous about WHAT counts, because the question is "is this real", not
     * "is this active". A second person on the roster is the strongest single signal, so it is
     * the one asserted here — with the same team measured before and after, so the assertion
     * cannot be satisfied by a fixture that was always going to say true.
     */
    it('flags a team as used once a second person joins', async () => {
        const coach = await newCoach('used-team');
        const created = await createTeamAs(coach, {
            team_name: 'Used Robotics', season_name: '2026-2027', team_number: freshNumber(),
        });
        const teamId = created.team_id!;

        const operator = await newCoach('used-team-op');
        await svc.from('platform_operators').insert({ user_id: operator.id } as never);

        const before = await operator.client.rpc('operator_new_teams', { p_limit: 100 });
        expect((before.data ?? []).find((r) => r.team_id === teamId)!.has_been_used).toBe(false);

        const student = await fixtures.createUser('used-team-student');
        await svc.from('team_members').insert({
            team_id: teamId, user_id: student.id, role: 'student', status: 'pending',
        } as never);

        const after = await operator.client.rpc('operator_new_teams', { p_limit: 100 });
        const row = (after.data ?? []).find((r) => r.team_id === teamId)!;
        expect(row.has_been_used).toBe(true);
        expect(row.members_total).toBe(2);

        await svc.from('platform_operators').delete().eq('user_id', operator.id);
    });

    it('a non-operator gets no rows at all', async () => {
        const coach = await newCoach('new-team-list-refuse');
        const { data, error } = await coach.client.rpc('operator_new_teams', { p_limit: 100 });

        expect(error).toBeNull();
        expect(data, 'a non-operator read the whole platform directory').toEqual([]);
    });

    /*
     * THE ONE CLICK. D3: "one click extends to season length once the team number has been
     * eyeballed". A new grant rather than an edit to the probation, so the audit trail keeps
     * the fact that a probation happened at all.
     */
    it('extends a probation to the end of the season without erasing it', async () => {
        const coach = await newCoach('extend');
        const created = await createTeamAs(coach, {
            team_name: 'Extend Robotics', season_name: '2026-2027', team_number: freshNumber(),
        });
        const teamId = created.team_id!;

        const operator = await newCoach('extend-op');
        await svc.from('platform_operators').insert({ user_id: operator.id } as never);
        const { data } = await operator.client.rpc('operator_extend_to_season', {
            p_team_id: teamId,
        });
        const result = data as unknown as ExtendResult;
        expect(result.success, result.error).toBe(true);

        // The probation row is still there and still in force. `team_entitlement` takes the
        // MAX of the in-force end dates, so the longer grant simply wins.
        const { data: grants } = await svc
            .from('license_grants')
            .select('valid_until, revoked_at, notes')
            .eq('team_id', teamId)
            .order('valid_until');
        expect(grants).toHaveLength(2);
        expect(grants!.every((g) => g.revoked_at === null)).toBe(true);
        expect(grants![0].notes).toContain('probation');

        // 30 April, and the NEXT one: a team extended in October 2026 and one extended in
        // February 2027 must both land on 2027-04-30, not eighteen months apart.
        const until = new Date(result.valid_until!);
        expect(until.getUTCMonth()).toBe(3);
        expect(until.getUTCDate()).toBe(30);
        expect(until.getTime()).toBeGreaterThan(Date.now());

        const { data: ent } = await svc
            .from('team_entitlement')
            .select('status, valid_until')
            .eq('team_id', teamId)
            .single();
        expect(ent!.status).toBe('active');
        expect(new Date(ent!.valid_until!).getTime()).toBe(until.getTime());

        // Recorded, like every other operator action.
        const { data: actions } = await svc
            .from('operator_actions')
            .select('action')
            .eq('team_id', teamId);
        expect(actions).toHaveLength(1);
        expect(actions![0].action).toBe('license_grant');

        await svc.from('platform_operators').delete().eq('user_id', operator.id);
    });

    it('a non-operator cannot extend anybody', async () => {
        const coach = await newCoach('extend-refuse');
        const created = await createTeamAs(coach, {
            team_name: 'Refuse Robotics', season_name: '2026-2027', team_number: freshNumber(),
        });
        const teamId = created.team_id!;

        const { data } = await coach.client.rpc('operator_extend_to_season', {
            p_team_id: teamId,
        });
        expect((data as unknown as ExtendResult).success).toBe(false);

        const { count } = await svc
            .from('license_grants')
            .select('id', { count: 'exact', head: true })
            .eq('team_id', teamId);
        expect(count, 'a non-operator issued themselves a grant').toBe(1);
    });
});
