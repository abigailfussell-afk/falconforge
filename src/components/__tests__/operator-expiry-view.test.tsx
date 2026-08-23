/**
 * SEC-07, the operator half — "who is about to go read-only?"
 *
 * The console could find any team by name and could not answer the only question an operator
 * has to ask on a schedule. Under D3 that stops being weekly housekeeping and becomes the
 * product's main loop: `create_team_as_admin` grants **30 days**, and the operator extending
 * it to season length is the normal path. A directory that cannot sort by expiry makes the
 * normal path a manual scan of every row, once a week, for ever.
 *
 * TWO LAYERS, DELIBERATELY. `orderDirectory` and `daysUntil` are pure and take `now` as an
 * argument, so the boundary cases are pinned at a fixed instant rather than "whenever the
 * suite happens to run" (`docs/failure-modes.md` §10 — this project has had clock defects in
 * both directions). The component tests then assert that the rendered list actually uses
 * them, because a correct helper with an unwired select is `docs/failure-modes.md` §7.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OperatorConsole, { orderDirectory, daysUntil } from '../admin/OperatorConsole';
import { deriveEntitlementState, EXPIRY_WARNING_DAYS } from '../../lib/entitlement';

const mocks = vi.hoisted(() => ({
    directory: [] as Record<string, unknown>[],
}));

vi.mock('../../lib/auth', () => ({ useAuth: () => ({ isOffline: false }) }));

vi.mock('../../lib/supabase', () => ({
    isSupabaseConfigured: () => true,
    supabase: {},
    supabaseSync: {
        rpc: (name: string) => {
            if (name === 'is_platform_operator') return Promise.resolve({ data: true, error: null });
            if (name === 'operator_team_directory')
                return Promise.resolve({ data: mocks.directory, error: null });
            return Promise.resolve({ data: null, error: null });
        },
    },
}));

const NOW = new Date('2026-08-23T12:00:00Z').getTime();
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

type Row = {
    team_id: string;
    team_name: string;
    team_number: string | null;
    created_at: string;
    admin_member_id: string | null;
    admin_name: string | null;
    admin_email: string | null;
    members_approved: number;
    members_pending: number;
    entitlement_status: string;
    seats_total: number | null;
    seats_unlimited: boolean;
    seats_used: number;
    valid_until: string | null;
};

const row = (over: Partial<Row> & { team_name: string }): Row => ({
    team_id: `id-${over.team_name}`,
    team_number: '12345',
    created_at: '2026-01-05T00:00:00Z',
    admin_member_id: 'm-1',
    admin_name: 'Coach Example',
    admin_email: 'coach@example.com',
    members_approved: 4,
    members_pending: 0,
    entitlement_status: 'active',
    seats_total: null,
    seats_unlimited: true,
    seats_used: 4,
    valid_until: null,
    ...over,
});

/*
 * The set every test below draws from. One of each kind, and the NAMES are deliberately in an
 * order that disagrees with the expiry order — otherwise a sort that does nothing at all would
 * pass, which is the `toHaveBeenCalledTimes(1)` mistake in list form.
 */
const LAPSED = row({ team_name: 'Alpha Lapsed', entitlement_status: 'read_only' });
const SOON = row({ team_name: 'Zulu Soon', valid_until: inDays(3) });
const LATER = row({ team_name: 'Bravo Later', valid_until: inDays(29) });
const NEXT_YEAR = row({ team_name: 'Charlie Next Year', valid_until: inDays(200) });
const OPEN = row({ team_name: 'Delta Open Ended', valid_until: null });
const ALL = [NEXT_YEAR, OPEN, LATER, LAPSED, SOON];

describe('orderDirectory — the order', () => {
    /*
     * THE RED TEST. Reverting to `rows` unsorted, or to a naive `ORDER BY valid_until`, turns
     * this red — and the naive version is the interesting failure: a lapsed team has no
     * in-force grant, so its `valid_until` is NULL, and a plain ascending sort puts the team
     * that already needs the operator either first or last depending on the collation, by
     * accident either way. `docs/failure-modes.md` §4, in sorting form.
     */
    it('puts lapsed teams first, then soonest expiry, then open-ended', () => {
        const names = orderDirectory(ALL, 'all', NOW).map((r) => r.team_name);

        expect(names).toEqual([
            'Alpha Lapsed',
            'Zulu Soon',
            'Bravo Later',
            'Charlie Next Year',
            'Delta Open Ended',
        ]);
    });

    it('breaks ties by name so the list cannot reorder under a click', () => {
        const a = row({ team_name: 'Yankee', valid_until: inDays(5) });
        const b = row({ team_name: 'Alfa', valid_until: inDays(5) });

        expect(orderDirectory([a, b], 'all', NOW).map((r) => r.team_name)).toEqual([
            'Alfa',
            'Yankee',
        ]);
        expect(orderDirectory([b, a], 'all', NOW).map((r) => r.team_name)).toEqual([
            'Alfa',
            'Yankee',
        ]);
    });

    it('does not mutate the array it was given', () => {
        const input = [...ALL];
        orderDirectory(input, 'all', NOW);
        expect(input.map((r) => r.team_name)).toEqual(ALL.map((r) => r.team_name));
    });
});

describe('orderDirectory — the filter', () => {
    it('"expiring" is exactly the teams inside the warning window', () => {
        const names = orderDirectory(ALL, 'expiring', NOW).map((r) => r.team_name);

        // Lapsed is NOT here: it has already expired, which is a different question and has
        // its own filter. Open-ended is not here because it never expires.
        expect(names).toEqual(['Zulu Soon', 'Bravo Later']);
    });

    /*
     * THE BOUNDARY, at a fixed instant, in both directions. `EXPIRY_WARNING_DAYS` days out is
     * IN; one day past it is out. The rounding is `Math.ceil`, shared with the entitlement
     * banner, so "29 days and 23 hours" counts as 30 and not as 29.
     */
    it('includes a team exactly at the boundary and excludes one just past it', () => {
        const at = row({ team_name: 'At', valid_until: inDays(EXPIRY_WARNING_DAYS) });
        const past = row({ team_name: 'Past', valid_until: inDays(EXPIRY_WARNING_DAYS + 1) });

        expect(orderDirectory([at, past], 'expiring', NOW).map((r) => r.team_name)).toEqual([
            'At',
        ]);
    });

    it('"lapsed" is exactly the read-only teams', () => {
        expect(orderDirectory(ALL, 'lapsed', NOW).map((r) => r.team_name)).toEqual([
            'Alpha Lapsed',
        ]);
    });
});

describe('daysUntil agrees with the licence banner', () => {
    /*
     * THE HAND-MAINTAINED-LIST GUARD (`docs/failure-modes.md` §12). The console reads a raw
     * ISO string off a directory row; `deriveEntitlementState` reads the store's entitlement.
     * Two implementations of "how many days left" that disagree would show a coach one number
     * and the operator another — about the same licence, on the same day. This asserts they
     * do not, at the instants where a rounding difference would show.
     */
    for (const hours of [1, 11, 23, 25, 24 * 29 + 23, 24 * 30]) {
        it(`agrees at ${hours} hours out`, () => {
            const iso = new Date(NOW + hours * 3_600_000).toISOString();
            const banner = deriveEntitlementState(
                {
                    teamId: 't',
                    status: 'active',
                    seatsTotal: null,
                    seatsUnlimited: true,
                    seatsUsed: 1,
                    validUntil: iso,
                    lapsedAt: null,
                },
                new Date(NOW),
            );

            expect(daysUntil(iso, NOW)).toBe(banner.daysUntilExpiry);
        });
    }

    it('is null for an open-ended grant, not a large number', () => {
        expect(daysUntil(null, NOW)).toBeNull();
    });
});

describe('the console actually uses them', () => {
    beforeEach(() => {
        mocks.directory = ALL as unknown as Record<string, unknown>[];
    });

    const rendered = async () => {
        render(<OperatorConsole />);
        await waitFor(() => expect(screen.getByTestId('operator-directory')).toBeInTheDocument());
    };

    /*
     * A pure helper with an unwired <select> is a gate with no door. This reads the DOM order,
     * not the helper's return value.
     */
    it('renders the directory in expiry order', async () => {
        await rendered();

        const names = [...screen.getByTestId('operator-directory').querySelectorAll('li')].map(
            (li) => li.textContent ?? '',
        );
        expect(names[0]).toContain('Alpha Lapsed');
        expect(names[1]).toContain('Zulu Soon');
        expect(names[4]).toContain('Delta Open Ended');
    });

    it('the filter narrows the list and says how much it hid', async () => {
        await rendered();
        expect(screen.getByTestId('operator-directory-count').textContent).toContain('5 of 5');

        fireEvent.change(screen.getByTestId('operator-expiry-filter'), {
            target: { value: 'expiring' },
        });

        await waitFor(() =>
            expect(
                screen.getByTestId('operator-directory').querySelectorAll('li'),
            ).toHaveLength(2),
        );
        expect(screen.getByTestId('operator-directory-count').textContent).toContain('2 of 5');
    });

    it('flags the days left on the rows inside the window, and only those', async () => {
        await rendered();

        const flags = screen.getAllByTestId('operator-expiry-flag').map((el) => el.textContent);
        expect(flags).toEqual(['3 days left', '29 days left']);
    });

    /*
     * "Nothing is expiring" is GOOD NEWS and must not read as a broken search. One shared
     * "No teams matched" would have told an operator whose licences are all healthy that the
     * console was not working — `docs/failure-modes.md` §4, the zero case being the first case.
     */
    it('an empty filtered list says nothing is expiring, not "no teams matched"', async () => {
        mocks.directory = [OPEN] as unknown as Record<string, unknown>[];
        await rendered();

        fireEvent.change(screen.getByTestId('operator-expiry-filter'), {
            target: { value: 'expiring' },
        });

        await waitFor(() =>
            expect(
                screen.getByText(`Nothing expires in the next ${EXPIRY_WARNING_DAYS} days.`),
            ).toBeInTheDocument(),
        );
        expect(screen.queryByText('No teams matched.')).not.toBeInTheDocument();
    });
});
