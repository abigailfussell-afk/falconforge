import { CloudOff } from 'lucide-react';
import { useAuth } from '../lib/auth';

/**
 * "You are offline. Work is saved on this device and will sync."
 *
 * The connectivity STATE already existed — `useAuth().isOffline` is wired to the window's
 * online/offline events, and MemberManager, InviteManager and the whole admin console consume it
 * to stop offering writes that go straight to Supabase. What was missing was somebody saying it
 * out loud in the main app, where a student adding tasks between matches is looking.
 *
 * The message is the important part, and it is the opposite of the usual one. Most apps use this
 * space to apologise or to warn. Here, offline is the DESIGNED case: the work is genuinely safe,
 * it is genuinely going to sync, and a banner that reads like a failure would teach a team to
 * stop working exactly when the venue wifi drops. So it states the fact and the reassurance, and
 * it does not offer a retry — there is nothing for the user to do.
 *
 * WHY IT STACKS ABOVE THE ACCESS BANNERS RATHER THAN COMPETING WITH THEM
 *
 * `AppShell` is emphatic that the archived-season and lapsed-licence banners are one position
 * with at most one visible, because they are alternative answers to "why can't I edit this?".
 * Connectivity is a different axis: a lapsed team can also be offline, and each sentence
 * explains something the other does not. It is one compact line for that reason.
 */
export default function OfflineBanner() {
    const { isOffline } = useAuth();

    if (!isOffline) return null;

    return (
        <div
            data-testid="offline-banner"
            role="status"
            className="mx-3 mb-2 flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-100 px-3 py-1.5 dark:border-slate-600 dark:bg-slate-800"
        >
            <CloudOff size={15} className="shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            <p className="text-sm text-slate-600 dark:text-slate-300">
                You&apos;re offline. Your work is saved on this device and will sync when you reconnect.
            </p>
        </div>
    );
}
