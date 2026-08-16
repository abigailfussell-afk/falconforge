import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ParkedChangesDialog from '../ParkedChangesDialog';
import { getSyncFailures, retrySyncFailure, discardSyncFailure } from '../../lib/offline-db';

vi.mock('../../lib/offline-db', () => ({
    getSyncFailures: vi.fn(),
    retrySyncFailure: vi.fn().mockResolvedValue(true),
    discardSyncFailure: vi.fn().mockResolvedValue(true),
}));

const lapsed = {
    id: 'f-1',
    tableName: 'scouting_reports',
    recordId: 'r-1',
    operation: 'create' as const,
    data: { teamNumber: '4321' },
    timestamp: 1000,
    retryCount: 5,
    failedAt: 1_700_000_000_000,
    lastError: 'new row violates row-level security policy for table "scouting_reports"',
    terminalReason: "Your team's licence has lapsed, so new changes cannot be saved.",
};

const archived = {
    id: 'f-2',
    tableName: 'tasks',
    recordId: 'r-2',
    operation: 'update' as const,
    data: { title: 'Rebuild the intake' },
    timestamp: 2000,
    retryCount: 5,
    failedAt: 1_700_000_100_000,
    lastError: 'new row violates row-level security policy for table "tasks"',
    terminalReason: 'This change belongs to a season that has been archived.',
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSyncFailures).mockResolvedValue([lapsed, archived]);
});

describe('ParkedChangesDialog', () => {
    it('lists each parked change rather than only counting them', async () => {
        render(<ParkedChangesDialog onClose={vi.fn()} onChanged={vi.fn()} />);

        // The gap this fills: before it, the app reported "2 changes didn't save" and offered
        // to retry all of them. A number is not reviewable.
        await waitFor(() => expect(screen.getAllByTestId('parked-change')).toHaveLength(2));
    });

    it('says what each change actually was, not a uuid', async () => {
        render(<ParkedChangesDialog onClose={vi.fn()} onChanged={vi.fn()} />);

        expect(await screen.findByText('Edited task: Rebuild the intake')).toBeDefined();
        // No title or name on a scouting report, so it falls back to the noun rather than
        // showing an identifier that means nothing to a coach.
        expect(screen.getByText('New scouting report')).toBeDefined();
    });

    it("shows B24's reason next to the change it belongs to", async () => {
        render(<ParkedChangesDialog onClose={vi.fn()} onChanged={vi.fn()} />);

        // The raw error is the same sentence about row-level security for both of these, so
        // the per-item reason is the only thing that distinguishes them.
        expect(await screen.findByText(/licence has lapsed/i)).toBeDefined();
        expect(screen.getByText(/season that has been archived/i)).toBeDefined();
    });

    it('retries ONE change, leaving the rest parked', async () => {
        const onChanged = vi.fn();
        render(<ParkedChangesDialog onClose={vi.fn()} onChanged={onChanged} />);

        await waitFor(() => expect(screen.getAllByTestId('parked-change')).toHaveLength(2));
        fireEvent.click(screen.getAllByTestId('parked-change-retry')[0]);

        // The point of the screen: all-or-nothing retry is what makes a permanently-dead change
        // hold the badge hostage.
        await waitFor(() => expect(retrySyncFailure).toHaveBeenCalledWith('f-1'));
        expect(retrySyncFailure).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(onChanged).toHaveBeenCalled());
    });

    it('never discards without confirming, and names what would be thrown away', async () => {
        render(<ParkedChangesDialog onClose={vi.fn()} onChanged={vi.fn()} />);

        await waitFor(() => expect(screen.getAllByTestId('parked-change')).toHaveLength(2));
        fireEvent.click(screen.getAllByTestId('parked-change-discard')[1]);

        // Discarding is the only action in this app that destroys the user's work on purpose.
        expect(discardSyncFailure).not.toHaveBeenCalled();
        expect(await screen.findByText(/Discard this change\?/i)).toBeDefined();
        // Scoped to the confirmation's own sentence: the change's name also appears in the list
        // behind it, and "it is on screen somewhere" would not prove the prompt names it.
        expect(
            screen.getByText(/"Edited task: Rebuild the intake" will be removed from this device/),
        ).toBeDefined();
    });

    it('discards exactly the confirmed change', async () => {
        const onChanged = vi.fn();
        render(<ParkedChangesDialog onClose={vi.fn()} onChanged={onChanged} />);

        await waitFor(() => expect(screen.getAllByTestId('parked-change')).toHaveLength(2));
        fireEvent.click(screen.getAllByTestId('parked-change-discard')[1]);
        fireEvent.click(await screen.findByTestId('parked-change-discard-confirm'));

        await waitFor(() => expect(discardSyncFailure).toHaveBeenCalledWith('f-2'));
        expect(discardSyncFailure).toHaveBeenCalledTimes(1);
    });

    it('says so plainly when nothing is parked', async () => {
        vi.mocked(getSyncFailures).mockResolvedValue([]);
        render(<ParkedChangesDialog onClose={vi.fn()} onChanged={vi.fn()} />);

        expect(await screen.findByText('Nothing is parked')).toBeDefined();
    });
});
