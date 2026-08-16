/**
 * The FALCONFORGE wordmark.
 *
 * The same gradient-clipped two-span markup was written out five times (the loading screen,
 * the auth-callback screen, the desktop rail, the mobile header, the mobile drawer) at four
 * different sizes, and they had already drifted — three of them said `text-slate-300` for the
 * FORGE half and two said `text-slate-700 dark:text-slate-300`, so the mark rendered as
 * light-grey-on-white in light mode in two places. Rule 8 says keep the brand; keeping it
 * means having exactly one definition of it.
 *
 * `logo` is opt-in because the two full-screen states pair the mark with a much larger
 * treated logo of their own.
 */
interface WordmarkProps {
    /** Matches the surrounding type scale. */
    size?: 'sm' | 'md' | 'lg';
    /** Show the falcon logo beside the mark. */
    logo?: boolean;
    className?: string;
}

const SIZES = {
    sm: { text: 'text-base', logo: 'w-7 h-7' },
    md: { text: 'text-lg', logo: 'w-9 h-9' },
    lg: { text: 'text-2xl', logo: 'w-11 h-11' },
} as const;

export default function Wordmark({ size = 'md', logo = false, className = '' }: WordmarkProps) {
    const s = SIZES[size];

    return (
        <span className={`inline-flex items-center gap-2 ${className}`}>
            {logo && (
                <img
                    src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                    className={`${s.logo} object-contain shrink-0`}
                    alt=""
                    aria-hidden="true"
                />
            )}
            {/* One accessible name for the whole mark — without this a screen reader reads
                "FALCON" and "FORGE" as two separate strings, because the gradient fill
                requires them to be separate elements. */}
            <span className={`${s.text} font-black italic tracking-tighter whitespace-nowrap`}>
                <span className="bg-gradient-to-r from-forge-500 to-amber-500 bg-clip-text text-transparent">
                    FALCON
                </span>
                <span className="text-slate-700 dark:text-slate-300">FORGE</span>
            </span>
        </span>
    );
}
