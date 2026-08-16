import React from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * The empty state. Seven hand-rolled designs (icon sizes 24/26/28/none, paddings py-6
 * through py-12, with and without headings) collapse to one: icon, a one-line title,
 * an optional explainer, and optionally the action that fills the emptiness.
 */
export interface EmptyStateProps {
    icon?: LucideIcon;
    title: string;
    body?: string;
    action?: React.ReactNode;
    className?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, title, body, action, className = '' }) => (
    <div className={`text-center px-4 py-10 ${className}`}>
        {Icon && <Icon size={26} className="mx-auto mb-2 text-slate-400" aria-hidden="true" />}
        <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-300">{title}</h4>
        {body && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-prose mx-auto">{body}</p>}
        {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
);

export default EmptyState;
