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
