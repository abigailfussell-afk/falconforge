/**
 * Unit test setup.
 *
 * This file used to `vi.mock` six modules — supabase, auth, offline-db, realtime, queries
 * and sync — for every unit test in the repo, whether it wanted them or not. The whole
 * data layer was stubbed by default, so nothing could tell you which tests actually
 * exercised it, and one of the stubs declared exports (`useSyncStatus`, `SyncProvider`)
 * that have never existed in the real module.
 *
 * Those mocks now live in `src/lib/__mocks__/` and are opted into per file with a bare
 * `vi.mock('@/lib/<name>')` — one line, at the top of the file that needs it, where the
 * dependency is visible to whoever reads the test. See that directory's README.
 *
 * What is left here is genuinely ambient: matchers, and a browser API jsdom lacks.
 */
// jsdom has no IndexedDB, and Dexie throws `MissingAPIError` on contact. This used to be
// stubbed with `{ open: vi.fn() }`, which is not an implementation — it just moved the
// failure. A working in-memory one means an incidental import of anything in the Dexie
// chain behaves, and a unit test that genuinely wants to look at the queue can.
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

/**
 * Testing Library's `findBy*` / `waitFor` default to a 1s timeout.
 *
 * That is tight for components which kick off async work on mount -- Onboarding calls
 * `loadTeams()` from an effect before it renders anything assertable -- and it produced a
 * genuine flake: "shows the Complete Setup form" failed twice in eleven full-suite runs,
 * both times immediately after the database suite had loaded the machine, and passed in
 * isolation every time.
 *
 * A flaky test is worse than a missing one, because it teaches you to re-run the suite
 * instead of reading it. Five seconds still fails a component that never settles; it just
 * stops failing one that settles slowly because 200 other tests are sharing the CPU.
 */
configure({ asyncUtilTimeout: 5000 });
