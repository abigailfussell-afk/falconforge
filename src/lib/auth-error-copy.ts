/**
 * Turning GoTrue's error strings into something a coach can act on (OPS-06).
 *
 * `Login.tsx` passed `error.message` straight to the screen. Most of the time that is fine —
 * "Invalid login credentials" says what it means. Two of them are not fine, and they are the two
 * that will actually happen on the evening this product is most likely to be judged:
 *
 *   "Error sending confirmation email"  — Resend's free tier is 100 emails a day, and a 20-member
 *                                          team costs ~23. Four teams onboarding on the same
 *                                          evening exhausts it (OPS-06).
 *   "email rate limit exceeded"         — Supabase's own hourly cap, 100/h.
 *
 * Both are temporary, neither is the user's fault, and both used to arrive as a bare sentence
 * with no suggestion of what to do — so a coach standing in front of twenty students concludes
 * the product is broken. Which, for the next hour, it is; the difference is whether they know to
 * come back.
 *
 * WHY MAPPING, NOT CATCHING
 *
 * The string is all there is. GoTrue does not distinguish these with a code, so matching the
 * message is the only handle available. That makes this fragile to an upstream rewording — which
 * is why the fallback is the ORIGINAL message rather than a generic apology: if the match ever
 * stops working, the user is no worse off than before this existed, and the failure is visible
 * rather than swallowed.
 */

interface Mapping {
    /** Lowercased substring to look for in GoTrue's message. */
    match: string;
    friendly: string;
}

const MAPPINGS: Mapping[] = [
    {
        // Resend refused: the daily ceiling. Nothing is wrong with the account.
        match: 'error sending confirmation email',
        friendly:
            'We could not send your confirmation email just now — this is our limit, not a ' +
            'problem with your details. Please try again in an hour, or ask your coach to ' +
            'contact support@falcon-forge.com and we will sort it out.',
    },
    {
        // Supabase's own hourly cap.
        match: 'email rate limit exceeded',
        friendly:
            'Too many emails have been sent from FalconForge in the last hour. Please try ' +
            'again shortly — your details are fine, and nothing has been lost.',
    },
    {
        // The same ceiling reached through a password reset.
        match: 'error sending recovery email',
        friendly:
            'We could not send your reset email just now. Please try again in an hour, or ' +
            'contact support@falcon-forge.com.',
    },
];

/**
 * The message to put on screen for an auth failure.
 *
 * Returns the original when nothing matches, deliberately: an unrecognised error the user can
 * read is more useful than a friendly sentence that describes the wrong problem.
 */
export function friendlyAuthError(message: string | undefined | null): string {
    if (!message) return 'Something went wrong. Please try again.';
    const haystack = message.toLowerCase();
    return MAPPINGS.find((m) => haystack.includes(m.match))?.friendly ?? message;
}

/** Is this one of the "come back later" cases, rather than something the user can fix? */
export function isTemporaryAuthError(message: string | undefined | null): boolean {
    if (!message) return false;
    const haystack = message.toLowerCase();
    return MAPPINGS.some((m) => haystack.includes(m.match));
}
