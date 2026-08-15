/**
 * Canonical display-name and initials logic.
 *
 * Six copies of this used to exist (here, user-context, SprintPlanning, SprintTaskActivity,
 * PreMatchChecklist, MemberManager) and they did not agree: five rendered the local part of
 * the email as a fallback, this one rendered the whole address; three split names on /\s+/,
 * this one on a single space. The same person could therefore appear under two different
 * names on two screens.
 *
 * The majority behaviours won. The local part is what the compact chips and avatars were
 * designed around, and splitting on /\s+/ avoids a real crash-adjacent bug: with a single
 * space, a trailing space in a full name ("Jane ") produced the initials "JUNDEFINED".
 */

/**
 * The minimum shape needed to name someone. Structural rather than `TeamMember` so the
 * currentUser record and pending-invite rows can use the same logic without being cast.
 */
export interface NamedPerson {
    fullName?: string | null;
    email?: string | null;
}

/**
 * Preferred display name: full name, else the local part of the email, else the fallback.
 */
export const getMemberDisplayName = (
    person: NamedPerson | null | undefined,
    fallback = 'Unknown User'
): string => {
    if (!person) return fallback;
    if (person.fullName) return person.fullName;
    if (person.email) return person.email.split('@')[0];
    return fallback;
};

/**
 * Initials: first and last initial of the full name, else its first two characters, else the
 * first two characters of the email, else the fallback.
 */
export const getMemberInitials = (
    person: NamedPerson | null | undefined,
    fallback = '?'
): string => {
    if (!person) return fallback;

    if (person.fullName) {
        const parts = person.fullName.trim().split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
        }
        if (parts.length === 1) {
            return parts[0].substring(0, 2).toUpperCase();
        }
        // A name of nothing but whitespace — fall through to the email.
    }

    if (person.email) {
        return person.email.substring(0, 2).toUpperCase();
    }

    return fallback;
};
