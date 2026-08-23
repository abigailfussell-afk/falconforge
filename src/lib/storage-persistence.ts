/**
 * ASKING THE BROWSER NOT TO THROW THE OFFLINE COPY AWAY (SYNC-08).
 *
 * Everything this product is for lives in IndexedDB: the sync queue, the dead letters, and the
 * whole offline dataset a team reads at a venue. All of it was under *best-effort* storage,
 * which is the browser's term for "evictable at any time".
 *
 * What that actually means, per platform:
 *
 *   - **Chrome / Android** evicts best-effort origins under storage pressure. A student's phone
 *     is full; the browser picks an origin; the parked scouting report goes with it.
 *   - **Safari** deletes all script-writable storage for a site not used for seven days — a
 *     school holiday — UNLESS the site is installed to the home screen. `persist()` does not
 *     change that rule, which is why the Getting started page says so in words.
 *
 * And nothing would ever report it: the queue would simply be empty, which is indistinguishable
 * from having synced. That is the same absence-as-a-value shape as B20, with a worse subject.
 *
 * WHY AFTER SIGN-IN
 *
 * `persist()` is a permission request. Chrome grants it silently on a site with enough
 * engagement (installed as a PWA, bookmarked, high engagement score) and denies it silently
 * otherwise; Firefox prompts. Asking on a page a stranger has just landed on is the worst
 * moment for both outcomes. Asking after sign-in means the person has an account and a team,
 * which is when there is finally something worth keeping.
 */

/** What the browser said, for the dead-letter dialog and for the tests. */
export interface StoragePersistence {
    /** `true` if storage is persistent, `false` if best-effort, `null` if unsupported. */
    persisted: boolean | null;
    /** Bytes in use and available, when the browser will say. */
    usage?: number;
    quota?: number;
}

let lastResult: StoragePersistence = { persisted: null };

/**
 * Ask once, and remember the answer.
 *
 * Never throws and never rejects: this is called from an auth callback, and a storage
 * permission that fails while reporting on storage must not take the sign-in with it.
 */
export async function requestStoragePersistence(): Promise<StoragePersistence> {
    try {
        if (typeof navigator === 'undefined' || !navigator.storage) {
            lastResult = { persisted: null };
            return lastResult;
        }

        /*
         * `persisted()` FIRST, and not merely as an optimisation.
         *
         * Calling `persist()` when the answer is already yes is a second permission request for
         * something already granted — and in Firefox that is a second prompt at a moment the
         * user did not ask for one.
         */
        let persisted = typeof navigator.storage.persisted === 'function'
            ? await navigator.storage.persisted()
            : false;

        if (!persisted && typeof navigator.storage.persist === 'function') {
            persisted = await navigator.storage.persist();
        }

        const estimate = typeof navigator.storage.estimate === 'function'
            ? await navigator.storage.estimate()
            : undefined;

        lastResult = {
            persisted,
            usage: estimate?.usage,
            quota: estimate?.quota,
        };

        if (!persisted) {
            // Not an error — a denial is a normal outcome and the app works either way. Worth
            // one line, because it is the difference between "the queue was cleared" and "the
            // queue was evicted" when somebody asks later.
            console.info(
                '[falconforge] storage is best-effort, not persistent: the browser may evict ' +
                'the offline copy under pressure. Installing to the home screen helps.',
            );
        }

        return lastResult;
    } catch (err) {
        console.warn('Could not ask for persistent storage:', err);
        lastResult = { persisted: null };
        return lastResult;
    }
}

/** The last answer, without asking again. */
export function getStoragePersistence(): StoragePersistence {
    return lastResult;
}

/** Reset — tests, and sign-out on a shared device. */
export function resetStoragePersistence(): void {
    lastResult = { persisted: null };
}
