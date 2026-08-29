/**
 * `scouting_reports.season_event_id` — the event by identity, against the real database.
 *
 * WHY THE COLUMN EXISTS. `event_name` is free text and the summary groups on it, so two scouts
 * at one competition typing "League Meet 1" and "League meet 1" produced two events in the
 * filter and two separate summaries, with nothing to say so. The client half normalises the
 * label; this half is the part normalising cannot do — "MI State" and "Michigan State
 * Championship" are different strings by any measure and the same event.
 *
 * BEHAVIOURAL, THROUGH PostgREST, as the coach. `docs/environment-divergences.md` §5:
 * `schema_assertions.sql` connects as `postgres`, who is not the app and cannot be refused, so
 * it would happily approve a constraint no real caller can reach.
 *
 * THE FOREIGN KEY IS COMPOSITE ON PURPOSE — `(season_event_id, team_id)` against
 * `competition_events (id, team_id)`. A single-column reference to `id` would let one team's
 * report point at another team's event, which is B21's shape: knowing a uuid is the entire
 * attack. The cross-tenant test below is the one that would catch that regression, and it is
 * the reason this file exists rather than a line in `schema_assertions.sql`.
 *
 * WHAT WOULD MAKE THESE FAIL: dropping the FK, making it single-column, making the column NOT
 * NULL, or changing the delete action to CASCADE (which would delete a season's scouting when
 * an event is tidied up) or to a whole-key SET NULL (which cannot fire at all, because
 * `team_id` is NOT NULL — the trap the erasure runbook documents on five other constraints).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures, type TestTeam } from './fixtures';
import { serviceClient } from './stack';

let fixtures: Fixtures;
let team: TestTeam;
let other: TestTeam;
let eventId: string;
let otherEventId: string;
const svc = serviceClient();

const makeEvent = async (t: TestTeam, name: string): Promise<string> => {
    const { data, error } = await svc
        .from('competition_events')
        .insert({ team_id: t.id, season_id: t.seasonId, name })
        .select('id')
        .single();
    if (error) throw new Error(`could not create fixture event: ${error.message}`);
    return (data as { id: string }).id;
};

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('scout-event');
    other = await fixtures.createTeam('scout-event-other');
    eventId = await makeEvent(team, 'League Meet 1');
    otherEventId = await makeEvent(other, 'Someone Else Meet');
}, 180_000);

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

describe('scouting_reports.season_event_id', () => {
    it('accepts a report with no event link at all', async () => {
        /*
         * The commonest case and a PERMANENT one, not a migration to finish: every report
         * written before this column has no link, and a scout at an event the coach has not
         * entered yet must still be able to record what they saw.
         */
        const { error } = await insert({});
        expect(error).toBeNull();
    });

    it("links a report to its own team's event", async () => {
        const { error } = await insert({ season_event_id: eventId });
        expect(error).toBeNull();
    });

    it("REFUSES a link to another team's event", async () => {
        /*
         * The test this file is really for. The coach names their OWN team_id — which is what
         * makes this reachable at all — and an event id belonging to somebody else. A
         * single-column foreign key would accept it, and the report would then group under a
         * competition its team never attended.
         *
         * Asserting the CODE, not merely that something failed: 42501 (an RLS refusal) would
         * mean the row was blocked for an unrelated reason and the constraint might still be
         * wrong.
         */
        const { error } = await insert({ season_event_id: otherEventId });
        expect(error).not.toBeNull();
        expect(error?.code).toBe('23503'); // foreign_key_violation
    });

    it('REFUSES a link to an event id that does not exist', async () => {
        const { error } = await insert({
            season_event_id: '00000000-0000-0000-0000-000000000000',
        });
        expect(error?.code).toBe('23503');
    });

    it('keeps the report when its event is deleted, nulling only the link', async () => {
        /*
         * ON DELETE SET NULL (season_event_id) — the PER-COLUMN form. Deleting an event must not
         * delete the scouting done at it, and the whole-key form could not fire anyway because
         * `team_id` is NOT NULL: it would try to null the tenant and raise instead, which is the
         * defect this repo documents on five other composite constraints.
         *
         * The report keeps its `event_name`, so it stays readable and stays grouped by label.
         */
        const doomed = await makeEvent(team, 'Deleted Meet');
        const { data: created, error: insertError } = await team.users.coach.client
            .from('scouting_reports')
            .insert({
                team_id: team.id,
                season_id: team.seasonId,
                opponent_team_number: '30728',
                data: {},
                event_name: 'Deleted Meet',
                season_event_id: doomed,
            } as never)
            .select('id')
            .single();
        expect(insertError).toBeNull();
        const reportId = (created as { id: string }).id;

        const { error: deleteError } = await svc
            .from('competition_events')
            .delete()
            .eq('id', doomed);
        expect(deleteError).toBeNull();

        const { data: after, error: readError } = await svc
            .from('scouting_reports')
            .select('id, team_id, season_event_id, event_name')
            .eq('id', reportId)
            .single();

        expect(readError).toBeNull();
        const row = after as { team_id: string; season_event_id: string | null; event_name: string };
        expect(row.season_event_id).toBeNull();
        // The two that must SURVIVE. A whole-key SET NULL would have taken the tenant with it.
        expect(row.team_id).toBe(team.id);
        expect(row.event_name).toBe('Deleted Meet');
    });
});
