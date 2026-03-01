---
name: Component Decomposition Guide
description: Prevent components from growing beyond ~300 lines
---

# Component Decomposition Guide

This skill provides guidelines and thresholds to prevent the creation of "God Components." Keeping components small ensures they are easily understood, highly reusable, and thoroughly testable.

## The Rule of 300

**Maximum Component Size: ~300 lines.**

If a component file exceeds 300 lines, it is almost certainly doing too much. It must be refactored.

## Signals That a Component Needs Splitting

1.  **Multiple Inline Sub-Components**: If you see functions returning JSX within the main component function (e.g., `const renderHeader = () => <header>...</header>`), extract them into their own files.
2.  **Complex State Management**: If a component has many `useState` hooks managing different domain objects, isolate that logic.
3.  **Extensive Prop Drilling**: If you are passing many props down purely to satisfy a deeply nested block of JSX, that block should be its own connected component.
4.  **Distinct Visual Sections**: Examples: A Dashboard containing a Sidebar, a Header, a Content Area, and a Footer. Each should be a distinct file.
5.  **Variations**: A Kanban board component that also has a "List View" and "Calendar View" in the same file. Each view should be its own component.

## How to Split Effectively

### 1. By Feature/View

*   `SprintPlanning.tsx` -> `SprintBoardView.tsx`, `SprintListView.tsx`, `SprintCalendarView.tsx`

### 2. By Form/Interaction

If a modal or form logic is complex, pull it out:
*   `AdminSettings.tsx` -> `InviteUserModal.tsx`, `SubTeamManager.tsx`

### 3. By List/Item

If rendering a complex list, extract the item:
*   `ScoutingReports.tsx` -> `ScoutingReportList.tsx`, `ScoutingReportCard.tsx`

## Passing State vs. Reading from Store

When decomposing, you must decide how the new child component receives data:

*   **Pass via Props (Dumb/Presentational Component)**: Use this when the child component is purely visual and highly reusable. It makes testing very easy.
    *   *Example*: A generic `Button` or `Card` component.
    *   *Example*: `ScoutingReportCard` receiving a `report` prop from the list.
*   **Read from Store (Smart/Connected Component)**: Use this when the component is tightly coupled to the application's domain and the data is deeply nested, saving you from prop drilling.
    *   *Example*: A deeply nested view like `SprintBoardColumn` might read its tasks directly from the Zustand store filtering by its column status, rather than having the parent pass down filtered arrays.
    *   *Caution*: Connecting too many small components to the store makes them harder to test in isolation without significant mocking.

## File Organization & Naming

*   Name sub-components descriptively, often prefixing them with the parent's domain (e.g., `AdminSettingsUsers.tsx`).
*   If a component has many sub-components, group them in a folder:
    ```
    src/components/AdminSettings/
    ├── AdminSettings.tsx (The container)
    ├── SeasonManager.tsx
    ├── SubTeamManager.tsx
    └── MemberManager.tsx
    ```
    *Note: Currently, most components live flat in `src/components/`. Only create a sub-folder if there are 3+ highly specific sub-components.*
