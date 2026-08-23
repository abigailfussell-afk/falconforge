/**
 * WALK-B-09 — a self-serve team is not told it was given a gift.
 * WALK-B-11 — the "New team admin" picker stops listing accounts the server will refuse.
 *
 * Neither ID has a block in `docs/assessment-2026-08/exit-criteria.md`. Sprint 17 wrote its
 * own definition of done for both, the way Sprint 11 did for SYNC-15, and the sprint report
 * says so and states them. This file is the executable half of those definitions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import EntitlementPanel from '../admin/EntitlementPanel';
import AdminTransferPanel from '../admin/AdminTransferPanel';
import { useAppStore } from '../../lib/store';
import type { TeamEntitlement } from '../../lib/slices/createTeamSlice';
import type { TeamMember } from '../../types';

const mocks = vi.hoisted(() => ({
    /** `users.age_classification` keyed by user id, or null for "we could not ask". */
    ages: null as Record<string, string | null> | null,
    profileId: 'user-admin',
}));

vi.mock('../../lib/auth', () => ({
    useAuth: () => ({
        profile: { id: mocks.profileId, email: 'a@b.c', fullName: 'The Admin', avatarUrl: null },
        isOffline: false,
    }),
}));

vi.mock('../../lib/supabase', () => ({
    isSupabaseConfigured: () => true,
    supabase: {},
    supabaseSync: {
        from: () => ({
            select: () => ({
                // The nomination read.
                eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
                /*
                 * The age read. Returns `null` data when `mocks.ages` is null, which is the
                 * "we could not ask" case the panel must fail OPEN on — and the distinction is
                 * the point of this mock rather than an accident of it.
                 */
                in: async () => ({
                    data:
                        mocks.ages === null
                            ? null
                            : Object.entries(mocks.ages).map(([id, age]) => ({
                                  id,
                                  age_classification: age,
                              })),
                    error: null,
                }),
            }),
        }),
        rpc: async () => ({ data: { success: true }, error: null }),
    },
}));

const entitlement = (over: Partial<TeamEntitlement> = {}): TeamEntitlement => ({
    teamId: 'team-1',
    status: 'active',
    seatsTotal: null,
    seatsUnlimited: true,
    seatsUsed: 4,
    validUntil: '2026-09-22T00:00:00Z',
    lapsedAt: null,
    isProbation: false,
    ...over,
});

const member = (over: Partial<TeamMember> & { id: string }): TeamMember =>
    ({
        userId: `user-${over.id}`,
        teamId: 'team-1',
        // `fullName`, not `name`: `getMemberDisplayName` reads the denormalised column, and a
        // fixture with the wrong field renders "Unknown User" — a mock that cannot express the
        // property under test, which is how the first run of this file failed.
        fullName: `Member ${over.id}`,
        email: `${over.id}@example.test`,
        role: 'student',
        status: 'approved',
        seatAssigned: true,
        avatarUrl: null,
        joinedAt: 0,
        ...over,
    }) as TeamMember;

beforeEach(() => {
    mocks.ages = null;
    mocks.profileId = 'user-admin';
    useAppStore.setState({ entitlement: null });
});

// ===========================================================================
describe('WALK-B-09 — what the licence panel calls the automatic grant', () => {
    /*
     * DEFINITION OF DONE (written by Sprint 17; WALK-B-09 has no exit-criteria block):
     *
     *   1. A team on the automatic grant is NOT described as having been gifted anything.
     *   2. The words say what actually happens next — the operator extends it — rather than
     *      only counting down, because under D3 extension is the normal path.
     *   3. A team that really WAS gifted a licence still reads "Gifted licence".
     *   4. The two are told apart by a server-supplied fact, not by client arithmetic over
     *      the expiry date, which would relabel a genuine 30-day gift.
     */
    it('does not tell a self-registered team it was gifted a licence', () => {
        useAppStore.setState({ entitlement: entitlement({ isProbation: true }) });
        render(<EntitlementPanel />);

        const label = screen.getByTestId('licence-source-label');
        expect(label.textContent).not.toContain('Gifted');
        expect(label.textContent).toContain('probation');
        // (2) — the next step is named, so the banner is not just a countdown.
        expect(label.textContent).toContain('extend');
    });

    it('still says "Gifted licence" for a team the operator actually gifted', () => {
        useAppStore.setState({ entitlement: entitlement({ isProbation: false }) });
        render(<EntitlementPanel />);

        expect(screen.getByTestId('licence-source-label').textContent).toContain('Gifted licence');
    });

    /*
     * (4), and the reason it is asserted separately: the tempting client-side shortcut is
     * "cover ends within ~30 days, therefore probation", which would relabel a real 30-day
     * gift and would flip a probation to "Gifted licence" on day 2 of its second month. The
     * two fixtures here have the SAME `validUntil` and differ only in `isProbation`.
     */
    it('is decided by the server fact, not by how far away the expiry is', () => {
        const sameDate = '2026-09-22T00:00:00Z';

        useAppStore.setState({
            entitlement: entitlement({ isProbation: true, validUntil: sameDate }),
        });
        const { unmount } = render(<EntitlementPanel />);
        expect(screen.getByTestId('licence-source-label').textContent).toContain('probation');
        unmount();

        useAppStore.setState({
            entitlement: entitlement({ isProbation: false, validUntil: sameDate }),
        });
        render(<EntitlementPanel />);
        expect(screen.getByTestId('licence-source-label').textContent).toContain('Gifted');
    });
});

// ===========================================================================
describe('WALK-B-11 / D9 — who the picker offers', () => {
    /*
     * DEFINITION OF DONE (written by Sprint 17; WALK-B-11 has no exit-criteria block, and D9
     * supplies the shape):
     *
     *   1. A `13_to_17` member is not offered, because `nominate_team_admin` refuses one
     *      outright and an affordance that cannot act is failure-modes §8. Sprint 6's version
     *      delivered that refusal to the STUDENT on acceptance.
     *   2. An 18+ member is still offered.
     *   3. The empty case has WORDS — D9: "a team whose only other members are minors sees
     *      why, not an empty list" — and they differ from the empty case where there is simply
     *      nobody on the roster.
     *   4. It FAILS OPEN: if the ages cannot be read, everyone is offered. The server refuses
     *      an under-18 regardless; hiding everybody over a timed-out query would tell the
     *      admin of an ordinary team that they have nobody to hand over to.
     */
    const roster = [
        member({ id: 'admin', role: 'admin', userId: 'user-admin' }),
        member({ id: 'kid', fullName: 'Sam Student', userId: 'user-kid' }),
        member({ id: 'grown', fullName: 'Alex Adult', userId: 'user-grown' }),
    ];

    it('does not offer a 13-17 member', async () => {
        mocks.ages = { 'user-kid': '13_to_17', 'user-grown': '18_plus' };
        render(<AdminTransferPanel teamId="team-1" teamMembers={roster} />);

        await waitFor(() => expect(screen.getByLabelText('New team admin')).toBeInTheDocument());
        const options = [...screen.getByLabelText('New team admin').querySelectorAll('option')]
            .map((o) => o.textContent);

        expect(options).toContain('Alex Adult');
        expect(options, 'an under-18 was offered a role the server refuses').not.toContain(
            'Sam Student',
        );
    });

    /*
     * (3). The empty state is the half D9 asks for by name, and it is the one a real team hits:
     * a coach whose roster is eleven fifteen-year-olds. "Invite or approve someone first" is
     * useless advice to them — they have approved eleven people.
     */
    it('a team of only minors is told why, not shown an empty list', async () => {
        mocks.ages = { 'user-kid': '13_to_17' };
        render(
            <AdminTransferPanel
                teamId="team-1"
                teamMembers={[roster[0], roster[1]]}
            />,
        );

        await waitFor(() =>
            expect(screen.getByText('No adult on this team to hand over to.')).toBeInTheDocument(),
        );
        expect(screen.getByText(/recorded as under 18/)).toBeInTheDocument();
        // And it names the way out that does not require anybody to have a birthday.
        expect(screen.getByText(/FalconForge operator can reassign/)).toBeInTheDocument();
    });

    it('a team with nobody on it gets the other empty state', async () => {
        mocks.ages = {};
        render(<AdminTransferPanel teamId="team-1" teamMembers={[roster[0]]} />);

        await waitFor(() =>
            expect(screen.getByText('No one to hand over to yet.')).toBeInTheDocument(),
        );
        expect(screen.queryByText(/recorded as under 18/)).not.toBeInTheDocument();
    });

    /*
     * (4) FAILS OPEN, and this is the assertion that stops the fix becoming the next defect —
     * the same rule `entitlement.ts` states at length. `mocks.ages = null` is a query that came
     * back with nothing, which is what offline and a timeout both look like.
     */
    it('offers everyone when the ages could not be read', async () => {
        mocks.ages = null;
        render(<AdminTransferPanel teamId="team-1" teamMembers={roster} />);

        await waitFor(() => expect(screen.getByLabelText('New team admin')).toBeInTheDocument());
        const options = [...screen.getByLabelText('New team admin').querySelectorAll('option')]
            .map((o) => o.textContent);

        expect(options).toContain('Alex Adult');
        expect(options, 'a failed age query hid the whole roster').toContain('Sam Student');
    });
});
