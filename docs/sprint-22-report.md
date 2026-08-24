# Sprint 22 — the September list

**Branch:** `v2/sprint-22-september-list`
**Commits:** `8fc2878..485c4c0` (eight), off `main` at `377b607`
**Ratchets:** `as any` **55 → 55**, arbitrary Tailwind values **2 → 2**, `dark:text-slate-500`
**0**, no `describe.skip`, no assertion-free tests. Coverage **68.64 / 61.41 / 64.25 / 70.51**
against floors 68 / 60 / 63 / 70.

Eight IDs: `WALK-B-06`, `WALK-B-07`, `WALK-B-10`, `FEAT-14`, `OPS-08`/`SYNC-12`, `OPS-12`,
`OPS-14`/`OPS-15`, and the backup restore.

---

## Gate

`npm run gate:db` exits 127 part-way on this machine (`HANDOFF_BUILD.md`, environment traps), so
every stage was run individually. Numbers are from the final state of the branch.

| Stage | Command | Result |
|---|---|---|
| lint | `npm run lint` | clean, 16.9 s |
| unit | `npx vitest run` | **89 files, 1074 passed**, 2 skipped, 21.1 s |
| integration | `npx vitest run --config vitest.config.integration.ts` | **9 files, 95 passed**, 4.8 s |
| build | `npm run build` | ok, 14.9 s — precache **45 entries (1583.05 KiB)** |
| schema | `npm run db:assert` | `schema assertions passed` |
| db | `npx vitest run --config vitest.config.db.ts` | **29 files, 645 passed**, 95.1 s (was 642 — three new) |
| RLS | `npx vitest run --config vitest.config.db.ts rls` | **6 files, 418 passed**, 16.4 s |
| e2e | `npx playwright test` | **36/36** (was 35 — one new), 1.6 min, chromium + mobile |
| coverage | `npm run test:coverage` | **127 files, 1814 passed**, thresholds met |

`npx supabase db reset --local` before each database run, per the fixture-collision trap.

No intermittents this sprint. One genuine failure during the run, from the suite rather than
from a person, and it is worth recording because it is the one channel this project's own
statistics say never catches anything: **`harness-invariants` rejected my new e2e spec for using
`Date.now()`**, which is the ratchet added after Sprint 8's clock defects. It was only generating
a unique team number; the rule is right and the spec uses `uniqueTeamNumber()` now.

---

## Exit criteria

**None of the eight IDs has an exit-criteria block.** Checked
`docs/assessment-2026-08/exit-criteria.md` by grep for each ID *and* for the subject of each
(`precache`, `sub-team`, `rename`, `maxLength`, `Welcome back`, `badge`, `audit`, `runbook`,
`setup`) — zero hits, so this is not Sprint 19's mistake of missing a shared bullet. **The
criteria below are mine.**

### WALK-B-06 — the first sentence a new coach reads

> A team with nothing in it is not greeted as a returning visitor, and is told what to do
> instead. A team with work in it still says "Welcome back". Neither is claimed while the
> app does not yet know which it is.

Verified in a real browser against a real build (`npx vite build --mode development`, served by
`vite preview`, worker cleared first): a fresh team shows `Welcome, Iron! 👋` and
"Nothing has been added yet — plan your first sprint below, or read the getting-started guide";
after adding one task through the board it shows `Welcome back, Iron! 👋`. The third clause is
the one that took two attempts — see **What running the app found**.

### WALK-B-07 — one badge, showing the team's number

> Both screens that render a team-number badge render the same string, and that string is the
> whole number. It fits inside the badge at 375 px without clipping, wrapping, or pushing
> anything out of its row.

Verified: the onboarding picker and the sidebar rail both render `#12345` for team 12345 (was
`#345` and `#12` respectively). Measured in the browser — `md` pill 66.5 × 40 with `min-width`
resolving to 40 px, text 50.5 px, no overflow; `sm` pill 54.7 × 28 with `min-width` 28 px inside
a 255 px row, team name unclipped, no horizontal page scroll at 375 px. Held by
`e2e/team-badge.spec.ts`.

### WALK-B-10 — a child's name has a length

> `managed_profiles.full_name` is capped at the same number as the other eight name columns, in
> the column and at the input, and the two cannot drift apart silently. A 142-character name can
> no longer be typed, and a capped one cannot break a layout.

Verified as the guardian in the browser: `maxlength="120"` on the input, and typing the
walkthrough's own 142-character emoji name through the browser's editing path
(`execCommand('insertText')`, which respects `maxlength` exactly as a keystroke or a paste does)
produced **120 characters**. The column refuses 121 through PostgREST as the guardian.

### FEAT-14 — sub-teams can be renamed

> A sub-team's name can be corrected in place, keeping its member assignments; Cancel and Escape
> discard; an archived season refuses, and the control says why.

Verified in the browser at 375 px: created "Programing", opened the rename, typed something else,
**Cancel left the name unchanged**, then renamed to "Programming" — which reached the server
(`select name from sub_teams` → `Programming`). Controls measure 44 × 44, input 16 px (above the
iOS zoom floor), no horizontal page scroll.

### OPS-08 / SYNC-12 — the precache

> The precache is under 2 MB, no two files in `public/` are the same bytes, every manifest icon
> is the size it is declared at, and nothing in the source names a file that is not there.

| | before | after |
|---|---|---|
| precache | 5213.30 KiB, **49 entries for 46 unique URLs** | **1583.05 KiB, 45 for 45** |
| `dist/` | 5,357,696 B | **1,640,120 B** |
| `falcon_logo.png` | 802,825 B, 1024² | 10,022 B, 256² |
| `icon-192.png` | 802,825 B, **1024²** while declared 192×192 | 7,287 B, 192² |
| `icon-512.png` | 802,825 B | 23,026 B |
| `hero_bg.png` | 595,652 B | **deleted** → `hero_bg.webp`, 46,670 B |
| `logo.png` | 802,825 B | **deleted** (`apple-touch-icon` → `icon-192.png`) |

**69.6 % smaller.** Four files shared md5 `f74e417a`; that is now impossible. Verified in the
browser: `/icon-192.png` loads at 192×192, `/hero_bg.webp` at 640×640, `falcon_logo.png` at 256²
rendered at 28 px, and `/logo.png` 404s.

### OPS-12 — dependencies, fixed or accepted in writing

> `npm audit --omit=dev` is the number that matters and every finding in it is either fixed or
> accepted with a reason naming why it does not reach a browser.

19 → **18** total; **4 → 3** with `--omit=dev`. Written up in `docs/beta-ops.md` →
**Dependencies**. Both production findings named there:

- **`ws` 8.18.3 (high)** — realtime-js's *Node* transport. `grep -c
  'Sec-WebSocket-Accept\|permessage-deflate' dist/assets/*.js` → **0 in all 34 assets**. Fixed in
  supabase-js ≥ 2.112; not taken, see below.
- **react-router 6.x (moderate ×2)** — no fix inside 6.x. The SSR one is unreachable (no server
  rendering, no `createStaticHandler`). The backslash open redirect is unreachable through a
  HashRouter, and `readReturnTo` refuses a backslash now anyway.

`react-router-dom` 6.30.3 → 6.30.6 closes the `//` open redirect.

### OPS-14 / OPS-15 — the runbooks and the fresh clone

> The three missing runbook scenarios exist, written as steps someone can follow during an
> incident; the fresh-clone fragilities are fixed rather than described.

Five new sections in `docs/beta-ops.md`: migration failure, dead-letter triage, licence
operations, the admin who has left, and site-down/project-paused triage. OPS-15: the `supabase`
devDependency is pinned exactly and a new invariant holds all four pins equal; README lists
everything that needs Docker and warns that a global CLI on PATH wins over the pinned one.

### The restore

> A backup is decrypted, loaded, and the rows are counted — and the count is compared against
> what went in, not just reported.

`scripts/restore-rehearsal.mjs`, run over the hosted dump taken today: **0 psql errors, 65 of 65
rows**. Details below.

---

## Red tests, each watched failing

Every one was watched red with the fix reverted and green with it back.

| Test | Reverted | What it said |
|---|---|---|
| `team-badge.test.tsx` (6) | `slice(0, 2)` back in `teamBadgeLabel` | 5 of 6 red — `expected '#30' to be '#30727'` |
| `dashboard-greeting.test.tsx` "does not claim a previous visit" | "Welcome back" made unconditional | red — `expected 'Welcome back, Team Member! 👋' to contain 'Welcome,'` |
| …"while the store is still rehydrating" | the `!hydrated` gate removed | red — `expected 'Your team is set up…' not to match /getting-started/i` |
| …"while the first server pull is still running" | `isPulling` removed from the gate | red, same message |
| `child-name-length.db.test.ts` "REFUSES a name one character over" | `ALTER TABLE managed_profiles DROP CONSTRAINT …` on the live local DB | red — `expected null not to be null` |
| `title-length-limits.test.ts` "caps managed_profiles.full_name" | the migration file removed | red |
| …"AddChildDialog caps its title input" | the `maxLength` removed | red |
| `sub-team-rename.test.tsx` (11) | `renameSubTeam` made a no-op | 3 red |
| … | the `canWriteToSeason` guard removed from the slice | 1 red |
| … | `disabled={!canEdit}` removed from the pencil | 1 red |
| … | the rename input wired straight to the store | **2 red** — Cancel and Escape |
| `harness-invariants` "no two files in public/ with identical bytes" | `logo.png` restored | red — `icon-512.png == logo.png` |
| …"declares each PWA icon at the size the file actually is" | the 1024² icon put back | red — `icon-192.png is declared 192x192 and is 1024x1024` |
| …"resolves every public asset the source names" | `index.html` pointed back at `logo.png` | red — `named in source and absent from public/: logo.png` |
| …"pins the devDependency exactly and matches every workflow" | the caret restored | red — `supabase is "^2.114.0"` |
| … | `ci.yml` drifted to 2.115.0 | red — `these setup-cli steps do not pin 2.114.0: … ci.yml:2.115.0 …` |
| `return-to.test.ts` "REFUSES a backslash-prefixed URL" | the backslash guard removed | red — `expected '/\evil.example' to be null` |
| `e2e/team-badge.spec.ts` | badge restored to a fixed 28 px circle | red — `the number starts before the pill does` |

The three that would otherwise have been decoration are worth naming. The Cancel/Escape pair is
red only when the input writes through to the store — the shape FEAT-04 has live in
`SprintTaskDetail` today, so writing the rename the obvious way would have shipped the same
defect twice in one repo. The icon-size check reads the PNG's IHDR header, so it cannot be
satisfied by the declaration it is checking. And the e2e geometry assertion is the only one of
the eighteen that jsdom is incapable of expressing.

---

## What running the app found, and the suite did not

### The greeting was still lying, for a different reason

Five green tests, and the fix was still wrong. Signing in on a cold device against a real build
and sampling the header every 100 ms:

```
102 ms   "Welcome, Iron! 👋   Your team is set up … Nothing has been added yet"
212 ms   "Welcome back, Iron! 👋"
```

Iron Falcons has work in it. There are **two** kinds of "not yet" and the first version handled
one: IndexedDB rehydration, which `useStoreHydrated()` covers, and the **first server pull**,
which it does not. On a device that has never seen this team — a new laptop, a cleared browser,
the shared pit tablet — rehydration finishes instantly with nothing in it and the data arrives
from the server a moment later. A tenth of a second on localhost is a wink; the same window on
venue wifi is a coach's whole first impression, and what it says is that their team is empty.

Every one of the five tests had the store already populated by the time it rendered, which is
`docs/failure-modes.md` §2 in its purest form: satisfied by a state the defect also produces.

Re-measured after gating on `isLoading` (set for the duration of `fetchTeamData`), same
procedure, same build:

```
 26 ms   "Welcome, Iron! 👋   Your robotics Command Center is ready."   (neutral)
301 ms   "Welcome back, Iron! 👋"
```

The new-team copy never appears for a team that has work.

### A class in the DOM with no effect, in this sprint's own new code

The rename input was written `className="field flex-1 min-w-0 py-1 text-sm"` and measured **16
px** in the browser: `.field` carries the iOS zoom floor and outranks a utility. `text-sm` was
doing nothing — `docs/failure-modes.md` §5's entire subject, reintroduced by the sprint reading
about it. Removed.

### The service worker was serving the previous build

`index-Dn_LlK9u.js` was on screen while `index-h5Wupz2i.js` was on disk. Exactly
`docs/environment-divergences.md` §4. Every measurement in this report was taken after
unregistering the worker and clearing the caches, and after confirming the loaded script matched
`dist/`.

### The seeded review team has nothing in it

`seed:review` creates five teams with **0 tasks, 0 scouting reports and 0 match plans** between
them. Any dashboard check written against that seed compares zero to zero — which is what
`HANDOFF_BUILD.md` warns about, met in the first ten minutes. The "Welcome back" half of
WALK-B-06 could not be verified against the seed at all; it needed a task created through the
board first.

---

## The restore, turned from believed into known

`scripts/restore-rehearsal.mjs` runs the whole path in `backup.yml`'s own order — assert the dump
carries `auth.users` and `public.teams`, `gpg --symmetric --cipher-algo AES256`, shred the
plaintext, decrypt, empty a **local** target, restore with the trigger-disable blocks — and then
**counts every table on both sides and diffs them**. It exits non-zero on any shortfall.

That last step is the whole point: every restore failure this project has recorded exited 0. The
schema-only dump exited 0. So did the restore that produced 32 teams and no members.

**Run 2026-08-23** over `backups/falconforge-2026-08-23-1604.sql` (the hosted database, dumped
today; 167,833 bytes, 17 INSERT statements) into the local stack:

```
0 psql errors
teams 2, seasons 2, team_members 3, sub_teams 10, tasks 2, meetings 29, checklists 2,
invites 2, license_grants 4, platform_operators 1, user_attestations 6, users 2
TOTAL 65 in the dump, 65 restored
```

**The script's own first run reported OK over `0 expected / 65 restored`** — its dump parser was
line-oriented and the CLI puts `VALUES` at the end of a line with the tuples on the lines after
it. Comparing zero to zero, inside the script written to stop exactly that. It now refuses to run
when the dump contains `INSERT INTO public.*` and the parser finds no rows in them.

### The documented trap did not reproduce, and the reason is nameable

`docs/beta-ops.md` has said since Sprint 14 that `SET session_replication_role = replica` is
denied to Supabase's `postgres` role, so a data-only restore loads with triggers live and rows
are silently rejected. `HANDOFF_BUILD.md` repeats it.

Measured today on the current local image (PostgreSQL 17.6): `postgres` is **not** a superuser
(`rolsuper = f`, `supabase_admin` is), `has_parameter_privilege('postgres',
'session_replication_role', 'SET')` is **false** — and the `SET` **succeeds**. Restoring the same
dump with the trigger blocks removed recovered all 65 rows and reported 0 errors.

The mechanism is **`supautils`**, the Supabase extension that gives one nominated role elevated
GUC access: `supautils.privileged_role = postgres` locally, and
`supautils.privileged_role_allowed_configs` contains `session_replication_role`.
`has_parameter_privilege` knows nothing about supautils, which is why it disagrees with what
actually happens. Read on the **hosted** project with `supabase db query --linked`: the same
allow-list contains it, but the privileged role there is `supabase_privileged_role`, of which
`postgres` is a member. **Whether membership is enough was not tested**, because testing it means
running a `SET` against production.

A control test isolated it further: a fresh role with only `pg_create_subscription` is refused
(`permission denied to set parameter "session_replication_role"`), so it is not role membership
in the Postgres sense.

**The trigger-disable blocks stay.** Not because the setting is refused — locally it is not — but
because a restore should not depend on a mechanism nobody can name, and because whatever produced
the earlier 32-teams-and-no-members result is unexplained. Both facts are now in `beta-ops.md`.

`docs/environment-divergences.md` §5 corrected in the same pass: it said schema assertions run as
"the superuser", and `postgres` is not one. What makes it blind to a permission gap is
`rolbypassrls` plus `pg_read_all_data`.

---

## Deduplication, treated as defect-finding

Two dedup passes, and the project's rule held both times.

**`TeamBadge`** replaced two implementations that disagreed about which digits to discard. The
divergence was the defect: team 30727 was `#30` in the rail and `#727` in the picker, and both are
valid-looking FTC numbers belonging to other teams. The truncation existed *because of the
layout* — `#30727` does not fit in a 28 px circle — so the fix had to change the shape, not just
delete a `slice`. It is a pill that grows with its text; there is deliberately no `truncate`,
because a clipped team number reads as a different valid team number.

**`useStoreHydrated`** threw when `store.persist` was absent. zustand attaches it only when its
storage resolves, and `createJSONStorage(() => indexedDBStorage)` is `undefined` under any test
file whose inline `vi.mock` of `offline-db` omits that export — **five do**. The throw took the
whole dashboard route into its error boundary. The hook now reads `persist?.hasHydrated() ?? true`,
which is the honest answer: with no persistence there is nothing to wait for.

---

## What was NOT done, and why

- **`@supabase/supabase-js` 2.89 → 2.112**, which would have closed the `ws` advisory. 2.112
  parses the `select()` string at the type level; the one data path builds that string at runtime
  from the entity registry, so the row type resolves to `never` and **six `tsc` errors** appear in
  `sync.ts` and `server-pull.ts`. Those are the two files CLAUDE.md principle 2 protects. Making
  them typecheck needs either a `never`-shaped cast in the sync engine or a real refactor of the
  read path, and either belongs in a change with the B1–B26 regression suite as its evidence. The
  advisory it closes does not ship. Pinned at `2.89.0` exactly so `npm install` cannot take it by
  accident. Parked with the numbers.
- **`DecodeField.png` (226,695 B)** left alone. It is the match planner's field image and is
  needed offline; the precache target was met without touching it, and re-encoding a diagram is a
  visual change with no measurement behind it.
- **A restore of a real encrypted nightly artifact.** The rehearsal encrypts and decrypts with a
  throwaway passphrase, so it proves the gpg round trip but not that `BACKUP_PASSPHRASE` opens the
  file GitHub is holding. Recorded in `beta-ops.md` as fifteen minutes' work worth doing before an
  incident asks for it.
- **The nine unprotected member-name render sites** found while checking WALK-B-10's rendering
  half. Parked with the exact list; the two guardian-facing ones and the shared `ConfirmDialog`
  were fixed, since those are where a child's name lands.

---

## Files

New: `src/components/ui/TeamBadge.tsx`, `scripts/restore-rehearsal.mjs`,
`supabase/migrations/20260830000000_walk_b10_child_name_length.sql`,
`src/test/db/child-name-length.db.test.ts`, `e2e/team-badge.spec.ts`,
`src/components/__tests__/{team-badge,dashboard-greeting,sub-team-rename}.test.tsx`,
`public/hero_bg.webp`.

Deleted: `public/logo.png`, `public/hero_bg.png`.

35 files changed, 2,046 insertions, 74 deletions.
