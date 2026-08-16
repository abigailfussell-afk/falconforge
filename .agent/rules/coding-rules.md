---
trigger: always_on
---

## Credentials

**Never put a password, key or token in this repository.** It is a PUBLIC repository, so
anything committed here is world-readable, and removing it from the working tree does not remove
it from the git history.

This file previously contained the plaintext password for a real account — the one holding the
`platform_operators` row on production — together with its email address. It has been removed
and the password must be treated as compromised and rotated. See `docs/sprint-7-report.md`.

For local browser testing, use the seeded accounts, whose passwords are local-only by
construction and worthless anywhere else:

```bash
npm run seed:review   # awkward licensing states; see the script for the accounts
npm run seed:demo     # one ordinary populated team: demo@falconforge.test
```

## Ports

There is no single fixed port. `.claude/launch.json` defines `dev` (5188), `dev-review` (5189)
and `dev-review-2` (5190), because parallel sessions contend for them; the Playwright smoke pack
serves a real build on 5199. The old instruction to "always use port 3000" was wrong and is
gone — 3000 is only the default in `vite.config.ts`, which nothing uses.

**Check which backend you are talking to before clicking anything.** `.env.local` points at the
HOSTED project and `.env.development.local` (gitignored) points dev at the local stack, so a
deleted file silently sends localhost to production. `read_network_requests` filtered on `54321`
is the two-second check. The capture, smoke and venue scripts all refuse at the network layer
rather than trusting configuration.

## Testing requirements

After making any code changes:

1. `npm run test:run` — unit and component tests.
2. Update the corresponding test file when you modify something that has tests.
3. New behaviour ships with a test that fails without it; a bug fix gets a regression test named
   for the bug.
4. Fix failures rather than deleting or skipping them.
5. For sync or data-transformation changes, also `npm run test:integration` and `npm run test:db`.
6. For UI work, run the app and look at it. `npm run capture` produces screenshots at
   375/768/1280 and `npm run venue` simulates a competition; neither replaces looking.

The full Gate is in `CLAUDE.md`, which is the binding version of all of this.
