import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SeasonManager from '../SeasonManager';
import { useAppStore } from '../../lib/store';

// Mock the store
vi.mock('../../lib/store', () => ({
    useAppStore: vi.fn(),
}));

describe('SeasonManager', () => {
    const mockAddSeason = vi.fn();
    const mockUpdateSeason = vi.fn();
    const mockDeleteSeason = vi.fn();

    const mockSeasons = [
        { id: 's1', name: 'Season 1', fieldImageData: null },
        { id: 's2', name: 'Season 2', fieldImageData: 'data:image/png;base64,xxx' },
    ];

    beforeEach(() => {
        vi.clearAllMocks();

        // Default store mock implementation
        (useAppStore as any).mockImplementation((selector: any) => {
            const state = {
                seasons: mockSeasons,
                currentSeasonId: 's1',
                addSeason: mockAddSeason,
                updateSeason: mockUpdateSeason,
                deleteSeason: mockDeleteSeason,
            };
            return selector(state);
        });

        // Mock URL.createObjectURL/revokeObjectURL
        global.URL.createObjectURL = vi.fn(() => 'blob:test');
        global.URL.revokeObjectURL = vi.fn();
    });

    describe('Rendering & Display', () => {
        it('renders the component and lists seasons', () => {
            render(<SeasonManager />);
            expect(screen.getByText('Season Manager')).toBeDefined();
            expect(screen.getByText('Season 1')).toBeDefined();
            expect(screen.getByText('Season 2')).toBeDefined();
        });

        it('shows "Active" badge for current season', () => {
            render(<SeasonManager />);
            const activeBadge = screen.getByText('Active');
            expect(activeBadge).toBeDefined();
            // Since s1 is active, it should be next to Season 1, but we just verify it exists.
        });
    });

    describe('Adding a Season', () => {
        it('adds a new season via button click', () => {
            render(<SeasonManager />);
            
            const input = screen.getByPlaceholderText(/New Season Name/i);
            fireEvent.change(input, { target: { value: 'Season 3' } });
            
            // The button icon is Plus, we can find the button by its enclosing div or role
            // The button is the only one next to the input
            const buttons = screen.getAllByRole('button');
            const addButton = buttons[0]; // First button is usually the Add button
            
            fireEvent.click(addButton);
            
            expect(mockAddSeason).toHaveBeenCalledWith('Season 3');
        });

        it('adds a new season via Enter key', () => {
            render(<SeasonManager />);
            
            const input = screen.getByPlaceholderText(/New Season Name/i);
            fireEvent.change(input, { target: { value: 'Season 4' } });
            fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
            
            expect(mockAddSeason).toHaveBeenCalledWith('Season 4');
        });

        it('does not add season if name is empty', () => {
            render(<SeasonManager />);
            
            const input = screen.getByPlaceholderText(/New Season Name/i);
            fireEvent.change(input, { target: { value: '   ' } });
            fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
            
            expect(mockAddSeason).not.toHaveBeenCalled();
        });
    });

    describe('Editing a Season', () => {
        it('toggles edit mode and updates season name', () => {
            render(<SeasonManager />);
            
            // Click Edit for season 1
            const editButtons = screen.getAllByText('Edit');
            fireEvent.click(editButtons[0]);
            
            // Input should be visible with current name
            const inputs = screen.getAllByRole('textbox');
            const editInput = inputs.find(i => (i as HTMLInputElement).value === 'Season 1');
            expect(editInput).toBeDefined();
            
            if (editInput) {
                fireEvent.change(editInput, { target: { value: 'Updated Season 1' } });
                fireEvent.blur(editInput);
                expect(mockUpdateSeason).toHaveBeenCalledWith('s1', { name: 'Updated Season 1' });
            }
        });

        it('closes edit mode when clicking Done', () => {
            render(<SeasonManager />);
            
            // Click Edit for season 1
            const editButtons = screen.getAllByText('Edit');
            fireEvent.click(editButtons[0]);
            
            // Should say Done now
            const doneButton = screen.getByText('Done');
            fireEvent.click(doneButton);
            
            // Should be back to Edit
            expect(screen.getAllByText('Edit').length).toBeGreaterThan(0);
            expect(screen.queryByText('Done')).toBeNull();
        });
    });

    describe('Deleting a Season', () => {
        it('does not show delete button if only one season exists', () => {
            (useAppStore as any).mockImplementation((selector: any) => {
                const state = {
                    seasons: [{ id: 's1', name: 'Only Season', fieldImageData: null }],
                    currentSeasonId: 's1',
                    addSeason: mockAddSeason,
                    updateSeason: mockUpdateSeason,
                    deleteSeason: mockDeleteSeason,
                };
                return selector(state);
            });
            
            const { container } = render(<SeasonManager />);
            const trashIcons = container.querySelectorAll('.lucide-trash-2');
            expect(trashIcons.length).toBe(0);
        });

        it('shows confirmation modal and deletes season', () => {
            const { container } = render(<SeasonManager />);
            
            // Click delete for the second season
            // The trash icon is wrapped in a button
            const trashIcons = container.querySelectorAll('.lucide-trash-2');
            const deleteButton = trashIcons[1].closest('button');
            
            if (deleteButton) {
                fireEvent.click(deleteButton);
            }
            
            // Modal should appear
            expect(screen.getByText('Delete Season?')).toBeDefined();
            expect(screen.getByText(/permanently delete the season/i)).toBeDefined();
            
            // Click cancel first
            fireEvent.click(screen.getByText('Cancel'));
            expect(screen.queryByText('Delete Season?')).toBeNull();
            
            // Click delete again
            if (deleteButton) {
                fireEvent.click(deleteButton);
            }
            
            // Confirm deletion
            const confirmDeleteButtons = screen.getAllByText('Delete Season');
            const confirmButton = confirmDeleteButtons.find(b => b.tagName.toLowerCase() === 'button');
            
            if (confirmButton) {
                fireEvent.click(confirmButton);
                expect(mockDeleteSeason).toHaveBeenCalledWith('s2');
                expect(screen.queryByText('Delete Season?')).toBeNull(); // Modal closes
            }
        });
    });

    describe('Image Upload', () => {
        it('validates non-image files', () => {
            render(<SeasonManager />);
            fireEvent.click(screen.getAllByText('Edit')[0]);
            
            // Find file input by type
            const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
            
            const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
            fireEvent.change(fileInput, { target: { files: [file] } });
            
            expect(screen.getByText('Please select an image file')).toBeDefined();
        });

        it('validates file size over 500KB', () => {
            render(<SeasonManager />);
            fireEvent.click(screen.getAllByText('Edit')[0]);
            
            const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
            
            // Create a file > 500KB
            const bigArray = new Uint8Array(501 * 1024);
            const file = new File([bigArray], 'big.png', { type: 'image/png' });
            
            fireEvent.change(fileInput, { target: { files: [file] } });
            
            expect(screen.getByText('Image must be less than 500KB')).toBeDefined();
        });

        it('allows removing an image', () => {
            // Season 2 has an image initially
            render(<SeasonManager />);
            
            // Click edit for Season 2
            fireEvent.click(screen.getAllByText('Edit')[1]);
            
            // Should see Replace Image
            expect(screen.getByText('Replace Image')).toBeDefined();
            
            // Should have remove button (X icon)
            const removeButton = document.querySelector('button[title="Remove image"]');
            expect(removeButton).toBeDefined();
            
            if (removeButton) {
                fireEvent.click(removeButton);
                expect(mockUpdateSeason).toHaveBeenCalledWith('s2', { fieldImageData: '' });
                
                // After remove, text should change to Upload Field Image
                expect(screen.getByText('Upload Field Image')).toBeDefined();
            }
        });
    });
});
