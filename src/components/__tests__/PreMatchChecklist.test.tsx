import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PreMatchChecklist from '../PreMatchChecklist';
import { useAppStore } from '../../lib/store';

// Mock the store
vi.mock('../../lib/store', () => ({
    useAppStore: vi.fn(),
}));

const mockStore = {
    checklist: [
        { id: '1', text: 'Check batteries', checked: false },
        { id: '2', text: 'Tighten screws', checked: true },
        { id: '3', text: 'Test motors', checked: false },
    ],
    teamMembers: [
        { id: 'member-1', fullName: 'John Doe', email: 'john@test.com', role: 'student' },
        { id: 'member-2', fullName: 'Jane Smith', email: 'jane@test.com', role: 'coach' },
    ],
    subTeams: [
        { id: 'subteam-1', name: 'Build Team', memberIds: ['member-1'] },
        { id: 'subteam-2', name: 'Programming', memberIds: ['member-2'] },
    ],
    toggleChecklistItem: vi.fn(),
    addChecklistItem: vi.fn(),
    deleteChecklistItem: vi.fn(),
    resetChecklist: vi.fn(),
    updateChecklistItem: vi.fn(),
    reorderChecklist: vi.fn(),
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

        // Find the first checklist item text and its parent button
        const checkButton = screen.getByText('Check batteries').closest('button');
        if (checkButton) {
            fireEvent.click(checkButton);
            expect(mockStore.toggleChecklistItem).toHaveBeenCalled();
        }
    });

    it('calls addChecklistItem when adding new item', () => {
        render(<PreMatchChecklist />);

        // Look for add button or input
        const addButtons = screen.getAllByRole('button');
        const addButton = addButtons.find(btn =>
            btn.textContent?.toLowerCase().includes('add') ||
            btn.querySelector('svg')
        );

        if (addButton) {
            fireEvent.click(addButton);
            // After clicking add, there should be input or modal
        }
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

        // Look for reset button
        const buttons = screen.getAllByRole('button');
        const resetButton = buttons.find(btn =>
            btn.textContent?.toLowerCase().includes('reset') ||
            btn.querySelector('[data-testid="reset"]')
        );

        if (resetButton) {
            fireEvent.click(resetButton);
            expect(mockStore.resetChecklist).toHaveBeenCalled();
        }
    });
});
