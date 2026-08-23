/**
 * SEC-10 — an under-13 cannot end up holding an account.
 *
 * The block was `CompleteProfileForm.tsx` disabling a button. `signUpWithEmail` forwards
 * whatever it is given, `handle_new_user` writes it, the column CHECK accepts it, and GoTrue has
 * no hook that refuses it — so a modified client, an old cached bundle, or plain curl produced
 * a real account with a child's name and email on file. `PrivacyPolicy.tsx` says that never
 * happens.
 *
 * THREE DOORS, ONE RULE, THREE TESTS
 *
 * The finding names signup and `update_user_age_classification`. The third is a direct
 * `PATCH /rest/v1/users`, which `users_update_own` permits and which the assessment's own
 * capability matrix lists. All three are asserted here because the rule is a trigger they all
 * pass through — and because if a later change moves the rule into `handle_new_user` instead,
 * the PATCH test is the one that notices.
 *
 * The positive controls matter: a trigger that refused every write to `age_classification`
 * would satisfy all three refusals while making "I've turned 18" impossible and blocking every
 * ordinary signup.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures } from './fixtures';
import { serviceClient, userClient, anonClient } from './stack';

let fixtures: Fixtures;
const svc = serviceClient();

beforeAll(() => {
    fixtures = new Fixtures();
});

afterAll(async () => {
    await fixtures.cleanup();
});

describe('SEC-10 — signup', () => {
    it('refuses an account whose signup metadata says under_13, and creates no auth user', async () => {
        const email = `sec10-${crypto.randomUUID()}@falconforge.test`;

        /*
         * `auth.signUp` on an anonymous client — the endpoint `signUpWithEmail` calls and the
         * one a modified or stale client would reach. Not `auth.admin.createUser`, which is a
         * path no user takes.
         *
         * WHAT IS NOT ASSERTED, AND WHY. The trigger's sentence is not. `/auth/v1/signup`
         * answers plain curl with `{"code":"23514","message":"Members under 13 use a
         * guardian-managed profile…"}`, but supabase-js sends
         * `X-Supabase-Api-Version: 2024-01-01`, and under that version GoTrue replaces every
         * database error with `{"code":"unexpected_failure","message":"Database error saving
         * new user"}` — confirmed by replaying the captured request with and without the
         * header. So the sentence exists and the app can never see it; asserting it here would
         * be a green result about a response no client receives
         * (`docs/environment-divergences.md`). What the app shows a child is
         * `CompleteProfileForm`'s disabled button, which is unchanged; this is the boundary
         * behind it. Mapping the generic message is logged in the plan's parking lot with
         * OPS-06, which owns the auth-error copy.
         */
        const { data, error } = await anonClient().auth.signUp({
            email,
            password: 'ForgeReview!2026-local',
            options: {
                data: {
                    full_name: 'Tiny Person',
                    age_classification: 'under_13',
                    privacy_accepted: true,
                    privacy_version: '2.0',
                },
            },
        });

        expect(error, 'an under-13 signup succeeded').not.toBeNull();
        expect(error?.status, 'the signup was refused for some other reason').toBe(500);
        expect(data?.user ?? null).toBeNull();

        /*
         * The account must not exist at all, not merely lack a profile. `handle_new_user` is
         * AFTER INSERT on `auth.users`, so the refusal has to roll the whole transaction back —
         * a signup that leaves a child's email in `auth.users` and nothing in `public.users` is
         * still the collection the privacy policy denies.
         */
        const { data: rows } = await svc.from('users').select('id').eq('email', email);
        expect(rows ?? []).toEqual([]);

        const { data: list } = await svc.auth.admin.listUsers();
        expect(
            list?.users?.some((u) => u.email === email) ?? false,
            'the auth user survived a refused signup',
        ).toBe(false);
    });

    it('still accepts an ordinary 13_to_17 signup — the control', async () => {
        const user = await fixtures.createUser('sec10-teenager', '13_to_17');
        const { data } = await svc
            .from('users')
            .select('age_classification')
            .eq('id', user.id)
            .single();
        expect((data as { age_classification: string }).age_classification).toBe('13_to_17');
    });
});

describe('SEC-10 — an existing account cannot become under_13', () => {
    it('the RPC refuses, in its own {success:false} shape', async () => {
        const user = await fixtures.createUser('sec10-rpc', '13_to_17');

        const { data } = await userClient(user.token).rpc('update_user_age_classification', {
            classification: 'under_13',
        });

        // The RPC's contract, not an exception: `auth.tsx` renders `error` on the profile
        // screen, and a 500 would surface as "An unexpected error occurred".
        expect(data).toMatchObject({ success: false });
        expect((data as { error: string }).error).toMatch(/under 13/i);
    });

    it('a direct PATCH of users is refused too — the door the finding did not name', async () => {
        const user = await fixtures.createUser('sec10-patch', '13_to_17');

        const { error } = await userClient(user.token)
            .from('users')
            .update({ age_classification: 'under_13' } as never)
            .eq('id', user.id)
            .select();

        expect(error, 'a user PATCHed themselves to under_13').not.toBeNull();
        expect(error?.code).toBe('23514');

        const { data } = await svc
            .from('users')
            .select('age_classification')
            .eq('id', user.id)
            .single();
        expect((data as { age_classification: string }).age_classification).toBe('13_to_17');
    });

    it('"I\'ve turned 18" still works — the control', async () => {
        const user = await fixtures.createUser('sec10-turned18', '13_to_17');

        const { data } = await userClient(user.token).rpc('update_user_age_classification', {
            classification: '18_plus',
        });
        expect(data).toMatchObject({ success: true });

        const { data: row } = await svc
            .from('users')
            .select('age_classification')
            .eq('id', user.id)
            .single();
        expect((row as { age_classification: string }).age_classification).toBe('18_plus');
    });
});
