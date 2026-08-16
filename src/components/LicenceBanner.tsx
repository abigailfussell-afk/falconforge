import { Link } from 'react-router-dom';
import { ShieldAlert, Clock } from 'lucide-react';
import { useAccessState } from '../lib/entitlement';
import { pathFor } from '../lib/navigation';

/**
 * "Your team's licence has lapsed" — and the softer "it lapses soon".
 *
 * RENDERED ONCE, IN THE SHELL, beside `ArchivedSeasonBanner` and never merged with it. Both
 * live above the `<Outlet>` for the same reason: every view below is both season-scoped and
 * team-scoped, so this is a property of the frame rather than something five feature components
 * each have to remember to say.
 *
 * ONLY ONE OF THE TWO EVER SHOWS. `useAccessState` decides which, and the archived season wins —
 * see the reasoning there. Two stacked banners is what happens by accident, and it is the worst
 * outcome, because the user has to work out which refusal is blocking them.
 *
 * FAILS OPEN. `isReadOnly` is positive knowledge from the server, so a device that has never
 * read the entitlement view shows nothing at all. The alternative — treating "we could not ask"
 * as "no" — locks a coach out at a venue because a query timed out, which is worse than an
 * unlicensed team typing into writes the database refuses anyway.
 */
export default function LicenceBanner() {
    const { refusal, isBothRefusals, lapsedAt, isExpiringSoon, daysUntilExpiry, validUntil } =
        useAccessState();

    if (refusal === 'lapsed-licence') {
        return (
            <div
                data-testid="licence-lapsed-banner"
                role="status"
                className="mb-4 flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 dark:border-red-700/60 dark:bg-red-900/20"
            >
                <ShieldAlert size={18} className="mt-0.5 flex-shrink-0 text-red-600 dark:text-red-400" />
                <div className="min-w-0">
                    <p className="text-sm font-bold text-red-900 dark:text-red-200">
                        Your team&apos;s licence has lapsed — read only
                    </p>
                    <p className="text-xs text-red-800/80 dark:text-red-300/80">
                        {/*
                          * "Nothing has been deleted" is load-bearing, not reassurance padding.
                          * Expiry is a read-only grace mode by design — the plan's words — and a
                          * coach seeing a red banner at a competition will assume the worst
                          * unless told otherwise.
                          */}
                        Everything your team has made is still here and still readable. Nothing has
                        been deleted.{' '}
                        {lapsedAt && `Cover ended ${lapsedAt.toLocaleDateString()}. `}
                        <Link to={pathFor('admin')} className="font-semibold underline">
                            See licence details
                        </Link>
                        .
                    </p>
                </div>
            </div>
        );
    }

    /*
     * The archived-season banner is showing instead, but the licence has ALSO lapsed. Say so in
     * one line rather than stacking a second full banner: the user's immediate fix is still to
     * switch seasons, and discovering the licence problem only after doing that is a worse
     * sequence than knowing about both now.
     */
    if (isBothRefusals) {
        return (
            <div
                data-testid="licence-also-lapsed-note"
                role="status"
                className="mb-4 flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-700/60 dark:bg-red-900/20 dark:text-red-300"
            >
                <ShieldAlert size={14} className="flex-shrink-0" />
                <span>
                    Your team&apos;s licence has also lapsed, so the current season is read-only
                    too.{' '}
                    <Link to={pathFor('admin')} className="font-semibold underline">
                        See licence details
                    </Link>
                    .
                </span>
            </div>
        );
    }

    // Expiring, not expired. Amber and quiet: everything still works.
    if (isExpiringSoon && daysUntilExpiry !== null && validUntil) {
        return (
            <div
                data-testid="licence-expiring-banner"
                role="status"
                className="mb-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200"
            >
                <Clock size={14} className="flex-shrink-0" />
                <span>
                    Your team&apos;s licence ends in{' '}
                    <strong>
                        {daysUntilExpiry} {daysUntilExpiry === 1 ? 'day' : 'days'}
                    </strong>{' '}
                    ({validUntil.toLocaleDateString()}). After that the team becomes read-only —
                    nothing is deleted.{' '}
                    <Link to={pathFor('admin')} className="font-semibold underline">
                        See licence details
                    </Link>
                    .
                </span>
            </div>
        );
    }

    return null;
}
