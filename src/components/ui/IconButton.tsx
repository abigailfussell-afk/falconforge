import React from 'react';

/**
 * A toolbar/row icon button: the quiet slate control that lights up on hover. `danger`
 * shifts the hover to red for destructive icons (trash, clear) so intent reads before
 * the click. Pass `title` — an icon-only control with no tooltip is a guess.
 */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    danger?: boolean;
}

const IconButton: React.FC<IconButtonProps> = ({ danger = false, className = '', type = 'button', children, ...rest }) => (
    <button
        type={type}
        className={`p-2 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            danger
                ? 'enabled:hover:text-red-600 enabled:hover:bg-red-50 dark:enabled:hover:bg-red-900/30'
                : 'enabled:hover:text-slate-800 dark:enabled:hover:text-white enabled:hover:bg-slate-200 dark:enabled:hover:bg-slate-600'
        } ${className}`}
        {...rest}
    >
        {children}
    </button>
);

export default IconButton;
