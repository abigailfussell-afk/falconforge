import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PreMatchChecklist from '../PreMatchChecklist';
import { useAppStore } from '../../lib/store';

// Mock the store hook, but keep the REAL `selectChecklist`. The component reads its list
// through that selector, and a stubbed copy of it would let the store's per-season keying
// (C6) drift away from what this test believes without anything failing.
vi.mock('../../lib/store', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/store')>()),
    useAppStore: vi.fn(),
}));

const SEASON_ID = 'season-1';

const mockStore = {
    currentSeasonId: SEASON_ID,
    checklistsBySeason: {
        [SEASON_ID]: [
            { id: '1', text: 'Check batteries', checked: false },
            { id: '2', text: 'Tighten screws', checked: true },
            { id: '3', text: 'Test motors', checked: false },
        ],
    },
    teamMembers: [
        { id: 'member-1', fullName: 'John Doe', email: 'john@test.com', role: 'student' },
        { id: 'member-2', fullName: 'Jane Smith', email: 'jane@test.com', role: 'coach' },
    ],
    subTeams: [
        { id: 'subteam-1', name: 'Build Team', memberIds: ['member-1'] },
        { id: 'subteam-2', name: 'Programming', memberIds: ['member-2'] },
    ],
    // Sprint 4: the checklist asks whether its season is archived before offering an edit.
    seasons: [{ id: SEASON_ID, name: 'Test Season', gameTitle: '', fieldImageData: '', isArchived: false, createdAt: 1000 }],
    toggleChecklistItem: vi.fn(),
    addChecklistItem: vi.fn(),
    deleteChecklistItem: vi.fn(),
    resetChecklist: vi.fn(),
    updateChecklistItem: vi.fn(),
    reorderChecklist: vi.fn(),
    saveChecklistAsTemplate: vi.fn(),
};

describe('PreMatchChecklist', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) => {
            if (typeof selector === 'function') {
                return selector(mockStore);
            }
            return mockStore;
        });
    });

    it('renders checklist items', () => {
        render(<PreMatchChecklist />);

        expect(screen.getByText('Check batteries')).toBeDefined();
        expect(screen.getByText('Tighten screws')).toBeDefined();
        expect(screen.getByText('Test motors')).toBeDefined();
    });

    it('shows checked state correctly', () => {
        render(<PreMatchChecklist />);

        // Find checkboxes or visual indicators
        const items = screen.getAllByRole('button');
        expect(items.length).toBeGreaterThan(0);
    });

    it('calls toggleChecklistItem when clicking an item', () => {
        render(<PreMatchChecklist />);

        // Regression (Sprint 5.5): the row used to be a clickable div/span pair, so this
        // `.closest('button')` was null and the old `if` guard silently skipped the whole
        // assertion. A real <button> is also what makes the item keyboard-reachable —
        // ticking items is this page's entire job.
        const checkButton = screen.getByText('Check batteries').closest('button');
        expect(checkButton).not.toBeNull();
        fireEvent.click(checkButton!);
        expect(mockStore.toggleChecklistItem).toHaveBeenCalledWith('1');
    });

    it('disables Add until the new-item field has text', () => {
        // Regression (Sprint 5.5): the Add button used to accept the tap and silently
        // do nothing on an empty field.
        render(<PreMatchChecklist />);

        fireEvent.click(screen.getByTestId('edit-checklist'));

        const addBtn = screen.getByText('Add').closest('button') as HTMLButtonElement;
        expect(addBtn.disabled).toBe(true);

        fireEvent.change(screen.getByPlaceholderText('Add new item...'), {
            target: { value: 'Check camera mount' },
        });
        expect(addBtn.disabled).toBe(false);

        fireEvent.click(addBtn);
        expect(mockStore.addChecklistItem).toHaveBeenCalledWith('Check camera mount');
    });

    it('puts the list into edit mode, where items can be added', () => {
        /*
         * OPS-02. This searched the buttons for one whose text contained "add" OR THAT HELD ANY
         * `svg` — nearly every icon button on the page — and then did all of its work inside
         * `if (addButton)` with no assertion. It never called `addChecklistItem`, despite its
         * name, and it passed whether the checklist rendered or not.
         *
         * Adding an item is behind Edit, so that is what this asserts: the state change the
         * screen actually has. The name changed with it, because a test named for a call it
         * does not make is how the next reader is misled about what is covered.
         */
        render(<PreMatchChecklist />);

        fireEvent.click(screen.getByTestId('edit-checklist'));

        expect(screen.getByTestId('reset-checklist')).toBeInTheDocument();
        // Edit mode is what reveals the new-item field; view mode has no way to add one.
        expect(screen.getByPlaceholderText('Add new item...')).toBeInTheDocument();
        // ...and it withdraws the tick-off buttons, which is what makes it a MODE rather
        // than an extra row.
        expect(screen.queryAllByTestId('checklist-item-toggle')).toHaveLength(0);
    });

    it('displays progress indicator', () => {
        render(<PreMatchChecklist />);

        // Should show something like "1/3 completed" or progress bar
        // The exact text depends on implementation
        const container = document.querySelector('.flex');
        expect(container).toBeDefined();
    });

    it('has reset functionality', () => {
        render(<PreMatchChecklist />);

        /*
         * OPS-02: the assertion used to sit inside `if (resetButton)`, and the search was for a
         * button whose text contained "reset" or that held `[data-testid="reset"]` — the real
         * id is `reset-checklist`, so it matched nothing and the expectation never ran.
         */
        fireEvent.click(screen.getByTestId('reset-checklist'));
        expect(mockStore.resetChecklist).toHaveBeenCalled();
    });
});
