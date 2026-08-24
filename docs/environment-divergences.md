# Where the thing you are testing is not the thing that ships

Every entry below is a way this project's verification environment differs from production.
Each one has already produced at least one green result that meant nothing.

Sprint 8's parking lot asked for this list explicitly: *"worth writing the divergence down
somewhere a test author will see it."* Read it before writing a test that touches auth, CSS,
service workers, the database's permission model, or a clock.

The failure shape is always the same and is worth naming once: **a gap here stays invisible
precisely because everything downstream of it is green.**

---

## 1. Signup: local had no email confirmation, production does — **CLOSED 2026-08-22**

| | Local | Hosted |
|---|---|---|
| Setting | `enable_confirmations = true` (was `false` until 2026-08-22) | `mailer_autoconfirm: false` |
| `signUp` returns | **no session** | **no session** |

Both now report `mailer_autoconfirm: false`, read off `/auth/v1/settings` on each. The history
below stays because the RULE it produced is the valuable part, and because the divergence is one
config line away from returning — which is why there is now a test that fails if it does.

So on a developer machine every "do this right after signing up" path fires, and in production
none of them do until the user follows an email link.

**What it has already cost.** Sprint 3's `handle_new_user` trigger wrote the attestation version
as a hardcoded `'1.0'`; Sprint 6 raised the documents to `2.0`. Locally the client's own
`recordAttestation` fires and writes a 2.0 row that **masks** the stale one, so Sprint 7's
registration smoke test asserted that a new account is not asked to re-accept its documents,
passed, and proved nothing. In production there is no session, no client write, and every new
account was told on its first screen that the documents had changed since it accepted them.
Found by Kevin testing with a second person; confirmed by reading `/auth/v1/settings` on both.

**Rule.** Anything that must survive account creation runs **server-side** (a trigger reading
signup metadata) or after the first real sign-in. Never rely on client code running at signup.

**How it was closed** (`v2/age-classification-writer`, 2026-08-22), as drafted:
`registration.spec.ts` walks the whole round trip — form, message out of Mailpit (port 54324),
link — and the other fifteen specs create a pre-confirmed account through the admin API
(`createConfirmedAccount` in `e2e/helpers.ts`). The pack still runs in 37s.

**What holds it closed.** A test that asserts the gap itself: submitting the sign-up form leaves
NO stored session, and the emailed link is what creates one. Its first version asserted the
router's destination instead and **passed against auto-confirm** — a signed-in account with no
team also lands on `#/`. It reads `localStorage` for `sb-*-auth-token` now, and was watched
failing with `enable_confirmations` flipped back.

**One more thing the closing found**, which is this document's own thesis: the admin-API helper
first omitted `privacy_version` from the signup metadata, and eleven specs timed out behind the
"We've updated our legal documents" modal — the exact symptom migration
`20260821000000_signup_attestation_version.sql` was written for, reached from a third direction.

## 2. `.env.local` points at **production**

A build or script that inherits ambient environment writes to the real database. This has been
caught before harm three separate times — the venue simulation, the seed scripts, and the
capture script — which is three warnings, not three successes.

**Rule.** Every write-capable script passes its environment **explicitly** rather than
inheriting it, and asserts the target at the network layer. `playwright.config.ts:78-89` and
`scripts/capture-screens.mjs` both do this; copy them.

## 3. jsdom applies no stylesheet

The unit suite cannot see CSS. Specificity, cascade layers, and Tailwind's class extraction all
resolve to nothing, so **jsdom renders the broken and fixed versions of a layout identically.**

This is not a gap that better assertions close. It has produced at least six defects, including
the iOS 16px zoom floor silently protecting nothing for two sprints while live on production,
because `.field` (specificity 0,1,0) outranks `input, select, textarea` (0,0,1).

**Rule.** Anything touching positioning, `index.css`, `tailwind.config.js`, or a z-index needs a
Playwright geometry assertion measuring the **computed value** at 375px. Asserting the class is
present is exactly what every one of those six defects would have passed.

## 4. The dev server has no service worker

An offline navigation against `npm run dev` renders blank, because a `React.lazy` chunk cannot
be fetched and nothing is precached. In this codebase offline behaviour *is* the product, so a
test pointed at the dev server asserts things about the harness.

Worse, a dev server keeps serving the stylesheet it generated at startup. `npm run capture`
once produced images of a silently collapsed layout **that looked exactly like a responsive
bug** — the class was in the JSX and absent from the CSS. Cost 20 minutes, then recurred the
same day.

**Rule.** e2e and captures run against a real build served by `vite preview`. Both do this now.

**And `vite preview` is not automatically safe either.** A real build still installs a service
worker, and it keeps serving the precached bundle across rebuilds. Verifying the Sprint 8
retrospective's own UI fix, the page was controlled by `sw.js` and serving `index-DAle-9hg.js`
while the fresh build on disk was `index-iCBpGKv2.js` — the DOM showed the pre-fix markup and a
CSS class that had been renamed sprints earlier. The measurement was about to confirm the bug was
still there, in a build that had fixed it. Same class as Sprint 5's stale worker serving the
previous `index.html`, which is why deleted Google Fonts links kept appearing.

Before measuring anything in a preview, check what is actually loaded and clear the worker:

```js
[...document.querySelectorAll('script[src]')].map(s => s.src.split('/').pop())  // compare to dist/
const rs = await navigator.serviceWorker.getRegistrations(); for (const r of rs) await r.unregister();
for (const k of await caches.keys()) await caches.delete(k);
```

## 5. Schema assertions run as `postgres`, who is not the app and cannot be refused

`supabase/tests/schema_assertions.sql` connects as `postgres`, so it cannot see a permission gap.

**Measured 2026-08-23, because this section used to say "the superuser" and that is not what
`postgres` is.** On the local stack and on the hosted project alike, `postgres` has
`rolsuper = f`; the superuser is `supabase_admin`. What makes it blind to a permission gap is not
superuser status but `rolbypassrls = t` plus membership of `pg_read_all_data` — it is never
refused by a policy and never refused a read. The distinction matters because the same
measurement showed `postgres` can also set `session_replication_role` despite
`has_parameter_privilege` returning false, via the `supautils` allow-list (`docs/beta-ops.md`,
Backups): reasoning about what this role may do from its *attributes* gives the wrong answer in
both directions. Sprint 2's migrations rebuilt a database **PostgREST could not read a single row of**
(`permission denied for table teams`) and every assertion passed. It was invisible locally for a
second reason too: the hosted project predates the change and already had the grants.

Related: `REVOKE EXECUTE … FROM anon` is a **no-op**, because EXECUTE comes from `PUBLIC` and
`anon` is a member. An assertion over `pg_proc` ACLs would have approved it.

**Rule.** Permissions are tested **behaviourally** — connect as the real role, attempt the
thing, be refused. Never assert the catalogue.

## 6. The Supabase CLI version

Local and CI have disagreed twice: 2.77 vs 2.114 (newer CLI stopped auto-granting default
privileges in `public`), and a harness that read stack status with a different binary than the
one that started the stack. CI is pinned to `2.114.0` in all three jobs (two in `ci.yml`, one in `backup.yml`); the
devDependency is pinned to the same version **exactly**, with no caret, as of Sprint 22 — a
caret is the same defect in slow motion, since `npm ci` honours the lockfile and `npm install`
on a fresh clone does not.
A note once claimed the pin existed when it did not, and the unpinned resolution went through
the rate-limited GitHub API — taking CI red on a **docs-only** commit. That is why the claim is
now a test rather than a note: `harness-invariants.test.ts` reads every `supabase/setup-cli`
step's `version:` and the devDependency and requires all four to be the same string.

## 7. Clocks

The runner is UTC; developer machines here are US Central. The suite has had defects in both
directions, so CI now runs the unit suite under `TZ=UTC` **and** `TZ=America/Chicago`
(`.github/workflows/ci.yml`).

Separately: in an e2e spec, Node's clock and Chromium's clock are two different processes that
share a timezone only by coincidence. Read times from the browser via `page.evaluate`.

## 8. The local `dist/` may not be the bundle you think

After any `test:e2e` run, `dist/` is Playwright's build, which pins the **local** stack. Three
sprint reports leaned on "the live bundle is byte-identical to the local build" as a deploy
check; that comparison fails for a reason unrelated to the deploy, and would equally **pass**
while hiding a real difference if the two happened to agree.

**Rule.** Normalise chunk hashes and diff, then check the live lazy chunks for the feature's own
strings.

## 9. The CI runner is cold and contended; your machine is not

Two defects were green locally and red on a two-core runner: an `onRehydrateStorage` callback
racing jsdom teardown (an *unhandled* error, so the run fails while every test reports passing),
and the e2e pack at Playwright's default 8 workers failing exactly one test per run, a different
one each time. The pack is capped at 4 workers for this reason, and the cap is load-bearing.

## 10. Playwright's Chromium is not Safari

It emulates iOS; it is not WebKit. Every claim about iOS in this repo — the 16px zoom floor, the
safe-area insets — is unverified on the real engine.
