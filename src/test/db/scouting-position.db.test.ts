/**
 * P-02 — alliance and station, against the real database.
 *
 * The two columns are the only schema change this sprint makes, and both are NULLABLE on
 * purpose: a scout at a venue is watching a match, not filling in a form, and every field that
 * insists is a reason for a report not to exist at all. `match_number` is already optional for
 * exactly this reason and B18 is what happened when an optional number was made to look
 * mandatory — five fabricated zeroes in production scouting data.
 *
 * BEHAVIOURAL, THROUGH PostgREST, as the coach. `docs/environment-divergences.md` §5:
 * `schema_assertions.sql` connects as `postgres` and would approve a CHECK nobody can reach.
 *
 * WHAT WOULD MAKE THESE FAIL: dropping either CHECK, or making either column NOT NULL.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures, type TestTeam } from './fixtures';
import { serviceClient } from './stack';

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('scout-position');
}, 120_000);

afterAll(async () => {
    await fixtures.cleanup();
}, 120_000);

const insert = (over: Record<string, unknown>) =>
    team.users.coach.client.from('scouting_reports').insert({
        team_id: team.id,
        season_id: team.seasonId,
        opponent_team_number: '30727',
        data: {},
        ...over,
    } as never);

describe('scouting_reports.alliance / .station', () => {
    it('accepts a report with neither noted', async () => {
        // The commonest case, and the one that must never be refused.
        const { error } = await insert({});
        expect(error).toBeNull();
    });

    it('accepts red and blue, and stations 1 to 3', async () => {
        for (const alliance of ['red', 'blue']) {
            for (const station of [1, 2, 3]) {
                const { error } = await insert({ alliance, station });
                expect(error, `${alliance} ${station} was refused`).toBeNull();
            }
        }
    });

    it('REFUSES an alliance that is not a colour', async () => {
        const { error } = await insert({ alliance: 'green' });
        // 23514 = check_violation. Asserting the code, not just "something went wrong": an RLS
        // refusal (42501) is a different bug wearing the same shape.
        expect(error?.code).toBe('23514');
        expect(error?.message).toMatch(/scouting_reports_alliance_valid/);
    });

    it('REFUSES a station outside 1–3', async () => {
        for (const station of [0, 4, -1]) {
            const { error } = await insert({ station });
            expect(error?.code, `station ${station} was accepted`).toBe('23514');
            expect(error?.message).toMatch(/scouting_reports_station_valid/);
        }
    });

    it('round-trips both through PostgREST unchanged', async () => {
        const { data, error } = await team.users.coach.client
            .from('scouting_reports')
            .insert({
                team_id: team.id,
                season_id: team.seasonId,
                opponent_team_number: '8412',
                data: { autoScore: 30 },
                alliance: 'blue',
                station: 2,
            } as never)
            .select('alliance, station, data')
            .single();

        expect(error).toBeNull();
        expect(data).toMatchObject({ alliance: 'blue', station: 2, data: { autoScore: 30 } });
    });

    it('leaves every existing report alone', async () => {
        // The migration adds nullable columns to a table with live rows. A row written before it
        // must read back with both absent rather than with a default nobody chose.
        await svc.from('scouting_reports').insert({
            team_id: team.id,
            season_id: team.seasonId,
            opponent_team_number: '1',
            data: {},
        } as never);

        const { data } = await svc
            .from('scouting_reports')
            .select('alliance, station')
            .eq('team_id', team.id)
            .eq('opponent_team_number', '1')
            .single();

        expect(data).toMatchObject({ alliance: null, station: null });
    });
});
