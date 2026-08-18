import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OperatorConsole from '../admin/OperatorConsole';

/**
 * The console's own behaviour, above the database.
 *
 * The RPCs' refusals are asserted against a real Postgres in `operator-console.db.test.ts` and
 * `anon-execute.rls.db.test.ts`, which is where a security property belongs. What is testable
 * HERE is the part that made the old console unusable and the part that makes the new one safe
 * to click:
 *
 *   - a non-operator is shown an explanation rather than a page of controls that would all fail;
 *   - the successor dropdown offers only members who can actually hold the role, which is the
 *     Sprint 6 defect (it offered eleven under-18s and the refusal landed on the student);
 *   - "Revoke all" asks first, and says the thing an operator needs to hear before clicking a
 *     red button on somebody else's team: that nothing is deleted.
 */

const mocks = vi.hoisted(() => ({
    isOperator: true as boolean,
    directory: [] as Record<string, unknown>[],
    detail: null as Record<string, unknown> | null,
    rpc: vi.fn(),
}));

vi.mock('../../lib/auth', () => ({
    useAuth: () => ({ isOffline: false }),
}));

vi.mock('../../lib/supabase', () => ({
    isSupabaseConfigured: () => true,
    supabase: {},
    supabaseSync: {
        rpc: (name: string, args?: Record<string, unknown>) => {
            mocks.rpc(name, args);
            if (name === 'is_platform_operator') {
                return Promise.resolve({ data: mocks.isOperator, error: null });
            }
            if (name === 'operator_team_directory') {
                return Promise.resolve({ data: mocks.directory, error: null });
            }
            if (name === 'operator_team_detail') {
                return Promise.resolve({ data: mocks.detail, error: null });
            }
            return Promise.resolve({ data: { success: true, revoked_count: 2 }, error: null });
        },
    },
}));

const TEAM_ID = '11111111-1111-1111-1111-111111111111';

const directoryRow = {
    team_id: TEAM_ID,
    team_name: 'Iron Falcons',
    team_number: '12345',
    created_at: '2026-01-05T00:00:00Z',
    admin_member_id: 'member-admin',
    admin_name: 'Coach Example',
    admin_email: 'coach@example.com',
    members_approved: 12,
    members_pending: 2,
    entitlement_status: 'active',
    seats_total: 15,
    seats_unlimited: false,
    seats_used: 12,
    valid_until: '2026-12-01T00:00:00Z',
};

const detailFor = (members: Record<string, unknown>[]) => ({
    success: true,
    team: { id: TEAM_ID, name: 'Iron Falcons', team_number: '12345', created_at: '2026-01-05T00:00:00Z' },
    members,
    grants: [
        {
            id: 'grant-1',
            source: 'gift',
            seats: null,
            valid_from: '2026-01-05T00:00:00Z',
            valid_until: null,
            revoked_at: null,
            notes: 'beta team',
            in_force: true,
        },
    ],
    actions: [],
    seasons: [{ id: 'season-1', name: '2026-2027', is_archived: false }],
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.isOperator = true;
    mocks.directory = [directoryRow];
    mocks.detail = detailFor([
        { id: 'm-admin', full_name: 'Coach Example', email: 'coach@example.com', role: 'admin', status: 'approved', seat_assigned: true, is_managed: false },
        { id: 'm-coach', full_name: 'Second Coach', email: 'second@example.com', role: 'coach', status: 'approved', seat_assigned: true, is_managed: false },
        { id: 'm-child', full_name: 'Robin', email: null, role: 'student', status: 'approved', seat_assigned: true, is_managed: true },
        { id: 'm-waiting', full_name: 'Hopeful', email: 'hopeful@example.com', role: 'student', status: 'pending', seat_assigned: false, is_managed: false },
    ]);
});

describe('the operator page seen by somebody who is not an operator', () => {
    it('explains itself instead of rendering controls that would all fail', async () => {
        mocks.isOperator = false;

        render(<OperatorConsole />);

        expect(await screen.findByText(/for the FalconForge operator/i)).toBeInTheDocument();
        expect(screen.queryByTestId('operator-search')).not.toBeInTheDocument();
    });
});

describe('finding a team', () => {
    it('lists teams from the directory RPC, not from team_entitlement', async () => {
        render(<OperatorConsole />);

        expect(await screen.findByText(/#12345 Iron Falcons/)).toBeInTheDocument();
        expect(screen.getByText(/coach@example.com/)).toBeInTheDocument();
        // The old console read the `team_entitlement` view, which is security_invoker and
        // therefore showed the operator their own teams. One team list now, and it is this one.
        expect(mocks.rpc).toHaveBeenCalledWith('operator_team_directory', expect.anything());
    });

    /*
     * A team with no admin row is the case `operator_transfer_team_admin` exists for, and the
     * directory left-joins the admin precisely so it stays visible. Saying so on the row is what
     * turns "findable" into "found".
     */
    it('calls out a stranded team rather than showing a blank admin', async () => {
        mocks.directory = [{ ...directoryRow, admin_member_id: null, admin_name: null, admin_email: null }];

        render(<OperatorConsole />);

        expect(await screen.findByText(/this team is stranded/i)).toBeInTheDocument();
    });
});

describe('acting on the selected team', () => {
    const selectTeam = async () => {
        render(<OperatorConsole />);
        fireEvent.click(await screen.findByText(/#12345 Iron Falcons/));
        await screen.findByText(/roster/i);
    };

    /*
     * THE SPRINT 6 DEFECT, in its new home. The successor dropdown used to be a uuid typed by
     * hand; now it is a list, and a list that offers somebody the database will refuse just
     * moves the error to the person least able to act on it.
     */
    it('offers only members who could actually hold the admin role', async () => {
        await selectTeam();

        const select = screen.getByTestId('successor-select') as HTMLSelectElement;
        const options = [...select.options].map((o) => o.textContent);

        expect(options.join(' ')).toContain('Second Coach');
        // The sitting admin, a pending member and a managed child profile are all refused by
        // `operator_transfer_team_admin`, so none of them is offered.
        expect(options.join(' ')).not.toContain('Coach Example');
        expect(options.join(' ')).not.toContain('Hopeful');
        expect(options.join(' ')).not.toContain('Robin');
    });

    it('asks before revoking everything, and says nothing is deleted', async () => {
        await selectTeam();

        fireEvent.click(screen.getByTestId('revoke-all'));

        const dialog = await screen.findByText(/Revoke every licence for Iron Falcons/i);
        expect(dialog).toBeInTheDocument();
        expect(screen.getByText(/read-only immediately/i)).toBeInTheDocument();
        expect(screen.getByText(/stays exactly where it is/i)).toBeInTheDocument();

        // Nothing has been sent yet — the dialog is a gate, not a notification.
        expect(mocks.rpc).not.toHaveBeenCalledWith('operator_revoke_license', expect.anything());
    });

    it('revokes every grant in force once confirmed, carrying the reason', async () => {
        await selectTeam();
        // `revokeNotes` was read by the revoke call and written by nothing, so every revocation
        // would have recorded a blank reason. Asserting the value ARRIVES is what makes the
        // input load-bearing rather than decorative.
        fireEvent.change(screen.getByTestId('revoke-notes'), {
            target: { value: 'gifted to the wrong team' },
        });
        fireEvent.click(screen.getByTestId('revoke-all'));
        // By test id, not by name: the page's own button and the dialog's confirm deliberately
        // carry the SAME label, so the operator reads the same words they clicked.
        fireEvent.click(await screen.findByTestId('confirm-revoke-all'));

        await waitFor(() =>
            expect(mocks.rpc).toHaveBeenCalledWith(
                'operator_revoke_license',
                expect.objectContaining({
                    p_team_id: TEAM_ID,
                    p_all: true,
                    p_notes: 'gifted to the wrong team',
                }),
            ),
        );
    });
});
