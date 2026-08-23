/**
 * The four tables Sprint 18 added, against a real database (D2, D4(b)).
 *
 * CLAUDE.md principle 4: *"Every table: RLS + policies + a behavioural cross-tenant isolation
 * test in the same change."* This is that test, and it is a separate file rather than four more
 * cases in `tenant-isolation.rls.db.test.ts` for one reason: three of these tables have no
 * `season_id` of their own. They hang off the event, so `season_is_open` is checked THROUGH a
 * join — a policy shape nothing else in the schema has, and the shape most likely to be wrong.
 *
 * `docs/failure-modes.md` §6's closing line is what the last block is about: *"write the
 * isolation test from the perspective of the LEAST privileged role that can reach the table,
 * and try naming YOUR OWN id, not just the victim's."* B21 survived 180 green assertions
 * because every cross-tenant INSERT the suite tried named the victim's user id.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures, type TestTeam } from './fixtures';
import { serviceClient } from './stack';

let fixtures: Fixtures;
let teamA: TestTeam;
let teamB: TestTeam;
const svc = serviceClient();

/** Team B's event, match and participant — the rows team A must not be able to touch. */
let bEventId = '';
let bMatchId = '';
let bParticipantId = '';
let bOverrideId = '';

const ROLES = ['admin', 'coach', 'mentor', 'student'] as const;

beforeAll(async () => {
    fixtures = new Fixtures();
    teamA = await fixtures.createTeam('events-a');
    teamB = await fixtures.createTeam('events-b');

    const { data: event, error: eventErr } = await svc
        .from('competition_events')
        .insert({
            team_id: teamB.id,
            season_id: teamB.seasonId,
            name: 'Team B State Championship',
            event_code: 'USMIDET1',
            starts_on: '2027-02-21',
        } as never)
        .select('id')
        .single();
    if (eventErr) throw eventErr;
    bEventId = (event as { id: string }).id;

    const { data: match, error: matchErr } = await svc
        .from('event_matches')
        .insert({
            team_id: teamB.id,
            event_id: bEventId,
            phase: 'qualification',
            match_number: 12,
        } as never)
        .select('id')
        .single();
    if (matchErr) throw matchErr;
    bMatchId = (match as { id: string }).id;

    const { data: participant, error: partErr } = await svc
        .from('match_participants')
        .insert({
            team_id: teamB.id,
            match_id: bMatchId,
            alliance: 'red',
            station: 1,
            team_number: '22857',
            team_name: 'Mechanical Mustangs',
        } as never)
        .select('id')
        .single();
    if (partErr) throw partErr;
    bParticipantId = (participant as { id: string }).id;

    const { data: override, error: overrideErr } = await svc
        .from('team_game_overrides')
        .insert({
            team_id: teamB.id,
            season_id: teamB.seasonId,
            base_definition_id: 'ftc-2025-decode',
            patch: { hide: ['farShooting'] },
        } as never)
        .select('id')
        .single();
    if (overrideErr) throw overrideErr;
    bOverrideId = (override as { id: string }).id;
}, 180_000);

afterAll(async () => {
    await fixtures.cleanup();
}, 180_000);

/**
 * "Denied" is either an error or an empty result.
 *
 * PostgREST reports an RLS refusal two ways depending on the verb: INSERT hits the WITH CHECK
 * and errors (42501), while SELECT/UPDATE/DELETE are filtered by the USING clause and simply
 * match no rows. Both are denials; asserting on only one would miss half the surface.
 */
async function expectDenied(
    label: string,
    query: PromiseLike<{ data: unknown[] | null; error: unknown }>,
) {
    const { data, error } = await query;
    if (error) return;
    expect(data ?? [], `${label} was NOT denied — it affected rows`).toEqual([]);
}

describe('cross-tenant isolation for events and overrides', () => {
    const cases = () => [
        {
            table: 'competition_events' as const,
            id: () => bEventId,
            update: { name: 'Renamed by team A' },
            insert: () => ({
                team_id: teamB.id,
                season_id: teamB.seasonId,
                name: 'Inserted by team A',
            }),
        },
        {
            table: 'event_matches' as const,
            id: () => bMatchId,
            update: { match_number: 99 },
            insert: () => ({
                team_id: teamB.id,
                event_id: bEventId,
                phase: 'qualification',
                match_number: 77,
            }),
        },
        {
            table: 'match_participants' as const,
            id: () => bParticipantId,
            update: { team_number: '99999' },
            insert: () => ({
                team_id: teamB.id,
                match_id: bMatchId,
                alliance: 'blue',
                station: 2,
                team_number: '11111',
            }),
        },
        {
            table: 'team_game_overrides' as const,
            id: () => bOverrideId,
            update: { patch: { hide: [] } },
            insert: () => ({
                team_id: teamB.id,
                season_id: teamB.seasonId,
                base_definition_id: 'ftc-2025-decode',
                patch: {},
            }),
        },
    ];

    for (const role of ROLES) {
        describe(`as ${role} of team A`, () => {
            for (const testCase of cases()) {
                const { table } = testCase;

                it(`cannot SELECT team B's ${table}`, async () => {
                    const { data, error } = await teamA.users[role].client
                        .from(table)
                        .select('*')
                        .eq('id', testCase.id());

                    expect(error).toBeNull();
                    expect(data, `${role} read team B's ${table}`).toEqual([]);
                });

                it(`cannot INSERT into team B's ${table}`, async () => {
                    await expectDenied(
                        `${role} INSERT into team B's ${table}`,
                        teamA.users[role].client.from(table).insert(testCase.insert() as never).select(),
                    );
                });

                it(`cannot UPDATE team B's ${table}`, async () => {
                    await expectDenied(
                        `${role} UPDATE of team B's ${table}`,
                        teamA.users[role].client
                            .from(table)
                            .update(testCase.update as never)
                            .eq('id', testCase.id())
                            .select(),
                    );
                });

                it(`cannot DELETE team B's ${table}`, async () => {
                    await expectDenied(
                        `${role} DELETE of team B's ${table}`,
                        teamA.users[role].client.from(table).delete().eq('id', testCase.id()).select(),
                    );
                });
            }
        });
    }

    /*
     * THE ASSERTION THAT MAKES THE ABOVE MEAN SOMETHING. An empty result from UPDATE/DELETE is
     * weaker evidence than it looks: the RETURNING clause is itself filtered by the SELECT
     * policy, so a write that SUCCEEDED could still report zero rows. This asks the database
     * directly, with RLS bypassed.
     */
    it('leaves every one of team B rows exactly as it found them', async () => {
        const { data: event } = await svc
            .from('competition_events').select('name').eq('id', bEventId).single();
        const { data: match } = await svc
            .from('event_matches').select('match_number').eq('id', bMatchId).single();
        const { data: participant } = await svc
            .from('match_participants').select('team_number').eq('id', bParticipantId).single();
        const { data: override } = await svc
            .from('team_game_overrides').select('patch').eq('id', bOverrideId).single();

        expect(event!.name).toBe('Team B State Championship');
        expect(match!.match_number).toBe(12);
        expect(participant!.team_number).toBe('22857');
        expect(override!.patch).toEqual({ hide: ['farShooting'] });
    });
});

describe('an unauthenticated client can reach nothing', () => {
    for (const table of ['competition_events', 'event_matches', 'match_participants', 'team_game_overrides'] as const) {
        it(`anon cannot SELECT ${table}`, async () => {
            const { anonClient } = await import('./stack');
            const { data, error } = await anonClient().from(table).select('*');
            // Either shape is a refusal; what must not happen is rows coming back.
            expect(error ? [] : data ?? []).toEqual([]);
        });
    }
});

describe('same-team access works — the control that stops this suite being vacuous', () => {
    /*
     * Three tests that assert "denied" are all satisfied by a table nobody can read. Without
     * this block the suite above would pass against a schema where these tables were simply
     * broken — which is `docs/failure-modes.md` §2's second-commonest shape.
     */
    it('a student on team A can read and write their own team events', async () => {
        const student = teamA.users.student.client;

        const { data: created, error } = await student
            .from('competition_events')
            .insert({
                team_id: teamA.id,
                season_id: teamA.seasonId,
                name: 'Our own qualifier',
            } as never)
            .select('id')
            .single();

        expect(error, error?.message).toBeNull();
        const eventId = (created as { id: string }).id;

        /*
         * A STUDENT, deliberately, and this is D8 rather than an oversight. `can_manage_content`
         * means "any approved member" and is recorded as a product decision; the case it exists
         * for is precisely this one — a student correcting a surrogate at a venue while the
         * coach is in the pit.
         */
        const { data: match, error: matchErr } = await student
            .from('event_matches')
            .insert({
                team_id: teamA.id,
                event_id: eventId,
                phase: 'qualification',
                match_number: 3,
            } as never)
            .select('id')
            .single();
        expect(matchErr, matchErr?.message).toBeNull();

        const { error: partErr } = await student.from('match_participants').insert({
            team_id: teamA.id,
            match_id: (match as { id: string }).id,
            alliance: 'red',
            station: 1,
            team_number: '12345',
        } as never);
        expect(partErr, partErr?.message).toBeNull();

        await svc.from('competition_events').delete().eq('id', eventId);
    });

    /*
     * ...but NOT the form patch, which is `can_manage_structure`. A patch changes the form
     * every scout on the team types into; content permissions would let any student hide a
     * field mid-competition for everybody.
     */
    it('a student cannot rewrite the team form patch, but the admin can', async () => {
        await expectDenied(
            'student writing a game override',
            teamA.users.student.client
                .from('team_game_overrides')
                .insert({
                    team_id: teamA.id,
                    season_id: teamA.seasonId,
                    base_definition_id: 'ftc-2025-decode',
                    patch: { hide: ['autoAim'] },
                } as never)
                .select(),
        );

        const { error } = await teamA.users.admin.client.from('team_game_overrides').insert({
            team_id: teamA.id,
            season_id: teamA.seasonId,
            base_definition_id: 'ftc-2025-decode',
            patch: { hide: ['autoAim'] },
        } as never);
        expect(error, error?.message).toBeNull();

        await svc.from('team_game_overrides').delete().eq('team_id', teamA.id);
    });
});

describe('naming your own team is not a way in (B21)', () => {
    /*
     * THE SHAPE THAT SURVIVED 180 GREEN ASSERTIONS. Every cross-tenant INSERT above names team
     * B's id, which the policies obviously refuse. The attack B21 actually used was naming your
     * OWN id on somebody else's row — so: a match on team A, pointing at team B's EVENT.
     *
     * The composite foreign key `(event_id, team_id) -> competition_events(id, team_id)` is
     * what makes this structurally impossible rather than merely unlikely, which is why the
     * events entity uses composite FKs throughout. A plain `event_id` FK would let a row in
     * team A point at team B's event, and RLS would not notice because it only looks at
     * `team_id`.
     */
    it('a match cannot be attached to another team event', async () => {
        const { error } = await teamA.users.admin.client.from('event_matches').insert({
            team_id: teamA.id,
            event_id: bEventId,
            phase: 'qualification',
            match_number: 5,
        } as never);

        expect(error, 'team A attached a match to team B event').not.toBeNull();
    });

    it('a participant cannot be attached to another team match', async () => {
        const { error } = await teamA.users.admin.client.from('match_participants').insert({
            team_id: teamA.id,
            match_id: bMatchId,
            alliance: 'red',
            station: 2,
            team_number: '12345',
        } as never);

        expect(error, 'team A attached a participant to team B match').not.toBeNull();
    });

    it('an override cannot be attached to another team season', async () => {
        const { error } = await teamA.users.admin.client.from('team_game_overrides').insert({
            team_id: teamA.id,
            season_id: teamB.seasonId,
            base_definition_id: 'ftc-2025-decode',
            patch: {},
        } as never);

        expect(error, 'team A wrote a patch against team B season').not.toBeNull();
    });
});

describe('the season gates writes through the event (D2)', () => {
    /*
     * The policy shape nothing else in this schema has. `event_matches` and
     * `match_participants` have no `season_id`, so `season_is_open` is checked through a join
     * — and a join in a policy is exactly the kind of thing that is written once, looks right,
     * and turns out to check the wrong row.
     *
     * Archiving the season must stop a match being added to an event in it, without any
     * property of the match itself changing.
     */
    it('an archived season closes its events matches too', async () => {
        const { data: created } = await svc
            .from('competition_events')
            .insert({
                team_id: teamA.id,
                season_id: teamA.seasonId,
                name: 'Season-gate probe',
            } as never)
            .select('id')
            .single();
        const eventId = (created as { id: string }).id;

        // Open season: the write lands.
        const { error: openErr } = await teamA.users.admin.client.from('event_matches').insert({
            team_id: teamA.id, event_id: eventId, phase: 'qualification', match_number: 1,
        } as never);
        expect(openErr, openErr?.message).toBeNull();

        await svc.from('seasons').update({ is_archived: true } as never).eq('id', teamA.seasonId);

        const { error: closedErr } = await teamA.users.admin.client.from('event_matches').insert({
            team_id: teamA.id, event_id: eventId, phase: 'qualification', match_number: 2,
        } as never);
        expect(closedErr, 'an archived season still accepted a new match').not.toBeNull();

        await svc.from('seasons').update({ is_archived: false } as never).eq('id', teamA.seasonId);
        await svc.from('competition_events').delete().eq('id', eventId);
    });
});
