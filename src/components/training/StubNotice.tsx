import { Construction } from 'lucide-react';

/**
 * The banner that says this is a stub, on every Training screen that can be reached directly.
 *
 * IT IS NOT DECORATION. Six of the eight tracks have no lessons and none of the controls record
 * anything, so without this the screens read as a shipped feature that is broken rather than a
 * shape that is settled — and `docs/failure-modes.md` section 7 is a list of things that looked
 * finished from the outside. A student who finds Training in the nav during the beta deserves
 * one sentence telling them why it is empty.
 *
 * On all three screens rather than only the index, because the lesson pages are deep-linkable
 * and somebody will arrive at one from a link without passing the index.
 */
export default function StubNotice() {
    return (
        <div
            data-testid="training-stub-notice"
            className="flex items-start gap-3 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-3"
        >
            <Construction size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <p className="text-sm text-amber-900 dark:text-amber-200">
                <span className="font-semibold">Training is a preview.</span> The outline below is
                settled; the lessons themselves are not written yet, and nothing on these pages
                records progress or sign-offs.
            </p>
        </div>
    );
}
