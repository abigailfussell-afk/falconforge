import React from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { describeUnsyncedWork, type UnsyncedChoice, type UnsyncedWork } from '../lib/sign-out';

/**
 * "You have work that hasn't reached the server. Sign out anyway?" (SYNC-05)
 *
 * Signing out clears the sync queue and the dead-letter store, which is correct — the next
 * person on a shared team laptop must not inherit them — and used to happen on one
 * unannounced click. The scenario is one this product is designed around: a student scouts
 * three matches in a gym with no signal, signs out so the next student can sign in, and the
 * reports are gone.
 *
 * NOT `ConfirmDialog`, which is two buttons. Online there are three genuinely different
 * answers, and collapsing "send it first" into "cancel" would leave the person to work out
 * for themselves that they should wait for the sync indicator before pressing the button
 * again. Offline that third option is not offered rather than being offered and refused
 * (`docs/failure-modes.md` section 8: a control that cannot act says why instead).
 *
 * `canSync` is passed in rather than read from `navigator.onLine` here, because `onLine` is
 * true in a captive portal (SYNC-07) — the shell already knows what the sync engine thinks.
 */
interface UnsyncedSignOutDialogProps {
    work: UnsyncedWork;
    /** Whether "Sync, then sign out" is worth offering: the engine believes it can reach the server. */
    canSync: boolean;
    onChoose: (choice: UnsyncedChoice) => void;
}

const UnsyncedSignOutDialog: React.FC<UnsyncedSignOutDialogProps> = ({ work, canSync, onChoose }) => (
    <Modal label="Unsynced changes" width="sm" stacked>
        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">
            Sign out with unsynced changes?
        </h3>
        <p className="text-slate-600 dark:text-slate-300 mb-2" data-testid="unsynced-signout-message">
            {describeUnsyncedWork(work)}
        </p>
        {!canSync && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                This device can&rsquo;t reach the server right now, so they can&rsquo;t be sent first.
            </p>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mt-4">
            <Button
                variant="secondary"
                onClick={() => onChoose('cancel')}
                data-testid="unsynced-signout-cancel"
            >
                Stay signed in
            </Button>
            <Button
                variant="danger"
                onClick={() => onChoose('sign-out')}
                data-testid="unsynced-signout-confirm"
            >
                Sign out anyway
            </Button>
            {canSync && (
                <Button
                    variant="primary"
                    onClick={() => onChoose('sync-first')}
                    data-testid="unsynced-signout-sync-first"
                >
                    Sync, then sign out
                </Button>
            )}
        </div>
    </Modal>
);

export default UnsyncedSignOutDialog;
