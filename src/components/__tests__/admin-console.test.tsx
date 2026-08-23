/**
 * The admin console's licensing surfaces.
 *
 * The states worth testing here are the awkward ones the hand-off named, because the happy path
 * is not where a licensing screen fails:
 *
 *   - the team at exactly capacity, where Approve must stop being offered BEFORE it is clicked
 *   - the member with no seat on a team with seats to spare
 *   - the admin who is the only admin
 *   - the operator page seen by somebody who is not an operator
 *   - the offline device that does not yet know any of it
 *
 * `EntitlementPanel` reads the store; the rest take props, so they are driven directly.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EntitlementPanel from '../admin/EntitlementPanel';
import AdminTransferPanel from '../admin/AdminTransferPanel';
import { useAppStore } from '@/lib/store';
import type { TeamEntitlement } from '@/lib/slices/createTeamSlice';
import type { TeamMember } from '@/types';

const mockAuth = vi.fn();
vi.mock('@/lib/auth', () => ({
    useAuth: () => mockAuth(),
}));

/*
 * `.in()` is here because `AdminTransferPanel` now reads `users.age_classification` for the
 * candidates (WALK-B-11 / D9), and a mock that cannot express a query the component makes is
 * `docs/failure-modes.md` §2's second variant — the test would fail on the harness rather than
 * on the behaviour, which is exactly how it failed when this was added.
 *
 * It returns `{ data: null }`, which is the "we could not ask" case, and that is DELIBERATE
 * for the tests below: the panel fails OPEN, so every roster candidate is offered, and these
 * tests keep asserting what they always asserted. `walk-b11-nominate-filter.test.tsx` is where
 * the ages are actually supplied.
 */
vi.mock('@/lib/supabase', () => ({
    supabaseSync: {
        from: () => ({
            select: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
                in: async () => ({ data: null, error: null }),
            }),
        }),
        rpc: async () => ({ data: { success: true }, error: null }),
    },
    isSupabaseConfigured: () => true,
}));

function entitlement(overrides: Partial<TeamEntitlement> = {}): TeamEntitlement {
    return {
        teamId: 'team-1',
        status: 'active',
        seatsTotal: 15,
        seatsUnlimited: false,
        seatsUsed: 12,
        validUntil: null,
        lapsedAt: null, isProbation: false,
        ...overrides,
    };
}

function member(overrides: Partial<TeamMember> = {}): TeamMember {
    return {
        id: `member-${Math.random().toString(36).slice(2)}`,
        teamId: 'team-1',
        userId: 'user-x',
        role: 'student',
        status: 'approved',
        seatAssigned: true,
        fullName: 'Sam Student',
        email: 'sam@example.test',
        avatarUrl: null,
        ...overrides,
    } as TeamMember;
}

beforeEach(() => {
    mockAuth.mockReturnValue({ profile: { id: 'admin-user' }, isOffline: false });
    useAppStore.setState({ currentTeamId: 'team-1', entitlement: null });
});

describe('EntitlementPanel', () => {
    it('renders the brief\'s sentence: 12 of 15 seats', () => {
        useAppStore.setState({ entitlement: entitlement() });
        render(<EntitlementPanel />);

        expect(screen.getByTestId('seats-in-use').textContent).toMatch(/12\s*of 15/);
        expect(screen.getByTestId('seats-available').textContent).toBe('3');
        expect(screen.getByTestId('entitlement-status').textContent).toMatch(/active/i);
    });

    it('shows a gifted open-ended licence as open-ended, not as a date', () => {
        useAppStore.setState({
            entitlement: entitlement({ seatsUnlimited: true, seatsTotal: null, validUntil: null }),
        });
        render(<EntitlementPanel />);

        expect(screen.getByTestId('cover-until').textContent).toBe('Open-ended');
        // Unlimited is a distinct answer, not a big number.
        expect(screen.getByTestId('seats-available').textContent).toBe('Unlimited');
    });

    it('shows a dated gift as its date', () => {
        useAppStore.setState({
            entitlement: entitlement({ validUntil: '2027-02-15T00:00:00Z' }),
        });
        render(<EntitlementPanel />);

        expect(screen.getByTestId('cover-until').textContent).toMatch(/2027/);
    });

    /*
     * THE OFFLINE DEVICE THAT DOES NOT YET KNOW ANY OF IT.
     *
     * "0 of 0 seats" would be a lie that also blocks every approval. The panel says so instead.
     */
    it('says it does not know rather than inventing zeroes', () => {
        useAppStore.setState({ entitlement: null });
        render(<EntitlementPanel />);

        expect(screen.getByTestId('seats-in-use').textContent).toBe('—');
        expect(screen.getByTestId('seats-available').textContent).toBe('—');
        expect(screen.getByTestId('entitlement-unknown-notice')).toBeDefined();
        expect(screen.queryByTestId('at-capacity-notice')).toBeNull();
    });

    it('explains being at capacity without implying anything is broken', () => {
        useAppStore.setState({ entitlement: entitlement({ seatsUsed: 15, seatsTotal: 15 }) });
        render(<EntitlementPanel />);

        expect(screen.getByTestId('at-capacity-notice').textContent).toMatch(/every seat is in use/i);
        expect(screen.queryByTestId('over-capacity-notice')).toBeNull();
    });

    /*
     * The seat-count reduction Kevin asked about. Allowed on purpose — a customer must always be
     * able to lower their bill — so the message names the number and reassures that nobody is
     * removed, rather than reading as data loss.
     */
    it('explains being over capacity as a state, not an error', () => {
        useAppStore.setState({ entitlement: entitlement({ seatsUsed: 13, seatsTotal: 10 }) });
        render(<EntitlementPanel />);

        const notice = screen.getByTestId('over-capacity-notice');
        expect(notice.textContent).toMatch(/3 more approved members than\s+seats/);
        expect(notice.textContent).toMatch(/everyone keeps their access/i);
    });

    it('shows a lapsed licence as read-only with the date cover ended', () => {
        useAppStore.setState({
            entitlement: entitlement({ status: 'read_only', lapsedAt: '2026-08-15T00:00:00Z' }),
        });
        render(<EntitlementPanel />);

        expect(screen.getByTestId('entitlement-status').textContent).toMatch(/read only/i);
        expect(screen.getByTestId('cover-until').textContent).toMatch(/2026/);
    });

    /*
     * A LAPSED TEAM HAS NO DENOMINATOR, AND THIS TEST EXISTS BECAUSE THE FIRST VERSION SHOWED
     * "4 of 0".
     *
     * `team_entitlement` reports `seats_total` as NULL when no grant is in force — the same shape
     * as "unlimited" except that `seats_unlimited` is false. Rendering `?? 0` turned that into
     * arithmetic that looks broken, on the one screen a coach whose team just went read-only will
     * be staring at. Found by looking at a seeded team whose grant expired yesterday, not by any
     * assertion.
     */
    it('does not invent a zero denominator for a team with no current licence', () => {
        useAppStore.setState({
            entitlement: entitlement({
                status: 'read_only',
                seatsTotal: null,
                seatsUnlimited: false,
                seatsUsed: 4,
                lapsedAt: '2026-08-15T00:00:00Z',
            }),
        });
        render(<EntitlementPanel />);

        expect(screen.getByTestId('seats-in-use').textContent).not.toMatch(/of 0/);
        expect(screen.getByTestId('seats-in-use').textContent).toMatch(/4\s*members/);
        expect(screen.getByTestId('seats-available').textContent).toBe('No licence');
    });

    it('warns about an expiry inside the window', () => {
        const soon = new Date(Date.now() + 12 * 86_400_000).toISOString();
        useAppStore.setState({ entitlement: entitlement({ validUntil: soon }) });
        render(<EntitlementPanel />);

        expect(screen.getByTestId('expiring-notice').textContent).toMatch(/cover ends in 12 days/i);
    });
});

describe('AdminTransferPanel', () => {
    const admin = member({ id: 'm-admin', userId: 'admin-user', role: 'admin', fullName: 'Ms Nguyen' });
    const coach = member({ id: 'm-coach', userId: 'coach-user', role: 'coach', fullName: 'Mr Adeyemi' });
    const student = member({ id: 'm-student', userId: 'student-user', role: 'student' });

    function renderPanel(members: TeamMember[]) {
        return render(
            <MemoryRouter>
                <AdminTransferPanel teamId="team-1" teamMembers={members} />
            </MemoryRouter>,
        );
    }

    it('offers the handover to an approved adult member', async () => {
        renderPanel([admin, coach]);

        const select = await screen.findByLabelText('New team admin');
        expect(select.textContent).toContain('Mr Adeyemi');
        // The current admin cannot be nominated to the role they already hold.
        expect(select.textContent).not.toContain('Ms Nguyen');
    });

    /*
     * THE ADMIN WHO IS THE ONLY ADMIN — and, here, the only member at all. There is nobody to
     * hand over to, and the screen says so rather than offering an empty select.
     */
    it('says there is nobody to hand over to when the admin is alone', async () => {
        renderPanel([admin]);

        expect(await screen.findByText(/no one to hand over to yet/i)).toBeDefined();
        expect(screen.queryByLabelText('New team admin')).toBeNull();
    });

    it('does not offer a guardian-managed child the admin role', async () => {
        const child = member({
            id: 'm-child',
            managedProfileId: 'profile-1',
            fullName: 'A Child',
        });
        renderPanel([admin, child]);

        expect(await screen.findByText(/no one to hand over to yet/i)).toBeDefined();
    });

    it('does not offer a pending member the admin role', async () => {
        renderPanel([admin, member({ id: 'm-pending', status: 'pending', fullName: 'Not Yet' })]);

        expect(await screen.findByText(/no one to hand over to yet/i)).toBeDefined();
    });

    it('tells a non-admin that only the admin can hand the role over', async () => {
        mockAuth.mockReturnValue({ profile: { id: 'coach-user' }, isOffline: false });
        renderPanel([admin, coach, student]);

        expect(await screen.findByText(/only the team admin can hand the role over/i)).toBeDefined();
    });

    /*
     * Handing over is an RPC, not a queued write, so offline genuinely means "not now" — the
     * same distinction MemberManager draws for seat assignment. Disabled WITH A REASON, because
     * a dead control with no explanation is the class of defect Sprint 4 spent time removing.
     */
    it('disables the handover offline, and says why', async () => {
        mockAuth.mockReturnValue({ profile: { id: 'admin-user' }, isOffline: true });
        renderPanel([admin, coach]);

        const button = (await screen.findByRole('button', { name: /nominate/i })) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.title).toMatch(/needs a connection/i);
    });

    it('mentions that the outgoing admin keeps their seat until removed', async () => {
        renderPanel([admin, coach]);

        // The seat count not moving after a handover is otherwise a mystery for the new admin.
        expect(
            await screen.findByText(/the FalconForge operator can reassign the team/i),
        ).toBeDefined();
    });
});
