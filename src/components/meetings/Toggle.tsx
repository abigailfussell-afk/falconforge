import { useId } from 'react';

/**
 * The switch the mockups use for "Show past events", "Repeats" and "Attendance tracking".
 *
 * A real `<button role="switch">` rather than a styled checkbox: `aria-checked` is what a
 * screen reader needs to announce "on"/"off", and the app already learned in Sprint 5.5 that
 * a div with a click handler is a control nobody can reach with a keyboard.
 */
export interface ToggleProps {
    checked: boolean;
    onChange: (next: boolean) => void;
    /** Accessible name. Rendered as the visible label when `showLabel`. */
    label: string;
    showLabel?: boolean;
    /** Orange when on. The attendance and repeat switches in 1b use the brand colour. */
    tone?: 'forge' | 'teal';
    disabled?: boolean;
    'data-testid'?: string;
}

export default function Toggle({
    checked,
    onChange,
    label,
    showLabel = false,
    tone = 'forge',
    disabled = false,
    'data-testid': testId,
}: ToggleProps) {
    const on = tone === 'teal' ? 'bg-teal-500' : 'bg-forge-500';
    const labelId = useId();

    return (
        <div className="inline-flex items-center gap-2">
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                /*
                 * WALK-A-09. `showLabel ? undefined : label` looked like the careful choice —
                 * don't repeat a name the user can already see — and was the bug: the visible
                 * text is a SIBLING <span>, not the button's content, so nothing associated the
                 * two and the switch had no accessible name at all. axe reported it as a
                 * critical `button-name` on /app/meetings; a screen reader announced "switch,
                 * on".
                 *
                 * `aria-labelledby` rather than always-on `aria-label`, so the announced name is
                 * the same string the user is looking at and cannot drift from it.
                 */
                aria-label={showLabel ? undefined : label}
                aria-labelledby={showLabel ? labelId : undefined}
                disabled={disabled}
                data-testid={testId}
                onClick={() => onChange(!checked)}
                // `p-0`: a <button> carries user-agent padding, and the knob is positioned
                // from the content box, so the padding would offset it.
                className={`relative h-5 w-9 shrink-0 p-0 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-forge-500 focus:ring-offset-1 dark:focus:ring-offset-slate-800 ${
                    checked ? on : 'bg-slate-300 dark:bg-slate-600'
                }`}
            >
                {/*
                 * `left-0` is not decoration — without it the knob was never positioned at all.
                 *
                 * An absolutely positioned element with `left: auto` falls at its STATIC
                 * position: where it would have sat in normal flow. A <button> centres its
                 * inline content, so the knob started life centred in the track and the
                 * `translate-x-4` then pushed it 14px past the right edge — measured, on the
                 * "on" state of every switch in the feature. It read as roughly-correct at
                 * desktop size and obviously wrong on a phone, which is where Kevin saw it.
                 *
                 * Anchored at `left-0` the geometry is arithmetic rather than luck: a 36px
                 * track, a 16px knob and 2px of inset each side leave exactly 16px of travel,
                 * which is what `translate-x-4` moves. Change any of the three and the other
                 * two have to move with it.
                 */}
                <span
                    className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-card transition-transform ${
                        checked ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
            </button>
            {showLabel && (
                <span id={labelId} className="text-sm font-medium text-slate-600 dark:text-slate-300">{label}</span>
            )}
        </div>
    );
}
