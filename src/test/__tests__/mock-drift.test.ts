/**
 * Mock drift guard.
 *
 * The manual mocks in `src/lib/__mocks__/` are hand-written. Nothing used to check them
 * against the modules they replace, and they had silently drifted:
 *
 *   - `@/lib/sync` was mocked with `useSyncStatus` and `SyncProvider`, neither of which
 *     has ever existed in the real module.
 *   - `src/test/setup-integration.ts` stubbed `.gt()` while sync.ts calls `.gte()`, which
 *     meant the delta-pull path threw on contact and had never been exercised.
 *
 * A mock that exports something real doesn't is worse than no mock: a test can pass
 * against an API the app cannot call. This suite fails when a mock declares an export the
 * real module lacks.
 *
 * Partial mocks are fine and expected — a mock may export FEWER names than the real
 * module. Only extra (phantom) names are an error.
 *
 * The mocks are imported directly rather than through `vi.mock`, because they are now
 * opted into per test file rather than applied globally, so there is no ambient mocked
 * module to inspect.
 */
import { describe, it, expect } from 'vitest';

/** Manual mock → the module it stands in for. */
const MOCK_PAIRS = [
    ['@/lib/__mocks__/supabase', '@/lib/supabase'],
    ['@/lib/__mocks__/offline-db', '@/lib/offline-db'],
    ['@/lib/__mocks__/realtime', '@/lib/realtime'],
    ['@/lib/__mocks__/sync', '@/lib/sync'],
    ['@/lib/__mocks__/queries', '@/lib/queries'],
    ['@/lib/__mocks__/auth', '@/lib/auth'],
] as const;

/** Names a mock module may legitimately carry that the real module doesn't export. */
const ALLOWED_EXTRA_KEYS = new Set<string>([
    'default', // vitest synthesises a default export on some namespace objects
]);

function exportNames(mod: Record<string, unknown>): string[] {
    return Object.keys(mod).filter((k) => !ALLOWED_EXTRA_KEYS.has(k));
}

describe('manual mocks match the modules they replace', () => {
    for (const [mockPath, realPath] of MOCK_PAIRS) {
        it(`${realPath} mock declares no exports the real module lacks`, async () => {
            const mocked = (await import(/* @vite-ignore */ mockPath)) as Record<string, unknown>;
            const actual = (await import(/* @vite-ignore */ realPath)) as Record<string, unknown>;

            const actualNames = new Set(exportNames(actual));
            const phantom = exportNames(mocked).filter((name) => !actualNames.has(name));

            expect(
                phantom,
                `${mockPath} exports ${JSON.stringify(phantom)}, which ${realPath} does not. ` +
                `Either remove them from the mock, or add them to the real module.`,
            ).toEqual([]);
        });
    }

    it('every manual mock is paired with a real module', async () => {
        // A mock file added to __mocks__/ without a line above would never be checked.
        const files = import.meta.glob('/src/lib/__mocks__/*.{ts,tsx}');
        const mockNames = Object.keys(files)
            .map((path) => path.replace(/^.*__mocks__\//, '').replace(/\.tsx?$/, ''))
            .sort();
        const paired = MOCK_PAIRS.map(([mockPath]) => mockPath.split('/').pop()!).sort();

        expect(mockNames).toEqual(paired);
    });
});
