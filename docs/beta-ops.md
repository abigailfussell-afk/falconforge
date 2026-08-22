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

### Receiving: make support@falcon-forge.com a real mailbox

`src/lib/feedback.ts` puts `support@falcon-forge.com` in the bundle, and it is the only inbound
channel a beta user can see.

**KNOWN BROKEN, deliberately shipped that way on 2026-08-18 (Kevin's call).**
`falcon-forge.com` has **no MX record** — confirmed against two resolvers — and its apex
resolves to GitHub Pages, which does not run SMTP. A coach who clicks the feedback link gets a
bounce. The previous bundle carried a working Gmail, so this is an accepted regression rather
than an oversight.

**No deploy is needed to fix it.** The address compiled into the app is already the right one;
only the mailbox behind it is missing. This is DNS plus a forwarding service.

#### Which forwarder, and the one that is riskier than it looks

| Option | What it costs you |
|---|---|
| **A forwarding service (ImprovMX, Forward Email, …)** — **recommended** | Two MX records and one TXT at GoDaddy. DNS stays where it is. Free tier forwards one address to one inbox, which is exactly the requirement. |
| **Cloudflare Email Routing** | Free and good, but it requires moving the domain's **nameservers** to Cloudflare — which means recreating the GitHub Pages A/AAAA records, the `www` CNAME and the Resend records above. A DNS migration to gain a mail alias, days before beta, with the site's availability riding on getting every record right. Not worth it now. |
| **GoDaddy / Microsoft 365 mailbox** | Paid, and gives you a whole mailbox to administer for an address that will receive a handful of messages. |

Take the first. The second is the trap: it is the option that sounds tidiest and is the only one
that can take falcon-forge.com off the air.

#### Steps

1. Sign up at the forwarder and add `falcon-forge.com`.
2. Create the alias: `support@falcon-forge.com` → your personal inbox.
3. Add the records it gives you at **GoDaddy → Domains → falcon-forge.com → DNS**. Typically
   two MX rows on the root (host `@`) at different priorities, plus one SPF TXT row. Copy the
   exact values from the forwarder.
4. Wait for it to report verified, then confirm from a terminal — this is the check that
   distinguishes "configured" from "working":

   ```bash
   nslookup -type=MX falcon-forge.com
   ```

   Zero exchangers means it is not live yet, whatever the dashboard says.
5. **Send a real message to `support@falcon-forge.com` from an outside address** and confirm it
   lands. A resolving MX record proves mail will be *accepted*; it does not prove the alias
   routes to you.
6. While you are there, click the feedback link in the app itself. It is a `mailto:` carrying
   the build id in the subject, and it is worth seeing the thing a coach sees.

#### Does this conflict with Resend?

No. Resend's records live on the `send.` subdomain; these live on the root. Different
hostnames, and they can be done in either order.

The one interaction to watch: if the forwarder asks you to add a **root SPF** record and you
later add a second one, **do not create two SPF TXT records** — a domain may have only one, and
two is a hard fail rather than a merge. Combine the `include:` clauses into a single record.

Until this is done, the only working inbound channel is Kevin's personal address, which is no
longer written down anywhere a beta user can see.

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
