---
name: Refactoring Patterns
description: Guide the agent through safe refactoring of large files
---

# Refactoring Patterns Skill

This skill documents the safe approach to refactoring large files in this codebase, prioritizing the preservation of existing functionality and test coverage.

## General Principles

1.  **Tests First**: Never refactor an untested file without first ensuring baseline functionality is covered by tests, or explicitly discussing the risk with the user.
2.  **Incremental Changes**: Make small, verifiable changes rather than massive rewrites in a single commit.
3.  **Verify After Each Step**: Run tests after extracting a component or function. Do not wait until the entire refactoring is done.

## Extracting a Sub-Component

When a component grows too large (e.g., > 300 lines), follow these steps to extract sub-components (like views, forms, or list items):

1.  **Identify the Boundary**: Determine exactly what state and props the sub-component needs. Minimise the data passed in.
2.  **Create the File**: Create a new file in the appropriate directory (usually next to the parent component, or in a `components/` subdirectory if there are many). Name it descriptively (e.g., `ComponentNameSubview.tsx`).
3.  **Define Props**: Create an interface for the props (e.g., `ComponentNameSubviewProps`).
4.  **Copy and Adapt**: Copy the JSX and necessary local state/handlers from the parent.
5.  **Pass State/Actions**:
    *   **Local State**: Pass down via props (e.g., `isOpen={isOpen}`).
    *   **Store State**: The sub-component should use its own Zustand selectors to read from the store `useAppStore(s => s.data)` unless passing props is significantly simpler.
6.  **Update Parent**: Replace the extracted JSX in the parent with the new `<ComponentNameSubview />`.
7.  **Update/Create Tests**:
    *   Ensure the parent component's tests still pass.
    *   Create dedicated tests for the new sub-component, mocking the store if it uses it directly.

## Splitting a Zustand Store

When `store.ts` becomes a monolith, consider splitting it using Zustand's slice pattern.

1.  **Identify Slices**: Group related state and actions (e.g., `createTaskSlice`, `createAuthSlice`).
2.  **Create Slice Files**: Create separate files for each slice (e.g., `src/lib/slices/taskSlice.ts`).
3.  **Define Slice Types**: Each slice should have its own State and Actions interface.
4.  **Implement Slice**:
    ```typescript
    import { StateCreator } from 'zustand';
    import { AppState } from '../store';

    export interface TaskSlice {
        tasks: Task[];
        addTask: (task: Task) => void;
    }

    export const createTaskSlice: StateCreator<AppState, [], [], TaskSlice> = (set, get) => ({
        tasks: [],
        addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),
    });
    ```
5.  **Merge in Main Store**: Use `...createTaskSlice(set, get, api)` in the main `useAppStore` definition in `store.ts`.

## Extracting Shared Utilities

When you notice identical helper functions (e.g., formatting names, calculating derived data) in multiple components:

1.  **Create a Utility File**: Create a new file in `src/lib/` with a descriptive name (e.g., `member-utils.ts`, `date-utils.ts`).
2.  **Export the Function**: Move the logic there and export it. Ensure it has correct TypeScript types.
3.  **Import Everywhere**: Replace the local implementations in the components with imports from the new utility file.
4.  **Write Unit Tests**: Add a test file `src/lib/__tests__/[utility].test.ts` to test the logic comprehensively.

## Refactoring Checklist

Before completing a refactoring task, ensure:
*   [ ] `npm run build` succeeds without TypeScript errors.
*   [ ] `npm run test:run` passes (all unit/component tests).
*   [ ] `npm run test:integration` passes (if sync logic was touched).
*   [ ] All extracted components have their own test files.
*   [ ] Reusable utility functions have their own test files.
