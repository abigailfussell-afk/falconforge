# Beta operations

What to do, and how often, once real teams are using falcon-forge.com. Written in Sprint 7,
before beta onboarding, so that none of it has to be invented during an incident.

---

## Backups

**The free tier does not back you up in a way you should rely on.** Supabase's free plan has no
point-in-time recovery. There is one database, it holds every team's season, and the only thing
standing between a bad migration and a lost season is a dump somebody took on purpose.

### The one-liner is two lines, and the reason matters

```bash
supabase db dump --linked             -f "backups/falconforge-$(date +%Y-%m-%d)-schema.sql"
supabase db dump --linked --data-only -f "backups/falconforge-$(date +%Y-%m-%d)-data.sql"
cat backups/falconforge-*-schema.sql backups/falconforge-*-data.sql > backups/falconforge-$(date +%Y-%m-%d).sql
```

**`supabase db dump` with no flag dumps the SCHEMA and nothing else.** This document carried the
single-command version from Sprint 7 until Sprint 14, when running it turned out to produce a
137 KB file containing every table, policy and function — and zero rows. The backup this file
calls "the difference between a bad afternoon and a lost season", taken before every migration,
would have restored an empty database.

It is not a subtle output either — the file has no data statements in it at all. That is the
check worth doing on any backup, here or anywhere else in this document:

```bash
# 23 on the current schema (17 public tables + 6 auth). 0 means the dump has no data in it.
grep -c '^INSERT INTO ' backups/falconforge-2026-09-01.sql

# And which tables, which is what tells you a restore would bring the app back:
grep -o '^INSERT INTO "[a-z_]*"\."[a-z_]*"' backups/falconforge-2026-09-01.sql | sort -u
```

`INSERT INTO`, not `COPY`: the Supabase CLI emits multi-row inserts. A check written for `COPY`
reports zero on a perfectly good backup, which is the false alarm that teaches people to ignore
the check.

Schema first, then data: the data half opens with `SET session_replication_role = replica`, which
is what lets it load without tripping over foreign keys, and it has nothing to load into until
the schema exists. `supabase db push` cannot rebuild the schema from this repo's squashed
migration history (see the traps below), so the dump has to carry it.

`backups/` is gitignored — a dump contains every team's data and every user's email address, and
it must never reach a public repository.

### The nightly one, which is not a habit

`.github/workflows/backup.yml` runs at **07:10 UTC every day**, dumps the hosted database,
encrypts it on the runner, and keeps it as a 30-day GitHub artifact. It exists because the
"weekly during the season" line below was a human habit with nothing running it — `grep 'db
dump' .github/workflows` found only this document — and the honest description of the recovery
position was "lose everything since somebody last remembered".

**Two repository secrets, and until they exist the workflow goes red every night.** That is
deliberate: a backup job that skips quietly is the failure this is meant to remove.

**Status, 2026-08-23 — WORKING. The first backup in this project's history exists.**

Run `32670045597`: **38 452 bytes of data, 17 `INSERT` statements**, encrypted on the runner and
retained as a 30-day artifact. The tables in it are the ones a restore cannot rebuild —
`auth.users`, `public.teams`, `team_members`, `platform_operators`, `user_attestations` — and the
list is identical to the manual dump taken the same afternoon, which was verified by **restoring
it** and applying all 14 pending migrations on top. The nightly runs at 07:10 UTC from here.

Getting there took three failures, and each is worth keeping because each looked like success
from the outside.

**1 — the workflow was not on GitHub at all.** `backup.yml` landed in Sprint 14, but `main` had
not been pushed since `c1cec81`, so it existed on one laptop and nowhere GitHub could see it.
`gh run list --workflow=backup.yml` answered `HTTP 404: workflow not found on the default
branch`. It was not going red every night; it was not running at all — the quieter of the two
failures, and the one this workflow was written to make impossible. Fixed by pushing `main` (86
commits) once the 14 pending migrations had been applied to the hosted project.

**2 — the secret was the wrong kind of connection string, and this document said to make it
that.** The first real run failed in 30 seconds:

```
pg_dump: error: connection to server at "db.<ref>.supabase.co" (2600:1f14:...), port 5432
failed: Network is unreachable
Your network does not support IPv6, which is required for direct connections to the database.
```

**GitHub's hosted runners have no IPv6, and Supabase's direct database host is IPv6-only on the
free tier** — so that address is not slow or flaky from Actions, it is unreachable, always. The
secrets table below used to say *"Use the direct connection, not the pooler."* Kevin set the
secret correctly according to the documentation; the documentation was wrong. It was half right,
which is why it survived: `pg_dump` genuinely needs a session and the TRANSACTION pooler (6543)
cannot give one. What it missed is the **session pooler on 5432** — IPv4 *and* session-mode.
`backup.yml` now refuses in its first step if the URL is not a pooler string, before pulling a
300 MB postgres image: 9 seconds and a named cause, against 34 seconds and an IPv6 error.

**3 — the size floor rejected a perfectly good backup, on the first run that ever reached it.**
The check was `data.sql` must exceed 50 KB. Production's data half is **38 452 bytes**. Nothing
was wrong with the dump; the floor was a guess made before anybody had measured the thing it was
guarding, and the first time it ran it failed a real backup. A byte count is the wrong instrument
twice over — it fails a small database that is perfectly backed up, and it passes a large one
whose rows are missing but whose `SET`/`COMMENT` preamble is bulky, which is the failure it was
written to catch. It now counts `INSERT` statements and requires `auth.users` and `public.teams`
specifically: an account and a tenancy, the two things no amount of re-running rebuilds. The
run summary carries those numbers, because "backup taken" is what thirty days of green would have
looked like while the artifact restored an empty database.

**Still not proven, and worth knowing:** nobody has decrypted an artifact and restored it. The
manual dump was restored and is the evidence that the *content* is good; the artifact is the same
content through `gpg`. Restoring one is the next thing to do — see "Restoring from a nightly
artifact", and note the trap recorded there about `session_replication_role`.

| Secret | What it is | Where to get it |
|---|---|---|
| `SUPABASE_DB_URL` | The **session pooler** connection string for the hosted project, including the password. | Supabase dashboard → **Connect → Session pooler**, port **5432**. **Not** the direct connection (`db.<ref>.supabase.co`): it is IPv6-only and GitHub runners have no IPv6, so `pg_dump` can never reach it — this is what made the first run fail. **Not** the transaction pooler (6543) either: `pg_dump` needs a session, which transaction pooling does not give it. Session pooler is the one that is both IPv4 and session-mode. |
| `BACKUP_PASSPHRASE` | Any long random string. It is the only thing that decrypts the artifacts, so **losing it loses every backup taken with it.** Put it in a password manager before pasting it into GitHub. | Generate one: `openssl rand -base64 48`. |

Add both under Settings → Secrets and variables → Actions → New repository secret. Then run the
workflow once by hand (Actions → *Nightly encrypted database backup* → Run workflow) rather than
waiting until 07:10 to find out whether it works.

**What the job refuses to do.** It fails rather than uploading if either secret is missing, if
the **data** dump comes back under 50 KB, or if the schema dump contains no `CREATE TABLE`. That
size is the shape of "connected, authenticated, and read nothing", which is a failure that
otherwise uploads happily and looks like a backup for thirty days. The check is on the data half
specifically, and that is not a detail: the first version of this workflow checked the combined
file, where 137 KB of schema hides the absence of every row. The plaintext is shredded before the
upload step runs, so only the `.gpg` can reach the artifact.

**The artifact contains every minor's name.** That is why it is encrypted on the runner rather
than after the fact: a GitHub artifact is readable by anybody with repo access, and the
passphrase is not in the repo. Thirty days is chosen for the same reason — long enough that a
problem noticed a fortnight later is recoverable, short enough that this file is not kept for
ever.

### Restoring from a nightly artifact

```bash
# 1. Download the artifact from the workflow run (Actions -> the run -> Artifacts).
unzip db-backup-<run-id>.zip

# 2. Decrypt. It will prompt for BACKUP_PASSPHRASE.
gpg --output restored.sql --decrypt backup-2026-09-01.sql.gpg

# 3. Restore. Read the two traps below FIRST.
psql "$DATABASE_URL" -f restored.sql
```

**Step 3 has a trap that reports success.** The data half of the dump opens with

```sql
SET session_replication_role = replica;
```

which is `pg_dump`'s way of holding triggers and foreign keys off while rows load. **The
`postgres` role on Supabase is not a superuser and is not allowed to set it** (`select usesuper
from pg_user where usename = 'postgres'` → `f`). psql prints one `permission denied to set
parameter` line in the middle of several hundred lines of output, carries on with every
application trigger live, and **exits 0**.

Measured, on the local stack, restoring a real dump this way: `teams` 32 and `seasons` 32
restored; `team_members`, `tasks`, `meetings`, `meeting_attendance` and `scouting_reports` all
**0**. The first trigger to fire rejects the row ("The team admin must accept the terms of
service…"), and every table with a foreign key to what it rejected fails after it. A restore that
gives you the teams and none of their people, work, meetings or scouting — and calls it success.

So disable the triggers yourself, as the table owner, which `postgres` is allowed to do:

```sql
-- BEFORE loading the data half.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables WHERE schemaname = 'public'
  LOOP EXECUTE 'ALTER TABLE ' || r.t || ' DISABLE TRIGGER USER'; END LOOP;
END $$;

-- ...load the data...

-- AFTER. Do not skip this: the app's own invariants live in these triggers.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables WHERE schemaname = 'public'
  LOOP EXECUTE 'ALTER TABLE ' || r.t || ' ENABLE TRIGGER USER'; END LOOP;
END $$;
```

With those two blocks around the load, the same dump restored **32 teams, 64 members, 7 tasks,
20 meetings, 126 attendance rows, 4 match plans and 67 auth users**, zero errors — Iron Falcons
back with its 18 members and 17 meetings.

**Always count something afterwards.** A restore is not finished when psql exits:

```sql
select (select count(*) from teams) teams, (select count(*) from team_members) members,
       (select count(*) from tasks) tasks, (select count(*) from meetings) meetings;
```

### Restoring ONE team, without touching the others

The dump is plain SQL, so a single team can be lifted out of it — which is the realistic case
(one team's season damaged by a bad write, everybody else fine). Restore the dump into a
**scratch** database first, then copy the rows across in foreign-key order:

```sql
-- In the scratch database: everything for one tenant, in dependency order.
\set team '00000000-0000-0000-0000-000000000000'

COPY (SELECT * FROM teams            WHERE id      = :'team') TO '/tmp/t_teams.csv'    CSV;
COPY (SELECT * FROM seasons          WHERE team_id = :'team') TO '/tmp/t_seasons.csv'  CSV;
COPY (SELECT * FROM team_members     WHERE team_id = :'team') TO '/tmp/t_members.csv'  CSV;
COPY (SELECT * FROM sub_teams        WHERE team_id = :'team') TO '/tmp/t_subteams.csv' CSV;
COPY (SELECT * FROM tasks            WHERE team_id = :'team') TO '/tmp/t_tasks.csv'    CSV;
COPY (SELECT * FROM scouting_reports WHERE team_id = :'team') TO '/tmp/t_scout.csv'    CSV;
COPY (SELECT * FROM match_plans      WHERE team_id = :'team') TO '/tmp/t_plans.csv'    CSV;
COPY (SELECT * FROM meetings         WHERE team_id = :'team') TO '/tmp/t_meetings.csv' CSV;
COPY (SELECT * FROM meeting_attendance WHERE team_id = :'team') TO '/tmp/t_att.csv'    CSV;
COPY (SELECT * FROM checklists       WHERE team_id = :'team') TO '/tmp/t_check.csv'    CSV;
```

Then `COPY ... FROM` each file into the live database **in that order** — parents before
children, because `season_id` is NOT NULL with a composite foreign key and `meeting_attendance`
carries one into `meetings(id, team_id)`. `meetings` before `meeting_attendance` is the pair
that actually bites.

Run it as the service role or as `postgres`: every one of these tables is behind RLS, and a
restore performed as an ordinary user silently writes nothing.

**Rehearsed once, on 2026-08-23, against the local stack — and it is the reason two things above
are written differently from how they were first written.** The rehearsal was: dump the local
database, run it through the workflow's own steps (size check, `gpg --symmetric`, `shred` the
plaintext), decrypt, and restore into an emptied database. It found the schema-only dump and the
`session_replication_role` trap, in that order, neither of which was visible by reading.

**What is still not rehearsed:** a restore of a real *hosted* artifact into a *new* Supabase
project. The local stack provides the `auth`, `extensions` and `vault` schemas that Supabase
manages on a hosted project — restoring into a bare Postgres database instead fails on all three,
so the local rehearsal cannot say anything about what a fresh project supplies. That last mile is
in the plan's parking lot and needs a scratch project plus one real nightly artifact.

### When to take a manual one anyway

| When | Why |
|---|---|
| **Before applying any migration to the hosted project** | Non-negotiable. Sprint 3's `db reset --linked` and Sprint 4's incident are both in the plan's log; a dump is the difference between a bad afternoon and a lost season. A nightly from up to 24 hours ago is not the same thing as one from two minutes ago. |
| Before and after beta onboarding | The onboarding itself is the risky change. |

### Two more traps, whichever restore you are doing

The steps live in **Restoring from a nightly artifact** above — there is one restore procedure in
this document, not two. (There were two until Sprint 14, and the older one was a bare `psql -f`
that silently loses five tables.)

These two have bitten this project before, both recorded in the plan's log:

- `supabase db push` **cannot apply a squashed migration history** — the first `CREATE TABLE`
  collides with what is already there. That is why Sprint 3 used `db reset --linked` instead.
- `platform_operators` **ships empty and no API path can write it.** After any restore that
  rebuilds the schema, re-insert Kevin's operator row with the service key or the operator
  console silently does nothing. The SQL is in `docs/v2-schema.md`.

---

## Transactional email

**LIVE AS OF 2026-08-22.** Custom SMTP through Resend is configured and verified end to end
against a real Gmail: a production signup confirmation arrived from
`Falcon-Forge <noreply@falcon-forge.com>` with **SPF, DKIM and DMARC all passing**, sent from
`54.240.14.44` (`a14-44.smtp-out.amazonses.com`). The section below is the runbook that got it
there, kept for the next time and for the rate-limit step, which is the one that stays
dangerous.

**Two things still outstanding here**, neither blocking:

1. ~~**The email rate limit**~~ **DONE 2026-08-22 — raised to 100/hour by Kevin.** It had been
   pinned low and does NOT lift itself when SMTP changes, so onboarding a team of fifteen would
   have failed on the fourth student with Resend wired up perfectly. **The ceiling that now
   binds is Resend's, not Supabase's**: the free tier is 100 messages a DAY and 3,000 a month,
   so 100/hour is right for one team onboarding in one room and the number to remember when
   several teams onboard on the same evening. Nothing warns about either limit; the symptom is
   a confirmation that never arrives.
2. **Two SPF records on `send.falcon-forge.com`** -- GoDaddy's SPF manager regenerates its own
   `_spfm` version alongside the correct one, and refuses to let the extra be deleted
   ("Your attempt to delete DNS records has failed"). Not currently harmful: SPF is evaluated
   against the ENVELOPE sender, which is not `send.falcon-forge.com` today, which is why the
   message above passed. It becomes harmful the moment Resend uses a custom bounce domain,
   because that is exactly what these records are for. Retry the delete after cancelling the
   "Add New Record" form, or clear it up when DNS moves.

---

**Originally, and the reason all of this exists:**

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
with templates and link rewriting. **The SMTP half is separable and was done alone** — nothing
below touches the templates.

**The templates have since been done too** (2026-08-22): six branded HTML files in
`supabase/templates/`, live in the dashboard, documented in `docs/auth-email-templates.md`. That
doc owns the template and redirect-URL settings; this one owns SMTP and the mailbox. The link
rewriting (`token_hash`) is still open and still needs app code.

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

**There is a tool now, and this section is no longer the procedure.** Sprint 21 (SEC-11) turned
the SQL that used to live here into two audited RPCs, reachable from the operator console:

| | |
|---|---|
| **Erase a person** | The **Erase** button on their row in a team's roster panel. Works from any team they belong to; it removes them from *all* of them. |
| **Delete a team** | The panel below the roster. Requires the team's name typed exactly. |
| **Remove one child** | The guardian does it themselves — **Remove** on the child's card in *My children*. No operator involvement, which is the point. |

Both RPCs write to `operator_actions`, so "did we honour that request, and what did it touch?"
is answerable afterwards. The erasure record deliberately does **not** keep the name or address
it erased; an audit log that retains the personal information is not an erasure.

### What the tool does, and why the order is what it is

The sequence below is the runbook that used to be here, and it is still worth reading before
editing `operator_erase_user` — its order is load-bearing and non-obvious.

`team_members` has five composite foreign keys pointing at it with `ON DELETE SET NULL`, and
**four of them cannot fire**:

```
tasks              (assigned_to, team_id)            -> team_members(id, team_id)
meetings           (created_by,  team_id)            -> team_members(id, team_id)
scouting_reports   (created_by,  team_id)            -> team_members(id, team_id)
meeting_attendance (attested_by, team_id)            -> team_members(id, team_id)
teams              (pending_admin_member_id, id)     -> team_members(id, team_id)
```

`SET NULL` nulls **every column in the key**, so each of these tries to null a `team_id` that is
`NOT NULL` — and the last tries to null `teams.id`, the primary key. So a plain
`DELETE FROM team_members` is refused for anybody who has been assigned a task, created a meeting,
filed a scouting report, taken a roster, or been nominated as admin. Every reference is released
explicitly first, one column at a time, because a composite FK with any NULL column is not
enforced.

Then: the guardian's children (cascading their consents and the child's membership), then the
memberships (cascading their own attendance and nothing else's), then the identity.

### Three things this section used to get wrong

Kept, because each was believed and written down, and the third nearly survived a second time.

**1 — "Then delete the login in the Supabase dashboard" does not work for most people.** Measured:
`auth.admin.deleteUser` on a team owner is refused (`Database error deleting user`); on a plain
student it succeeds. `public.users.id -> auth.users(id) ON DELETE CASCADE` means deleting the
login deletes the profile row, and four `NO ACTION` references — `teams.owner_id`,
`teams.pending_admin_nominated_by`, `invites.created_by`, `extra_team_grants.granted_by` — refuse
that for anyone who has ever owned a team or issued an invite. Which is every admin. The tool
**bans** the login instead: one outcome for everybody rather than a step that silently half-works.

**2 — the anonymisation was not durable.** The old SQL wrote the tombstone to `public.users` and
left `auth.users` alone. But `handle_new_user()` fires `AFTER INSERT OR UPDATE ON auth.users` and
its upsert says `email = EXCLUDED.email` — *"GoTrue owns the address; there is no other writer."*
So the next time GoTrue touched that row for any reason — a password reset, an email confirmation
— the real address was copied straight back over the tombstone. Combined with (1), an erased
administrator kept a working login that silently un-erased itself. The tool anonymises
`auth.users` **first** and lets the trigger carry the tombstone into `public.users`, which uses
the sync rather than fighting it.

**3 — SEC-01's admin-protection trigger refuses the whole thing, and a psql probe says otherwise.**
Deleting a team cascades into `team_members` and takes the admin's row with it, which that trigger
exists to prevent — so `DELETE FROM teams` was refused for every team that has an administrator,
which is every team. What makes this worth writing down is how nearly it was missed: **running the
same function in psql SUCCEEDED**, because psql connects as `postgres` and the trigger's first
bypass exempts exactly that. The probe agreed with a broken function. Only calling it the way the
app does — an operator's JWT through PostgREST — showed the refusal. A transaction-local
`falconforge.operator_removal` flag now licenses it, deliberately *not* reusing `admin_transfer`.

### What an erasure actually did, measured

From the original hand-run, against a seeded student with 1 assigned task, 1 authored scouting
report and 9 attendance rows, on a team holding 125 attendance rows in total:

| | before | after |
|---|---|---|
| their memberships | 1 | **0** |
| their attendance rows | 9 | **0** |
| their name / email | `Student 1` / `iron-student0@…` | **`Erased user` / `erased-…@erased.invalid`** |
| their assigned task | exists, assigned to them | **exists, `assigned_to` NULL** |
| their scouting report | exists, authored by them | **exists, `created_by` NULL** |
| the team's other attendance | 125 | **116** |

Which is the policy's sentence exactly: the person is gone, their contributions stay with the
team, and no other member lost anything. `src/test/db/erasure.db.test.ts` asserts all of it,
including the half that is easy to break — that the task and the report *survive*.

### If you still need to do it by hand

Take a dump first (see Backups), and read `supabase/migrations/20260829000000_sec_11_erasure.sql`
rather than reconstructing the order from memory. The function is the runbook now, and unlike a
code block in a document it is tested.

### Under-13s

A guardian removes one child from their own screen; nothing reaches an operator. Removing the
guardian's account removes every child with it, because a managed member's `team_members` row
carries the **guardian's** `user_id` — which is also why the operator console does not offer
*Erase* on a child's roster row: the account behind it is the parent's.

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

### What a beta report now carries (OPS-03 / OPS-05)

The "Send feedback" link is still a `mailto:`, and the body now brings the context that used to
have to be asked for over three emails:

```
build: 83e4190          <- the commit, not "0.1.0" (OPS-03)
screen: #/app/board
device online: yes      <- navigator.onLine
server: NOT reachable   <- what the app has actually observed (SYNC-07)
unsent changes: 3 queued, 1 parked
team: 6eec0597-…
```

`device online` and `server` are deliberately two lines. They answer different questions, and
conflating them is the whole of SYNC-07: a captive portal is "online: yes, server: NOT
reachable", and an email that only said the first would send you looking at the wrong layer.

It carries **no names, no task content and no address but the support one** — asserted in
`src/lib/__tests__/feedback.test.ts`, which walks every line of the block and fails on any key
outside the fixed set. A support inbox is not where minors' data should arrive by accident.

### Uptime — the piece that is still yours to set up (OPS-05)

Nothing watches the site between deploys. `check-production.mjs` runs once, after a deploy, and
then nobody looks until somebody emails. Two free HTTPS checks close that, and both are GETs
that script already makes:

| Check | URL | Expect |
|---|---|---|
| The app is served | `https://falcon-forge.com/` | 200, and the body contains `<div id="root"`  |
| Auth is answering | `https://<project>.supabase.co/auth/v1/settings` | 200 JSON |

Either [UptimeRobot](https://uptimerobot.com) or [BetterStack](https://betterstack.com) has a
free tier that covers a 5-minute interval on two monitors with email alerts. **This is an
account signup, so it is Kevin's to do** — there is nothing in the repo that can do it.

**Status, 2026-08-23 — Kevin reports UptimeRobot is set up.** Recorded rather than verified:
an external monitoring account leaves no trace in this repo or in the GitHub API, so nothing
here can confirm the two monitors exist, point at the URLs in the table above, or alert
anybody. The check that would settle it is the one that matters anyway — take the site down
deliberately for six minutes and see whether the mail arrives — and it should be done once
before a competition rather than discovered during one.

Two reasons it is worth the ten minutes:

1. It is the only thing that would tell you the site is down **before a coach does**. Everything
   else in this document is a review cadence, which means "after the fact by up to a week".
2. **It defeats the 7-day inactivity pause.** A Supabase free project with no requests for seven
   days is paused, and the first person to notice is whoever tries to sign in on the eighth day.
   A check every five minutes is traffic, so the project never idles — which matters most in the
   quiet weeks between competitions, when nobody is using the app and nobody would notice it had
   stopped working.

Point them at the two URLs above rather than at a health endpoint the app does not have.

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
