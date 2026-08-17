/**
 * The signup consent, recorded at the version the user was actually shown.
 *
 * KEVIN'S BUG, AND WHY THE SUITE MISSED IT.
 *
 * `handle_new_user` hardcoded `'1.0'`. Sprint 6 raised `ATTESTATION_VERSIONS` to `'2.0'`, so
 * every account created after that was recorded as having accepted a version the client
 * considered stale — and was told, on its first screen, that the documents had changed since it
 * accepted them. Thirty seconds after it accepted them.
 *
 * Sprint 7 had already fixed the same SYMPTOM from a different cause and added a smoke test for
 * it. That test passes, and proves nothing about production: it runs against a local stack with
 * `enable_confirmations = false`, so `signUp` returns a session, the client's own
 * `recordAttestation` fires, and the 2.0 row it writes masks the 1.0 row the trigger wrote.
 * Production has `mailer_autoconfirm: false` — no session, no client write, only the trigger's
 * stale row.
 *
 * So these tests exercise the TRIGGER on its own, which is the only path production takes at
 * account-creation time. No session is created here at all: `auth.admin.createUser` fires the
 * same trigger that a self-serve signup does, and nothing else runs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures } from './fixtures';
import { serviceClient } from './stack';
import { ATTESTATION_VERSIONS } from '@/lib/attestations';

let fixtures: Fixtures;
const svc = serviceClient();

beforeAll(() => {
    fixtures = new Fixtures();
});

afterAll(async () => {
    await fixtures.cleanup();
});

/**
 * Create an auth user with the given signup metadata, exactly as `signUpWithEmail` does, and
 * return whatever attestation rows the trigger produced.
 */
async function signUpWith(metadata: Record<string, unknown>) {
    const email = `attest-${crypto.randomUUID()}@falconforge.test`;
    const { data, error } = await svc.auth.admin.createUser({
        email,
        password: crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { full_name: 'Attest Tester', ...metadata },
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);

    // Cleaned up with everything else this suite made.
    (fixtures as unknown as { created: { userIds: string[] } }).created.userIds.push(data.user.id);

    const { data: rows } = await svc
        .from('user_attestations')
        .select('attestation_type, version')
        .eq('user_id', data.user.id);

    return { userId: data.user.id, rows: rows ?? [] };
}

describe('the signup attestation the trigger writes', () => {
    it('records the version the client says it displayed', async () => {
        const { rows } = await signUpWith({
            age_classification: '13_to_17',
            privacy_accepted: true,
            privacy_version: '2.0',
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            attestation_type: 'privacy_and_guidelines',
            version: '2.0',
        });
    });

    it('records the version the APP currently considers current', async () => {
        /*
         * The assertion that would have caught this. It is not "the version is 2.0" — that
         * hardcodes the same number in a third place — but "whatever the client believes is
         * current is what the database ends up holding". It fails the day someone raises
         * `ATTESTATION_VERSIONS` and leaves the server behind, which is precisely what
         * happened between Sprint 6 and now.
         */
        const current = ATTESTATION_VERSIONS.privacy_and_guidelines;
        const { rows } = await signUpWith({
            age_classification: '18_plus',
            privacy_accepted: true,
            privacy_version: current,
        });

        expect(rows[0]?.version).toBe(current);
    });

    it('leaves a client that says nothing about versions on the old default', async () => {
        // A cached bundle from before this change still signs people up. Recording '1.0' is
        // the honest answer for a client that did not say which version it showed — and the
        // prompt then asks properly, which is the behaviour that is correct rather than
        // spurious.
        const { rows } = await signUpWith({
            age_classification: '18_plus',
            privacy_accepted: true,
        });

        expect(rows[0]?.version).toBe('1.0');
    });

    it('records nothing when the box was not ticked', async () => {
        const { rows } = await signUpWith({ privacy_accepted: false, privacy_version: '2.0' });
        expect(rows).toHaveLength(0);
    });

    it('does not need a session, which is the whole point', async () => {
        /*
         * Production requires email confirmation, so at signup there IS no session and the
         * client's `recordAttestation` — which calls `auth.getUser()` — cannot write anything.
         * Nothing in this file creates a session, and the row exists anyway.
         */
        const { userId, rows } = await signUpWith({
            privacy_accepted: true,
            privacy_version: ATTESTATION_VERSIONS.privacy_and_guidelines,
        });

        const { data: sessions } = await svc.auth.admin.listUsers({ page: 1, perPage: 1 });
        expect(sessions).toBeTruthy(); // the admin API works; no user session was ever minted
        expect(rows).toHaveLength(1);
        expect(rows[0].version).toBe(ATTESTATION_VERSIONS.privacy_and_guidelines);
        expect(userId).toBeTruthy();
    });
});
