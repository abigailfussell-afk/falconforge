import { Archive } from 'lucide-react';
import { useSeasonScope } from '../lib/season-scope';

/**
 * "You are looking at a prior season."
 *
 * Rendered once, in the app shell above whichever view is active, rather than five times in
 * five feature components. Every view is season-scoped, so every view needs this state and
 * none of them needs its own copy of the rule.
 *
 * The banner explains WHY things are unavailable. Disabling a button with no reason given is
 * the same failure mode as the silent write it exists to prevent — the user is told nothing
 * and left to guess.
 */
export default function ArchivedSeasonBanner() {
    const { season, isArchived } = useSeasonScope();

    if (!isArchived || !season) return null;

    return (
        <div
            data-testid="archived-season-banner"
            role="status"
            className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700/60 dark:bg-amber-900/20"
        >
            <Archive size={18} className="mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0">
                <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
                    {season.name} is archived — read only
                </p>
                <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
                    Everything from this season stays here to browse. Switch to the current
                    season to make changes, or reopen it in Admin Settings.
                </p>
            </div>
        </div>
    );
}
