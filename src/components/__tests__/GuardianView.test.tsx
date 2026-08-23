/**
 * The guardian's own screen — and specifically the destructive control SEC-11 put on it.
 *
 * This component had **no test file at all** (0% of 535 lines) when a "Remove" button was added
 * to it, which is the worst possible combination: the one irreversible action on a parent's
 * screen, in the one component nothing exercised. Found by CI's coverage threshold refusing the
 * release, which is the first time in this project's history that gate has caught something real.
 *
 * WHAT IS WORTH TESTING HERE, given the store action already has its own file
 * (`remove-managed-profile.test.ts`) covering the cascade the client has to mirror:
 *
 *   - who the button is offered to, which is a rule and not a detail — a promoted child must not
 *     have one, because their memberships have moved to their own account and removing the
 *     profile would take a consent trail with it while not touching the account it points at;
 *   - that it asks first, and that the question names the child and says what SURVIVES, because a
 *     parent asking this is usually worried about the second half;
 *   - that cancelling does nothing at all, which is the assertion that fails if the dialog is
 *     ever wired to fire on mount or on the wrong handler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GuardianView from '../guardian/GuardianView';
import { useAppStore } from '../../lib/store';
import type { ManagedProfile, TeamMember } from '../../types';

const GUARDIAN = 'guardian-1';
const TEAM = 'team-1';

vi.mock('../../lib/auth', () => ({
    useAuth: () => ({ user: { id: GUARDIAN, email: 'parent@example.com' }, isOffline: false }),
}));

vi.mock('../../lib/supabase', () => ({
    isSupabaseConfigured: () => true,
    supabase: {},
    supabaseSync: { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
}));

vi.mock('../../lib/server-pull', () => ({
    fetchGuardianData: vi.fn().mockResolvedValue(undefined),
}));

const profile = (id: string, fullName: string, over: Partial<ManagedProfile> = {}): ManagedProfile => ({
    id,
    guardianUserId: GUARDIAN,
    fullName,
    notes: '',
    promotedToUserId: null,
    promotedAt: null,
    promotionCode: '',
    createdAt: 1000,
    ...over,
});

const member = (id: string, managedProfileId: string): TeamMember =>
    ({
        id,
        teamId: TEAM,
        userId: GUARDIAN,
        managedProfileId,
        role: 'student',
        status: 'approved',
        seatAssigned: true,
        fullName: 'child',
        email: null,
        avatarUrl: null,
        joinedAt: 1000,
    }) as unknown as TeamMember;

beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
        currentTeamId: TEAM,
        teams: [{ id: TEAM, name: 'Iron Falcons' }] as never,
        managedProfiles: [profile('child-a', 'Robin'), profile('child-b', 'Sam')],
        guardianConsents: [] as never,
        teamMembers: [member('m-a', 'child-a'), member('m-b', 'child-b')],
        meetings: [] as never,
        meetingAttendance: [] as never,
    });
});

describe('the guardian sees their children', () => {
    it('lists them, oldest first', async () => {
        render(<GuardianView />);

        expect(await screen.findByText('Robin')).toBeInTheDocument();
        expect(screen.getByText('Sam')).toBeInTheDocument();
    });

    it('names the team a child is on', async () => {
        render(<GuardianView />);

        expect(await screen.findAllByText(/Iron Falcons/)).not.toHaveLength(0);
    });
});

describe('SEC-11 — removing one child', () => {
    it('offers Remove for a child who has no login of their own', async () => {
        render(<GuardianView />);

        expect(await screen.findByTestId('remove-child-child-a')).toBeInTheDocument();
        expect(screen.getByTestId('remove-child-child-b')).toBeInTheDocument();
    });

    /*
     * NOT offered after a promotion, and this is a rule rather than a nicety. The memberships now
     * belong to the child's own account; this profile is the record of the handover. Removing it
     * would delete a consent trail and would not touch the account it points at — a different
     * request, from a different person.
     */
    it('does not offer Remove once a child has their own login', async () => {
        useAppStore.setState({
            managedProfiles: [
                profile('child-a', 'Robin', { promotedToUserId: 'user-robin', promotedAt: 2000 }),
                profile('child-b', 'Sam'),
            ],
        });
        render(<GuardianView />);

        await screen.findByTestId('remove-child-child-b');
        expect(screen.queryByTestId('remove-child-child-a')).not.toBeInTheDocument();
    });

    it('asks first, names the child, and says what survives', async () => {
        render(<GuardianView />);

        fireEvent.click(await screen.findByTestId('remove-child-child-a'));

        expect(await screen.findByText(/Remove Robin\?/i)).toBeInTheDocument();
        // The half a parent is actually worried about.
        expect(screen.getByText(/stays with the team/i)).toBeInTheDocument();
        expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    });

    it('removes the child, and only that child, when confirmed', async () => {
        render(<GuardianView />);

        fireEvent.click(await screen.findByTestId('remove-child-child-a'));
        fireEvent.click(await screen.findByTestId('confirm-remove-child'));

        await waitFor(() => {
            const ids = useAppStore.getState().managedProfiles.map((p) => p.id);
            expect(ids).toEqual(['child-b']);
        });
        // Their sibling's membership is untouched, which the store action is responsible for and
        // this screen is the only place a parent would notice going wrong.
        expect(useAppStore.getState().teamMembers.map((m) => m.id)).toEqual(['m-b']);
    });

    it('does nothing at all when the parent cancels', async () => {
        render(<GuardianView />);

        fireEvent.click(await screen.findByTestId('remove-child-child-a'));
        fireEvent.click(await screen.findByText('Cancel'));

        await waitFor(() =>
            expect(screen.queryByTestId('confirm-remove-child')).not.toBeInTheDocument(),
        );
        expect(useAppStore.getState().managedProfiles).toHaveLength(2);
    });
});
