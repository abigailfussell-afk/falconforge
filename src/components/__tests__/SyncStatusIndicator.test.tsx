import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SyncStatusIndicator from '../SyncStatusIndicator';

// Mock sync hook
const mockSync = vi.fn();
const mockUseSync = vi.fn();

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
            lastSyncTime: new Date(),
            sync: mockSync,
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
});
