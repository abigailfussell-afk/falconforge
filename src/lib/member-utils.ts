import { TeamMember } from '../types';

/**
 * Returns the preferred display name for a team member.
 * Falls back to 'Unknown User' if member is not found,
 * or the email address if no full name is set.
 */
export const getMemberDisplayName = (member: TeamMember | null | undefined): string => {
    if (!member) return 'Unknown User';

    if ((member.role as string) === 'demo') {
        return member.fullName || 'Demo User';
    }

    return member.fullName || member.email || 'Unknown User';
};

/**
 * Generates initials based on a team member's full name or email.
 * Defaults to '?' if both are missing.
 */
export const getMemberInitials = (member: TeamMember | null | undefined): string => {
    if (!member) return '?';

    // Check if it's a demo user first
    if ((member.role as string) === 'demo' && member.fullName) {
        return member.fullName.substring(0, 2).toUpperCase();
    }

    if (member.fullName) {
        const parts = member.fullName.trim().split(' ');
        if (parts.length > 1) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return member.fullName.substring(0, 2).toUpperCase();
    }
    if (member.email) {
        return member.email.substring(0, 2).toUpperCase();
    }
    return '?';
};
