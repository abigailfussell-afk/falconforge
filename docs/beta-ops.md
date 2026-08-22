# Beta operations

What to do, and how often, once real teams are using falcon-forge.com. Written in Sprint 7,
before beta onboarding, so that none of it has to be invented during an incident.

---

## Backups

**The free tier does not back you up in a way you should rely on.** Supabase's free plan has no
point-in-time recovery. There is one database, it holds every team's season, and the only thing
standing between a bad migration and a lost season is a dump somebody took on purpose.

### The one-liner

```bash
supabase db dump --linked -f "backups/falconforge-$(date +%Y-%m-%d).sql"
```

`backups/` is gitignored — a dump contains every team's data and every user's email address, and
it must never reach a public repository.

### When to take one

| When | Why |
|---|---|
| **Before applying any migration to the hosted project** | Non-negotiable. Sprint 3's `db reset --linked` and Sprint 4's incident are both in the plan's log; a dump is the difference between a bad afternoon and a lost season. |
| Weekly during the season | Cheap. A week is the most work anyone should be able to lose. |
| Before and after beta onboarding | The onboarding itself is the risky change. |

### Restoring

Restoring is not a command you want to be reading for the first time under pressure:

```bash
psql "$DATABASE_URL" -f backups/falconforge-2026-09-01.sql
```

Two things that have bitten this project before, both recorded in the plan's log:

- `supabase db push` **cannot apply a squashed migration history** — the first `CREATE TABLE`
  collides with what is already there. That is why Sprint 3 used `db reset --linked` instead.
- `platform_operators` **ships empty and no API path can write it.** After any restore that
  rebuilds the schema, re-insert Kevin's operator row with the service key or the operator
  console silently does nothing. The SQL is in `docs/v2-schema.md`.

---

## Transactional email

**This is the one piece of beta infrastructure that fails silently, and it is not code.**

Supabase's built-in email service is rate-limited to a couple of messages an hour on the free
plan and is documented as being for testing rather than production — no deliverability
guarantee, no custom domain, and Supabase's own sending reputation rather than ours. The hosted
project has confirmations **on** (`mailer_autoconfirm: false`), so that service currently
carries both halves of a beta user's first hour: the signup confirmation and the password reset.

A coach onboarding fifteen students in one evening will exhaust the hourly allowance and the
rest of the team simply never receives anything. Nothing errors, nothing appears in a log the
app can reach, and the coach reports "it didn't work".

### Sending: point Supabase at Resend

The deferred "Auth email branding & the confirmation round trip" item in the plan bundles this
with templates and link rewriting. **The SMTP half is separable and should be done alone** —
templates can stay on Supabase's defaults and nothing below touches them.

**SENDING AND RECEIVING ARE INDEPENDENT.** This section makes FalconForge able to SEND. It does
nothing for `support@falcon-forge.com`, which is about RECEIVING and is the next section. You
need both, and doing one does not partially do the other.

**1 — Resend account and domain.** Sign up at [resend.com](https://resend.com); the free tier
is 3,000/month and 100/day, far beyond a beta of a few teams. **Not Brevo** — its free tier
stamps its own branding on the message, which is the problem being solved wearing a different
hat. Then **Domains → Add Domain → `falcon-forge.com`**.

**2 — Publish the DNS records at GoDaddy.** Resend generates the exact values per account, so
copy them from its screen rather than from here; the shape is three records, and by default
Resend scopes the sending ones to a `send.` subdomain:

| Type | Host (typical) | Purpose |
|---|---|---|
| MX | `send` | return path for bounces |
| TXT | `send` | SPF (`v=spf1 include:amazonses.com ~all`) |
| TXT | `resend._domainkey` | DKIM |

GoDaddy hosts this zone (nameservers are `*.domaincontrol.com`), so: **godaddy.com → My
Products → Domains → falcon-forge.com → DNS → Add New Record.** Enter the host exactly as
Resend shows it — GoDaddy appends the domain itself, so the host is `send`, **not**
`send.falcon-forge.com`.

Two things worth knowing before you type:

- **These do not touch the site.** The A/AAAA records pointing at GitHub Pages and the `www`
  CNAME are separate rows. Do not edit them.
- **The `send.` scoping is why this does not collide** with the root MX record the next section
  adds for receiving. Different hostnames, no conflict, and they can be done in either order.

**3 — Wait for Resend to verify.** Click Verify in Resend until every record reads verified.
GoDaddy's TTL here is 600s, so this is usually minutes. **Do not skip ahead** — mail sent from
an unverified domain is accepted and then filed as spam, which looks exactly like mail that was
never sent, and is much harder to diagnose after the fact than before.

**4 — API key.** Resend → **API Keys → Create API Key**, permission **Sending access**. It is
shown once. It is a credential: it goes in the Supabase dashboard field below and nowhere in
this repository, no `.env` file, and no commit.

**5 — Supabase SMTP.** Dashboard → your project → **Project Settings → Authentication → SMTP
Settings** → enable Custom SMTP:

```
Host:            smtp.resend.com
Port:            465
Username:        resend
Password:        <the re_... API key>
Sender email:    noreply@falcon-forge.com
Sender name:     FalconForge
```

`noreply@` rather than `support@` on purpose: this is the **From:** address, and the From:
address of an automated confirmation is not where you want a human's reply to land. It does not
need to be a real mailbox — a From: address on a verified domain sends fine whether or not
anything can receive there.

**6 — Raise the rate limit.** **Authentication → Rate Limits → emails sent per hour.** It is
pinned low (a couple per hour) while the built-in service is in use and **does not lift itself
when SMTP changes** — this is the step that is easy to miss, because everything appears to work
until the fourth student of the evening signs up. 100/hour is ample.

**7 — Check the redirect configuration while you are in there.** **Authentication → URL
Configuration.** Site URL must be `https://falcon-forge.com`. This is what recovery and
confirmation links are built from, and Sprint 9's fix depends on the link landing on `/` with
the token in the fragment rather than on a path GitHub Pages answers with its own 404.

**8 — Verify, and verify the two failures separately.** Sign up a genuinely new address, then
run a password reset on it:

- Did it **arrive**? (sending works)
- Did it arrive **in the inbox rather than spam**? (reputation and DNS work)
- Open the raw message and check the headers say `dkim=pass` and `spf=pass`.

The first is visible from the Resend dashboard. The second and third are not, and a message
that silently lands in a coach's spam folder is indistinguishable from one that was never sent.

### Receiving: support@falcon-forge.com

`src/lib/feedback.ts` puts `support@falcon-forge.com` into the bundle, and it is the only
inbound channel a beta user can see.

Resend receives mail for the domain (root MX -> `inbound-smtp.us-east-1.amazonaws.com`) but
**does not deliver it to a mailbox** -- its inbound is webhook-driven. So the address accepts
mail and drops it unless something is listening, which is worse than bouncing: a bounce tells
the sender, silent acceptance tells nobody.

`supabase/functions/forward-support-email` is that listener. It verifies the Svix signature,
then calls `resend.emails.receiving.forward()` to relay the message to a real inbox.

**This is the project's only Edge Function.** Nothing else deploys one, so the step below is
not part of any existing workflow and has to be run by hand.

#### Deploy

```bash
supabase functions deploy forward-support-email --no-verify-jwt
```

`--no-verify-jwt` is **required**, and `supabase/config.toml` sets `verify_jwt = false` to
match. Supabase checks a Supabase JWT by default; a webhook from Resend carries none, so with
the default the endpoint answers 401 and no mail is ever forwarded. The consequence is that
this function is **public**, and its signature check is the entirety of its access control.

#### Secrets

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set RESEND_WEBHOOK_SECRET=whsec_xxxxxxxx
supabase secrets set SUPPORT_FORWARD_TO=your-real-inbox@example.com
```

| Secret | Where it comes from |
|---|---|
| `RESEND_API_KEY` | Resend -> API Keys. The same key the SMTP settings use is fine. |
| `RESEND_WEBHOOK_SECRET` | Resend -> Webhooks -> the endpoint's page, after creating it below. |
| `SUPPORT_FORWARD_TO` | The inbox mail should land in. |
| `SUPPORT_FORWARD_FROM` | Optional; defaults to `support@falcon-forge.com`. Must be on the verified sending domain. |

**`SUPPORT_FORWARD_TO` has no default and the function refuses to run without it.** This
repository is public, and a personal inbox committed to it is an address handed to every
scraper that walks GitHub. A missing `RESEND_WEBHOOK_SECRET` is likewise a hard failure rather
than a skipped signature check -- both asserted in
`src/test/__tests__/support-forwarding.test.ts`.

#### Wire up the webhook

1. **Resend -> Webhooks -> Add Webhook.**
2. Endpoint URL: `https://<project-ref>.supabase.co/functions/v1/forward-support-email`
3. Subscribe to **`email.received`**. Other events are harmless -- the function answers them
   200 and does nothing -- but there is no reason to send them.
4. Copy the signing secret into `RESEND_WEBHOOK_SECRET`, and redeploy if you set it after
   deploying.

#### Verify

Send a real message to `support@falcon-forge.com` from an outside address, then:

```bash
supabase functions logs forward-support-email
```

Expect one `forwarded inb_... -> ...` line, **and** the message in the destination inbox. A 200
in the logs proves the webhook was accepted, not that the mail arrived.

Worth proving the refusal too, once -- it is the check that this is not an open endpoint:

```bash
curl -si -X POST https://<project-ref>.supabase.co/functions/v1/forward-support-email -d '{}' | head -1
```

Expect `401`.

#### What it deliberately does not do

It does not log message content. A support email is somebody's words -- often a parent's -- and
an Edge Function log is not where they belong. Only ids and event types are logged.

---

## Erasing a person's data

The Privacy Policy promises this and there is deliberately **no tool for it**: for a beta of a
few known teams, a request handled by hand is a real answer and building an audited operator
RPC is not worth doing yet (Kevin's call, 2026-08-18). This section is what makes "by hand"
safe — the SQL below was **run against a real database and its effects measured**, not written
from memory.

What the policy says, and therefore what this does: *"we remove your personal information and
your memberships. Work you contributed to a team stays with the team."*

### Read this first: the deletes do not work in the obvious order

`team_members` has five composite foreign keys pointing at it with `ON DELETE SET NULL`, and
**four of them cannot fire**:

```
tasks              (assigned_to, team_id)            -> team_members(id, team_id)
meetings           (created_by,  team_id)            -> team_members(id, team_id)
scouting_reports   (created_by,  team_id)            -> team_members(id, team_id)
meeting_attendance (attested_by, team_id)            -> team_members(id, team_id)
teams              (pending_admin_member_id, id)     -> team_members(id, team_id)
```

`SET NULL` nulls **every column in the key**, so each of these tries to null a `team_id` that
is `NOT NULL` — and the last one tries to null `teams.id`, the primary key. So a plain
`DELETE FROM team_members` is REFUSED for anybody who has been assigned a task, created a
meeting, filed a scouting report, taken a roster, or been nominated as admin:

```
ERROR: null value in column "team_id" of relation "tasks" violates not-null constraint
```

This has never bitten anyone because the app never deletes a member — it sets
`status = 'removed'`. See the plan's parking lot; it is a real schema defect and it is logged.

The consequence for this runbook: **release every reference explicitly first.** A single-column
`UPDATE ... SET assigned_to = NULL` is fine, because a composite FK with any NULL column is not
enforced.

### The sequence

Run it as ONE transaction against the linked database, having taken a dump first (see Backups).

```sql
\set uid 'THE-USER-UUID'
BEGIN;

-- Refuse to continue if they solely administer a team: removing their membership would strand
-- it, and the fix is to transfer the admin role in the operator console FIRST.
SELECT count(*) AS must_be_zero
  FROM team_members WHERE user_id = :'uid' AND role = 'admin' AND status <> 'removed';

-- 1. Release the composite references. None of these can be left to a cascade.
UPDATE teams SET pending_admin_member_id = NULL, pending_admin_nominated_at = NULL,
                 pending_admin_nominated_by = NULL
 WHERE pending_admin_member_id IN (SELECT id FROM team_members WHERE user_id = :'uid');
UPDATE tasks              SET assigned_to = NULL
 WHERE assigned_to IN (SELECT id FROM team_members WHERE user_id = :'uid');
UPDATE meetings           SET created_by  = NULL
 WHERE created_by  IN (SELECT id FROM team_members WHERE user_id = :'uid');
UPDATE scouting_reports   SET created_by  = NULL
 WHERE created_by  IN (SELECT id FROM team_members WHERE user_id = :'uid');
UPDATE meeting_attendance SET attested_by = NULL
 WHERE attested_by IN (SELECT id FROM team_members WHERE user_id = :'uid');

-- 2. Their children, if they are a guardian. Cascades guardian_consents.
DELETE FROM managed_profiles WHERE guardian_user_id = :'uid';

-- 3. Their memberships. Cascades THEIR OWN attendance and nothing else's.
DELETE FROM team_members WHERE user_id = :'uid';

-- 4. The person. ANONYMISED, NOT DELETED -- `teams.owner_id` and `invites.created_by` are
--    NO ACTION, so a DELETE is refused for anyone who ever owned a team or issued an invite,
--    which is every admin. `email` is NOT NULL, hence a tombstone rather than NULL.
UPDATE users
   SET email      = 'erased-' || left(replace(:'uid','-',''),8) || '@erased.invalid',
       full_name  = 'Erased user',
       avatar_url = NULL
 WHERE id = :'uid';

COMMIT;
```

Then **delete the login** in the Supabase dashboard (Authentication → Users). Nothing above
touches `auth.users`, so until you do that the account still exists and can still sign in — to
an anonymised profile.

### What this actually did, measured

Run against a seeded student with 1 assigned task, 1 authored scouting report and 9 attendance
rows, on a team holding 125 attendance rows in total:

| | before | after |
|---|---|---|
| their memberships | 1 | **0** |
| their attendance rows | 9 | **0** |
| their name / email | `Student 1` / `iron-student0@…` | **`Erased user` / `erased-25dfe65c@erased.invalid`** |
| their assigned task | exists, assigned to them | **exists, `assigned_to` NULL** |
| their scouting report | exists, authored by them | **exists, `created_by` NULL** |
| the team's other attendance | 125 | **116** |

Which is the policy's sentence, exactly: the person is gone, their contributions stay with the
team, and no other member lost anything.

### Under-13s

A guardian's request removes the child through step 2 — `managed_profiles` cascades
`guardian_consents`, and the child's `team_members` row goes with the guardian's in step 3
because a managed member's row carries the GUARDIAN's `user_id`. To remove one child while the
guardian keeps their own account, delete that `managed_profiles` row alone and let the cascade
do the rest.

---

## Error review

There is no Sentry. `src/lib/error-reporting.ts` writes one structured line per caught error,
tagged `[falconforge:error]`, carrying the route — which is the field that turns "it crashed"
into a reproduction. Per-route error boundaries catch render failures so one broken view does
not blank the app.

That means client errors are visible in a coach's console and nowhere else, and it is the honest
state of things rather than a gap somebody forgot. The cadence that compensates:

- **Weekly, during the season:** skim the Supabase dashboard's Postgres and API logs for 4xx/5xx
  spikes. A wave of 42501s means a policy is refusing something it should not.
- **After every deploy:** the Deploy workflow now runs `scripts/check-production.mjs`
  automatically. If it fails, the deploy is live and something about it is wrong — read the step
  output before touching anything.

Why client errors are not written to Postgres: it would need a table anyone may `INSERT` into,
which is an unauthenticated write endpoint on the database holding every team's data. That
deserves its own design, not a rider on a hardening sprint.

## Feedback

The sidebar has a feedback link on every screen (`src/lib/feedback.ts`). It is a `mailto:` with
the build id in the subject, so a report arrives attached to a version rather than to "last
Tuesday". A form was rejected for the same reason as error logging: it needs an endpoint, and the
only endpoint available would be an unauthenticated write.

---

## Deploys

`main` deploys automatically again as of Sprint 7 (Kevin's call). The rule that goes with it:

> **Schema changes are ordered by hand. Everything else ships on merge.**

When a branch carries a migration:

1. Take a dump (above).
2. Read the migration. Additive and loosening changes are safe; anything that drops or rewrites
   is not.
3. Apply it to the hosted project and verify.
4. *Then* merge, which deploys the bundle that expects it.

Sprint 4's incident was a bundle deployed against a database that did not match. The ordering is
the whole mitigation.

---

## The demo team

`scripts/seed-demo-team.mjs` builds a populated example team on the LOCAL stack: a season, sub-teams,
a filled sprint board, scouting reports and a worked checklist. It exists so a beta coach can be
shown what the app looks like in use rather than an empty shell, and so screenshots for
documentation do not have to be staged by hand.

It refuses to run against anything but localhost, like `seed-review-states.mjs`.
