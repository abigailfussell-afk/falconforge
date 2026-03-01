---
name: Error Handling & Edge Cases
description: Ensure consistent error handling across the app
---

# Error Handling & Edge Cases Skill

This skill outlines how to robustly handle errors, loading states, and edge cases in the FalconForge application.

## General Principles

1.  **Don't swallow errors**: Log them, report them to monitoring (if available), and show a user-friendly message.
2.  **Fail Gracefully**: The entire app shouldn't crash if one component fails.
3.  **Inform the User**: Always communicate what went wrong and how to fix it or proceed.

## Supabase Error Handling

When interacting with Supabase, errors can occur due to network issues, permission errors (RLS), or invalid data.

1.  **Check for Errors**: Always inspect the `error` object returned by Supabase queries.
    ```typescript
    const { data, error } = await supabase.from('table').select('*');
    if (error) {
        console.error('Failed to fetch data:', error.message);
        // Handle the error (e.g., show toast, return specific error object)
        throw new Error(`Failed to fetch: ${error.message}`);
    }
    ```
2.  **Sync Operations**: For sync processes, capture errors and store them in the queue item's `lastError` field, incrementing the `retryCount`.

## UI Patterns

### Loading States

Every component that fetches data must handle the state before the data is available.

1.  **Use Skeleton UI**: Prefer skeleton loaders over simple spinners for main page content to reduce layout shift.
    ```tsx
    if (isLoading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded w-1/4"></div>
                <div className="h-32 bg-slate-200 dark:bg-slate-700 rounded"></div>
            </div>
        );
    }
    ```
2.  **Button Spinners**: For actions (e.g., "Save", "Submit"), show a small loading spinner inside the button and disable it to prevent double submission.
    ```tsx
    <button disabled={isSubmitting}>
        {isSubmitting ? <Spinner className="w-4 h-4 mr-2" /> : null}
        Save
    </button>
    ```

### Empty States

When data is successfully loaded but there is none to display (e.g., an empty list of tasks):

1.  **Provide Feedback**: Show a clear message indicating there is no data.
2.  **Offer Action**: Provide a button or link to create the first item if applicable.
    ```tsx
    if (tasks.length === 0) {
        return (
            <div className="text-center p-8 text-slate-500">
                <p>No tasks found in this column.</p>
                <button onClick={handleCreate} className="mt-4 text-blue-500 hover:underline">
                    Create your first task
                </button>
            </div>
        );
    }
    ```

### Toast/Notification Patterns

Use a toast notification system (if implemented, or a simple custom hook/component) to show transient success or error messages to the user without interrupting their flow.
*(Currently, rely on localized inline error messages or standard `window.alert` if a toast system isn't present, but strive to implement a non-blocking toast system if possible).*

## Testing Edge Cases

When writing tests, explicitly verify the component behaves correctly in non-ideal scenarios:

1.  **Mocking Errors**: Mock your API or store to throw an error and assert that the error boundary or error message is rendered.
    ```typescript
    it('displays error message on fetch failure', () => {
        // Mock the store or API to return an error/reject
        render(<MyComponent />);
        expect(screen.getByText(/failed to load/i)).toBeDefined();
    });
    ```
2.  **Empty Lists**: Assert that the empty state UI renders correctly.
    ```typescript
    it('displays empty state when list is empty', () => {
        render(<MyComponent items={[]} />);
        expect(screen.getByText('No items found')).toBeDefined();
    });
    ```
3.  **Loading Spinners**: Assert the spinner is present when `isLoading` is true.
