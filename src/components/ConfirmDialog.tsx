import React from 'react';

/**
 * A confirmation modal for destructive actions.
 *
 * Extracted from SprintPlanning's inline delete confirmation. Kept generic because the
 * same shape is hand-rolled in several other components -- consolidating those is
 * worthwhile, but is a behaviour-affecting change per component and does not belong in the
 * commit that merely moves this one out.
 */
interface ConfirmDialogProps {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    title,
    message,
    confirmLabel = 'Delete',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel,
}) => (
    // z-[60] keeps this above the task modal, which sits at z-50.
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">{title}</h3>
            <p className="text-slate-600 dark:text-slate-300 mb-6">{message}</p>
            <div className="flex justify-end gap-3">
                <button
                    onClick={onCancel}
                    className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
                >
                    {cancelLabel}
                </button>
                <button
                    onClick={onConfirm}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition"
                >
                    {confirmLabel}
                </button>
            </div>
        </div>
    </div>
);

export default ConfirmDialog;
