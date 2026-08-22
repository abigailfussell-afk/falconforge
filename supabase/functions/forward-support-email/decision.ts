/**
 * What to do with an inbound Resend webhook, decided without touching the network.
 *
 * WHY THIS IS A SEPARATE FILE FROM `index.ts`.
 *
 * The entry point runs on Deno and imports the Resend SDK through an `npm:` specifier, neither
 * of which the repo's vitest suite can load — so anything living there is untestable by the
 * Gate. Everything here is plain TypeScript with no imports at all, which means
 * `support-forwarding.test.ts` under `src/` can import it directly and `tsc` typechecks it as
 * part of the ordinary build.
 *
 * That split is the whole point: the parts of this endpoint that decide whether to ACT on a
 * request are the parts worth testing, and they are exactly the parts that do not need Deno.
 */

/** The three headers Svix signs a Resend webhook with. */
export interface SvixHeaders {
    id: string;
    timestamp: string;
    signature: string;
}

export type WebhookAction =
    /** Verified and actionable: forward this received email. */
    | { action: 'forward'; emailId: string }
    /** Understood, and nothing to do. MUST be answered 200 or Resend retries it forever. */
    | { action: 'ignore'; reason: string }
    /** Malformed. Answered 400; a retry would produce the same result. */
    | { action: 'reject'; reason: string };

/**
 * Pull the Svix headers out of a request, or refuse.
 *
 * All three or none: a partial set cannot be verified, and treating a missing signature as
 * "unsigned, therefore fine" is how a public endpoint becomes an open one. This endpoint has
 * no other authentication — Supabase JWT verification is deliberately off, because a webhook
 * from Resend carries no Supabase token — so the signature IS the authentication.
 */
export function readSvixHeaders(get: (name: string) => string | null): SvixHeaders | null {
    const id = get('svix-id');
    const timestamp = get('svix-timestamp');
    const signature = get('svix-signature');

    if (!id || !timestamp || !signature) return null;
    return { id, timestamp, signature };
}

/**
 * Decide what a verified webhook payload asks for.
 *
 * Runs AFTER signature verification, never before: this function trusts the shape of what it
 * is given and says nothing about whether the sender was genuine.
 *
 * Unknown event types are IGNORED rather than rejected, and the distinction matters
 * operationally. Resend retries non-2xx responses, so answering 400 to an event type we simply
 * do not handle would turn every `email.sent` notification into an indefinite retry loop
 * against this endpoint. "I understood you and there is nothing to do" is a 200.
 */
export function decideAction(payload: unknown): WebhookAction {
    if (typeof payload !== 'object' || payload === null) {
        return { action: 'reject', reason: 'payload is not an object' };
    }

    const event = payload as { type?: unknown; data?: unknown };

    if (typeof event.type !== 'string') {
        return { action: 'reject', reason: 'payload has no event type' };
    }

    if (event.type !== 'email.received') {
        return { action: 'ignore', reason: `unhandled event type: ${event.type}` };
    }

    const data = event.data as { email_id?: unknown } | undefined;
    const emailId = data?.email_id;

    // An `email.received` with no id is the one malformed case worth refusing loudly: it is
    // the event we DO handle, arriving in a shape we cannot act on, which means either the
    // payload contract changed or something is impersonating it past a valid signature.
    if (typeof emailId !== 'string' || emailId.length === 0) {
        return { action: 'reject', reason: 'email.received carried no email_id' };
    }

    return { action: 'forward', emailId };
}

/**
 * The addresses this endpoint is configured with, or an explanation of what is missing.
 *
 * FAILS CLOSED, and both halves of that are deliberate:
 *
 *   - The forwarding destination is NOT in this repository. The repo is public, and a personal
 *     inbox address committed to it is an address handed to every scraper that walks GitHub.
 *     It comes from `SUPPORT_FORWARD_TO` and there is no default.
 *   - A missing signing secret is an ERROR, never a reason to skip verification. The tempting
 *     shape — "if we have a secret, check it" — silently converts this into an unauthenticated
 *     endpoint the moment the secret is unset, which is precisely when nobody is looking.
 */
export interface ForwarderConfig {
    apiKey: string;
    webhookSecret: string;
    forwardTo: string;
    forwardFrom: string;
}

export function readConfig(env: (name: string) => string | undefined):
    | { ok: true; config: ForwarderConfig }
    | { ok: false; missing: string[] } {
    const apiKey = env('RESEND_API_KEY');
    const webhookSecret = env('RESEND_WEBHOOK_SECRET');
    const forwardTo = env('SUPPORT_FORWARD_TO');
    // The only one with a default: it is not a secret, it is on the verified sending domain,
    // and it is the address the forwarded copy appears to come from.
    const forwardFrom = env('SUPPORT_FORWARD_FROM') || 'support@falcon-forge.com';

    const missing: string[] = [];
    if (!apiKey) missing.push('RESEND_API_KEY');
    if (!webhookSecret) missing.push('RESEND_WEBHOOK_SECRET');
    if (!forwardTo) missing.push('SUPPORT_FORWARD_TO');

    if (missing.length > 0) return { ok: false, missing };

    return {
        ok: true,
        config: {
            apiKey: apiKey as string,
            webhookSecret: webhookSecret as string,
            forwardTo: forwardTo as string,
            forwardFrom,
        },
    };
}
