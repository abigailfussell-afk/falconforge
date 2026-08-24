/**
 * WALK-B-10 — a child's name has a length, and the database is the thing that holds it.
 *
 * The walkthrough typed a 142-character emoji name into "Add a child" and it was accepted,
 * stored and rendered in full on the coach's pending list, the roster, the join screen's
 * "Who is joining?" select and every guardian sentence naming the child. Sprint 19 capped eight
 * title/name columns and missed this one — the only one of the nine an adult types on behalf of
 * a minor, and the one that lands on the most other people's screens.
 *
 * BEHAVIOURAL, NOT CATALOGUE. The insert is attempted through PostgREST as the GUARDIAN, which
 * is the role that actually performs it, and the database is required to refuse.
 * `docs/environment-divergences.md` §5: `schema_assertions.sql` connects as `postgres` and would
 * approve a constraint nobody can reach, and a `pg_proc` assertion once approved a `REVOKE` that
 * was a no-op.
 *
 * WHAT WOULD MAKE THESE FAIL: dropping `managed_profiles_full_name_length`. The first test goes
 * green-to-red immediately — the insert stops being refused. That is the question
 * `docs/failure-modes.md` asks of every verification step, and it has an answer.
 *
 * The source-level pair check lives in `src/test/__tests__/title-length-limits.test.ts`; this is
 * the half that proves the constraint is real and reachable rather than merely written down.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures } from './fixtures';
import { TITLE_MAX_LENGTH } from '../../lib/text-limits';

let fixtures: Fixtures;
let guardian: { id: string; client: Awaited<ReturnType<Fixtures['createTeam']>>['guardian']['user']['client'] };

beforeAll(async () => {
    fixtures = new Fixtures();
    const team = await fixtures.createTeam('child-name-length');
    guardian = { id: team.guardian.user.id, client: team.guardian.user.client };
});

afterAll(async () => {
    await fixtures.cleanup();
});

describe('managed_profiles.full_name is capped at the same number as every other name column', () => {
    it('REFUSES a name one character over the limit', async () => {
        const { error } = await guardian.client.from('managed_profiles').insert({
            guardian_user_id: guardian.id,
            full_name: 'a'.repeat(TITLE_MAX_LENGTH + 1),
        } as never);

        expect(error).not.toBeNull();
        // 23514 = check_violation. Asserting the code, not just "something went wrong": a
        // refusal from RLS (42501) would be a different bug wearing the same shape, and this
        // test would otherwise pass on it.
        expect(error?.code).toBe('23514');
        expect(error?.message).toMatch(/managed_profiles_full_name_length/);
    });

    it('ACCEPTS a name exactly at the limit', async () => {
        /*
         * The other half, and the one that stops the cap being tightened by accident. A CHECK
         * written `< 120` instead of `<= 120` refuses a name the client's `maxLength={120}`
         * input happily produces — and the user meets that as a sync that failed, days later,
         * with no screen able to explain it. That asymmetry is the entire reason the client and
         * the column have to be the same number rather than merely both finite.
         */
        const { data, error } = await guardian.client
            .from('managed_profiles')
            .insert({
                guardian_user_id: guardian.id,
                full_name: 'b'.repeat(TITLE_MAX_LENGTH),
            } as never)
            .select('full_name')
            .single();

        expect(error).toBeNull();
        expect((data as { full_name: string } | null)?.full_name).toHaveLength(TITLE_MAX_LENGTH);
    });

    it('measures code points, so an emoji name is counted the way a person counts it', async () => {
        /*
         * `char_length`, not `octet_length`. The walkthrough's name was "Zoë 🚀 Very…" and a
         * rocket is four bytes; charging four characters for it would refuse names that are
         * plainly short, and it would do so only for the families whose names carry the
         * characters. 60 rockets is 60 code points and 240 bytes — accepted under
         * `char_length`, refused under `octet_length`.
         */
        const { error } = await guardian.client.from('managed_profiles').insert({
            guardian_user_id: guardian.id,
            full_name: '🚀'.repeat(60),
        } as never);

        expect(error).toBeNull();
    });
});
