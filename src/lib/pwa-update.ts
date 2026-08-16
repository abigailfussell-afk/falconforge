import { Workbox } from 'workbox-window';

/**
 * Service-worker registration, and telling the user when a new version is waiting.
 *
 * WHY THIS REPLACED `registerType: 'autoUpdate'`
 *
 * The plugin was configured to update automatically, which sounds like the considerate option
 * and is not. `autoUpdate` ships `skipWaiting` + `clientsClaim`, so a newly deployed service
 * worker activates and takes control of an ALREADY-OPEN page. Every feature in this app is
 * behind `React.lazy`, so the chunk names change with each build -- and a tab that has been
 * open since before the deploy will ask for a chunk that the new precache no longer contains.
 * The user sees "Failed to fetch dynamically imported module" when they click a nav item, at
 * whatever moment happens to be inconvenient.
 *
 * That is a bad trade for a team at a competition, which is the situation this codebase exists
 * for. So the new worker now WAITS, the app says so, and the reload happens when the user says
 * it can. Nothing is lost by waiting: the queue is in IndexedDB and survives the reload.
 *
 * The reload is driven by the `controlling` event rather than being fired straight after
 * `skipWaiting`. Reloading before the new worker has taken control just serves the old page
 * again from the old precache, and the prompt reappears -- a loop that looks like the button
 * not working.
 */

export interface PendingUpdate {
    /** Tell the waiting worker to take over, and reload once it has. */
    apply: () => void;
}

/**
 * Registration starts at BOOT, not when the prompt mounts.
 *
 * The first version of this registered from inside `AppUpdatePrompt`, which lives in the app
 * shell -- so nothing registered until the user had signed in and picked a team. The landing
 * page and the login page, which are the first things anyone loads, registered no worker at
 * all, and a user who lost connectivity early had no precache to fall back on. The offline
 * smoke test caught it immediately, which is the argument for having written it.
 *
 * So `startServiceWorker()` is called from `main.tsx`, and the prompt merely SUBSCRIBES. That
 * ordering also fixes the race in the other direction: an update discovered before the shell
 * mounts is remembered here and handed to the prompt when it arrives, rather than being
 * announced to nobody.
 */
let pending: PendingUpdate | null = null;
let started = false;
const subscribers = new Set<(update: PendingUpdate | null) => void>();

/** Begin registration. Idempotent: calling it twice does not register two workers. */
export function startServiceWorker(): void {
    if (started) return;
    started = true;
    registerServiceWorker((update) => {
        pending = update;
        for (const notify of subscribers) notify(update);
    });
}

/** Subscribe to "a new version is waiting", receiving one immediately if it already is. */
export function subscribeToUpdates(onChange: (update: PendingUpdate | null) => void): () => void {
    subscribers.add(onChange);
    if (pending) onChange(pending);
    return () => {
        subscribers.delete(onChange);
    };
}

/** Test seam: forget the module-level registration state between cases. */
export function resetUpdateStateForTests(): void {
    pending = null;
    started = false;
    subscribers.clear();
}

/**
 * Register the service worker and call back when a new version is waiting to take over.
 *
 * Returns a teardown so a caller in an effect can detach. No-ops where there is no service
 * worker to register: the dev server does not build one, and jsdom has no `navigator
 * .serviceWorker` at all, so this must be safe to import from a component under test.
 */
export function registerServiceWorker(onUpdateReady: (update: PendingUpdate) => void): () => void {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};

    const wb = new Workbox('/sw.js');
    let disposed = false;

    const apply = () => {
        /*
         * `controlling` fires once the waiting worker has actually taken over. Only then is a
         * reload guaranteed to be served the new precache.
         */
        wb.addEventListener('controlling', () => window.location.reload());
        wb.messageSkipWaiting();
    };

    const announce = () => {
        if (!disposed) onUpdateReady({ apply });
    };

    /*
     * `waiting`: a new worker is installed and parked behind the current one -- the normal case
     * for a second visit after a deploy.
     *
     * This covers the two-tab case as well. Older workbox-window had a separate
     * `externalwaiting` event for a worker installed by ANOTHER tab of the same app; in the
     * version here that was folded into the same event, carrying `isExternal: true`. Listening
     * for the old name is not merely redundant, it does not type-check -- which is how the
     * first draft of this file found out.
     */
    wb.addEventListener('waiting', announce);

    void wb.register();

    return () => {
        disposed = true;
    };
}
