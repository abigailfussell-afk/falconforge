/**
 * WALK-A-08 — the modal keeps the promise its ARIA makes.
 *
 * The markup was already right: `role="dialog" aria-modal="true"` with a name. That is the
 * trap rather than the fix — a screen reader is *told* this is a modal dialog and then focus is
 * left behind it, on the page underneath. The walkthrough measured it on an existing task:
 * `opened: true, focusInDialog: false, closedByEsc: false`.
 *
 * WHAT jsdom CAN AND CANNOT SEE HERE, because it decides what belongs in this file. Focus,
 * `document.activeElement`, key events and the tab CYCLE are all real in jsdom — this is DOM
 * behaviour, not layout. What jsdom cannot see is anything about size or contrast, so
 * WALK-A-09's contrast and WALK-A-10's tap targets are measured in the browser instead
 * (`scripts/probe-accessibility.mjs`) and are not faked here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Modal from '../ui/Modal';

/**
 * `offsetParent` is always null in jsdom — it has no layout — and the component filters the
 * tab cycle on it to skip `display: none` controls. Without this the cycle would be empty in
 * every test here and each one would pass for the wrong reason.
 */
beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
        configurable: true,
        get() {
            return this.parentNode;
        },
    });
});

const Dialog = ({ onClose }: { onClose?: () => void }) => (
    <Modal label="Test dialog" onClose={onClose}>
        <button type="button">First</button>
        <input aria-label="Middle" />
        <button type="button">Last</button>
    </Modal>
);

describe('focus goes into the dialog', () => {
    /*
     * THE RED TEST. Without the initial-focus effect this is `<body>` — which is exactly what
     * the walkthrough recorded, and exactly what `aria-modal="true"` promises is not the case.
     */
    it('lands on the first focusable control on open', () => {
        render(<Dialog />);
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
    });

    /*
     * DELIBERATELY NOT UNCONDITIONAL, and this is the assertion that stops the fix breaking the
     * one path that already worked. `SprintTaskDetail` focuses the title input itself for a NEW
     * task, which is why the walkthrough found the new-task path correct; stealing focus back
     * would have regressed it.
     */
    it('leaves focus alone when the modal has already claimed it', () => {
        const Claiming = () => (
            <Modal label="Claiming">
                <button type="button">First</button>
                <input aria-label="Mine" autoFocus />
            </Modal>
        );
        render(<Claiming />);
        expect(document.activeElement).toBe(screen.getByLabelText('Mine'));
    });

    /*
     * A modal with nothing focusable still has to hold focus, or `aria-modal` is a broken
     * promise in the one case nobody thinks to check — a confirm whose buttons are all
     * disabled while a request is in flight, for instance.
     */
    it('falls back to the panel when there is nothing to focus', () => {
        render(
            <Modal label="Empty">
                <p>Nothing here.</p>
            </Modal>,
        );
        expect(document.activeElement).not.toBe(document.body);
        expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    });

    /*
     * ...and it comes BACK. Without this, closing drops focus onto `<body>` and a keyboard user
     * restarts from the top of the page — on the sprint board that is the whole rail and every
     * card before they reach the task they just edited.
     */
    it('returns focus to whatever opened it', () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();

        const { unmount } = render(<Dialog />);
        expect(document.activeElement).not.toBe(opener);

        unmount();
        expect(document.activeElement).toBe(opener);
        opener.remove();
    });
});

describe('Tab is trapped', () => {
    it('wraps from the last control back to the first', () => {
        render(<Dialog />);
        const last = screen.getByRole('button', { name: 'Last' });
        last.focus();

        fireEvent.keyDown(document, { key: 'Tab' });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
    });

    it('wraps backwards from the first control to the last', () => {
        render(<Dialog />);
        screen.getByRole('button', { name: 'First' }).focus();

        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last' }));
    });

    /*
     * THE CONTROL for the two above. A trap that fires on every Tab would "pass" both by
     * pinning focus to one control, which is worse than no trap — the user cannot reach the
     * form. In the middle of the cycle the browser's own order must be left alone.
     */
    it('does not interfere in the middle of the cycle', () => {
        render(<Dialog />);
        const middle = screen.getByLabelText('Middle');
        middle.focus();

        fireEvent.keyDown(document, { key: 'Tab' });

        // Unchanged: jsdom does not move focus itself, and neither should the trap here.
        expect(document.activeElement).toBe(middle);
    });

    /*
     * Focus escaping to the page underneath is the failure this whole component exists to
     * prevent, and it is reachable in a real browser by clicking something behind the overlay.
     */
    it('pulls focus back in when it has escaped the dialog', () => {
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        render(<Dialog />);
        outside.focus();

        fireEvent.keyDown(document, { key: 'Tab' });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
        outside.remove();
    });

    /*
     * A disabled control is not in the tab cycle, and after WALK-A-06 nearly every form modal
     * opens with its primary action disabled. Focusing or stopping on one is a Tab press that
     * appears to do nothing.
     */
    it('skips disabled controls', () => {
        render(
            <Modal label="With disabled">
                <button type="button" disabled>Disabled</button>
                <button type="button">Only</button>
            </Modal>,
        );
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Only' }));
    });
});

describe('Escape', () => {
    it('closes a dismissable modal', () => {
        const onClose = vi.fn();
        render(<Dialog onClose={onClose} />);

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    /*
     * NOT EVERY MODAL IS DISMISSABLE, and the two that are not matter: `ReAttestationPrompt`
     * (the user has to answer) and `UnsyncedSignOutDialog` (dismissing silently drops the
     * choice). They pass no `onClose`, keep the trap, and must not vanish on a stray keypress —
     * which for the second one would mean losing unsynced work without deciding to.
     */
    it('does nothing when the modal has no onClose', () => {
        render(<Dialog />);
        expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    /*
     * A stacked confirm sits above another modal, and both listen on `document`. Without the
     * capture-phase handler and `stopPropagation`, one Escape dismisses both — the user presses
     * a key once and loses two screens, including the form underneath.
     */
    it('a stacked dialog closes only itself', () => {
        const closeParent = vi.fn();
        const closeChild = vi.fn();
        render(
            <>
                <Modal label="Parent" onClose={closeParent}>
                    <button type="button">Parent button</button>
                </Modal>
                <Modal label="Child" stacked onClose={closeChild}>
                    <button type="button">Child button</button>
                </Modal>
            </>,
        );

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(closeChild).toHaveBeenCalledTimes(1);
        expect(closeParent).not.toHaveBeenCalled();
    });
});

describe('the ARIA that was already right', () => {
    it('keeps its role, modality and name', () => {
        render(<Dialog />);
        const dialog = screen.getByRole('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-label')).toBe('Test dialog');
    });
});
