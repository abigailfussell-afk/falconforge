import type { MemberRole } from '../types';

/**
 * The adults-and-veterans set: admin, coach or mentor.
 *
 * WHY THIS IS A FUNCTION AND NOT AN EXPRESSION IN TWO PLACES
 *
 * This predicate had exactly one caller until the Training stub arrived —
 * `AppShell`'s `canManageMeetings`, which mirrors the server's `can_manage_meetings`. Training
 * needs the same SET for a different REASON: the design's role table
 * (`docs/assessment-2026-08/training-onboarding-design.md` section 2.2) gives sign-off to
 * admin, coach and mentor, and withholds it from students and from guardians acting for a
 * child. Writing `canManageTeam || role === 'mentor'` a second time would be two spellings of
 * one rule that a later capability split would have to find twice — principle 9, and the
 * cheapest possible moment to apply it is while the second copy is still hypothetical.
 *
 * The two NAMES stay distinct on purpose. They coincide today; they are not the same question,
 * and when P-06 gives training its own `can_sign_off_training` capability this is the seam that
 * lets one move without the other.
 *
 * UX, NOT SECURITY, in both callers. Nothing here is a boundary: the Meetings page's writes are
 * refused by RLS regardless of what the client renders, and the Training stub writes nothing at
 * all.
 */
export function isMentorOrAbove(role?: MemberRole | null): boolean {
    return role === 'admin' || role === 'coach' || role === 'mentor';
}
