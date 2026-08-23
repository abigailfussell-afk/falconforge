import React, { useCallback, useEffect, useId, useLayoutEffect, useRef } from 'react';

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
 *
 * ---------------------------------------------------------------------------
 * KEYBOARD AND FOCUS (WALK-A-08)
 *
 * The walkthrough opened an existing task and measured `focusInDialog: false`,
 * `closedByEsc: false`. The markup was already right — `role="dialog" aria-modal="true"` with
 * a name — which is the trap: a screen reader is TOLD this is a modal dialog, and then focus
 * is left behind it on the page underneath. `aria-modal` is a promise about behaviour, and
 * nothing was keeping it.
 *
 * All three behaviours live HERE and only here, which is the fix direction's own point and
 * CLAUDE.md principle 9: fifteen call sites, one implementation. Doing it per modal is how
 * this project got seven display-name implementations, and a focus trap is far easier to get
 * subtly wrong than a display name.
 *
 * Deliberately NOT `<dialog>`: the native element brings its own top-layer stacking, which
 * would fight the `z-dialog`/`z-50` scheme `stacked` exists to manage, and its backdrop cannot
 * be styled with the overlay classes every modal here already shares.
 *
 * And deliberately NO BACKDROP-CLICK DISMISS, which a first draft had. Two reasons, and the
 * second is the one that decided it. `jsx-a11y` refuses a click handler on a non-interactive
 * element, and it is right — a backdrop is not a control. More importantly, most modals in this
 * app are FORMS: a mis-click beside the scouting dialog would discard a report a scout has just
 * typed at a venue, with no undo and no warning. This project has spent several sprints removing
 * ways to silently lose work; adding one back for a convenience nobody asked for is a bad trade.
 * Escape is the dismissal, and every modal also has a visible Cancel.
 */
type Width = 'sm' | 'panel' | 'dialog' | 'wide';

const widthClasses: Record<Width, string> = {
    sm: 'max-w-sm',
    panel: 'max-w-panel',
    dialog: 'max-w-dialog',
    wide: 'max-w-2xl',
};

/**
 * What counts as focusable, for the initial focus and for the Tab cycle.
 *
 * `:not([disabled])` matters more than it looks: a modal whose primary action is disabled
 * until a field is valid — which is every form modal in this app after WALK-A-06 — would
 * otherwise focus a control that cannot be pressed, and Tab would stop on it.
 *
 * `[tabindex]:not([tabindex="-1"])` picks up the report cards and list rows that were made
 * keyboard-reachable in earlier sprints; `-1` is excluded because it means "focusable by
 * script, not in the tab order", which is exactly what it is used for here.
 */
/**
 * Which modals are open, innermost last.
 *
 * WHY A MODULE-LEVEL STACK AND NOT `stopPropagation`. A first draft attached the key handler in
 * the capture phase and called `stopPropagation`, reasoning that a stacked `ConfirmDialog` would
 * then see Escape before the modal underneath it. That is wrong, and its own test caught it:
 * both handlers are on the SAME node (`document`), and `stopPropagation` does not stop other
 * listeners on the node it fires on — only `stopImmediatePropagation` does, and that would make
 * the outcome depend on registration order, which is mount order, which is not something a
 * component should be reasoning about.
 *
 * So the question "am I the one that should respond?" is answered explicitly. Only the top of
 * the stack handles Escape and owns the Tab trap; the modal underneath ignores both, which is
 * also what stops the two traps fighting over where focus is allowed to be.
 *
 * A `useId` token rather than the element, because the panel ref is null on the first render and
 * the stack has to be maintained from an effect that runs after it.
 */
const modalStack: string[] = [];

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface ModalProps {
    /** Accessible name for the dialog. */
    label: string;
    width?: Width;
    /** Renders above another open modal (z-dialog instead of z-50). */
    stacked?: boolean;
    /**
     * Escape calls this.
     *
     * OPTIONAL, and the default is not "close anyway". A modal with no `onClose` keeps its
     * focus trap and simply does not dismiss — which is right for the two that must not be
     * escapable: `ReAttestationPrompt` (the user has to answer) and `UnsyncedSignOutDialog`
     * (dismissing it silently drops the choice). Making it required would have forced those
     * two to pass a no-op, and a no-op named `onClose` reads as a bug.
     */
    onClose?: () => void;
    className?: string;
    children: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({
    label,
    width = 'panel',
    stacked = false,
    onClose,
    className = 'p-6',
    children,
}) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const id = useId();
    /*
     * Where focus was before the modal opened, so it can go back.
     *
     * Without this, closing a modal drops focus onto `<body>` and a keyboard user restarts
     * from the top of the page — which on the sprint board means tabbing past the whole rail
     * and every card to get back to the task they just edited.
     */
    const returnFocusTo = useRef<Element | null>(null);

    const focusable = useCallback(
        () =>
            Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
                // `offsetParent === null` catches `display: none` and collapsed sections. A
                // hidden control in the tab cycle is a Tab press that appears to do nothing.
                (el) => el.offsetParent !== null || el === document.activeElement,
            ),
        [],
    );

    /*
     * Registered in a LAYOUT effect so the stack order matches mount order before any keydown
     * can arrive, and popped by identity rather than by `pop()` — a modal is not always
     * unmounted in the order it was mounted (a parent can close while a stacked confirm is
     * still open, which is what "Delete season?" over the rollover wizard does).
     */
    useLayoutEffect(() => {
        modalStack.push(id);
        return () => {
            const at = modalStack.lastIndexOf(id);
            if (at !== -1) modalStack.splice(at, 1);
        };
    }, [id]);

    useEffect(() => {
        returnFocusTo.current = document.activeElement;

        /*
         * INITIAL FOCUS, and it is deliberately NOT unconditional.
         *
         * Several modals already focus a specific control themselves — `SprintTaskDetail`
         * focuses the title input for a NEW task through `titleInputRef`, which is why the
         * walkthrough found the new-task path correct and the existing-task path broken. If
         * something inside has already claimed focus by the time this runs, leave it alone;
         * stealing it back would break the one path that was working.
         */
        const panel = panelRef.current;
        if (panel && !panel.contains(document.activeElement)) {
            const first = focusable()[0];
            // The panel itself as a fallback, so focus is INSIDE the dialog even for a modal
            // that has nothing focusable — otherwise `aria-modal` is still a broken promise.
            (first ?? panel).focus();
        }

        return () => {
            const previous = returnFocusTo.current;
            if (previous instanceof HTMLElement && document.contains(previous)) {
                previous.focus();
            }
        };
    }, [focusable]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            // Only the innermost open modal responds. See `modalStack`.
            if (modalStack[modalStack.length - 1] !== id) return;

            if (event.key === 'Escape') {
                if (!onClose) return;
                onClose();
                return;
            }

            if (event.key !== 'Tab') return;

            /*
             * THE TRAP. Only the two ends are handled: everywhere else the browser's own Tab
             * order is already correct and re-implementing it would be a second, worse
             * implementation of something that works.
             *
             * `document.activeElement` rather than `event.target`, because focus may be on the
             * panel itself (the no-focusable-children fallback above), where the browser's next
             * Tab would leave the dialog entirely.
             */
            const items = focusable();
            if (items.length === 0) {
                event.preventDefault();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;

            if (!panelRef.current?.contains(active)) {
                event.preventDefault();
                first.focus();
                return;
            }
            if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        };

        /*
         * Capture, so the trap sees Tab before anything inside the panel can act on it — a
         * component that handles Tab itself (none do today) would otherwise sit outside the
         * cycle. WHICH modal responds is decided by the stack above, not by the phase.
         */
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [focusable, onClose, id]);

    return (
        <div
            className={`fixed inset-0 bg-black/50 ${stacked ? 'z-dialog' : 'z-50'} flex items-center justify-center p-4`}
            role="dialog"
            aria-modal="true"
            aria-label={label}
        >
            <div
                ref={panelRef}
                // -1 so the panel can hold focus as a fallback without entering the tab order.
                tabIndex={-1}
                className={`bg-white dark:bg-slate-800 rounded-xl shadow-overlay w-full max-h-modal outline-none ${widthClasses[width]} ${className}`}
            >
                {children}
            </div>
        </div>
    );
};

export default Modal;
