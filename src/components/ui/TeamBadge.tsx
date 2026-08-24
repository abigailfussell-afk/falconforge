/**
 * The team-number badge (WALK-B-07).
 *
 * There were two of these and they disagreed about which part of the number to throw away.
 * The sidebar rendered `#${teamNumber.slice(0, 2)}` and the onboarding team picker rendered
 * `#${teamNumber.slice(-3)}`, so team 30727 appeared as "#30" on one screen and "#727" on the
 * other — and neither is the team's number. FTC numbers run to five digits, so on any real
 * team both badges were wrong, in different ways, on two screens a coach sees within a minute
 * of each other. `docs/failure-modes.md` §1: each copy was correct on the day it was written
 * and nothing compared them afterwards.
 *
 * WHY NOT JUST DROP THE SLICE. Because the slice was load-bearing for the layout, which is the
 * reason it was there: both call sites are fixed-size circles (28px and 40px), and "#30727"
 * does not fit in a 28px circle at any legible size. Truncation was chosen over overflow, and
 * quietly rendering a different team's number is the worse of those two.
 *
 * So the badge is a PILL, not a circle: a fixed height with a minimum width equal to that
 * height, growing to fit its text. A one-digit team still looks like a circle; a five-digit
 * team gets a wider pill and stays readable. `tabular-nums` keeps the digits from jittering as
 * the sidebar re-renders, and `whitespace-nowrap` stops a five-digit number wrapping into two
 * lines inside a 28px-tall box, which is how the truncated version would have failed anyway.
 *
 * There is deliberately no `truncate` here. A clipped team number reads as a different, valid
 * team number — the exact defect this replaces — where an overflowing one is visibly wrong.
 */

interface TeamBadgeProps {
    /** The team's FTC number. Null/empty falls back to the team name's initial. */
    teamNumber?: string | null;
    /** The team name, used only for the no-number fallback. */
    teamName?: string | null;
    /** Height of the pill and its minimum width. */
    size?: 'sm' | 'md';
    /** Colour/shape classes for the pill itself — the two call sites do not share a palette. */
    className?: string;
    /** Text classes. */
    textClassName?: string;
}

const SIZES = {
    sm: 'h-7 min-w-7 px-1.5 rounded-full',
    md: 'h-10 min-w-10 px-2 rounded-lg',
} as const;

/**
 * The badge's text: `#12345`, or the team name's first character, or `T`.
 *
 * Exported so a test can assert the whole-number rule without rendering, and so nothing is
 * tempted to re-derive it beside a `<TeamBadge>` somewhere.
 */
export const teamBadgeLabel = (
    teamNumber?: string | null,
    teamName?: string | null,
): string => {
    const trimmed = teamNumber?.trim();
    if (trimmed) return `#${trimmed}`;
    const name = teamName?.trim();
    if (name) return name.charAt(0).toUpperCase();
    return 'T';
};

export default function TeamBadge({
    teamNumber,
    teamName,
    size = 'sm',
    className = '',
    textClassName = '',
}: TeamBadgeProps) {
    const label = teamBadgeLabel(teamNumber, teamName);

    return (
        <span
            data-testid="team-badge"
            className={`inline-flex items-center justify-center shrink-0 ${SIZES[size]} ${className}`}
        >
            <span className={`font-bold tabular-nums whitespace-nowrap ${textClassName}`}>
                {label}
            </span>
        </span>
    );
}
