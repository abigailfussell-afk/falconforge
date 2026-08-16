import React from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * A card's section header. The Admin page stacked five different treatments (icons at
 * 24/20/18, headings at h3/h4, 16px/600 next to 16px/700, rules on some) — peers that
 * should read as peers. One recipe: 18px forge icon, `text-base font-bold`, bottom rule,
 * optional right-aligned action.
 */
export interface SectionHeaderProps {
    icon?: LucideIcon;
    title: string;
    action?: React.ReactNode;
    className?: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ icon: Icon, title, action, className = '' }) => (
    <div
        className={`flex items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-200 dark:border-slate-700 ${className}`}
    >
        <h3 className="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-white">
            {Icon && <Icon size={18} className="text-forge-600 dark:text-forge-400" aria-hidden="true" />}
            {title}
        </h3>
        {action}
    </div>
);

export default SectionHeader;
