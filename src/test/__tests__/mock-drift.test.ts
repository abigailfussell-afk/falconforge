/**
 * Mock drift guard.
 *
 * The global mocks in `src/test/setup.ts` are hand-written. Nothing used to check
 * them against the modules they replace, and they had silently drifted:
 *
 *   - `@/lib/sync` was mocked with `useSyncStatus` and `SyncProvider`, neither of
 *     which has ever existed in the real module.
 *   - `src/test/setup-integration.ts` stubbed `.gt()` while `sync.ts` calls `.gte()`,
 *     which meant the delta-pull path threw on contact and had never been exercised.
 *
 * A mock that exports something real doesn't is worse than no mock: a test can pass
 * against an API the app cannot call. This suite fails when a mock declares an export
 * the real module lacks.
 *
 * Partial mocks are fine and expected — a mock may export FEWER names than the real
 * module. Only extra (phantom) names are an error.
 */
import { describe, it, expect, vi } from 'vitest';

/** Modules mocked globally in setup.ts, and therefore at risk of drift. */
const MOCKED_MODULES = [
    '@/lib/supabase',
    '@/lib/offline-db',
    '@/lib/realtime',
    '@/lib/sync',
    '@/lib/queries',
    '@/lib/auth',
] as const;

/** Names a mock factory may legitimately add that the real module doesn't export. */
const ALLOWED_EXTRA_KEYS = new Set<string>([
    'default', // vitest synthesises a default export on some namespace objects
]);

function exportNames(mod: Record<string, unknown>): string[] {
    return Object.keys(mod).filter((k) => !ALLOWED_EXTRA_KEYS.has(k));
}

describe('global mocks match the modules they replace', () => {
    for (const specifier of MOCKED_MODULES) {
        it(`${specifier} declares no exports the real module lacks`, async () => {
            const mocked = (await import(specifier)) as Record<string, unknown>;
            const actual = (await vi.importActual(specifier)) as Record<string, unknown>;

            const actualNames = new Set(exportNames(actual));
            const phantom = exportNames(mocked).filter((name) => !actualNames.has(name));

            expect(
                phantom,
                `Mock for ${specifier} exports ${JSON.stringify(phantom)}, which the real ` +
                `module does not. Either remove them from the mock factory in ` +
                `src/test/setup.ts, or add them to the real module.`,
            ).toEqual([]);
        });
    }
});
