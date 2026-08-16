/**
 * The error-logging story, stated honestly rather than pretended.
 *
 * There is no Sentry and no error-reporting backend, and the plan is explicit that for beta the
 * story can be "even just structured console + Supabase log review cadence". The value of this
 * module is therefore not cleverness, it is HAVING ONE PLACE: a single shape, so that when a
 * coach sends a screenshot of their console, or a real reporter is added in a later sprint,
 * there is one function to change rather than a hunt through `console.error` call sites.
 *
 * The only backend is Supabase, and there is no table for this. Writing client errors to
 * Postgres would need a table anyone may INSERT into -- which is an unauthenticated write
 * endpoint on the same database that holds every team's data, and default-deny says no to that
 * without a proper think. So this stays client-side until a sprint owns it properly.
 *
 * Deliberately never throws. A reporter that can fail while reporting a failure turns one
 * broken view into a broken app, and this is called from `componentDidCatch`.
 */

export interface ErrorContext {
    /** Where it was caught, e.g. 'route'. */
    boundary?: string;
    /** The route path, when there is one. */
    route?: string;
    /** React's component stack, when the caller has it. */
    componentStack?: string | null;
    [key: string]: unknown;
}

/** One structured line per error, so a console screenshot is actually readable. */
export function reportError(error: unknown, context: ErrorContext = {}): void {
    try {
        const err = error instanceof Error ? error : new Error(String(error));

        console.error('[falconforge:error]', {
            message: err.message,
            name: err.name,
            stack: err.stack,
            // The route matters more than anything else here: it is the one field that turns
            // "the app crashed" into a reproduction.
            ...context,
            at: new Date().toISOString(),
            // Not navigator.userAgent in full -- it is long, and the useful part for this app
            // is only ever "was this a phone at a venue".
            online: typeof navigator !== 'undefined' ? navigator.onLine : null,
        });
    } catch {
        // Reporting must never be the thing that breaks. Swallowed on purpose.
    }
}
