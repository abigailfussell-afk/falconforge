# Manual mocks

Vitest picks these up when a test file opts in with a bare `vi.mock('@/lib/<name>')` — no
factory needed. They used to live in `src/test/setup.ts` and applied to **every** unit
test whether it wanted them or not.

That was the "test truth" problem the V2 plan called out: a suite where the entire data
layer is stubbed by default cannot tell you which tests actually exercise it. A test could
pass against `queueForSync` being a no-op without its author ever knowing the real one was
never called. Worse, a mock declaring an export the real module lacks (`useSyncStatus`,
`SyncProvider` — neither has ever existed) let tests pass against an API the app cannot
call.

Opting in per file makes the dependency visible at the top of the file that has it, and
leaves everything else running against the real implementation.

`src/test/__tests__/mock-drift.test.ts` fails when a mock here declares an export the real
module does not have.
