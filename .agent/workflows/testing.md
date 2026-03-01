---
description: How to run tests and update tests after code changes
---

# Testing Workflow

## After Making Code Changes

1. **Run unit and component tests** to verify your changes don't break existing functionality:
   ```powershell
   npm run test:run
   ```

2. **If tests fail**, fix the failing tests or the code that broke them before proceeding.

3. **If you modified a function or component that has tests**, update the test file to cover your changes:
   - Store functions: `src/lib/__tests__/store.test.ts`
   - Components: `src/components/__tests__/<ComponentName>.test.tsx`

4. **For new features**, create tests in the appropriate `__tests__` directory following existing patterns.

## For Changes Affecting Data Sync

// turbo
5. **Run integration tests** when changes affect store actions, sync, or data transformations:
   ```powershell
   npm run test:integration
   ```

Integration tests are in:
- `src/lib/__tests__/store-sync.integration.test.ts` - Store → sync queue tests
- `src/lib/__tests__/data-transform.integration.test.ts` - camelCase/snake_case tests

## Test File Locations

| Type | Location | Pattern |
|------|----------|---------|
| Store tests | `src/lib/__tests__/` | `*.test.ts` |
| Integration tests | `src/lib/__tests__/` | `*.integration.test.ts` |
| Component tests | `src/components/__tests__/` | `*.test.tsx` |
| Page tests | `src/pages/__tests__/` | `*.test.tsx` |

## Quick Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Run tests in watch mode |
| `npm run test:run` | Run all unit tests once |
| `npm run test:integration` | Run integration tests |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run test:all` | Run all tests (unit + integration) |

## Adding data-testid for Testing

When adding new interactive elements, always include `data-testid` attributes:

```tsx
<button data-testid="my-button">Click Me</button>
<input data-testid="search-input" />
```

Then in component tests, use:

```typescript
screen.getByTestId('my-button');
screen.getByTestId('search-input');
```
