import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, RotateCcw, Trash2 } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import EmptyState from './ui/EmptyState';
import ConfirmDialog from './ConfirmDialog';
import {
    getSyncFailures,
    retrySyncFailure,
    discardSyncFailure,
    type SyncFailure,
} from '../lib/offline-db';

/**
 * WHICH changes are parked — the half of the dead-letter story B24 did not cover.
 *
 * B2 stopped failed changes being deleted outright, so the work survives. B24 gave each parked
 * change a `terminalReason`, so the indicator can say "Your team's licence has lapsed" instead
 * of "retry when you have a connection", which was actively wrong. What neither did was let
 * anybody SEE the parked changes: the app reported a number and offered to retry all of them.
 *
 * A number is not reviewable. "3 changes didn't save" does not tell a coach whether the three
 * are the scouting reports they spent the afternoon on or three duplicate saves of a task
 * title, and it gives them no way to deal with one that is genuinely dead — a change belonging
 * to an archived season will never succeed, so a bulk retry re-parks it forever and the badge
 * never clears. The only escape was "discard everything", which throws away the good with the
 * bad. That is how a red badge teaches somebody to destroy their own work.
 *
 * So: per-item, with the reason next to it, retried or discarded one at a time. Discarding is
 * the one action in this app that destroys work on purpose, so it is confirmed and it names
 * what is being thrown away.
 */

/** Human wording for a queue row, without pretending to know every entity's title field. */
function describe(failure: SyncFailure): string {
    const noun = failure.tableName.replace(/_/g, ' ').replace(/s$/, '');
    const verb =
        failure.operation === 'create' ? 'New' : failure.operation === 'delete' ? 'Deleted' : 'Edited';
    // `data.title`/`name` covers tasks, seasons, sub-teams and match plans; the rest fall back
    // to the noun alone rather than showing a uuid, which tells a coach nothing.
    const label =
        (typeof failure.data?.title === 'string' && failure.data.title) ||
        (typeof failure.data?.name === 'string' && failure.data.name) ||
        null;
    return label ? `${verb} ${noun}: ${label}` : `${verb} ${noun}`;
}

function whenever(ms: number): string {
    return new Date(ms).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

interface Props {
    onClose: () => void;
    /** Called after any change to the parked set, so the caller can refresh its counts. */
    onChanged: () => void;
}

export default function ParkedChangesDialog({ onClose, onChanged }: Props) {
    const [failures, setFailures] = useState<SyncFailure[] | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [confirming, setConfirming] = useState<SyncFailure | null>(null);

    const load = useCallback(async () => {
        setFailures(await getSyncFailures());
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const handleRetry = async (failure: SyncFailure) => {
        setBusyId(failure.id);
        try {
            await retrySyncFailure(failure.id);
            await load();
            onChanged();
        } finally {
            setBusyId(null);
        }
    };

    const handleDiscard = async (failure: SyncFailure) => {
        setBusyId(failure.id);
        try {
            await discardSyncFailure(failure.id);
            setConfirming(null);
            await load();
            onChanged();
        } finally {
            setBusyId(null);
        }
    };

    return (
        <>
            <Modal label="Changes that didn't save" width="dialog" className="p-0">
                <div className="flex flex-col gap-3 p-4" data-testid="parked-changes-dialog">
                    <div>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white">
                            Changes that didn&apos;t save
                        </h2>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                            These are still stored on this device. Retry one when whatever stopped it has
                            been fixed, or discard it if it is no longer wanted.
                        </p>
                    </div>

                    {failures === null ? (
                        <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
                    ) : failures.length === 0 ? (
                        <EmptyState
                            icon={AlertCircle}
                            title="Nothing is parked"
                            body="Every change on this device has reached the server."
                        />
                    ) : (
                        <ul className="flex flex-col gap-2" data-testid="parked-changes-list">
                            {failures.map((failure) => (
                                <li
                                    key={failure.id}
                                    data-testid="parked-change"
                                    className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"
                                >
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                        {describe(failure)}
                                    </p>
                                    <p className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">
                                        {whenever(failure.failedAt)}
                                    </p>
                                    {/*
                                     * The reason, where B24 could work one out. Without it the raw
                                     * error is the same sentence about row-level security whatever
                                     * the policy's actual reason was, so showing `lastError` to a
                                     * coach would be worse than saying nothing useful at all.
                                     */}
                                    <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
                                        {failure.terminalReason ??
                                            'This did not save after several attempts. Retrying may work.'}
                                    </p>
                                    <div className="mt-2 flex gap-2">
                                        <Button
                                            size="sm"
                                            onClick={() => handleRetry(failure)}
                                            busy={busyId === failure.id}
                                            data-testid="parked-change-retry"
                                        >
                                            <RotateCcw size={14} /> Retry
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => setConfirming(failure)}
                                            data-testid="parked-change-discard"
                                        >
                                            <Trash2 size={14} /> Discard
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}

                    <div className="flex justify-end">
                        <Button size="sm" variant="secondary" onClick={onClose} data-testid="parked-changes-close">
                            Close
                        </Button>
                    </div>
                </div>
            </Modal>

            {confirming && (
                <ConfirmDialog
                    title="Discard this change?"
                    /* Names the change rather than saying "this item": the whole point of the
                       screen is that the user knows what they are throwing away. */
                    message={`"${describe(confirming)}" will be removed from this device and will not be sent to the server. This cannot be undone.`}
                    confirmLabel="Discard"
                    confirmTestId="parked-change-discard-confirm"
                    onConfirm={() => handleDiscard(confirming)}
                    onCancel={() => setConfirming(null)}
                />
            )}
        </>
    );
}
