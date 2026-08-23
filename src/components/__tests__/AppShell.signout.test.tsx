/**
 * SYNC-05 — the sidebar's sign-out button, with work still on the device.
 *
 * `clearLocalDatabase()` empties the sync queue AND the dead-letter store, and the sidebar
 * button used to call it on one unannounced click. The case is the one this product is
 * designed around: a student scouts three matches in a gym with no signal, signs out so the
 * next student can sign in on the same laptop, and the reports are gone.
 *
 * The real `sign-out` module runs here, against a real (fake-indexeddb) Dexie: the assertion
 * is that the QUEUE is still there, not that a spy was not called. `sign-out.test.ts` already
 * proves each teardown step is invoked, and its own header says why that is not enough —
 * "that would still pass if `clearLocalDatabase()` stopped clearing the dead-letter store".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AppShell from '../AppShell';
import { useAppStore } from '../../lib/store';
import { db, queueForSync } from '../../lib/offline-db';

vi.mock('@/lib/auth');
vi.mock('@/lib/realtime');

vi.mock('../../lib/supabase', () => ({
    isSupabaseConfigured: () => true,
    supabase: {
        auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() },
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
    },
    supabaseSync: {
        rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
    },
    resolveSyncAccessTokenAsync: vi.fn(async () => null),
    resolveSyncAccessToken: vi.fn(() => null),
    isAuthenticatedToken: vi.fn(() => false),
}));

vi.mock('../../lib/server-pull', () => ({
    fetchTeamData: vi.fn().mockResolvedValue(undefined),
    fetchGuardianData: vi.fn().mockResolvedValue(undefined),
    fetchSeasonData: vi.fn().mockResolvedValue(undefined),
    ensureSeasonFieldImage: vi.fn().mockResolvedValue(undefined),
}));

/** The hard reload at the end of sign-out, which jsdom cannot do. */
const redirected = vi.fn();
vi.mock('../../lib/sign-out', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../lib/sign-out')>();
    return {
        ...real,
        performSignOut: (signOut: () => Promise<void>, _redirect?: () => void, ask?: never) =>
            real.performSignOut(signOut, redirected, ask),
    };
});

function renderShell() {
    useAppStore.setState({
        currentTeamId: 'team-1',
        teamMembers: [],
        subTeams: [],
        managedProfiles: [],
        seasons: [],
        currentSeasonId: null,
        tasks: [],
    } as never);

    render(
        <MemoryRouter initialEntries={['/app/board']}>
            <Routes>
                <Route path="/app" element={<AppShell />}>
                    <Route path="board" element={<div>board</div>} />
                </Route>
            </Routes>
        </MemoryRouter>,
    );
}

beforeEach(async () => {
    vi.clearAllMocks();
    await db.syncQueue.clear();
    await db.syncFailures.clear();
});

afterEach(async () => {
    await db.syncQueue.clear();
});

describe('signing out with unsynced work (SYNC-05)', () => {
    it('asks first, names the count, and clears nothing until it is answered', async () => {
        await queueForSync('scouting_reports', 'report-1', 'create', {
            id: 'report-1',
            teamNumber: '4242',
        });

        renderShell();
        fireEvent.click(await screen.findByTestId('sign-out-button'));

        const message = await screen.findByTestId('unsynced-signout-message');
        expect(message.textContent, 'the warning does not say how much work is at stake').toContain(
            '1 change',
        );
        expect(
            await db.syncQueue.count(),
            'the queue was cleared before anybody answered',
        ).toBe(1);
        expect(redirected, 'sign-out navigated away while still asking').not.toHaveBeenCalled();
    });

    it('keeps the work when the answer is "stay signed in"', async () => {
        await queueForSync('scouting_reports', 'report-1', 'create', { id: 'report-1' });

        renderShell();
        fireEvent.click(await screen.findByTestId('sign-out-button'));
        fireEvent.click(await screen.findByTestId('unsynced-signout-cancel'));

        await waitFor(() => expect(screen.queryByTestId('unsynced-signout-message')).toBeNull());
        expect(await db.syncQueue.count(), 'cancelling still destroyed the queue').toBe(1);
        expect(redirected).not.toHaveBeenCalled();
    });

    it('clears it when the answer is "sign out anyway"', async () => {
        await queueForSync('scouting_reports', 'report-1', 'create', { id: 'report-1' });

        renderShell();
        fireEvent.click(await screen.findByTestId('sign-out-button'));
        fireEvent.click(await screen.findByTestId('unsynced-signout-confirm'));

        await waitFor(() => expect(redirected).toHaveBeenCalled());
        expect(await db.syncQueue.count(), 'the user chose to sign out and the queue survived').toBe(0);
    });

    it('does not interrupt a sign-out with nothing queued — the control', async () => {

        renderShell();
        fireEvent.click(await screen.findByTestId('sign-out-button'));

        await waitFor(() => expect(redirected).toHaveBeenCalled());
        expect(
            screen.queryByTestId('unsynced-signout-message'),
            'a device with nothing to lose was still asked',
        ).toBeNull();
    });
});
