# Moving falcon-forge.com from GitHub Pages to Cloudflare Pages

Written 2026-08-22. **Nothing here has been executed.** This is the plan Kevin asked for before
any of it starts, and the hand-off prompt that starts it is `HANDOFF_CLOUDFLARE.md`.

The plan's §3 Hosting row reaffirmed gh-pages on 2026-08-16 with "stay put through beta". This
document does not overturn that decision — it is what to do when it is overturned, written while
the reasoning is fresh, so that the decision to go is a decision about timing rather than a
decision to start thinking.

---

## 1. Scope: hosting, not routing

**The app stays on `HashRouter`.** The plan's §3 row bundles "leave gh-pages" with
"HashRouter → BrowserRouter" as one change, and that bundling is what made it look like a
framework-shaped job three weeks from kickoff. They are separable, and separating them is most of
what makes this tractable:

- Cloudflare Pages serves a HashRouter app exactly as Pages does. Nothing about `#/app/board`
  cares who is serving `index.html`.
- The QR posters already going onto paper encode `…/#/app/checkin/0842` (`QrCode.tsx`). A
  hosting move leaves every printed poster valid. A router move invalidates all of them.
- `e2e/`, `scripts/capture-screens.mjs`, `authRedirectUrl()` and the `404.html` translator all
  encode hash routes. None of them change here.

BrowserRouter remains deferred, with its own trigger: **no posters in circulation**. That means
after the season, not before it.

### What this move actually buys

| Want | Gh-pages today | After |
|---|---|---|
| Security headers over minors' data (CSP, HSTS, X-Frame-Options, Referrer-Policy) | **None. Pages cannot send response headers at all.** | A `_headers` file |
| Per-branch preview deploys | No | Yes, `*.pages.dev` per branch |
| Private repository | Needs a paid GitHub plan for Pages | Free |
| Traffic capacity | Never the issue | Never the issue |

**Traffic is not a reason and never was.** A beta of a handful of teams will not approach any
limit on either host. If the only motivation on a given day is "Cloudflare is faster", the
correct answer is to not do this.

### What it does not buy, and what it costs

It does not fix anything a user can see today. It spends a day-plus of work and one genuinely
risky DNS change (§2) to buy headers, previews and a private repo. Weigh that against whatever
else is on the pre-beta list at the time.

---

## 2. The finding that shapes the sequencing: DNS is the risky part, not hosting

`falcon-forge.com` is registered at GoDaddy and its DNS is served there. That DNS now carries
things that took real effort to get working and that fail **silently**:

- **MX → `inbound-smtp.us-east-1.amazonaws.com`** (Resend inbound), which is what makes
  `support@falcon-forge.com` — the only inbound channel in the bundle (`src/lib/feedback.ts`) —
  reach the Edge Function that forwards it.
- **SPF, DKIM and DMARC for sending**, verified end to end on 2026-08-22: a production signup
  confirmation arrived from `Falcon-Forge <noreply@falcon-forge.com>` with all three passing.
- **The duplicate `_spfm` record on `send.falcon-forge.com`** that GoDaddy's SPF manager
  regenerates and refuses to let anyone delete (`docs/beta-ops.md`).

And here is the constraint that makes DNS non-optional: **Cloudflare Pages cannot serve an apex
domain from third-party DNS.** External-DNS custom domains are CNAME-only, and GoDaddy does not
support CNAME (or ALIAS) at the apex. `falcon-forge.com` is what is printed on the posters and
what `authRedirectUrl()` builds from, so serving only `www.` and forwarding the apex is not
acceptable — it puts a redirect hop in front of a QR code a student scans in a gym.

So the move to Cloudflare Pages **requires** moving nameservers to Cloudflare, which means
re-creating every mail record. That is the real risk in this project, and it is nothing to do
with hosting.

**One upside, worth naming:** on Cloudflare DNS the duplicate `_spfm` record can finally be
deleted. It is harmless today only because the envelope sender is not `send.falcon-forge.com`; it
turns harmful the moment Resend uses a custom bounce domain.

**Therefore the phases below change DNS and hosting on different days, so they can fail
separately and be diagnosed separately.**

---

## 3. Phases

### Phase 1 — DNS to Cloudflare, site still on gh-pages

The site does not move. Only the authority for the zone does, which makes this phase's success
criterion purely "everything still works".

1. **Inventory first, in writing.** Export the full GoDaddy zone (every A, AAAA, CNAME, MX, TXT,
   SRV, CAA) into `docs/dns-inventory-2026-xx-xx.md`. Cloudflare's import scan is a convenience,
   not a record — and the thing being protected is a set of TXT records whose absence produces no
   error, just mail in a spam folder.
2. Add the zone in Cloudflare, let it import, then **diff the imported zone against the
   inventory record by record.** Pay attention to: the two Pages A/AAAA sets (or the `CNAME` to
   `<user>.github.io`), MX, `v=spf1`, the Resend DKIM CNAME/TXT, `_dmarc`, and any GoDaddy-added
   records that should NOT be recreated (`_spfm`, `_domainconnect`).
3. **Set the web records to DNS-only (grey cloud) for now.** Proxying gh-pages through Cloudflare
   is a second change and this phase is deliberately one change.
4. Lower TTLs to 5 minutes on the records Phase 3 will move (apex + `www`), while the old
   nameservers are still authoritative if possible.
5. Change nameservers at GoDaddy. Wait for Cloudflare to report the zone active.
6. **Verify, and verify the mail, not just the web:**
   - `dig falcon-forge.com`, `dig www.falcon-forge.com`, `dig MX falcon-forge.com`,
     `dig TXT falcon-forge.com`, `dig TXT _dmarc.falcon-forge.com` — compare against the inventory.
   - `https://falcon-forge.com` still serves the app (still gh-pages).
   - **Sign up a throwaway account on production and confirm the email arrives**, with
     `spf=pass dkim=pass dmarc=pass` in the raw headers. This is the check that a dashboard
     cannot do for you (`docs/beta-ops.md` says why).
   - **Send a real message to `support@falcon-forge.com` from an outside address** and confirm it
     reaches the forwarding inbox — not just a 200 in `supabase functions logs`.
7. Delete the duplicate `_spfm` record now that a sane DNS UI is in front of it, and re-run the
   sending check.

**Rollback:** point the nameservers back at GoDaddy. Keep the inventory file; that is what makes
rollback a five-minute job rather than an archaeology exercise.

### Phase 2 — A Pages project, verified on `*.pages.dev`

Nothing user-facing changes in this phase either. The site is still gh-pages.

1. Create the Pages project. **Do not use Cloudflare's Git integration to build.** The existing
   `deploy.yml` is not just `npm run build` — it typechecks, runs the unit and integration
   suites, refuses to publish sourcemaps, verifies the CNAME, and runs `check:prod` afterwards.
   Cloudflare's builder would bypass every one of those. Keep GitHub Actions as the builder and
   publish with `cloudflare/wrangler-action` (`wrangler pages deploy dist`).
2. Add `public/_headers` (contents in §4). Vite copies `public/` verbatim, so it ships the same
   way `CNAME` and `404.html` do.
3. **Decide what preview deploys talk to, and write the decision down.** This is the sharpest new
   risk in the whole move: a preview build carrying the production `VITE_SUPABASE_*` values is a
   publicly-reachable `*.pages.dev` URL wired to the database holding every beta team's data,
   with RLS as the only thing between them. Three options, in order of preference:
   - **Previews get no Supabase credentials at all.** The app renders its "not configured" state;
     previews are for looking at the UI. Cheapest, and honest about what a preview is for.
   - Previews point at a second Supabase project. Correct, and it is a whole second environment
     to migrate and seed.
   - Previews point at production. Only with Cloudflare Access in front of the preview domain,
     never on the strength of "nobody knows the URL".
4. Deploy to the `*.pages.dev` URL and check it there, before any DNS points at it:
   - The app boots, signs in, and syncs.
   - `curl -sI https://<project>.pages.dev` shows the headers from `_headers`.
   - **Realtime still connects** — this is what a wrong `connect-src` breaks, and it breaks
     nothing else, so it will not show up as an error anywhere except a websocket that never opens.
   - `https://<project>.pages.dev/app/board` (a non-hash deep link) still lands on the board:
     Pages serves `404.html` for unknown paths, and the translator in it does the rest. If it does
     not, add a `_redirects` line — but check first, because a `_redirects` catch-all to
     `/index.html` would BREAK the recovery flow, which lives in the fragment.
5. **Supabase Auth → URL Configuration:** add whatever preview origins are allowed to sign in.
   `authRedirectUrl()` returns the origin root, so an origin that is not on the allow-list
   silently fails the confirm/recovery round trip. Leave the Site URL as
   `https://falcon-forge.com`.

### Phase 3 — Cutover

1. Add `falcon-forge.com` and `www.falcon-forge.com` as custom domains on the Pages project.
2. Flip the apex and `www` records to the Pages target (proxied/orange this time).
3. Verify within minutes:
   - `curl -sI https://falcon-forge.com` — 200, plus the security headers.
   - The bundle hash matches the commit that deployed (`check:prod` already does this).
   - **Sign in on a phone that already has the PWA installed.** The origin has not changed, so
     the existing service worker updates the way any deploy updates it — but this is the one
     user-visible risk of the whole move and it takes thirty seconds to check.
   - Scan a printed QR poster. It is the flow with paper in the world.
4. Leave GitHub Pages enabled and the `gh-pages` branch intact for a week. **Rollback is a DNS
   change back to the Pages records**, which is why Phase 1 lowered those TTLs.
5. Once settled: remove the gh-pages publish step from `deploy.yml`, delete `public/CNAME` and
   the workflow step that checks it, and turn Pages off in the repo settings. Not before — a
   half-removed deploy path is worse than two working ones.

### Phase 4 — Turn the headers on properly, and go private

1. Ship the CSP as `Content-Security-Policy-Report-Only` first (§4), use the app as every role,
   and read what it would have blocked. Then swap to the enforcing header. A CSP that breaks
   Realtime or the service worker in a gym is worse than no CSP.
2. Make the repository private if that is still wanted. Check first that nothing depends on it
   being public: the `gh-pages` publish (gone by now), any badge, and any raw-content link.
   **Note that making it private does not remove anything from history** — the leaked credential
   in `.agent/` history is fixed by the rotation Kevin performed on 2026-08-22, not by privacy.

---

## 4. `public/_headers`

Start here; ship the CSP report-only first.

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), microphone=(), geolocation=(), interest-cohort=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://cvnonrjzshaawzxcjwmn.supabase.co wss://cvnonrjzshaawzxcjwmn.supabase.co; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'

/index.html
  Cache-Control: no-cache

/sw.js
  Cache-Control: no-cache
```

Notes, each of which is a thing that would otherwise be discovered the hard way:

- **`camera=(self)` is load-bearing.** Check-in scans a QR code with the device camera. A blanket
  `camera=()` would disable the flow this project built a poster around.
- **`style-src 'unsafe-inline'` stays.** The built `index.html` has no inline `<style>` and no
  inline `<script>` (verified against `dist/` on 2026-08-22 — one module script, nothing else),
  but React writes inline `style` attributes at runtime. `script-src` is genuinely `'self'`.
- **`connect-src` must name the Supabase origin twice**, `https:` and `wss:`. The project ref is
  already public — it is inlined in the bundle — so writing it here leaks nothing.
- **`frame-ancestors 'none'` is the one that only works as a real header.** It is ignored in a
  `<meta>` tag, which is why the meta-CSP option sketched in `.agent/production-gauntlet-plan.md`
  was always going to be partial, and why this is the trigger that actually justifies the move.
- **`no-cache` on `index.html` and `sw.js`** — not `no-store`. The service worker is how the app
  updates; a CDN holding a stale `index.html` or `sw.js` is the "stale worker serves the previous
  build indefinitely" defect from Sprint 2 and the retrospective, reintroduced at the edge.
- `upgrade-insecure-requests` is deliberately absent: everything is already same-origin HTTPS, and
  it would only mask a mixed-content mistake instead of surfacing it.

---

## 5. Verification that would actually fail

Per CLAUDE.md: a verification step with no answer to "what would make this fail?" is decoration.

| Step | What makes it fail |
|---|---|
| `dig` diff against the DNS inventory | A record Cloudflare's import missed |
| Real signup on production, raw headers read | SPF/DKIM/DMARC broken by the nameserver move |
| Real message to `support@` reaching the inbox | MX not recreated; forwarding silently dead |
| `curl -sI` on the live origin | `_headers` not shipped, or Pages not serving it |
| Realtime connects after CSP | `connect-src` missing the `wss:` origin |
| Non-hash deep link `/app/board` | `404.html` not served by Pages the way it was by GH |
| PWA on a real phone, post-cutover | Service worker or manifest served with wrong headers |
| Scan a printed poster | Anything about the origin that changed and should not have |
| `check:prod` extended to assert the headers | The `_headers` file being deleted later, silently |

That last row is worth doing as part of this work rather than after: `scripts/check-production.mjs`
already asserts the site responds and that the bundle it names exists. Adding an assertion that
the security headers are present turns "we added headers once" into a property that stays true —
and it costs about ten lines in a script that already runs on every deploy.

---

## 6. Estimate, and what it is not

Two working sessions, if DNS behaves: one for Phase 1 (mostly waiting and verifying), one for
Phases 2–3. Phase 4 is an evening.

It is **not** a sprint. It ships no user-visible behaviour, it touches no schema, and it should
not be numbered as one. It is infrastructure work with its own branch (`v2/cloudflare-hosting`)
and its own verification.

---

## 7. Explicitly out of scope

- **BrowserRouter.** Deferred, with the trigger stated in §1.
- **Supabase free → Pro.** Unrelated, a billing toggle, no migration, and its trigger is the first
  paying customer (§3 of the plan).
- **Cloudflare Workers, D1, R2, or moving any backend.** The only backend is Supabase. Pages here
  is a static host with a headers file, and nothing about this move should start changing that.
- **Error reporting / Sentry.** Genuinely wanted, genuinely separate.
