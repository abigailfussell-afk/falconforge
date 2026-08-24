import React from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';

/**
 * A confirmation modal for destructive actions.
 *
 * Extracted from SprintPlanning's inline delete confirmation; since Sprint 5.5 it is a
 * thin composition over the ui kit, so the "confirm" look has exactly one definition.
 */
interface ConfirmDialogProps {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Optional test ids so callers replacing a hand-rolled confirm keep their selectors. */
    confirmTestId?: string;
    cancelTestId?: string;
    onConfirm: () => void;
    onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    title,
    message,
    confirmLabel = 'Delete',
    cancelLabel = 'Cancel',
    confirmTestId,
    cancelTestId,
    onConfirm,
    onCancel,
}) => (
    // stacked: confirmations are raised FROM other modals (z-50), so this sits above them.
    <Modal label={title} width="sm" stacked onClose={onCancel}>
        {/*
          * `break-words` on both (WALK-B-10).
          *
          * Every confirmation in the app interpolates a user-typed value into these two strings
          * — a child's name, a member's name, a season's name — inside the app's NARROWEST
          * modal (`width="sm"`). A 120-character name with no spaces in it is now the longest
          * thing that can arrive here, and without this it renders past the modal's edge and
          * takes the buttons with it.
          */}
        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2 break-words">{title}</h3>
        <p className="text-slate-600 dark:text-slate-300 mb-6 break-words">{message}</p>
        <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onCancel} data-testid={cancelTestId}>
                {cancelLabel}
            </Button>
            <Button variant="danger" onClick={onConfirm} data-testid={confirmTestId}>
                {confirmLabel}
            </Button>
        </div>
    </Modal>
);

export default ConfirmDialog;
