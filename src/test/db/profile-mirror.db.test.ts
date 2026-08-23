/**
 * SEC-02 — what `handle_new_user` may and may not write back over a profile.
 *
 * The trigger is `AFTER INSERT OR UPDATE ON auth.users`, and GoTrue UPDATEs that table on every
 * password sign-in, every `updateUser`, every password change and every email change. So its
 * conflict branch runs constantly, on rows whose signup metadata is frozen at the moment the
 * account was created. Before `20260824000100`, `age_classification` took the metadata's value,
 * which meant a student who used the "I've turned 18" control lost it at their next login —
 * reproduced over the API, and recorded as RESOLVED in the plan because the CLIENT half of the
 * same defect (B27) had been fixed a sprint earlier.
 *
 * WHY THE TEST DRIVES `auth.users` DIRECTLY
 *
 * `UPDATE auth.users SET last_sign_in_at = now()` is what a sign-in does to this table, minus
 * the rate limits and the session. Asserting through a real password grant would be a slower
 * test of GoTrue; the thing under test is the trigger.
 *
 * The two "still propagates" cases are not padding. The shortest reading of the finding — let
 * the existing row win for every column — deletes the ONLY path by which renaming yourself
 * reaches `public.users` and then the roster, and jsdom, the unit suite and the RLS suite would
 * all have stayed green over it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { Fixtures } from './fixtures';
import { serviceClient, stackCredentials, assertLocalStack } from './stack';

let fixtures: Fixtures;
let pg: Client;
const svc = serviceClient();

beforeAll(async () => {
    const { dbUrl, apiUrl } = stackCredentials();
    assertLocalStack(apiUrl);
    fixtures = new Fixtures();
    pg = new Client({ connectionString: dbUrl });
    await pg.connect();
});

afterAll(async () => {
    await pg.end();
    await fixtures.cleanup();
});

/** What a password sign-in does to `auth.users`, and therefore to this trigger. */
async function simulateSignIn(userId: string) {
    await pg.query('UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1', [userId]);
}

async function profile(userId: string) {
    const { data } = await svc
        .from('users')
        .select('full_name, avatar_url, age_classification, email')
        .eq('id', userId)
        .single();
    return data as {
        full_name: string | null;
        avatar_url: string | null;
        age_classification: string | null;
        email: string;
    };
}

describe('handle_new_user on account creation', () => {
    it('still writes full_name and age_classification from the signup metadata', async () => {
        const user = await fixtures.createUser('sec02-fresh', '13_to_17');
        const row = await profile(user.id);

        expect(row.full_name).toBe('sec02-fresh');
        expect(row.age_classification).toBe('13_to_17');
    });
});

describe('SEC-02 — a corrected age classification survives', () => {
    it('is not reverted by a sign-in', async () => {
        const user = await fixtures.createUser('sec02-turned18', '13_to_17');

        // The profile control, exactly as the app calls it.
        await pg.query(
            "UPDATE users SET age_classification = '18_plus' WHERE id = $1",
            [user.id],
        );
        expect((await profile(user.id)).age_classification).toBe('18_plus');

        await simulateSignIn(user.id);

        expect(
            (await profile(user.id)).age_classification,
            'signing in put the signup metadata back over the column',
        ).toBe('18_plus');
    });

    it('is not reverted by a profile update, which UPDATEs auth.users too', async () => {
        const user = await fixtures.createUser('sec02-rename-age', '13_to_17');
        await pg.query("UPDATE users SET age_classification = '18_plus' WHERE id = $1", [user.id]);

        // `auth.updateUser({ data: { full_name } })`.
        await svc.auth.admin.updateUserById(user.id, {
            user_metadata: { full_name: 'Renamed Person', age_classification: '13_to_17' },
        });

        expect(
            (await profile(user.id)).age_classification,
            'a rename reverted the age classification',
        ).toBe('18_plus');
    });

    it('still fills a NULL classification from the metadata (the ensureUserProfile race)', async () => {
        const user = await fixtures.createUser('sec02-null-age', '13_to_17');
        await pg.query('UPDATE users SET age_classification = NULL WHERE id = $1', [user.id]);

        await simulateSignIn(user.id);

        expect(
            (await profile(user.id)).age_classification,
            'a row with no classification was left with none',
        ).toBe('13_to_17');
    });
});

describe('SEC-02 — renaming yourself still reaches the profile and the roster', () => {
    it('propagates a changed full_name from the auth metadata', async () => {
        const user = await fixtures.createUser('sec02-rename');

        await svc.auth.admin.updateUserById(user.id, {
            user_metadata: { full_name: 'Newly Named', age_classification: '18_plus' },
        });

        expect(
            (await profile(user.id)).full_name,
            'renaming yourself no longer reaches public.users — the roster and comments would keep the old name',
        ).toBe('Newly Named');
    });

    it('does not put a stale metadata name back over a corrected one on sign-in', async () => {
        const user = await fixtures.createUser('sec02-corrected');
        await pg.query("UPDATE users SET full_name = 'Corrected Name' WHERE id = $1", [user.id]);

        await simulateSignIn(user.id);

        expect(
            (await profile(user.id)).full_name,
            'signing in put the signup metadata name back',
        ).toBe('Corrected Name');
    });

    it('still tracks the email, which only GoTrue writes', async () => {
        const user = await fixtures.createUser('sec02-email');
        const next = `sec02-moved-${crypto.randomUUID()}@falconforge.test`;

        await svc.auth.admin.updateUserById(user.id, { email: next, email_confirm: true });

        expect((await profile(user.id)).email).toBe(next);
    });
});
