/**
 * WHETHER THE SERVER IS ACTUALLY ANSWERING (SYNC-07).
 *
 * The sync indicator derived everything from `navigator.onLine`, which reports whether the
 * device has a network interface with a route — not whether anything is on the other end of
 * it. Cold-booting the built app with the network cut showed a green tick and the word
 * "Synced" while 37 requests failed and the realtime socket never opened, because
 * `navigator.onLine` was `true` throughout.
 *
 * That is not a Chromium quirk to shrug at. It is exactly what venue WiFi and a captive portal
 * look like: associated, addressed, routed to a login page. A coach reading "Synced" concludes
 * the board reflects what everybody else has done, and it does not.
 *
 * So the app records what it has actually observed. Every request that reaches PostgREST or
 * comes back refused says "reachable"; every request that fails to complete says "not". The
 * indicator reads THAT, and `navigator.onLine` is left to answer the one question it can —
 * has the device been told there is no network at all.
 *
 * WHAT COUNTS AS CONTACT, AND WHY A 42501 DOES
 *
 * A row-level-security refusal is a conversation with the server: it heard us and said no.
 * Treating it as unreachable would light the "can't reach server" warning for a team whose
 * licence has lapsed, which is a different problem with a different explanation already
 * attached (B24). Contact means "the server answered", never "the server agreed".
 *
 * A pull SKIPPED for want of a signed-in token (SYNC-02) is not contact either. Nothing was
 * asked, so nothing was learned, and reporting success there is how "Synced" would come to
 * mean "we did not look".
 */

/** How long a successful contact stays believable before the indicator hedges. */
export const CONTACT_STALE_AFTER_MS = 2 * 60 * 1000;

export interface ServerReachability {
    /** When the server last answered anything. Null means it never has, this session. */
    lastContactAt: number | null;
    /** When a request last failed to complete. */
    lastFailureAt: number | null;
    /**
     * The app's best answer to "can we reach the server right now".
     *
     * `null` until something has been tried — the third state, kept separate on purpose. "We
     * have not asked" and "we asked and could not" are arithmetically identical and
     * semantically opposite, which is `docs/failure-modes.md` §4 and has cost this project a
     * whole team's checklist once already.
     */
    reachable: boolean | null;
}

let state: ServerReachability = { lastContactAt: null, lastFailureAt: null, reachable: null };

type Listener = (next: ServerReachability) => void;
const listeners = new Set<Listener>();

/**
 * Report the outcome of a request that went to the server.
 *
 * `now` is injectable so a test can stand at a chosen moment rather than sleeping.
 */
export function recordServerContact(succeeded: boolean, now: number = Date.now()): void {
    const next: ServerReachability = succeeded
        ? { lastContactAt: now, lastFailureAt: state.lastFailureAt, reachable: true }
        : { lastContactAt: state.lastContactAt, lastFailureAt: now, reachable: false };

    if (
        next.reachable === state.reachable &&
        next.lastContactAt === state.lastContactAt &&
        next.lastFailureAt === state.lastFailureAt
    ) {
        return;
    }

    state = next;
    listeners.forEach((fn) => fn(state));
}

export function getServerReachability(): ServerReachability {
    return state;
}

export function onServerReachabilityChange(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Forget everything observed. Sign-out, and test setup.
 *
 * On a shared team laptop the next person's device state should not inherit the previous
 * session's idea of whether the server was up.
 */
export function resetServerReachability(): void {
    state = { lastContactAt: null, lastFailureAt: null, reachable: null };
    listeners.forEach((fn) => fn(state));
}

/** Has a successful contact aged past the point where "Synced" is still a fair thing to say? */
export function isContactStale(
    reachability: ServerReachability = state,
    now: number = Date.now(),
): boolean {
    if (reachability.lastContactAt === null) return true;
    return now - reachability.lastContactAt > CONTACT_STALE_AFTER_MS;
}

/**
 * How long ago the server last answered, in words. `null` when it never has.
 *
 * Rounded down and never below "just now": a label that flickers between "0 min ago" and
 * "1 min ago" is noise, and the number is only ever read to answer "roughly how stale is
 * this?".
 */
export function describeLastContact(
    reachability: ServerReachability = state,
    now: number = Date.now(),
): string | null {
    if (reachability.lastContactAt === null) return null;
    const seconds = Math.max(0, Math.floor((now - reachability.lastContactAt) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.floor(hours / 24)} d ago`;
}
