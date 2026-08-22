# Hand-off — moving falcon-forge.com to Cloudflare Pages

Written 2026-08-22, alongside `docs/cloudflare-migration-plan.md`, which is the plan itself. This
file carries only what a fresh session needs that is not written down elsewhere.

**This is not a sprint.** It ships no user-visible behaviour and touches no schema. Do not number
it, and do not add it to §6.

---

## The prompt

Paste this into a fresh session in `C:\Claude\falconforge`:

> Read `docs/cloudflare-migration-plan.md` in full, then `FALCONFORGE_V2_PLAN.md` §3 (the Hosting
> row in particular) and §5, then `CLAUDE.md` and `docs/environment-divergences.md`. Then execute
> **Phase 1 only** of the Cloudflare migration on branch `v2/cloudflare-hosting`, and stop for my
> review before Phase 2.
>
> Phase boundaries are the point of the plan, not bureaucracy: Phase 1 moves DNS while the site
> stays on gh-pages, so that if mail breaks I know it was DNS and not hosting. Do not collapse
> phases, and do not start Phase 2 "since we're here".
>
> Several steps are mine, not yours — anything involving the GoDaddy or Cloudflare dashboards,
> nameservers, or the Supabase Auth URL configuration. Tell me exactly what to click and what you
> need back from me, then verify the result yourself from the command line. Do not ask me to
> verify anything you can check.
>
> The success criterion for Phase 1 is that **nothing changes**: the site still serves, a real
> signup email still arrives with SPF/DKIM/DMARC passing, and a real message to
> `support@falcon-forge.com` still reaches the forwarding inbox. Two of those three cannot be
> checked from a dashboard.

---

## What is already decided — do not reopen

1. **HashRouter stays.** This is a hosting move only. The BrowserRouter change is deferred until
   there are no printed QR posters in circulation. If you find yourself editing routes, you have
   left the scope of this work.
2. **GitHub Actions keeps building; Cloudflare only publishes.** `deploy.yml` typechecks, runs
   two suites, refuses sourcemaps and runs `check:prod`. Cloudflare's own Git build would bypass
   all of it. Use `wrangler pages deploy`.
3. **DNS moves to Cloudflare** — not because it is nicer, but because Pages cannot serve an apex
   domain from third-party DNS and GoDaddy has no apex CNAME. Serving only `www.` and forwarding
   the apex is not acceptable: the apex is what is on the posters.
4. **Phase order is 1 → 2 → 3 → 4**, each with its own verification and its own rollback.

## The thing most likely to go wrong

**Mail, not hosting.** `falcon-forge.com`'s DNS carries the Resend inbound MX, SPF, DKIM and
DMARC. All of it started working on 2026-08-22 and all of it fails *silently* — a signup
confirmation lands in spam, or `support@` accepts a message and drops it, and nothing anywhere
reports an error. `docs/beta-ops.md` is the runbook for both and is the thing to re-read before
touching a record.

Export the whole GoDaddy zone into a dated file in `docs/` **before** changing anything, and diff
Cloudflare's import against it record by record. Cloudflare's import scan is a convenience, not a
record of what was there.

Two records that should NOT be recreated: GoDaddy's `_spfm` duplicate (the one it regenerates and
refuses to delete — deleting it for good is a small win of this move) and `_domainconnect`.

## The second thing, which is new

**Decide what preview deploys are allowed to talk to before creating the first one.** A preview
build carrying the production `VITE_SUPABASE_*` values is a publicly-reachable URL wired to the
database that will hold every beta team's data. The plan's §3 Phase 2 lists three options; the
default is "previews get no Supabase credentials", and any other choice is Kevin's to make
explicitly.

## What to do that the plan does not spell out

- Extend `scripts/check-production.mjs` to assert the security headers are present. It already
  runs on every deploy and already asserts the bundle exists. Without it, "we added headers once"
  is a fact about the past, and a deleted `_headers` file is silent. Ten lines, and it belongs in
  this branch rather than a later one.
- Update `FALCONFORGE_V2_PLAN.md` §3's Hosting row when Phase 3 lands. It currently says
  "gh-pages + custom domain … Reaffirmed 2026-08-16 — stay put through beta", which will be
  false. Rewrite it rather than appending to it — a row that contradicts itself across two
  sentences is how the Gate ended up with three definitions.
- Add a row to §8's Progress log. One row, at the end, like every other.

## What not to do

- Do not add a `_redirects` catch-all to `/index.html`. Check whether Pages serves the existing
  `public/404.html` for unknown paths first — it should, and the 404 translator is deliberate
  about two cases it refuses (a URL that already has a fragment, because the recovery token lives
  there; and anything with a file extension). A blanket SPA rewrite would break password
  recovery, which was dead in production until Sprint 9 for a closely related reason.
- Do not proxy anything through Cloudflare in Phase 1. One change at a time is the whole design.
- Do not turn off GitHub Pages or delete `public/CNAME` until the new host has served real traffic
  for a week. Rollback is a DNS change, and only while both paths still exist.
- Do not treat a green `npm run gate` as evidence about any of this. Nothing in this work is
  visible to the suite; the verification table in the plan's §5 is the real gate here.
