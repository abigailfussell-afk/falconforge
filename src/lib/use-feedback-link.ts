/**
 * The feedback `mailto:`, built from what the app knows right now (OPS-05).
 *
 * A hook rather than the module constant it replaces, because every field in the body is a fact
 * about NOW — which screen, how much is queued, whether the server is answering. A constant
 * computed at module load reports the state the app was in when it started, and for an installed
 * PWA that is never reloaded on a schedule that could be days ago.
 *
 * There are two links (the sidebar and the Getting started page) and one of these, so the two
 * cannot drift into carrying different information — which is the defect class this project has
 * hit more than any other.
 */
import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { getPendingSyncCount, getSyncFailureCount } from './offline-db';
import { collectFeedbackContext, feedbackMailto } from './feedback';

/**
 * Poll interval for the queue counts.
 *
 * The same five seconds `useSync` already uses for the same two numbers. Reading them on mount
 * only would mean a coach who works for an hour and then reports a problem sends the counts
 * from the moment the sidebar rendered.
 */
const COUNT_POLL_MS = 5_000;

export function useFeedbackLink(): string {
    const currentTeamId = useAppStore((s) => s.currentTeamId);
    const [counts, setCounts] = useState({ pending: 0, failed: 0 });

    useEffect(() => {
        let cancelled = false;
        const read = async () => {
            try {
                const [pending, failed] = await Promise.all([
                    getPendingSyncCount(),
                    getSyncFailureCount(),
                ]);
                if (!cancelled) setCounts({ pending, failed });
            } catch {
                /*
                 * Guarded, because this runs on an interval and is a READ of local state.
                 * An unguarded throw here is an unhandled rejection every five seconds for as
                 * long as the app is open, and failing it changes nothing anybody can act on —
                 * the link still works, it just reports the counts it last managed to read.
                 * `useSync` learned this the hard way; see its own polling comment.
                 */
            }
        };
        void read();
        const timer = setInterval(read, COUNT_POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, []);

    return feedbackMailto(collectFeedbackContext(counts, currentTeamId));
}
