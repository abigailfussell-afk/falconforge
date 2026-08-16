import React from 'react';

/**
 * The modal shell. Before Sprint 5.5 five modals shipped five widths and two z-index
 * schemes, `max-w-panel`/`max-w-dialog` sat unused in tailwind.config, and only
 * ConfirmDialog carried `role="dialog"`. The shell owns the overlay, the elevation
 * (`shadow-overlay`), the width vocabulary and the ARIA so no copy can drift.
 *
 * `stacked` puts the overlay at `z-dialog` (above another open modal) — that is
 * ConfirmDialog's job, raised from inside a `z-50` overlay. Everything else is `z-50`.
 *
 * The default body is `p-6`; a modal that manages its own header/body/footer split
 * passes `className` (e.g. `flex flex-col overflow-hidden`) and pads its sections.
 */
type Width = 'sm' | 'panel' | 'dialog' | 'wide';

const widthClasses: Record<Width, string> = {
    sm: 'max-w-sm',
    panel: 'max-w-panel',
    dialog: 'max-w-dialog',
    wide: 'max-w-2xl',
};

export interface ModalProps {
    /** Accessible name for the dialog. */
    label: string;
    width?: Width;
    /** Renders above another open modal (z-dialog instead of z-50). */
    stacked?: boolean;
    className?: string;
    children: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ label, width = 'panel', stacked = false, className = 'p-6', children }) => (
    <div
        className={`fixed inset-0 bg-black/50 ${stacked ? 'z-dialog' : 'z-50'} flex items-center justify-center p-4`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
    >
        <div className={`bg-white dark:bg-slate-800 rounded-xl shadow-overlay w-full max-h-modal ${widthClasses[width]} ${className}`}>
            {children}
        </div>
    </div>
);

export default Modal;
