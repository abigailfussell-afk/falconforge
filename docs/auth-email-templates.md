# Auth email templates

The six transactional emails Supabase sends on FalconForge's behalf, as branded HTML. Source
files live in `supabase/templates/`; the **live** copies are pasted into the Supabase dashboard
(Authentication → Emails). See "Where these actually live" below — the split is deliberate and
it is the thing most likely to rot.

**Status: live as of 2026-08-22.** All six pasted into the dashboard. Two things below are
deliberately *not* done and are not blocking: the OTP-expiry copy check, and the send round trip
(`docs/beta-ops.md` step 8) — a template can render perfectly in the dashboard Preview and still
be attached to a link that does not work.

| Dashboard template | File | Subject line to paste | Sent today? |
|---|---|---|---|
| Confirm sign up | `confirm-signup.html` | `Confirm your FalconForge email` | **Yes** — every signup |
| Reset password | `reset-password.html` | `Reset your FalconForge password` | **Yes** — every recovery |
| Change email address | `change-email.html` | `Confirm your new FalconForge email address` | Only if a user changes their address |
| Invite user | `invite.html` | `You've been invited to FalconForge` | **No** — see below |
| Magic link / OTP | `magic-link.html` | `Your FalconForge sign-in link` | **No** — see below |
| Reauthentication | `reauthentication.html` | `Your FalconForge verification code` | **No** — see below |

Three are not sent by the app today and are here anyway, because the alternative is not "no
email" — it is Supabase's unbranded default going out the first time somebody uses the feature:

- **Invite user** fires from the dashboard's own *Invite* button, which is one click away from
  anyone administering the project. FalconForge's real invite path is the `/join/:code` team
  code, which sends nothing.
- **Magic link / OTP** fires from `signInWithOtp`, which the app does not call — sign-in is
  password or OAuth.
- **Reauthentication** fires when `secure_password_change` is on. It is off
  (`supabase/config.toml`), so this one is dormant until that changes.

---

## Design notes, so the next edit does not undo them

- **Table layout, inline styles, no external CSS, no webfont.** Email clients are not browsers.
  Gmail strips `<style>` in several contexts, Outlook renders through Word, and Inter will not
  load — the stack falls back to the system UI font on purpose rather than pretending.
- **The wordmark is text, not the logo PNG.** Most clients block remote images by default, so an
  image-only header renders as a grey box for the first-time recipient who has not yet chosen to
  trust the sender. `public/logo.png` is also 1024×1024 and 784 KB, which is not an email asset.
- **Colours are the brand tokens**: `#ea580c` (forge-600) for the button and links, `#0f172a`
  (slate-950) for headings, `#334155` for body, `#f1f5f9` page behind a white card.
- **The button is a table cell with `bgcolor`**, not a styled `<a>`. Outlook ignores padding on
  an anchor and would render a bare orange word.
- **Every link is repeated as pasteable text** under a divider. Some clients mangle the button;
  the URL below it is the escape hatch.
- **A preheader** (the grey line next to the subject in the inbox list) is set in each file — the
  hidden `<div>` at the top of `<body>`. Without one, clients scrape the first visible text.
- **Light-only, declared.** `color-scheme: light` asks clients not to auto-invert. Gmail and
  Outlook will sometimes invert anyway; the palette was chosen to survive it legibly rather than
  to fight it.
- Verified at 375 px: no horizontal overflow in any of the six, button 173×46 (above the 44 px
  tap target), long fallback URLs wrap instead of stretching the layout.

## Copy notes

- **The reset-password and reauthentication copy states "expires in one hour."** That is a claim
  about a setting, not about the template. Check **Authentication → Emails → Email OTP
  Expiration** and make the sentence match; if it says 86400, the copy should say 24 hours.
- **Confirm sign up carries a line addressed to guardians** — under-13s use guardian-managed
  profiles and the guardian owns the login, so the guardian is a real recipient of that email,
  not an edge case.
- **Change email address is sent to both the old and the new address** when secure email change
  is on (`double_confirm_changes = true` locally). The copy is written to be correct read from
  either end, and tells the old address what to do if the change was not theirs.
- The footer says replies are not monitored and points at `support@falcon-forge.com`, because the
  From: is `noreply@falcon-forge.com` (see `docs/beta-ops.md`).

---

## `{{ .ConfirmationURL }}` vs `{{ .TokenHash }}` — read this before "fixing" it

**The plan (§6, *Auth email branding & the confirmation round trip*) says to build links from
`{{ .TokenHash }}` to our own hash route, "because the default bounces through Supabase's
`/auth/v1/verify` and returns tokens in the URL *fragment*, which is exactly where HashRouter
keeps its route." That rationale was written 2026-08-16 and Sprint 9 has since removed it.**

`authRedirectUrl()` (`src/lib/auth.tsx`) now returns the origin **root**, and the whole point of
that helper is that the fragment survives: GitHub Pages serves `/`, the app boots,
`detectSessionInUrl` reads the fragment, and `onAuthStateChange` decides where the user goes.
There is no longer a route in the fragment for the token to collide with. So these templates use
`{{ .ConfirmationURL }}`, which works today with **zero application code**.

The argument for `{{ .TokenHash }}` that has *not* gone away is a different one:
**link scanners.** Corporate mail filters and some security products prefetch every URL in an
incoming message, which spends the one-time token before the human clicks it, and the user sees
"Token has expired or is invalid." Supabase documents this, and the fix is a `token_hash` link to
an endpoint that calls `verifyOtp` itself.

**FalconForge cannot do that yet.** It needs a route that reads `token_hash` and `type` from the
query string and calls `verifyOtp` — `/auth/callback` today renders a splash screen and nothing
else. That is app work with its own tests, not a template edit. Until it exists,
`{{ .ConfirmationURL }}` is the correct choice, and a beta team behind an aggressive mail filter
is the failure to watch for.

## Settings that have to be right for any of this to work

These are not in the template and will silently defeat it:

1. **Authentication → URL Configuration → Site URL = `https://falcon-forge.com`.** Confirmation
   links are built from it. `signUpWithEmail` passes no `emailRedirectTo`, so signup confirmation
   uses Site URL and *only* Site URL — which also means a confirmation started from `localhost`
   or the `github.io` origin lands on production.
2. **Redirect allow-list** needs exactly one entry, `https://falcon-forge.com/` — the origin
   root with a trailing slash, because that is the only value `authRedirectUrl()` produces.
   A path-bearing entry such as `/auth/callback` is the Sprint 9 defect written down as config,
   and a stale entry hides itself: an unmatched `redirect_to` silently falls back to Site URL,
   so a wrong list looks exactly like a right one until Site URL is also wrong. Local dev has
   its own list in `supabase/config.toml` and is not affected by this one.
3. **Email rate limit** (Authentication → Rate Limits). Still pinned low per `docs/beta-ops.md`;
   it does not lift itself when custom SMTP is enabled.
4. **Custom SMTP** — live as of 2026-08-22, `Falcon-Forge <noreply@falcon-forge.com>`, SPF/DKIM/
   DMARC passing.

## The Security notification emails (the toggles below Authentication)

All seven are off. Two are worth turning on for a product where an adult guardian owns a child's
login and would otherwise have no signal that anything changed:

- **Password changed**
- **Email address changed** (it has its own `{{ .OldEmail }}` variable)

They have separate templates with their own variables, and are not covered by the six files here.
Turning them on without templating them means Supabase's default wording goes out.

## Where these actually live

The `[auth.email.template.*]` blocks in `supabase/config.toml` are **not** wired to these files,
deliberately: they configure the *local* stack (`supabase start`) only. The hosted project reads
its templates from the dashboard, so the dashboard is the live copy and these files are the
reference the dashboard was pasted from.

**That is a drift risk, and it is the known cost of this approach.** When you change a template:
edit the file, paste it into the dashboard, and use the dashboard's **Preview** toggle before
saving. If the two ever disagree, the dashboard is what users received.

## Verifying

The dashboard Preview renders the HTML but does not send. To check the round trip, do what
`docs/beta-ops.md` step 8 says — sign up a genuinely new address and run a reset on it — and
check the two failure modes separately: did it **arrive** (SMTP), and did the link **land you
signed in** (Site URL and redirect handling). A template can look perfect and still be attached
to a broken link.
