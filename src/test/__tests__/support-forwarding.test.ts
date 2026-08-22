import { describe, it, expect } from 'vitest';
import {
    decideAction,
    readConfig,
    readSvixHeaders,
} from '../../../supabase/functions/forward-support-email/decision.ts';

/**
 * The support-forwarding endpoint's decisions, which are the parts of it worth testing.
 *
 * WHY THIS FILE CAN EXIST AT ALL. `index.ts` runs on Deno and imports the Resend SDK through
 * an `npm:` specifier, so vitest cannot load it. Every decision that endpoint makes about
 * whether to ACT on a request lives in `decision.ts` instead, which has no imports — so it
 * loads here, and `tsc` typechecks it as an ordinary dependency of this test.
 *
 * WHAT IS AT STAKE. Supabase JWT verification is off for this function, because a webhook from
 * Resend carries no Supabase token. The endpoint is public and the Svix signature is the
 * entirety of its access control. Two of the assertions below are about that and nothing else:
 * that absent headers are refused rather than waved through, and that a missing signing secret
 * is an error rather than a reason to skip the check.
 */

describe('the signature headers are the only thing standing in front of this endpoint', () => {
    const complete: Record<string, string> = {
        'svix-id': 'msg_123',
        'svix-timestamp': '1700000000',
        'svix-signature': 'v1,abcdef',
    };

    it('reads all three Svix headers', () => {
        expect(readSvixHeaders((n) => complete[n] ?? null)).toEqual({
            id: 'msg_123',
            timestamp: '1700000000',
            signature: 'v1,abcdef',
        });
    });

    /*
     * ALL THREE OR NONE. A partial set cannot be verified, and the tempting shape -- treat a
     * missing signature as "unsigned, therefore nothing to check" -- turns a public endpoint
     * into an open one. Asserted per-header so that dropping any single one from the guard
     * fails here rather than being covered by the other two.
     */
    it.each(['svix-id', 'svix-timestamp', 'svix-signature'])(
        'refuses a request with no %s',
        (missing) => {
            const partial = { ...complete };
            delete partial[missing];

            expect(readSvixHeaders((n) => partial[n] ?? null)).toBeNull();
        },
    );

    it('refuses a request with no headers at all', () => {
        expect(readSvixHeaders(() => null)).toBeNull();
    });
});

describe('deciding what a verified payload asks for', () => {
    it('forwards an email.received, carrying its id', () => {
        expect(decideAction({ type: 'email.received', data: { email_id: 'inb_42' } })).toEqual({
            action: 'forward',
            emailId: 'inb_42',
        });
    });

    /*
     * IGNORED, NOT REJECTED, and the difference is operational rather than cosmetic. Resend
     * retries any non-2xx, so answering 400 to an event type this endpoint does not handle
     * would turn every `email.sent` notification into an indefinite retry loop against it.
     */
    it.each(['email.sent', 'email.delivered', 'email.bounced', 'contact.created'])(
        'ignores %s rather than refusing it',
        (type) => {
            const decision = decideAction({ type, data: {} });

            expect(decision.action).toBe('ignore');
        },
    );

    it('rejects an email.received with no email_id', () => {
        // The one malformed case worth refusing loudly: the event we DO handle, arriving in a
        // shape we cannot act on.
        expect(decideAction({ type: 'email.received', data: {} }).action).toBe('reject');
        expect(decideAction({ type: 'email.received' }).action).toBe('reject');
        expect(decideAction({ type: 'email.received', data: { email_id: '' } }).action).toBe('reject');
    });

    it.each([null, undefined, 'a string', 42, [], {}])('rejects the malformed payload %s', (bad) => {
        expect(decideAction(bad).action).toBe('reject');
    });
});

describe('configuration fails closed', () => {
    const full: Record<string, string> = {
        RESEND_API_KEY: 're_test',
        RESEND_WEBHOOK_SECRET: 'whsec_test',
        SUPPORT_FORWARD_TO: 'someone@example.com',
    };

    it('reads a complete configuration', () => {
        const result = readConfig((n) => full[n]);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.config.forwardTo).toBe('someone@example.com');
        // Not a secret, and on the verified sending domain, so it has a default.
        expect(result.config.forwardFrom).toBe('support@falcon-forge.com');
    });

    /*
     * A MISSING SIGNING SECRET IS AN ERROR, NEVER A SKIPPED CHECK.
     *
     * The shape this exists to forbid is `if (secret) verify()`, which reads as defensive and
     * silently converts the endpoint into an unauthenticated one the moment the secret is
     * unset -- which is exactly the moment nobody is watching.
     */
    it.each(['RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'SUPPORT_FORWARD_TO'])(
        'refuses to run with %s missing',
        (missing) => {
            const partial = { ...full };
            delete partial[missing];

            const result = readConfig((n) => partial[n]);

            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.missing).toContain(missing);
        },
    );

    /*
     * THE DESTINATION IS NOT IN THIS REPOSITORY. It is public, and a personal inbox committed
     * to it is an address handed to every scraper that walks GitHub. There is no default, and
     * this asserts there is no default -- which is the thing a later "helpful" edit would undo.
     */
    it('has no built-in forwarding destination', () => {
        const result = readConfig((n) => (n === 'SUPPORT_FORWARD_TO' ? undefined : full[n]));

        expect(result.ok).toBe(false);
    });
});
