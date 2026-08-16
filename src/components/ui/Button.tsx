import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * The button recipe. Sprint 5.5: the app had eight hand-rolled primary-button styles
 * (two of them identical except for a shadow), three disabled opacities and three cancel
 * variants — every one of them a reasonable choice locally and a visible inconsistency
 * globally. One component makes the drift impossible instead of policed.
 *
 * `enabled:hover:*` rather than `hover:*` so a disabled button does not light up under
 * the pointer. `busy` renders the spinner AND disables — an async action never needs to
 * wire those separately, which is how Approve got a spinner and Reject didn't.
 */
type Variant = 'primary' | 'secondary' | 'danger';
type Size = 'md' | 'sm';

const variantClasses: Record<Variant, string> = {
    primary: 'bg-forge-600 text-white font-semibold shadow-card enabled:hover:bg-forge-700',
    secondary:
        'text-slate-600 dark:text-slate-300 font-medium enabled:hover:bg-slate-100 dark:enabled:hover:bg-slate-700',
    danger: 'bg-red-600 text-white font-medium enabled:hover:bg-red-700',
};

const sizeClasses: Record<Size, string> = {
    md: 'px-4 py-2 text-sm',
    sm: 'px-3 py-1.5 text-sm',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant;
    size?: Size;
    /** Shows a spinner and disables the control while an async action is in flight. */
    busy?: boolean;
}

const Button: React.FC<ButtonProps> = ({
    variant = 'primary',
    size = 'md',
    busy = false,
    disabled,
    className = '',
    type = 'button',
    children,
    ...rest
}) => (
    <button
        type={type}
        disabled={disabled || busy}
        className={`inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...rest}
    >
        {busy && <Loader2 size={16} className="animate-spin" data-testid="button-spinner" />}
        {children}
    </button>
);

export default Button;
