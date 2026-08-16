# Hand-off — Sprint 6: Licensing & admin console + legal

Open a fresh Opus 5 session in `C:\Claude\falconforge` and give it everything below.

*(Updated after Sprint 5.5 — the "Sprint 5.5 happened" section below amends this file;
where they disagree, the 5.5 section wins.)*

---

**FIRST: merge Sprint 5.5.** The branch `v2/sprint-5.5-ui-polish` (11 commits) is complete,
Gate-green, and reviewed in the session that built it, but not merged. Before any Sprint 6
work:

  1. `git checkout main && git merge --no-ff v2/sprint-5.5-ui-polish` with a merge message
     in the style of Sprint 5's (`332f2bd`): one line naming the sprint and its headline —
     the auth-deadlock fix and the UI primitive kit.
  2. Run the full Gate **on main after the merge** and report real output.
  3. `main` auto-deploys to falcon-forge.com on push, and this merge contains an auth-path
     fix that production users hit on every reload. **Confirm with Kevin in chat before
     pushing**, then push and verify CI + Deploy go green.
  4. Only then branch `v2/sprint-6-licensing` off the merged main.

---

Read FALCONFORGE_V2_PLAN.md §5 (engineering rules — binding) and §6 Sprint 6, then
execute Sprint 6 under those rules. Branch v2/sprint-6-licensing off main.

## Sprint 5.5 happened after this hand-off was written

A UI-polish sprint ran between Sprint 5 and you. What it changes about this brief:

  - **The 🔴 restored-session auth bug described under "will bite you" below is FIXED.**
    Root cause: `auth.tsx`'s `onAuthStateChange` callback awaited a supabase REST call while
    supabase-js still held the `sb-*-auth-token` Web Lock — the client deadlocked on itself.
    The profile sync now defers out of the callback (`setTimeout(0)`), guarded by regression
    test **B23** in `auth.test.tsx`. It will no longer interrupt your local testing. The
    narrow lesson stands for your registration work: never await a supabase call inside
    `onAuthStateChange`.
  - **A UI primitive kit exists and rule 8 extends to it: build the admin console FROM it.**
    `src/components/ui/`: `Button` (primary/secondary/danger; `busy` ties spinner to
    disable), `IconButton` (`danger` variant), `Modal` (owns overlay, `shadow-overlay`,
    named widths `sm`/`panel`/`dialog`/`wide`, dialog ARIA; `stacked` raises a confirm above
    another modal), `EmptyState`, `SectionHeader`, and the `.field` class in `index.css` for
    every input/select/textarea. `ConfirmDialog` composes it. Hand-rolling a button, modal,
    input, empty state or section header in your new screens is a regression — the kit
    exists because Sprint 5 grew eight primary-button recipes. README's design-system
    section documents it.
  - **`MemberManager.tsx` moved further** than described below: the native `confirm()` is
    now `ConfirmDialog`, Approve/Reject both use `Button busy`, the header is a
    `SectionHeader`, the empty state is an `EmptyState`, and the admin's own disabled role
    select carries a title pointing at role transfer. Still true: seat toggle wired to
    `seat_assigned`, capacity-refusal handling, and no notion of a seats total.
  - **Numbers moved:** `as any` is **55** (only down). Unit suite is **344 tests + 2
    pre-existing skips** across 28 files. Coverage thresholds unchanged at 72/67/69/74.
  - **New parking-lot items from 5.5** (§8): due dates render a day early in US timezones
    (UTC-midnight epochs rendered via local `getDate()` — pre-existing, inherited by the new
    dashboard deadlines panel); two `!px-*` important-modifier overrides on Button callers,
    with the suggested escape hatch if the pattern spreads.
  - **Local-stack conveniences left in place:** `.env.development.local` currently points
    dev mode at the **local** Supabase stack (gitignored; production keys untouched in
    `.env.local`) — delete it if you want dev against production, and mind the restart
    caveat below. `.claude/launch.json` gained a `dev-review` config on port **5189** for
    when another session holds 5188. The local stack has a seeded review account
    (`reviewer@falconforge.test` / `ForgeReview!2026-local`, team "Iron Falcons") — local
    Docker only, wiped by every `supabase db reset`.

Read first, in this order:
  - docs/sprint-5-report.md   — what just shipped, and what it leaves in your way
  - docs/v2-schema.md         — licensing section especially: `license_grants`,
                                `team_entitlement`, `team_can_write`, `enforce_seat_capacity`
  - FALCONFORGE_V2_PLAN.md §8 parking lot — NINE items name Sprint 6 by name, more than
                                any sprint so far. Read all of them before planning.

**THE SCHEMA IS FROZEN AND PRODUCTION HAS REAL DATA.** Forward migrations only. The hosted
project holds Kevin's account, his `platform_operators` row, TestTeam, and an open-ended
gift grant. A migration that drops or rewrites `license_grants` takes his own access with
it — including the operator identity that `grant_team_license` checks, which no API path can
recreate. Back up before you touch licensing tables, and read the Sprint 3 progress-log
entries about the production reset before assuming anything is disposable.

THREE DECISIONS ARE KEVIN'S, NOT YOURS. **Ask all three in your first message and wait.**
Do not infer them from the code — two of them are underdetermined *because* the code does
not answer them.

  1. **Seats are not enforced anywhere in the database, and the sprint brief assumes they
     are.** I checked: `team_can_write(team_id)` reads `license_grants` and nothing else, and
     **zero RLS policies reference `seat_assigned`** (`select count(*) from pg_policies where
     qual like '%seat_assigned%'` → 0). `enforce_seat_capacity` caps how many seats can be
     handed out; holding one grants nothing and lacking one costs nothing. So the brief's
     "unlicensed member → clear lock screen" currently has no server-side meaning, and the
     exit criterion "enforcement is server-side, not just UI" cannot be met by building the
     screen. Either seats gain RLS (a forward migration plus isolation tests, real work), or
     seats stay a billing-count concept and the lock screen becomes team-level only. This
     changes the shape of the sprint; it is not a detail.

  2. **The `sync.ts` TERMINAL classification — Sprint 6 or Sprint 7?** The plan assigns it
     here. Sprint 3 raised it, Sprint 4 deferred it, Sprint 5 deferred it, and it has now
     accumulated three cases: an unlicensed write, an archived-season write, and a write
     queued by a device that was offline during a rollover. All three are 403s from a policy
     that cannot succeed on retry, and all three currently burn five retries over nine
     minutes before dead-lettering. The drain has NO error classification at all today —
     `drainSyncQueue` has one failure path, retry-then-dead-letter, at `sync.ts:340`. Adding
     one is contained, but it is a change to the hardened engine under rule 6 in a sprint
     already carrying an admin console and a legal rewrite.

  3. **Deploy is still automatic, and this is the sprint where that gets sharp.** `main`
     deploys to falcon-forge.com on push. Sprint 6 changes who is allowed to do what, on a
     live site where Kevin is the only admin of the only team. A bug that mis-reads
     `team_entitlement` shows a lock screen to real users; a bug in the admin console can
     lock him out of the console that would fix it. §7.3 suggests manual deploys until
     Sprint 7 hardening. He declined at Sprint 5's merge and merged anyway, which was fine
     because Sprint 5 could not revoke anyone's access. Ask again — the argument is
     different now.

TWO BULLETS IN YOUR BRIEF ARE ALREADY DONE, AND ONE IS HALF DONE.

  - "Operator gifting flow (SQL function ...)" — `grant_team_license(p_team_id, p_seats,
    p_valid_until, p_notes)` exists, is operator-gated via `is_platform_operator()`, and has
    been exercised end to end on production (see the progress log: it refused a caller with
    no operator identity and accepted Kevin). What is missing is only the **UI**.
  - "`platform_operators` starts empty and Kevin must insert his row" — done on production.
    Do not write a migration that seeds it; the table ships empty by design and no API path
    can write it.
  - Half done: `pullEntitlement` in `server-pull.ts` already reads the view into the store
    (`createTeamSlice.ts` holds `entitlement` and `TeamEntitlement`). **Exactly one component
    consumes it** — `SeasonManager`, for the rollover guard. Every other enforcement surface
    is unbuilt.

Sprint 5 context you cannot infer from the code alone:

  - **`MemberManager.tsx` is the screen you are rewriting, and it is not a blank slate.** It
    already has a per-row seat toggle wired to `seat_assigned`, disabled for non-admins with
    a title explaining why, and it already handles the `enforce_seat_capacity` refusal. What
    it does not have is any notion of a total — the brief's "12 of 15 seats" needs
    `team_entitlement.seats_total` / `seats_used`, which are in the store already. Read the
    existing component before replacing it; the trigger interaction is the part that took
    the time.

  - **There is one nav definition now: `src/lib/navigation.ts`.** The sidebar rail, the
    mobile drawer and the route table are three renderings of one array. An admin-console
    sub-page is added THERE, not in three places. `Dashboard.test.tsx` asserts every nav
    entry appears **exactly once** in the DOM (`getAllByTestId('nav-<id>')` length 1) — if
    you add nav items, keep that property, because it is the only thing stopping the
    duplicated-sidebar problem coming back.

  - **The "expired team → read-only banner" has a pattern to follow and a trap to avoid.**
    `ArchivedSeasonBanner` renders exactly once, in `AppShell` above the `<Outlet>`, because
    every route below it is season-scoped. The licence banner belongs in the same place for
    the same reason. **Do not merge it with the archived-season banner or with
    `useSeasonScope`.** `season-scope.ts` carries a comment explaining why it deliberately
    does NOT consult entitlement: a lapsed licence and an archived season are different
    refusals with different fixes ("renew" vs "switch to this year"), and collapsing them
    produces a UI that cannot tell the user which one they are looking at. Decide what a
    team that is BOTH archived-season and lapsed sees; do not let it be two stacked banners
    by accident.

  - **`useCurrentUser` and `user-context.tsx` are gone.** The profile, the offline flag and
    the display-name derivations live on `useAuth()` now: `profile`, `displayName`,
    `initials`, `isOffline`. `MemberManager` and `InviteManager` already use
    `useAuth().isOffline` to stop offering writes that go through Supabase directly rather
    than through the sync queue — that distinction matters for you, because seat assignment
    is one of those direct writes and "offline" really does mean "not now" for it.

  - **Design tokens exist and rule 8 now has teeth.** `forge-*` (the brand ramp),
    `text-2xs`, `shadow-card`/`raised`/`overlay`, `max-w-prose`/`panel`/`dialog`/`wide`/`app`,
    `touch-target`, `.hide-when-short`. There is exactly **one** arbitrary value left in
    `src/`, and it carries a comment explaining why it earns its place. Do not start a second
    collection. README has a design-system section describing all of it.

  - **The 16px form-control floor is load-bearing.** `text-base` is 14px, and `index.css`
    floors `input`/`select`/`textarea` at 16px under `pointer: coarse`, because iOS Safari
    zooms the viewport on focus below that and does not zoom back. You are building the most
    form-heavy screens in the app (registration, attestation, seat assignment). Do not
    "fix" the inconsistency by removing the floor.

Numbers you will want:

  - **Coverage thresholds are 72 / 67 / 69 / 74** (statements / branches / functions /
    lines) in `vitest.config.coverage.ts`. Ratchet, never lower. Note `src/pages/legal` is
    currently **0% covered** across all three files — if you rewrite them as the brief says,
    you will move that number, and `Onboarding.tsx` (59% statements, 23% functions) is the
    other weak spot and is exactly what the registration-flow work touches.
  - **`as any` is 55 after Sprint 5.5.** Only down.
  - **`test:rls` is 261 assertions and `test:db` is 320.** Both are back in your Gate:
    you will be writing migrations, so `db:verify` (needs Docker) and `test:rls` apply.
  - **Legal pages are 81 / 97 / 114 lines** — small, so a rewrite is cheap. Attestation
    versioning is the part with teeth, not the prose.
  - **`SIGNUP_REQUIRED_ATTESTATIONS`, `COACH_REQUIRED_ATTESTATIONS` and
    `MEMBER_REQUIRED_ATTESTATIONS`** in `lib/attestations.ts` still have no consumers. They
    were left in place *for this sprint's registration flow* — use them or delete them, but
    do not leave them for a fourth sprint.

Three things outside your scope that will bite you:

  - ~~A restored session can drop you on "Almost Done!..."~~ — **FIXED in Sprint 5.5** (see
    the section at the top). Kept here so you know the paragraph's absence from your local
    testing is expected, not luck. B23 in `auth.test.tsx` is the regression test; treat
    `onAuthStateChange` as a no-supabase-calls zone.

  - **`.env.local` points at the HOSTED project. Do not overwrite it** (Sprint 2 did, and it
    was unrecoverable). For local work write `.env.development.local`, which takes priority
    in dev mode and is gitignored, and delete it when you are done. **Note the failure mode
    Sprint 5 hit:** deleting it while the dev server is running makes Vite fall back to
    `.env.local`, so `localhost:5188` silently starts talking to **production**. Restart the
    server after touching env files and verify which backend you are on before clicking
    anything. There is a `dev` config in `.claude/launch.json` on port 5188.

  - **Screenshots above ~1024px cannot be captured through the Browser pane.** It composites
    an emulated viewport into its own surface without scaling up, so a 1280-wide page renders
    into about a fifth of the image — correct, but unreadable. 375 and 768 are fine, 1024 is
    marginal. If your exit criteria need wide captures, ask Kevin to widen the pane first
    rather than discovering it at the end. Also: a stale service worker will serve you the
    previous `index.html` indefinitely; unregister it and clear caches before believing what
    you see.

Rule 10 mattered in a specific way this time, and it will again. Sprint 5's suite was green
over five defects that only appeared when the app was actually run and looked at — an empty
checklist that rendered nothing, a phone keyboard that squeezed the nav to a 24px sliver, and
a Tailwind breakpoint that silently generated **no CSS at all**, so a class compiled to plain
`hidden` and an element was invisible at every size. DOM measurements did not catch that one;
a screenshot did. Two of the eleven deliberately-reintroduced defects were NOT caught by the
tests that were supposed to catch them, and both were worth more than the nine that were.

For a licensing sprint the equivalent of "go and look" is not the happy path either. It is:
the team whose grant expired **yesterday**; the member with no seat on a team with seats to
spare; the admin who is the only admin; the operator page seen by somebody who is not an
operator; a lapsed team that is also browsing an archived season; and the offline device that
does not yet know any of it. Several of those are states you have to construct deliberately
in the database, because no UI can reach them. Construct them.
