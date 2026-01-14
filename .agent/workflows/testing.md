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

## For Changes Affecting Critical Flows

// turbo
5. **Run E2E tests** when changes affect login, authentication, navigation, or critical user flows:
   ```powershell
   npm run test:e2e
   ```

## Test File Locations

| Type | Location | Pattern |
|------|----------|---------|
| Store tests | `src/lib/__tests__/` | `*.test.ts` |
| Component tests | `src/components/__tests__/` | `*.test.tsx` |
| Page tests | `src/pages/__tests__/` | `*.test.tsx` |
| E2E tests | `e2e/` | `*.spec.ts` |

## Quick Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Run tests in watch mode |
| `npm run test:run` | Run all tests once |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run test:e2e:ui` | Run E2E tests with interactive UI |
