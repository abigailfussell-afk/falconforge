import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SeasonManager from '../SeasonManager';
import { useAppStore } from '../../lib/store';

/*
 * Mock the store — INCLUDING `getState`.
 *
 * `ensureSeasonFieldImage` reads the store directly, and a `vi.fn()` with no `getState`
 * threw inside an async function, i.e. as an unhandled rejection: the run fails while every
 * test reports passing (`docs/failure-modes.md` section 11). A mock that cannot represent
 * what the code under test does is the same class as a mock returning `undefined` where the
 * real API returns a promise.
 */
const storeState = { seasons: [] as unknown[] };
vi.mock('../../lib/store', () => {
    const useAppStore = Object.assign(vi.fn(), { getState: () => storeState });
    return { useAppStore };
});

const season = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    name: 'Season 1',
    gameTitle: '',
    fieldImageData: null,
    isArchived: false,
    createdAt: 1000,
    ...over,
});

describe('SeasonManager', () => {
    const mockUpdateSeason = vi.fn();
    const mockDeleteSeason = vi.fn();
    const mockSetSeasonArchived = vi.fn();
    const mockRollOverSeason = vi.fn(() => 'new-season-id');

    const mockSeasons = [
        season({ id: 's1', name: 'Season 1' }),
        season({ id: 's2', name: 'Season 2', fieldImageData: 'data:image/png;base64,xxx' }),
    ];

    /** Point the mocked store at a state, without rendering anything. */
    const setStore = (over: Record<string, unknown> = {}) => {
        (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: (s: unknown) => unknown) =>
            selector({
                seasons: mockSeasons,
                currentSeasonId: 's1',
                subTeams: [
                    { id: 'st1', name: 'Build', memberIds: ['m1'], seasonId: 's1' },
                    { id: 'st2', name: 'Programming', memberIds: [], seasonId: 's1' },
                ],
                checklistTemplates: [],
                entitlement: { teamId: 't1', status: 'active', seatsTotal: null, seatsUnlimited: true, seatsUsed: 1, validUntil: null, lapsedAt: null },
                updateSeason: mockUpdateSeason,
                deleteSeason: mockDeleteSeason,
                setSeasonArchived: mockSetSeasonArchived,
                rollOverSeason: mockRollOverSeason,
                ...over,
            }),
        );
    };

    /** Render with a store state, defaulting to an entitled team on an open season. */
    const mountWith = (over: Record<string, unknown> = {}) => {
        setStore(over);
        return render(<SeasonManager />);
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockRollOverSeason.mockReturnValue('new-season-id');
        global.URL.createObjectURL = vi.fn(() => 'blob:test');
        global.URL.revokeObjectURL = vi.fn();
    });

    describe('Rendering & Display', () => {
        it('renders the component and lists seasons', () => {
            mountWith();
            expect(screen.getByText('Season Manager')).toBeDefined();
            expect(screen.getByText('Season 1')).toBeDefined();
            expect(screen.getByText('Season 2')).toBeDefined();
        });

        it('shows "Active" badge for current season', () => {
            mountWith();
            expect(screen.getByText('Active')).toBeDefined();
        });

        it('shows the game title alongside the season name', () => {
            mountWith({ seasons: [season({ gameTitle: 'DECODE' })] });
            expect(screen.getByText('· DECODE')).toBeDefined();
        });

        it('marks an archived season', () => {
            mountWith({ seasons: [season({ isArchived: true })] });
            expect(screen.getByTestId('archived-badge-s1')).toBeDefined();
        });
    });

    describe('The new-season wizard', () => {
        it('pre-fills the next season name from the current one', () => {
            mountWith({ seasons: [season({ name: '2026-2027 Season' })] });
            fireEvent.click(screen.getByTestId('start-new-season'));

            expect((screen.getByTestId('wizard-season-name') as HTMLInputElement).value)
                .toBe('2027-2028 Season');
        });

        it('rolls over with the structure cloned and the previous season archived', () => {
            mountWith();
            fireEvent.click(screen.getByTestId('start-new-season'));

            fireEvent.change(screen.getByTestId('wizard-season-name'), { target: { value: '2027-2028 Season' } });
            fireEvent.change(screen.getByTestId('wizard-game-title'), { target: { value: 'DECODE' } });
            fireEvent.click(screen.getByTestId('wizard-confirm'));

            expect(mockRollOverSeason).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: '2027-2028 Season',
                    gameTitle: 'DECODE',
                    cloneSubTeams: true,
                    checklistSource: 'previous',
                    archivePrevious: true,
                    fromSeasonId: 's1',
                }),
            );
        });

        it('names the sub-teams that will be copied, and says members are not', () => {
            mountWith();
            fireEvent.click(screen.getByTestId('start-new-season'));

            expect(screen.getByText(/Build, Programming/)).toBeDefined();
            expect(screen.getByText(/Member assignments always start empty/)).toBeDefined();
        });

        it('passes the chosen checklist source through', () => {
            mountWith({
                checklistTemplates: [{ id: 'tpl-1', name: 'Standard', items: [], seasonId: 's1' }],
            });
            fireEvent.click(screen.getByTestId('start-new-season'));
            fireEvent.change(screen.getByTestId('wizard-checklist-source'), {
                target: { value: 'template:tpl-1' },
            });
            fireEvent.click(screen.getByTestId('wizard-confirm'));

            expect(mockRollOverSeason).toHaveBeenCalledWith(
                expect.objectContaining({ checklistSource: 'template:tpl-1' }),
            );
        });

        it('will not create a season with a blank name', () => {
            mountWith();
            fireEvent.click(screen.getByTestId('start-new-season'));
            fireEvent.change(screen.getByTestId('wizard-season-name'), { target: { value: '   ' } });

            expect((screen.getByTestId('wizard-confirm') as HTMLButtonElement).disabled).toBe(true);
            fireEvent.click(screen.getByTestId('wizard-confirm'));
            expect(mockRollOverSeason).not.toHaveBeenCalled();
        });
    });

    describe('An unlicensed team is not offered a rollover', () => {
        /*
         * The inherited defect this guards. Sprint 3 verified in a browser that an
         * unlicensed team's writes fail SILENTLY — the row appears, the server refuses it
         * (403 from a policy requiring `team_can_write`), and the sync indicator reads
         * "1 pending" with no reason. A rollover is such a write, so it must not be offered.
         */
        const readOnly = {
            entitlement: { teamId: 't1', status: 'read_only', seatsTotal: null, seatsUnlimited: false, seatsUsed: 0, validUntil: null, lapsedAt: '2026-01-01T00:00:00Z' },
        };

        it('disables the action and says why', () => {
            mountWith(readOnly);

            expect((screen.getByTestId('start-new-season') as HTMLButtonElement).disabled).toBe(true);
            expect(screen.getByTestId('rollover-blocked-reason')).toBeDefined();
        });

        it('queues nothing even if the click gets through', () => {
            // A NAME IS TYPED FIRST, deliberately. Without it this test passed with the
            // entitlement guard deleted — the handler declined on the empty name instead,
            // so it was asserting nothing about licensing at all. Found by removing the
            // guard on purpose and watching which assertions noticed.
            mountWith(readOnly);

            fireEvent.change(screen.getByPlaceholderText(/Add an empty season/i), {
                target: { value: 'Sneaky Season' },
            });
            fireEvent.click(screen.getByTestId('add-empty-season'));

            expect(mockRollOverSeason).not.toHaveBeenCalled();
        });

        it('will not roll over from the wizard either, if it is somehow opened', () => {
            mountWith(readOnly);
            fireEvent.click(screen.getByTestId('start-new-season'));

            // The wizard does not open, because its trigger is disabled — which is itself
            // the assertion. If a future change opens it another way, `confirmRollover`
            // still refuses; that is why the guard is in the handler as well as on the
            // button.
            expect(screen.queryByTestId('new-season-wizard')).toBeNull();
            expect(mockRollOverSeason).not.toHaveBeenCalled();
        });

        it('still offers the rollover when entitlement is UNKNOWN', () => {
            // Null means "we could not read the view" — offline, or the request failed —
            // which is not the same as "you are not licensed". Blocking on it would take
            // the rollover away from every offline team, and the server is the boundary.
            mountWith({ entitlement: null });

            expect((screen.getByTestId('start-new-season') as HTMLButtonElement).disabled).toBe(false);
            expect(screen.queryByTestId('rollover-blocked-reason')).toBeNull();
        });
    });

    describe('Archiving', () => {
        it('archives an open season', () => {
            mountWith();
            fireEvent.click(screen.getByTestId('toggle-archive-s1'));
            expect(mockSetSeasonArchived).toHaveBeenCalledWith('s1', true);
        });

        it('reopens an archived one — archival is not a one-way door', () => {
            mountWith({ seasons: [season({ isArchived: true })] });
            fireEvent.click(screen.getByTestId('toggle-archive-s1'));
            expect(mockSetSeasonArchived).toHaveBeenCalledWith('s1', false);
        });
    });

    describe('Adding a bare season', () => {
        it('adds one with nothing cloned and nothing archived', () => {
            mountWith();

            const input = screen.getByPlaceholderText(/Add an empty season/i);
            fireEvent.change(input, { target: { value: 'Off-Season 2027' } });
            fireEvent.click(screen.getByTestId('add-empty-season'));

            expect(mockRollOverSeason).toHaveBeenCalledWith({
                name: 'Off-Season 2027',
                cloneSubTeams: false,
                checklistSource: 'blank',
                archivePrevious: false,
            });
        });

        it('adds one via the Enter key', () => {
            mountWith();

            const input = screen.getByPlaceholderText(/Add an empty season/i);
            fireEvent.change(input, { target: { value: 'Season 4' } });
            fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

            expect(mockRollOverSeason).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Season 4' }),
            );
        });

        it('does not add a season if the name is empty', () => {
            mountWith();

            const input = screen.getByPlaceholderText(/Add an empty season/i);
            fireEvent.change(input, { target: { value: '   ' } });
            fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

            expect(mockRollOverSeason).not.toHaveBeenCalled();
        });
    });

    describe('Editing a Season', () => {
        it('toggles edit mode and updates season name', () => {
            mountWith();

            fireEvent.click(screen.getAllByText('Edit')[0]);

            const inputs = screen.getAllByRole('textbox');
            const editInput = inputs.find(i => (i as HTMLInputElement).value === 'Season 1');
            expect(editInput).toBeDefined();

            fireEvent.change(editInput!, { target: { value: 'Updated Season 1' } });
            fireEvent.blur(editInput!);
            expect(mockUpdateSeason).toHaveBeenCalledWith('s1', { name: 'Updated Season 1' });
        });

        it('updates the game title', () => {
            mountWith();
            fireEvent.click(screen.getAllByText('Edit')[0]);

            const input = screen.getByTestId('edit-game-title-s1');
            fireEvent.change(input, { target: { value: 'DECODE' } });
            fireEvent.blur(input);

            expect(mockUpdateSeason).toHaveBeenCalledWith('s1', { gameTitle: 'DECODE' });
        });

        it('closes edit mode when clicking Done', () => {
            mountWith();

            fireEvent.click(screen.getAllByText('Edit')[0]);
            fireEvent.click(screen.getByText('Done'));

            expect(screen.getAllByText('Edit').length).toBeGreaterThan(0);
            expect(screen.queryByText('Done')).toBeNull();
        });
    });

    describe('Deleting a Season', () => {
        it('does not show delete button if only one season exists', () => {
            const { container } = mountWith({ seasons: [season({ name: 'Only Season' })] });
            const trashIcons = container.querySelectorAll('.lucide-trash-2');
            expect(trashIcons.length).toBe(0);
        });

        it('shows confirmation modal and deletes season', () => {
            const { container } = mountWith();

            const trashIcons = container.querySelectorAll('.lucide-trash-2');
            const deleteButton = trashIcons[1].closest('button')!;

            fireEvent.click(deleteButton);

            expect(screen.getByText('Delete Season?')).toBeDefined();
            expect(screen.getByText(/permanently delete the season/i)).toBeDefined();

            fireEvent.click(screen.getByText('Cancel'));
            expect(screen.queryByText('Delete Season?')).toBeNull();

            fireEvent.click(deleteButton);

            const confirmButton = screen
                .getAllByText('Delete Season')
                .find(b => b.tagName.toLowerCase() === 'button')!;

            fireEvent.click(confirmButton);
            expect(mockDeleteSeason).toHaveBeenCalledWith('s2');
            expect(screen.queryByText('Delete Season?')).toBeNull();
        });

        it('points at archiving as the non-destructive alternative', () => {
            const { container } = mountWith();
            fireEvent.click(container.querySelectorAll('.lucide-trash-2')[1].closest('button')!);
            expect(screen.getByText(/archive it instead/i)).toBeDefined();
        });
    });

    describe('Image Upload', () => {
        it('validates non-image files', () => {
            mountWith();
            fireEvent.click(screen.getAllByText('Edit')[0]);

            const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
            const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
            fireEvent.change(fileInput, { target: { files: [file] } });

            expect(screen.getByText('Please select an image file')).toBeDefined();
        });

        it('validates file size over 500KB', () => {
            mountWith();
            fireEvent.click(screen.getAllByText('Edit')[0]);

            const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
            const bigArray = new Uint8Array(501 * 1024);
            const file = new File([bigArray], 'big.png', { type: 'image/png' });

            fireEvent.change(fileInput, { target: { files: [file] } });

            expect(screen.getByText('Image must be less than 500KB')).toBeDefined();
        });

        it('allows removing an image', () => {
            const { rerender } = mountWith();

            fireEvent.click(screen.getAllByText('Edit')[1]);
            expect(screen.getByText('Replace Image')).toBeDefined();

            const removeButton = document.querySelector('button[title="Remove image"]')!;
            fireEvent.click(removeButton);
            expect(mockUpdateSeason).toHaveBeenCalledWith('s2', { fieldImageData: '' });

            /*
             * The panel reads the STORE, not a local copy of it, so the label follows the
             * store — which the mock has to be told about, because a spy does not write one.
             *
             * The previous version of this assertion passed without this step, because the
             * component kept its own `editFieldImageData` and cleared it on click. That made
             * the check a statement about a `useState` call rather than about the season, and
             * it would have gone on passing if `updateSeason` had stopped being called at
             * all. It also could not survive the field image becoming a lazily-fetched column
             * (SYNC-03): a copy taken when the panel opened would never learn the image had
             * arrived.
             */
            setStore({
                seasons: [mockSeasons[0], season({ id: 's2', name: 'Season 2', fieldImageData: '' })],
            });
            rerender(<SeasonManager />);

            // The panel is still open — the label under it is what changed.
            expect(screen.getByText('Upload Field Image')).toBeDefined();
            expect(screen.queryByText('Replace Image')).toBeNull();
        });
    });
});
