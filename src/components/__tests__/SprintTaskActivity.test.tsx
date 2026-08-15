/**
 * Author resolution in the task activity feed.
 *
 * This is the only real logic that was buried in SprintPlanning's 250-line inline modal:
 * a timeline entry's author can be the signed-in user, the "System" pseudo-author used for
 * automatic history entries, another member of the roster, or -- for a comment left by
 * someone since removed from the team -- nobody nameable at all. That last case had no
 * coverage before the split.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SprintTaskActivity from '../SprintTaskActivity';
import type { TeamMember, TimelineEvent } from '../../types';

const mockUseCurrentUser = vi.fn();
vi.mock('../../lib/user-context', () => ({
    useCurrentUser: () => mockUseCurrentUser(),
}));

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
    id: 'member-1',
    teamId: 'team-1',
    userId: 'user-1',
    role: 'student',
    status: 'approved',
    seatAssigned: false,
    fullName: 'Ada Lovelace',
    email: 'ada@example.com',
    avatarUrl: null,
    joinedAt: 1000,
    ...over,
});

const event = (over: Partial<TimelineEvent> = {}): TimelineEvent => ({
    id: 'e1',
    type: 'comment',
    authorId: 'member-1',
    content: 'Intake jams on the third cone',
    timestamp: 1_700_000_000_000,
    ...over,
});

beforeEach(() => {
    mockUseCurrentUser.mockReturnValue({
        currentUser: { id: 'user-signed-in' },
        displayName: 'Signed In User',
        initials: 'SI',
    });
});

const renderFeed = (props: Partial<React.ComponentProps<typeof SprintTaskActivity>> = {}) =>
    render(
        <SprintTaskActivity
            timeline={[event()]}
            teamMembers={[member()]}
            onAddComment={vi.fn()}
            onDeleteComment={vi.fn()}
            {...props}
        />,
    );

describe('author resolution', () => {
    it('names a roster member', () => {
        renderFeed();
        expect(screen.getByText('Ada Lovelace')).toBeDefined();
        expect(screen.getByText('AL')).toBeDefined();
    });

    it('uses the signed-in user display name for their own comments', () => {
        renderFeed({ timeline: [event({ authorId: 'user-signed-in' })] });
        expect(screen.getByText('Signed In User')).toBeDefined();
        expect(screen.getByText('SI')).toBeDefined();
    });

    it('labels automatic history entries as System', () => {
        renderFeed({ timeline: [event({ authorId: 'System', type: 'history' })] });
        expect(screen.getByText('System')).toBeDefined();
        expect(screen.getByText('S')).toBeDefined();
    });

    it('falls back to Guest for an author no longer on the team', () => {
        // A student leaves the team; their comments must still render rather than showing
        // a blank name or crashing on the missing member lookup.
        renderFeed({ timeline: [event({ authorId: 'departed-member' })] });
        expect(screen.getByText('Guest')).toBeDefined();
        expect(screen.getByText('G')).toBeDefined();
    });

    it('derives initials from the email when a member has no full name', () => {
        renderFeed({ teamMembers: [member({ fullName: null, email: 'zoe@example.com' })] });
        expect(screen.getByText('zoe')).toBeDefined();
        expect(screen.getByText('ZO')).toBeDefined();
    });

    it('handles a single-word name without indexing past the end', () => {
        renderFeed({ teamMembers: [member({ fullName: 'Prince' })] });
        expect(screen.getByText('PR')).toBeDefined();
    });
});

describe('comment box', () => {
    it('submits a comment and clears the input', () => {
        const onAddComment = vi.fn();
        renderFeed({ onAddComment });

        const input = screen.getByPlaceholderText('Add a comment...') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Try a softer compliant wheel' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onAddComment).toHaveBeenCalledWith('Try a softer compliant wheel');
        expect(input.value).toBe('');
    });

    it('ignores whitespace-only comments', () => {
        const onAddComment = vi.fn();
        renderFeed({ onAddComment });

        const input = screen.getByPlaceholderText('Add a comment...');
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onAddComment).not.toHaveBeenCalled();
    });

    it('offers delete on comments but not on history entries', () => {
        renderFeed({
            timeline: [event({ id: 'c1', type: 'comment' }), event({ id: 'h1', type: 'history' })],
        });

        // Only the comment is deletable -- history is a record of what happened.
        expect(screen.getAllByText('Delete')).toHaveLength(1);
    });

    it('passes the right id when deleting', () => {
        const onDeleteComment = vi.fn();
        renderFeed({ timeline: [event({ id: 'comment-42' })], onDeleteComment });

        fireEvent.click(screen.getByText('Delete'));

        expect(onDeleteComment).toHaveBeenCalledWith('comment-42');
    });
});
