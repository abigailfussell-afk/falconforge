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
    /**
     * What an action RPC answers, so a test can be about the REFUSAL rather than the happy path.
     *
     * `operator_erase_user` and `operator_delete_team` both return `{success: false, error}` for
     * every refusal the database makes — sole administrator, name mismatch, not an operator — and
     * every one of those lands on a person mid-request who needs to know what to do next. Until
     * these tests the component's entire failure half was unexercised.
     */
    actionResult: null as Record<string, unknown> | null,
    actionError: null as { message: string } | null,
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
            // D3's new-team panel loads alongside the directory. An unhandled RPC would fall
            // through to the catch-all below and hand the panel a `{success: true}` object
            // where it expects an array -- a harness failure dressed up as a component one.
            if (name === 'operator_new_teams') {
                return Promise.resolve({ data: [], error: null });
            }
            if (mocks.actionError) {
                return Promise.resolve({ data: null, error: mocks.actionError });
            }
            if (mocks.actionResult) {
                return Promise.resolve({ data: mocks.actionResult, error: null });
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
    mocks.actionResult = null;
    mocks.actionError = null;
    mocks.directory = [directoryRow];
    mocks.detail = detailFor([
        { id: 'm-admin', user_id: 'u-admin', full_name: 'Coach Example', email: 'coach@example.com', role: 'admin', status: 'approved', seat_assigned: true, is_managed: false },
        { id: 'm-coach', user_id: 'u-coach', full_name: 'Second Coach', email: 'second@example.com', role: 'coach', status: 'approved', seat_assigned: true, is_managed: false },
        /*
         * A CHILD'S ROW CARRIES THE GUARDIAN'S ACCOUNT ID, which is the trap SEC-11 has to avoid
         * and the reason this fixture names it `u-guardian` rather than `u-robin`. There is no
         * account for Robin; a managed profile is reached through the parent's login.
         */
        { id: 'm-child', user_id: 'u-guardian', full_name: 'Robin', email: null, role: 'student', status: 'approved', seat_assigned: true, is_managed: true },
        { id: 'm-waiting', user_id: 'u-hopeful', full_name: 'Hopeful', email: 'hopeful@example.com', role: 'student', status: 'pending', seat_assigned: false, is_managed: false },
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

// =================================================================================================
describe('SEC-11 — erasing a person from the console', () => {
    const selectTeam = async () => {
        render(<OperatorConsole />);
        fireEvent.click(await screen.findByText(/#12345 Iron Falcons/));
        await screen.findByRole('heading', { name: /Iron Falcons — roster/i });
    };

    /*
     * THE ASSERTION THIS WHOLE FEATURE HANGS ON.
     *
     * A managed child's `team_members.user_id` is their GUARDIAN's, because a child has no login
     * of their own. An Erase button on Robin's row would call `operator_erase_user('u-guardian')`
     * and take the parent — and every other child they have — with them. The button is therefore
     * absent rather than disabled: a disabled control still says "this is the way to do it".
     */
    it('does not offer Erase on a child profile, whose account belongs to their parent', async () => {
        await selectTeam();

        expect(screen.getByTestId('erase-user-m-coach')).toBeInTheDocument();
        expect(screen.queryByTestId('erase-user-m-child')).not.toBeInTheDocument();
    });

    /*
     * The sole administrator's Erase is DISABLED rather than absent, and that difference is the
     * point: the action is legitimate, it is just blocked on something the operator can fix. The
     * child's button is absent because there is nothing to fix — that account is their parent's.
     */
    it('will not let the only admin of a team be erased, and says what to do instead', async () => {
        await selectTeam();

        const adminButton = screen.getByTestId('erase-user-m-admin');
        expect(adminButton).toBeDisabled();
        expect(adminButton.getAttribute('title')).toMatch(/transfer the admin role first/i);

        // A second admin makes it legitimate again, which is what proves the rule is the rule
        // and not just "admins are never erasable".
        expect(screen.getByTestId('erase-user-m-coach')).toBeEnabled();
    });

    it('asks first, names the person, and says what stays', async () => {
        await selectTeam();

        fireEvent.click(screen.getByTestId('erase-user-m-coach'));

        expect(await screen.findByText(/Erase Second Coach\?/i)).toBeInTheDocument();
        // The two things an operator needs before pressing a red button on somebody's account.
        expect(screen.getByText(/across every team you belong to|across every team/i)).toBeInTheDocument();
        expect(screen.getByText(/stays with the team/i)).toBeInTheDocument();
        expect(mocks.rpc).not.toHaveBeenCalledWith('operator_erase_user', expect.anything());
    });

    /*
     * THE REFUSALS, which is where an operator actually needs the component to be good.
     *
     * `operator_erase_user` returns `{success: false, error}` for a sole administrator, and the
     * message names the team and the remedy. A component that reports "Erased." on that, or that
     * says nothing at all, sends somebody away believing a legal request was honoured when it was
     * refused. Neither path had a test before this.
     */
    it('shows the database\'s reason when an erasure is refused', async () => {
        mocks.actionResult = {
            success: false,
            error_code: 'sole_admin',
            error: 'This person is the only administrator of: Iron Falcons. Transfer the admin role first, then erase.',
        };
        await selectTeam();

        fireEvent.click(screen.getByTestId('erase-user-m-coach'));
        fireEvent.click(await screen.findByTestId('confirm-erase-user'));

        // The database's own words, not a generic failure: they name the team and the remedy.
        expect(await screen.findByText(/only administrator of: Iron Falcons/i)).toBeInTheDocument();
        expect(screen.queryByText(/^Erased\./i)).not.toBeInTheDocument();
    });

    /*
     * A transport failure does not report success — and this test documents a real limitation
     * rather than the behaviour anyone would want.
     *
     * A supabase-js error is a PostgrestError: a plain `{message, code, details, hint}` object,
     * NEVER an `Error` instance. Every catch block here reads
     * `err instanceof Error ? err.message : <generic>`, so the database's own explanation is
     * discarded and the operator is told "Could not erase this person" whatever went wrong.
     * Seven handlers in this file do it, and more elsewhere, so fixing it is one shared helper
     * and not a line in this component — parked in the plan's §8 with the count.
     *
     * What this DOES pin down is that the failure is surfaced at all, and that "Erased." never
     * appears: reporting success on a refused erasure is the outcome that actually harms someone.
     */
    it('surfaces a transport failure rather than reporting success', async () => {
        mocks.actionError = { message: 'network is unreachable' };
        await selectTeam();

        fireEvent.click(screen.getByTestId('erase-user-m-coach'));
        fireEvent.click(await screen.findByTestId('confirm-erase-user'));

        expect(await screen.findByText(/Could not erase this person/i)).toBeInTheDocument();
        expect(screen.queryByText(/memberships removed/i)).not.toBeInTheDocument();
    });

    /*
     * On success it reports WHAT IT DID, not that it worked. The operator is usually answering an
     * email that asked about a child specifically, and "Erased." leaves them guessing whether the
     * child profiles went too.
     */
    it('reports the counts it removed, including children', async () => {
        mocks.actionResult = {
            success: true,
            memberships_removed: 3,
            children_removed: 2,
        };
        await selectTeam();

        fireEvent.click(screen.getByTestId('erase-user-m-coach'));
        fireEvent.click(await screen.findByTestId('confirm-erase-user'));

        const banner = await screen.findByText(/3 memberships removed/i);
        expect(banner).toBeInTheDocument();
        expect(banner.textContent).toMatch(/2 child profiles removed/i);
        expect(banner.textContent).toMatch(/stay with the team/i);
    });

    it('closes without erasing anything when the operator cancels', async () => {
        await selectTeam();

        fireEvent.click(screen.getByTestId('erase-user-m-coach'));
        fireEvent.click(await screen.findByText('Cancel'));

        await waitFor(() =>
            expect(screen.queryByTestId('confirm-erase-user')).not.toBeInTheDocument(),
        );
        expect(mocks.rpc).not.toHaveBeenCalledWith('operator_erase_user', expect.anything());
    });

    it('erases the account behind the membership, not the membership', async () => {
        await selectTeam();

        fireEvent.click(screen.getByTestId('erase-user-m-coach'));
        fireEvent.click(await screen.findByTestId('confirm-erase-user'));

        await waitFor(() =>
            expect(mocks.rpc).toHaveBeenCalledWith(
                'operator_erase_user',
                // `u-coach`, NOT `m-coach`. Passing the membership id would erase nobody and
                // return "No such user", which reads like the person is already gone.
                expect.objectContaining({ p_user_id: 'u-coach' }),
            ),
        );
    });
});

// =================================================================================================
describe('SEC-11 — deleting a team from the console', () => {
    const selectTeam = async () => {
        render(<OperatorConsole />);
        fireEvent.click(await screen.findByText(/#12345 Iron Falcons/));
        await screen.findByRole('heading', { name: /Iron Falcons — roster/i });
    };

    it('will not send the request until the name matches exactly', async () => {
        await selectTeam();

        const button = screen.getByTestId('delete-team');
        expect(button).toBeDisabled();

        // Close, and deliberately not close enough.
        fireEvent.change(screen.getByTestId('delete-team-confirm'), { target: { value: 'iron falcons' } });
        expect(screen.getByTestId('delete-team')).toBeDisabled();

        fireEvent.change(screen.getByTestId('delete-team-confirm'), { target: { value: 'Iron Falcons' } });
        expect(screen.getByTestId('delete-team')).toBeEnabled();
    });

    /*
     * The typed name goes to the SERVER. The disabled button above is a courtesy that stops a
     * mis-click; `operator_delete_team` refuses on `name_mismatch` regardless, because a
     * confirmation enforced only in the browser is one a stale bundle does not have.
     */
    it('shows the server\'s reason when the name does not match', async () => {
        mocks.actionResult = {
            success: false,
            error_code: 'name_mismatch',
            error: "Type the team's name exactly to confirm. Expected: Iron Falcons",
        };
        await selectTeam();

        fireEvent.change(screen.getByTestId('delete-team-confirm'), { target: { value: 'Iron Falcons' } });
        fireEvent.click(screen.getByTestId('delete-team'));

        expect(await screen.findByText(/Type the team's name exactly to confirm/i)).toBeInTheDocument();
    });

    it('says what went and what did not, when a team is deleted', async () => {
        mocks.actionResult = { success: true, team_name: 'Iron Falcons', members_removed: 14 };
        await selectTeam();

        fireEvent.change(screen.getByTestId('delete-team-confirm'), { target: { value: 'Iron Falcons' } });
        fireEvent.click(screen.getByTestId('delete-team'));

        const banner = await screen.findByText(/Iron Falcons is gone/i);
        // The two things an operator has to be able to tell somebody afterwards.
        expect(banner.textContent).toMatch(/14 memberships/i);
        expect(banner.textContent).toMatch(/people keep their accounts/i);
    });

    it('sends the typed name for the server to check', async () => {
        await selectTeam();

        fireEvent.change(screen.getByTestId('delete-team-confirm'), { target: { value: 'Iron Falcons' } });
        fireEvent.click(screen.getByTestId('delete-team'));

        await waitFor(() =>
            expect(mocks.rpc).toHaveBeenCalledWith(
                'operator_delete_team',
                expect.objectContaining({ p_team_id: TEAM_ID, p_confirm_name: 'Iron Falcons' }),
            ),
        );
    });
});

describe('acting on the selected team', () => {
    const selectTeam = async () => {
        render(<OperatorConsole />);
        fireEvent.click(await screen.findByText(/#12345 Iron Falcons/));
        /*
         * The HEADING, not the word. This was `findByText(/roster/i)` — a wait, never an
         * assertion — and SEC-11's delete-team panel says "erasing a person is the button on
         * their roster row", which made it ambiguous and failed three tests that are about
         * something else entirely. A wait that matches a common word in body copy is one
         * paragraph away from breaking, and matching the section heading costs nothing.
         */
        await screen.findByRole('heading', { name: /Iron Falcons — roster/i });
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
