/**
 * The two fields Sprint 9 removed from the guardian schema before anything wrote them.
 *
 * Both assertions are BEHAVIOURAL — they attempt the write through PostgREST, the way the app
 * does, and require the database to refuse it. Neither reads the catalogue. That distinction is
 * `docs/environment-divergences.md` section 5: `schema_assertions.sql` connects as `postgres`
 * and would happily approve a column nobody can actually use, and a `pg_proc` assertion once
 * approved a `REVOKE` that was a no-op.
 *
 * WHAT WOULD MAKE THESE FAIL: reinstating either field. `ALTER TABLE guardian_consents ALTER
 * COLUMN version SET DEFAULT '1.0'` turns the first test green-to-red immediately, because the
 * insert stops being refused. Re-adding `birth_year` does the same to the second. That question
 * is the one `docs/failure-modes.md` asks of every verification step, and both have an answer.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures } from './fixtures';
import { serviceClient } from './stack';

let fixtures: Fixtures;
let guardianUserId: string;
let profileId: string;
const svc = serviceClient();

beforeAll(async () => {
    fixtures = new Fixtures();
    const team = await fixtures.createTeam('guardian-schema');
    guardianUserId = team.guardian.user.id;
    profileId = team.guardian.profileId;
});

afterAll(async () => {
    await fixtures.cleanup();
});

describe('guardian_consents.version — the client owns the number', () => {
    it('REFUSES a consent that does not say which version was displayed', async () => {
        /*
         * The defect this prevents, stated as a test: with the DEFAULT in place this insert
         * SUCCEEDS and silently records '1.0'. The moment the documents go to 2.0 — which is
         * exactly what Sprint 6 did to the attestation documents — every consent recorded
         * through a caller that forgot to say would claim the guardian agreed to text they
         * were never shown.
         *
         * `attestations.ts:81-84` wrote the rule down before this table existed. A column
         * DEFAULT breaks it the same way the trigger's hardcoded '1.0' did.
         */
        const { error } = await svc.from('guardian_consents').insert({
            managed_profile_id: profileId,
            guardian_user_id: guardianUserId,
            consent_type: 'terms',
        } as never);

        expect(error).not.toBeNull();
        // 23502 = not_null_violation. The column stayed NOT NULL on purpose: dropping the
        // default without that would have turned a wrong answer into no answer.
        expect(error?.code).toBe('23502');
        expect(error?.message).toMatch(/version/);
    });

    it('stores exactly the version it was given, without substituting one', async () => {
        const { data, error } = await svc
            .from('guardian_consents')
            .insert({
                managed_profile_id: profileId,
                guardian_user_id: guardianUserId,
                consent_type: 'privacy',
                version: '7.3-test',
            } as never)
            .select('version')
            .single();

        expect(error).toBeNull();
        // Not '1.0', and not silently normalised. Whatever the client displayed is what the
        // record says the guardian agreed to.
        expect((data as { version: string } | null)?.version).toBe('7.3-test');
    });
});

describe("managed_profiles.birth_year — the app never knows a child's age", () => {
    it('REFUSES a profile that tries to record a birth year', async () => {
        /*
         * Locked 2026-08-17: not collected. The column is gone rather than merely unused,
         * so this is not a convention a later sprint can drift off — it is a write that
         * fails. `docs/failure-modes.md` section 7 is the class where a field exists with no
         * writer and somebody eventually supplies one.
         */
        const { error } = await svc.from('managed_profiles').insert({
            guardian_user_id: guardianUserId,
            full_name: 'A child whose age is nobody the app knows',
            birth_year: 2016,
        } as never);

        expect(error).not.toBeNull();
        // PGRST204: PostgREST cannot find the column in its schema cache.
        expect(error?.message).toMatch(/birth_year/);
    });

    it('accepts the profile without it', async () => {
        const { data, error } = await svc
            .from('managed_profiles')
            .insert({
                guardian_user_id: guardianUserId,
                full_name: 'A child whose age is nobody the app knows',
            } as never)
            .select('id, full_name')
            .single();

        expect(error).toBeNull();
        expect(data).toBeTruthy();
    });
});
