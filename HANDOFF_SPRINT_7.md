# Hand-off — Sprint 7: Beta hardening & launch

Open a fresh Opus 5 session in `C:\Claude\falconforge` and give it everything below.

---

**FIRST: merge Sprint 6.** The branch `v2/sprint-6-licensing` (7 commits) is complete, Gate-green,
and **pushed** — but not merged. Before any Sprint 7 work:

  1. `git checkout main && git merge --no-ff v2/sprint-6-licensing` with a message in the style of
     Sprint 5's and 5.5's (`332f2bd`, `909a163`): one line naming the sprint and its headline — the
     licensing console, the B25 escalation, and the iOS zoom floor that had stopped working.
  2. Run the full Gate **on main after the merge** and report real output. `supabase/` IS touched
     this time, so `npm run db:verify` (needs Docker) and `npm run test:rls` both apply — unlike
     Sprints 5 and 5.5.
  3. **`main` NO LONGER AUTO-DEPLOYS.** Sprint 6 changed `deploy.yml` to `workflow_dispatch` only.
     Merging and pushing `main` therefore ships nothing; the live site changes when somebody runs
     Deploy from the Actions tab. Confirm with Kevin before doing that, and see decision 1 below.
  4. Only then branch `v2/sprint-7-hardening` off the merged main.

**B25 — a cross-tenant privilege escalation, unfixed on production until this deploys, but NOT a
fire drill.** `can_manage_billing` returned NULL rather than false for a non-member, so every
`IF NOT can_manage_billing(...)` guard in plpgsql was skipped — and `transfer_team_admin` is that
shape, is SECURITY DEFINER, and is EXECUTE-granted to `authenticated` **and `anon`**. Confirmed as a
working exploit against a two-team fixture, not a theory.

**Calibrate it honestly, which the first draft of this hand-off did not.** Exploiting it needs an
authenticated member of a *different* team, and production has one team and one user. So it is
unreachable in practice right now and must simply be fixed before beta teams onboard — which this
branch does. Ship it with the sprint; a standalone hotfix was offered at Sprint 6's close and was
correctly declined as over-cautious. Details in `docs/sprint-6-report.md`.

**Note the migration.** `20260818000000_v2_licensing_admin.sql` is the second forward migration on
the frozen schema. It is additive or loosening throughout and does not touch `license_grants`,
`platform_operators` or `team_members` structurally — but it does `CREATE OR REPLACE` three
capability functions and drop/recreate one unique constraint on `user_attestations`. Read it before
applying to the hosted project, and take a backup first as Sprint 3's entries insist.

---

Read FALCONFORGE_V2_PLAN.md §5 (engineering rules — binding) and §6 Sprint 7, then execute Sprint 7
under those rules.

Read first, in this order:
  - `docs/sprint-6-report.md`  — what just shipped, the three bugs found by running the app, and
                                 the two exit criteria Sprint 6 did **not** meet
  - FALCONFORGE_V2_PLAN.md §8 parking lot — **the first item is 🔴 and it is about CI**
  - `README.md` "Licensing, seats, and who may do what" — the model Sprint 6 settled, so you do not
                                 re-derive it from the schema

---

## 🔴 CI HAS NEVER RUN ON A SPRINT BRANCH. FIX THIS FIRST.

`ci.yml` triggers on `push: branches: [main, 'refactor/**']` and on `pull_request`. `v2/**` is in
neither. Confirmed empirically: pushing `v2/sprint-6-licensing` fired **zero workflows**.

So every sprint since Sprint 1 has been merged to `main` on the strength of a locally-run Gate, and
the first CI run has always arrived *after* the merge — the one moment it is useless. Nothing has
been caught by this because the Gate is genuinely run and reported, but "CI green" has never been
true of a sprint branch before its merge, and Sprint 7's whole purpose is confidence.

Add `'v2/**'` to the trigger list as your first or second commit. It is one line. Then Sprint 7's
own smoke pack has somewhere to run before a merge rather than after one.

---

## THREE DECISIONS ARE KEVIN'S, NOT YOURS. Ask all three in your first message and wait.

  1. **Deploy posture, now that the hardening is being built.** Sprint 6 made deploys manual, and
     **the reason recorded in `deploy.yml` was initially overstated and has been corrected — read it
     rather than assuming.** Production is still GREENFIELD: `db reset --linked` at Sprint 3 emptied
     `auth.users`, and it holds only Kevin's account, his `platform_operators` row, TestTeam and one
     gift grant. There are no users to lock out, and he holds the service key. The surviving argument
     is the MIGRATION — the second forward migration on a frozen schema, against the one database
     holding an operator identity no API path can recreate, which is Sprint 4's incident in a
     different costume.
     So with no users, reverting to auto-deploy is defensible *today*. **Ask at the START of the
     sprint what he wants at the END of it**, because it decides whether you build a post-deploy
     smoke check (see 2) and it is the difference between "merge ships it" and "merge then click".
     The honest trigger for going back to manual permanently is beta onboarding, not this sprint.

  2. **Should the smoke pack also run against PRODUCTION after a deploy?** Against the local stack
     it is a pre-merge gate. Against production it is the thing that tells a solo maintainer within
     two minutes that a deploy broke the login page — which is worth a lot at kickoff. The cost is
     real: it writes test data into the hosted database, needs a dedicated account and team, and a
     flow that creates a season or a task leaves rows behind. There is a middle option — a
     read-only smoke check (loads, serves the right bundle, auth endpoint answers, `team_entitlement`
     returns 200) that writes nothing. His call, and it shapes the Playwright work.

  3. **Is Sprint 7 the last sprint before real teams get the URL?** The plan has beta launch in the
     week of Sept 7 with beta teams onboarding Sept 2026, and Sprint 7's exit criterion is Kevin
     tagging `v2.0.0-beta`. Several things are deliberately unfinished — the trial licence still
     self-grants (Sprint 10/Stripe), guardian *UI* does not exist (Sprint 9, schema only), and
     Sprint 6's end-to-end walkthrough was only partly done. Ask whether he wants a Sprint 8 buffer
     for those or whether the tag goes on regardless, because it decides how much of the backlog
     you pull forward versus park.

---

## BUILD THE SCREENSHOT TOOLING FIRST. IT IS ALREADY DECIDED.

Decided with Kevin at Sprint 6's close, recorded in §6 under Sprint 7's Playwright bullet:
**Playwright owns screenshot capture, and it is the first thing you build.**

Sprint 5 and Sprint 6 both have "screenshots at 375 / 768 / 1280" in their exit criteria. Sprint 5
satisfied it by hand; **Sprint 6 could not satisfy it at all, at any width.** Two distinct causes,
and the undocumented one is what actually cost the sprint its captures:

  - **The Browser pane cannot capture while it is hidden.** No pane displayed → no compositing → no
     frames → `screenshot failed: the Browser pane is not displayed`. This is not a capability
     limit, and it is not fixed by knowing about the width ceiling.
  - Above ~1024px it composites an emulated viewport into its own surface without scaling up, so a
     1280-wide page lands in about a fifth of the image. Correct, unreadable.

Playwright is headless, so the first stops applying entirely, and takes an arbitrary viewport plus
`fullPage: true`, so the second does too. A `scripts/capture-screens.mjs` that signs in against the
seeded local stack and captures the main views at three widths is ~100 lines and turns a per-sprint
manual ritual into a Gate artifact.

**Two things to carry rather than rediscover:**

  - **Playwright does not replace looking at the app.** All three defects Sprint 6 found in a browser
     came from poking around, not from assertions: a successor dropdown offering eleven under-18s,
     a lapsed team's panel reading "4 of 0", and clumsy copy at capacity. A script only checks what
     somebody already thought to check. Rule 10 still means open the app and look at it.
  - **Playwright's Chromium is not Safari.** Sprint 6's iOS zoom bug was caught by measuring computed
     styles, which Playwright does equally well — but genuine Safari zoom-on-focus behaviour wants a
     real device before you hand teams a URL.

`scripts/seed-review-states.mjs` (Sprint 6) already builds the awkward states — 12 of 15 seats, a
team at capacity with four people waiting, a grant that expired yesterday, one expiring in 9 days,
a stranded team with no admin — and refuses to run against anything but localhost. Reuse it; do not
write a second seeder.

---

## THINGS IN YOUR BRIEF THAT ARE ALREADY PARTLY DONE

  - **"Dead-letter UI reviewed (a coach can understand and retry)"** — half done. B24 added
    `SyncFailure.terminalReason`, and `SyncStatusIndicator` now renders the actual cause
    ("Your team's licence has lapsed…", "This change belongs to a season that has been archived…")
    instead of "retry when you have a connection", which was actively wrong for a lapsed licence.
    What is missing is the *review*: there is still no way to see WHICH changes are parked, only how
    many, and no way to discard one deliberately.
  - **"Offline banner wired to real connectivity state"** — `useAuth().isOffline` already exists and
    is consumed by MemberManager, InviteManager and the whole admin console to stop offering direct
    Supabase writes. The gap is a visible app-level banner, not the state behind it.
  - **The venue simulation** has a precedent worth copying: Sprint 4 verified rollover offline
    end-to-end in a browser, and Sprint 6's `sync-terminal.db.test.ts` drives the real drain against
    real refusals. Neither replaces DevTools-offline-plus-throttling by hand.

## THINGS THAT WILL BITE YOU

  - **Every existing user will be asked to re-accept the legal documents on first load after this
    deploys — including Kevin.** Sprint 6 rewrote all three documents and raised
    `ATTESTATION_VERSIONS` to 2.0, and `ReAttestationPrompt` asks when an acceptance is out of date.
    This is intended, not a bug. It is dismissible ("Later"), it never blocks the app, and the
    previous acceptance is kept rather than overwritten. Do not "fix" it.
  - **The eligibility trigger must never re-validate an existing admin.**
    `enforce_member_role_eligibility` short-circuits when `role` and `user_id` are unchanged, which
    is the only reason bumping the document versions did not lock every current admin — Kevin
    included, on the only production team — out of the console that could fix it. There is a test
    named for that property. If you touch that trigger, keep it.
  - **`anon` has EXECUTE on the admin RPCs**, via the schema's default privileges. B25's fix makes it
    harmless (an anonymous caller now gets `false` from every capability rather than NULL), but
    granting anonymous EXECUTE on team administration is wrong by default-deny. A
    `REVOKE EXECUTE ... FROM anon` sweep is a contained forward migration and wants one behavioural
    test per function. Good fit for a hardening sprint; ask Kevin if it is in scope.
  - **Local signup needs email confirmation, which is why Sprint 6's end-to-end walkthrough is only
    partly done.** The licensing halves were walked in a browser against constructed states, but not
    a fresh registration plus four real invite-and-join round trips. Inbucket is running
    (`supabase_inbucket_falconforge`) and can be read for the confirmation link, or confirmation can
    be disabled in `supabase/config.toml` for local only. This is exactly what the smoke pack should
    cover, and it closes a Sprint 6 gap for free.
  - **`.env.local` points at the HOSTED project. Do not overwrite it** (Sprint 2 did, unrecoverably).
    `.env.development.local` currently points dev at the **local** stack and is gitignored — delete
    it if you want dev against production, and **restart the server after touching env files**,
    because deleting it while Vite is running makes it fall back to `.env.local` and
    `localhost` silently starts talking to production. Verify which backend you are on before
    clicking anything: `read_network_requests` for `54321` is the two-second check.
  - **Ports 5188 and 5189 are often held by other sessions.** `.claude/launch.json` gained
    `dev-review-2` on **5190** in Sprint 6. Add another if all three are taken; do not fight over one.
  - **A stale service worker will serve you the previous `index.html` indefinitely.** Unregister it
    and clear caches before believing what you see. Sprint 6 hit this on the first page load.

## NUMBERS YOU WILL WANT

  - **Unit 470 (+2 pre-existing skips) across 36 files. Integration 87. db 364. rls 265. Schema
    assertions 20.**
  - **`as any` is 55.** Only down. Note it is measured by `grep -r 'as any' src/ | wc -l`, so English
    prose can trip it — a sentence in the privacy policy did, and was reworded.
  - Arbitrary Tailwind values still **1**, and it carries a comment explaining why it earns its place.
  - Coverage thresholds unchanged at **72 / 67 / 69 / 74**. Sprint 6 moved `src/pages/legal` off 0%;
    `Onboarding.tsx` is still a weak spot and the registration smoke flow is what touches it.
  - `MAX_SYNC_RETRIES` is 5, over a 3s/15s/60s/3m/5m backoff — roughly nine minutes. B24 means a
    refusal the client can explain no longer spends any of it.

## RULE 10, SPECIFICALLY FOR A HARDENING SPRINT

Sprint 5's suite was green over five defects that only appeared when the app was run and looked at.
Sprint 6's suite was green over three more — including a 16px iOS floor that had silently stopped
working the moment `.field` shipped, affecting **every form in the app**, and which no amount of
unit testing could have caught because jsdom does not apply `index.css`.

For a hardening sprint the equivalent of "go and look" is the venue: DevTools offline with
throttling, a full session's work queued, then reconnect and watch it drain. Plus the states a
smoke pack will not think to construct — a second device holding stale state, a session that
expires mid-edit, a service worker mid-update, an approval racing between two admins. Several of
those need constructing deliberately. Construct them.
