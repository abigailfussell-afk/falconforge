import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SyncStatusIndicator from '../SyncStatusIndicator';

// The component reads live realtime status; this suite drives it through the mock.
vi.mock('@/lib/realtime');

// Mock sync hook
const mockSync = vi.fn();
const mockUseSync = vi.fn();
const mockRetryFailed = vi.fn().mockResolvedValue(1);

vi.mock('../../lib/sync', () => ({
    useSync: (...args: any[]) => mockUseSync(...args),
}));

// Mock supabase config — always configured so the component renders
vi.mock('../../lib/supabase', () => ({
    isSupabaseConfigured: vi.fn(() => true),
}));

describe('SyncStatusIndicator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSync.mockClear();
    });

    function setupSync(overrides: Record<string, any> = {}) {
        mockUseSync.mockReturnValue({
            isOnline: true,
            syncStatus: 'idle',
            pendingChanges: 0,
            failedChanges: 0,
            failureReasons: [],
            lastSyncTime: new Date(),
            sync: mockSync,
            retryFailedChanges: mockRetryFailed,
            error: null,
            ...overrides,
        });
    }

    it('renders without crashing', () => {
        setupSync();
        render(<SyncStatusIndicator />);
        const container = document.querySelector('button');
        expect(container).toBeDefined();
    });

    it('shows "Synced" when idle with no pending changes', () => {
        setupSync({ syncStatus: 'idle', pendingChanges: 0 });
        render(<SyncStatusIndicator />);
        expect(screen.getByText('Synced')).toBeDefined();
    });

    it('shows pending count when there are pending changes', () => {
        setupSync({ syncStatus: 'idle', pendingChanges: 3 });
        render(<SyncStatusIndicator />);
        expect(screen.getByText('3 pending')).toBeDefined();
    });

    it('shows "Syncing..." during sync', () => {
        setupSync({ syncStatus: 'syncing' });
        render(<SyncStatusIndicator />);
        expect(screen.getByText('Syncing...')).toBeDefined();
    });

    it('disables button while syncing', () => {
        setupSync({ syncStatus: 'syncing' });
        render(<SyncStatusIndicator />);
        const button = screen.getByRole('button');
        expect(button).toHaveProperty('disabled', true);
    });

    it('shows "Sync Error" on error state', () => {
        setupSync({ syncStatus: 'error', error: 'Connection failed' });
        render(<SyncStatusIndicator />);
        expect(screen.getByText('Sync Error')).toBeDefined();
    });

    it('shows "Offline" when not online', () => {
        setupSync({ isOnline: false });
        render(<SyncStatusIndicator />);
        expect(screen.getByText('Offline')).toBeDefined();
    });

    it('disables button when offline', () => {
        setupSync({ isOnline: false });
        render(<SyncStatusIndicator />);
        const button = screen.getByRole('button');
        expect(button).toHaveProperty('disabled', true);
    });

    it('calls sync when button is clicked', () => {
        setupSync({ syncStatus: 'idle', pendingChanges: 2 });
        render(<SyncStatusIndicator />);
        const button = screen.getByRole('button');
        fireEvent.click(button);
        expect(mockSync).toHaveBeenCalledTimes(1);
    });

    it('hides text in icon variant', () => {
        setupSync({ syncStatus: 'idle', pendingChanges: 0 });
        render(<SyncStatusIndicator variant="icon" />);
        expect(screen.queryByText('Synced')).toBeNull();
    });

    it('returns null when supabase is not configured', async () => {
        // Re-mock to return false
        const { isSupabaseConfigured } = await import('../../lib/supabase');
        vi.mocked(isSupabaseConfigured).mockReturnValue(false);

        setupSync();
        const { container } = render(<SyncStatusIndicator />);
        expect(container.innerHTML).toBe('');

        // Restore
        vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    });

    it('shows "Live" when realtime is connected and idle with no pending changes', async () => {
        // Mock realtime as connected
        const { getRealtimeStatus, onRealtimeStatusChange } = await import('../../lib/realtime');
        vi.mocked(getRealtimeStatus).mockReturnValue('connected');
        // Make onRealtimeStatusChange immediately call the listener with 'connected'
        vi.mocked(onRealtimeStatusChange).mockImplementation((listener) => {
            listener('connected');
            return () => { };
        });

        setupSync({ syncStatus: 'idle', pendingChanges: 0 });
        render(<SyncStatusIndicator />);
        expect(screen.getByText('Live')).toBeDefined();

        // Restore
        vi.mocked(getRealtimeStatus).mockReturnValue('disconnected');
        vi.mocked(onRealtimeStatusChange).mockImplementation(() => () => { });
    });

    describe('failed changes notice (B2)', () => {
        it('says nothing when no changes have failed', () => {
            setupSync({ failedChanges: 0 });
            render(<SyncStatusIndicator />);

            expect(screen.queryByRole('alert')).toBeNull();
        });

        it('tells the user when changes could not be saved', () => {
            setupSync({ failedChanges: 3 });
            render(<SyncStatusIndicator />);

            const alert = screen.getByRole('alert');
            expect(alert.textContent).toContain("3 changes didn't save");
            // The reassurance matters as much as the warning: the work still exists.
            expect(alert.textContent).toContain('still stored on this device');
        });

        it('uses singular wording for a single failure', () => {
            setupSync({ failedChanges: 1 });
            render(<SyncStatusIndicator />);

            expect(screen.getByRole('alert').textContent).toContain("1 change didn't save");
        });

        it('re-queues and syncs when the user retries', async () => {
            setupSync({ failedChanges: 2 });
            render(<SyncStatusIndicator />);

            fireEvent.click(screen.getByRole('button', { name: /Retry/ }));

            expect(mockRetryFailed).toHaveBeenCalled();
            // The retry must actually push, not just move rows back onto the queue.
            await vi.waitFor(() => expect(mockSync).toHaveBeenCalled());
        });

        it('cannot retry while offline', () => {
            setupSync({ failedChanges: 2, isOnline: false });
            render(<SyncStatusIndicator />);

            expect((screen.getByRole('button', { name: /Retry/ }) as HTMLButtonElement).disabled).toBe(true);
        });

        it('shows a count badge in icon mode, where there is no room for the notice', () => {
            setupSync({ failedChanges: 4 });
            render(<SyncStatusIndicator variant="icon" />);

            expect(screen.queryByRole('alert')).toBeNull();
            expect(screen.getByText('4')).toBeDefined();
        });
    });

    describe('why a change was refused (B24)', () => {
        /*
         * A policy refusal used to reach this notice after nine minutes carrying only
         * "didn't save", because PostgREST reports every one of them as the same sentence
         * about row-level security. The reason is decided at classification time and stored
         * with the parked change; this is the only surface that can say it.
         */
        it('shows the reason instead of the generic connection advice', () => {
            setupSync({
                failedChanges: 2,
                failureReasons: ["Your team's licence has lapsed, so the server is not accepting changes."],
            });
            render(<SyncStatusIndicator />);

            const alert = screen.getByRole('alert');
            expect(alert.textContent).toContain("licence has lapsed");
            // "Retry when you have a connection" is actively wrong for a lapsed licence — the
            // connection is fine and retrying changes nothing until the licence does.
            expect(alert.textContent).not.toContain('Retry when you have a connection');
        });

        it('lists several distinct reasons together', () => {
            setupSync({
                failedChanges: 5,
                failureReasons: [
                    "Your team's licence has lapsed.",
                    'This change belongs to a season that has been archived.',
                ],
            });
            render(<SyncStatusIndicator />);

            const alert = screen.getByRole('alert');
            expect(alert.textContent).toContain('licence has lapsed');
            expect(alert.textContent).toContain('archived');
        });

        it('falls back to the connection advice when nothing explained itself', () => {
            // Five failed attempts with no classification is a genuinely unknown failure, and
            // inventing a reason for it would be worse than the generic line.
            setupSync({ failedChanges: 1, failureReasons: [] });
            render(<SyncStatusIndicator />);

            expect(screen.getByRole('alert').textContent).toContain('still stored on this device');
        });
    });
})

/**
 * Found by running the venue simulation and looking at the sidebar.
 *
 * `getStatusText` returned a bare 'Offline' and threw the pending count away, so a team that
 * had worked through a whole session at a competition saw exactly what a team that had done
 * nothing saw. The one number answering "is my afternoon actually saved?" went quiet at the
 * moment it was worth reading and came back only once the connection did — which is when it
 * stops mattering.
 */
describe('offline, with work waiting', () => {
    function setup(overrides: Record<string, any> = {}) {
        mockUseSync.mockReturnValue({
            isOnline: false,
            syncStatus: 'idle',
            pendingChanges: 0,
            failedChanges: 0,
            failureReasons: [],
            lastSyncTime: new Date(),
            sync: mockSync,
            retryFailedChanges: mockRetryFailed,
            error: null,
            ...overrides,
        });
        render(<SyncStatusIndicator />);
    }

    it('says how much is queued while offline', () => {
        setup({ pendingChanges: 7 });
        expect(screen.getByText('Offline · 7 queued')).toBeDefined();
    });

    it('still says plain Offline when there is genuinely nothing waiting', () => {
        // The count must not become noise: "Offline · 0 queued" would be a worse sentence than
        // "Offline", and it is the state most people are in most of the time.
        setup({ pendingChanges: 0 });
        expect(screen.getByText('Offline')).toBeDefined();
    });

    it('does not lose the count when a single change is waiting', () => {
        setup({ pendingChanges: 1 });
        expect(screen.getByText('Offline · 1 queued')).toBeDefined();
    });
});
