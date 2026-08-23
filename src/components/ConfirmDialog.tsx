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
        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">{title}</h3>
        <p className="text-slate-600 dark:text-slate-300 mb-6">{message}</p>
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
