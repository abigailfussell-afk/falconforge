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

        it('falls back to email if full name is missing', () => {
            expect(getMemberDisplayName(defaultMember)).toBe('test@example.com');
        });

        it('returns "Unknown User" if null or undefined', () => {
            expect(getMemberDisplayName(null)).toBe('Unknown User');
            expect(getMemberDisplayName(undefined)).toBe('Unknown User');
        });
    });

    describe('getMemberInitials', () => {
        it('returns initials from full name', () => {
            expect(getMemberInitials({ ...defaultMember, fullName: 'John Doe' })).toBe('JD');
        });

        it('returns first two letters of first name if no last name', () => {
            expect(getMemberInitials({ ...defaultMember, fullName: 'John' })).toBe('JO');
        });

        it('falls back to email if full name is missing', () => {
            expect(getMemberInitials(defaultMember)).toBe('TE');
        });

        it('returns "?" if null or undefined', () => {
            expect(getMemberInitials(null)).toBe('?');
            expect(getMemberInitials(undefined)).toBe('?');
        });
    });
});
