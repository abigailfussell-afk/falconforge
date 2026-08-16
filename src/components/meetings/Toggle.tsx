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

    return (
        <div className="inline-flex items-center gap-2">
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={showLabel ? undefined : label}
                disabled={disabled}
                data-testid={testId}
                onClick={() => onChange(!checked)}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-forge-500 focus:ring-offset-1 dark:focus:ring-offset-slate-800 ${
                    checked ? on : 'bg-slate-300 dark:bg-slate-600'
                }`}
            >
                <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-card transition-transform ${
                        checked ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                />
            </button>
            {showLabel && (
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{label}</span>
            )}
        </div>
    );
}
