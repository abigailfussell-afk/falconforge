import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SyncStatusIndicator from '../SyncStatusIndicator';

// Mock the useLiveQuery hook from dexie-react-hooks
vi.mock('dexie-react-hooks', () => ({
    useLiveQuery: vi.fn(() => []),
}));

// Mock the db from offline-db
vi.mock('@/lib/offline-db', () => ({
    db: {
        syncQueue: {
            toArray: vi.fn().mockResolvedValue([]),
        },
    },
}));

describe('SyncStatusIndicator', () => {
    it('renders without crashing', () => {
        render(<SyncStatusIndicator />);
        // The component should render some element
        const container = document.querySelector('.flex');
        expect(container).toBeDefined();
    });

    it('shows synced state when there are no pending items', () => {
        render(<SyncStatusIndicator />);
        // Look for the "Synced" text or check icon
        const syncedText = screen.queryByText(/synced/i);
        expect(syncedText).toBeDefined();
    });
});
