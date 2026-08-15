import { describe, it, expect } from 'vitest';
import { getMemberDisplayName, getMemberInitials } from '../member-utils';
import { TeamMember } from '../../types';

describe('member-utils', () => {
    const defaultMember = {
        id: '1',
        teamId: 'team-1',
        role: 'student' as const,
        email: 'test@example.com',
        fullName: null,
        joinedAt: Date.now()
    } as TeamMember;

    describe('getMemberDisplayName', () => {
        it('returns full name if available', () => {
            expect(getMemberDisplayName({ ...defaultMember, fullName: 'John Doe' })).toBe('John Doe');
        });

        it('falls back to the local part of the email, not the whole address', () => {
            expect(getMemberDisplayName(defaultMember)).toBe('test');
        });

        it('returns "Unknown User" if null or undefined', () => {
            expect(getMemberDisplayName(null)).toBe('Unknown User');
            expect(getMemberDisplayName(undefined)).toBe('Unknown User');
        });

        it('accepts a caller-supplied fallback', () => {
            expect(getMemberDisplayName(null, 'Guest')).toBe('Guest');
            expect(getMemberDisplayName({ fullName: null, email: null }, 'Guest')).toBe('Guest');
        });

        it('accepts any shape carrying a name and an email', () => {
            expect(getMemberDisplayName({ fullName: 'Ada Lovelace', email: 'ada@ftc.org' })).toBe('Ada Lovelace');
            expect(getMemberDisplayName({ email: 'ada@ftc.org' })).toBe('ada');
        });
    });

    describe('getMemberInitials', () => {
        it('returns initials from full name', () => {
            expect(getMemberInitials({ ...defaultMember, fullName: 'John Doe' })).toBe('JD');
        });

        it('uses first and last name when there are middle names', () => {
            expect(getMemberInitials({ ...defaultMember, fullName: 'John Quincy Doe' })).toBe('JD');
        });

        it('returns first two letters of first name if no last name', () => {
            expect(getMemberInitials({ ...defaultMember, fullName: 'John' })).toBe('JO');
        });

        it('handles irregular whitespace without emitting "UNDEFINED"', () => {
            // Regression: splitting on a single space turned "John " into ['John', ''],
            // whose second element has no [0], producing the initials "JUNDEFINED".
            expect(getMemberInitials({ ...defaultMember, fullName: 'John ' })).toBe('JO');
            expect(getMemberInitials({ ...defaultMember, fullName: 'John  Doe' })).toBe('JD');
            expect(getMemberInitials({ ...defaultMember, fullName: '  Jane   Q   Roe  ' })).toBe('JR');
        });

        it('falls back to the email when the name is only whitespace', () => {
            expect(getMemberInitials({ ...defaultMember, fullName: '   ' })).toBe('TE');
        });

        it('falls back to email if full name is missing', () => {
            expect(getMemberInitials(defaultMember)).toBe('TE');
        });

        it('returns "?" if null or undefined', () => {
            expect(getMemberInitials(null)).toBe('?');
            expect(getMemberInitials(undefined)).toBe('?');
        });

        it('accepts a caller-supplied fallback', () => {
            expect(getMemberInitials(null, 'G')).toBe('G');
            expect(getMemberInitials({ fullName: null, email: null }, 'G')).toBe('G');
        });
    });
});
