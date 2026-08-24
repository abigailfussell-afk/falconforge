/**
 * `isMentorOrAbove` — the one spelling of "an adult or a veteran, not a student".
 *
 * It had a single caller (`AppShell`'s `canManageMeetings`) until Training needed the same set
 * for sign-offs. The reason it is a function rather than a second `||` expression is principle 9,
 * and the reason it has its own test is that both callers are UX gates whose failure mode is
 * silent: too generous and a student sees a control that the database will refuse; too strict
 * and a mentor cannot find the page they are supposed to run.
 */
import { describe, it, expect } from 'vitest';
import { isMentorOrAbove } from '../roles';

describe('isMentorOrAbove', () => {
    it('includes the admin, the coach and the mentor', () => {
        expect(isMentorOrAbove('admin')).toBe(true);
        expect(isMentorOrAbove('coach')).toBe(true);
        expect(isMentorOrAbove('mentor')).toBe(true);
    });

    it('excludes a student', () => {
        // The whole point of the predicate: `mentor` is the first role in this app that means
        // something a student's does not.
        expect(isMentorOrAbove('student')).toBe(false);
    });

    it('excludes somebody with no role at all', () => {
        /*
         * A guardian holds no membership of their own, so `currentMember` is null for them
         * permanently and `currentMember?.role` is undefined. Falling open here would offer a
         * parent the sign-off side of a page about a team they are not on.
         */
        expect(isMentorOrAbove(undefined)).toBe(false);
        expect(isMentorOrAbove(null)).toBe(false);
    });
});
