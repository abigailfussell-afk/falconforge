/**
 * support@falcon-forge.com -> a real inbox.
 *
 * WHY THIS EXISTS AT ALL
 *
 * `src/lib/feedback.ts` puts `support@falcon-forge.com` into the bundle every beta coach
 * installs, and it is the only inbound channel a user can see. Resend receives mail for the
 * domain (root MX -> `inbound-smtp.us-east-1.amazonaws.com`) but does not deliver it to a
 * mailbox: inbound is webhook-driven, so without this endpoint the address ACCEPTS mail and
 * drops it. That is worse than bouncing, because a bounce at least tells the sender.
 *
 * THE ONLY AUTHENTICATION IS THE SIGNATURE.
 *
 * Supabase Edge Functions verify a Supabase JWT by default and a webhook from Resend carries
 * none, so `verify_jwt` is false for this function (see `supabase/config.toml`). The endpoint
 * is therefore public, and the Svix signature is the whole of its access control. Everything
 * below is ordered so that nothing is parsed, trusted or acted on before that check passes,
 * and a missing secret is a 500 rather than a skipped check.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not log message content. A support email is somebody's words, frequently a parent's,
 * and an Edge Function log is not the place for them. Only ids and event types are logged.
 *
 * DEPLOY
 *   supabase functions deploy forward-support-email --no-verify-jwt
 * See `docs/beta-ops.md` for the secrets and the Resend webhook wiring.
 */
import { Resend } from 'npm:resend@6.22.0';
import { decideAction, readConfig, readSvixHeaders } from './decision.ts';

Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    const cfg = readConfig((name) => Deno.env.get(name));
    if (!cfg.ok) {
        // 500, not 200: an unconfigured forwarder must look broken to Resend so the event is
        // retried once it is configured, rather than being acknowledged and lost.
        console.error(`forward-support-email is not configured: missing ${cfg.missing.join(', ')}`);
        return new Response('Not configured', { status: 500 });
    }

    const headers = readSvixHeaders((name) => req.headers.get(name));
    if (!headers) {
        return new Response('Missing signature headers', { status: 401 });
    }

    /*
     * THE RAW BODY, and it must stay raw. The signature covers the exact bytes sent, so
     * parsing to JSON and re-serialising before verifying — which reads as harmless — changes
     * key order and whitespace and fails every signature. Read as text, verify, parse after.
     */
    const rawBody = await req.text();
    const resend = new Resend(cfg.config.apiKey);

    let payload: unknown;
    try {
        payload = resend.webhooks.verify({
            payload: rawBody,
            headers,
            webhookSecret: cfg.config.webhookSecret,
        });
    } catch (err) {
        console.warn('rejected an unverified webhook:', err instanceof Error ? err.message : err);
        return new Response('Invalid signature', { status: 401 });
    }

    const decision = decideAction(payload);

    if (decision.action === 'reject') {
        console.warn(`rejecting a verified webhook: ${decision.reason}`);
        return new Response(decision.reason, { status: 400 });
    }

    if (decision.action === 'ignore') {
        // 200 on purpose. Resend retries non-2xx, so refusing an event type we simply do not
        // handle would turn every notification into an indefinite retry loop.
        return new Response('ignored', { status: 200 });
    }

    const { data, error } = await resend.emails.receiving.forward({
        emailId: decision.emailId,
        to: cfg.config.forwardTo,
        from: cfg.config.forwardFrom,
    });

    if (error) {
        /*
         * 500 so Resend retries. A forward that failed once — a transient API error, a rate
         * limit — is exactly the case its retry schedule exists for, and answering 200 here
         * would silently discard the message. Silent discard is the failure this whole
         * endpoint was written to remove.
         */
        console.error(`forward failed for ${decision.emailId}:`, error.message);
        return new Response('Forward failed', { status: 500 });
    }

    console.log(`forwarded ${decision.emailId} -> ${data?.id ?? 'unknown'}`);
    return new Response('ok', { status: 200 });
});
