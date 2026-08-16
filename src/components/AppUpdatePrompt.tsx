import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import Button from './ui/Button';
import { subscribeToUpdates, type PendingUpdate } from '../lib/pwa-update';

/**
 * "A new version is ready" — the visible half of the update flow.
 *
 * Deliberately not a blocking modal. A team mid-match should be able to ignore this for as long
 * as they like: the waiting worker costs nothing, and the queued work is in IndexedDB either
 * way. It is dismissible, and dismissing it does not discard the update — the new version still
 * arrives on the next natural reload.
 */
export default function AppUpdatePrompt() {
    const [update, setUpdate] = useState<PendingUpdate | null>(null);
    const [dismissed, setDismissed] = useState(false);

    // Subscribe only. Registration starts at boot in main.tsx -- see pwa-update.ts for why.
    useEffect(() => subscribeToUpdates(setUpdate), []);

    if (!update || dismissed) return null;

    return (
        <div
            data-testid="app-update-prompt"
            role="status"
            className="mx-3 mb-2 flex items-center gap-3 rounded-xl border border-forge-500/40 bg-forge-500/10 px-3 py-2"
        >
            <RefreshCw size={16} className="shrink-0 text-forge-500" aria-hidden="true" />
            <p className="flex-1 min-w-0 text-sm text-slate-700 dark:text-slate-200">
                A new version of FalconForge is ready.
            </p>
            <Button size="sm" onClick={update.apply} data-testid="app-update-reload">
                Reload
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDismissed(true)} data-testid="app-update-later">
                Later
            </Button>
        </div>
    );
}
