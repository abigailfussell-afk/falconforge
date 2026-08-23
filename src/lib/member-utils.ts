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


/**
 * Who is on this team's roster right now.
 *
 * SEC-03. "Remove from team" used to `DELETE` the `team_members` row — which failed outright
 * for anyone with a task, a scouting report or a meeting (`23502`; five composite foreign keys
 * with a NOT NULL `team_id`) and destroyed their attendance when it succeeded. It now sets
 * `status = 'removed'`, the value the schema, `join_team_with_invite`'s rejoin branch and the
 * one-admin partial index have all expected since Sprint 3 and nothing ever wrote.
 *
 * `pullFromServer` already filters `team_members` to `status = 'approved'`, so the ordinary
 * roster never carries a removed row and this is NOT a second copy of that rule. It exists for
 * the one path that bypasses it: `pullGuardianMemberships` merges a guardian's children in at
 * EVERY status, deliberately, so a coach who is also a parent has their own removed child in
 * the same collection every assignee picker reads. Applied once, in `AppShell`, where the
 * roster is assembled — not at each picker, because "who is on the team" having four
 * definitions is `docs/failure-modes.md` §1 and this project's most frequent defect.
 */
export const isActiveMember = (member: { status?: string | null }): boolean =>
    member.status !== 'removed';
