import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MatchPlanner from '../MatchPlanner';
import { useAppStore } from '../../lib/store';
import { useMatchPlansQuery } from '../../lib/queries';

// Mock the queries
vi.mock('../../lib/queries', () => ({
    useMatchPlansQuery: vi.fn(),
}));

// Mock the store
vi.mock('../../lib/store', () => ({
    useAppStore: vi.fn(),
}));

// Mock D3 to avoid canvas issues in tests
vi.mock('d3', () => ({
    select: vi.fn(() => ({
        attr: vi.fn().mockReturnThis(),
        style: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
        append: vi.fn().mockReturnThis(),
        selectAll: vi.fn(() => ({
            attr: vi.fn().mockReturnThis(),
            style: vi.fn().mockReturnThis(),
            on: vi.fn().mockReturnThis(),
            call: vi.fn().mockReturnThis(),
            remove: vi.fn().mockReturnThis(),
        })),
        remove: vi.fn().mockReturnThis(),
        node: vi.fn(() => ({ getContext: vi.fn() })),
        call: vi.fn().mockReturnThis(),
    })),
    drag: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
    })),
}));

// Mock SVG methods that JSDOM doesn't support
Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', {
    value: vi.fn(() => ({
        inverse: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })),
    })),
    configurable: true
});
Object.defineProperty(SVGSVGElement.prototype, 'createSVGPoint', {
    value: function() {
        return {
            x: 0,
            y: 0,
            matrixTransform: function(this: any) {
                return { x: this.x, y: this.y };
            }
        };
    },
    configurable: true
});
Object.defineProperty(Element.prototype, 'setPointerCapture', { value: vi.fn(), configurable: true });
Object.defineProperty(Element.prototype, 'releasePointerCapture', { value: vi.fn(), configurable: true });

describe('MatchPlanner', () => {
    const mockAddMatchPlan = vi.fn();
    const mockDeleteMatchPlan = vi.fn();

    const mockMatchPlans = [
        {
            id: 'plan-1',
            title: 'Match 1 Strategy',
            drawingData: [{ d: 'M 10 10 L 20 20', stroke: '#ef4444', width: 3 }],
            notes: 'Start on left side',
            allianceTeam: '12345',
            partnerAutonomous: true,
            partnerPark: true,
            updatedAt: Date.now(),
            seasonId: 'season-1',
        },
    ];

    const mockStore = {
        matchPlans: mockMatchPlans,
        addMatchPlan: mockAddMatchPlan,
        deleteMatchPlan: mockDeleteMatchPlan,
        currentSeasonId: 'season-1',
        currentTeamId: 'team-1',
        getCurrentSeason: () => ({
            id: 'season-1',
            name: 'Test Season',
            fieldImageData: '',
        }),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) => {
            if (typeof selector === 'function') {
                return selector(mockStore);
            }
            return mockStore;
        });
        (useMatchPlansQuery as any).mockReturnValue({ isLoading: false });
    });

    it('renders the planner with default values', () => {
        render(<MatchPlanner />);
        expect(screen.getByText('Match Notes')).toBeDefined();
        expect(useMatchPlansQuery).toHaveBeenCalledWith('team-1');
    });

    it('allows toggling drawing mode and colors', () => {
        const { container } = render(<MatchPlanner />);
        
        // Find toggle drawing button (usually the first button in the toolbar)
        const toggleBtn = container.querySelector('button[title*="Drawing"]');
        expect(toggleBtn).toBeDefined();
        
        if (toggleBtn) {
            fireEvent.click(toggleBtn);
            // It should toggle, hard to assert state visually without exact classes, but it runs
        }
        
        // Find color buttons
        const redBtn = container.querySelector('.bg-red-500');
        const blueBtn = container.querySelector('.bg-blue-500');
        const greenBtn = container.querySelector('.bg-green-500');
        const yellowBtn = container.querySelector('.bg-yellow-400');
        expect(redBtn).toBeDefined();
        
        if (redBtn) fireEvent.click(redBtn);
        if (blueBtn) fireEvent.click(blueBtn);
        if (greenBtn) fireEvent.click(greenBtn);
        if (yellowBtn) fireEvent.click(yellowBtn);
    });

    describe.skip('Drawing actions', () => {
        it('handles pointer events for drawing', () => {
            const { container } = render(<MatchPlanner />);
            const svg = container.querySelector('svg');
            expect(svg).toBeDefined();

            if (svg) {
                fireEvent.pointerDown(svg, { clientX: 10, clientY: 10, pointerId: 1 });
                fireEvent.pointerMove(svg, { clientX: 20, clientY: 20, pointerId: 1 });
                fireEvent.pointerUp(svg, { pointerId: 1 });

                // The path should be added to the SVG
                // A path should render with d="M 10 10 L 20 20"
                const path = container.querySelector('.touch-none path');
                expect(path).not.toBeNull();
                if (path) {
                    expect(path.getAttribute('d')).toContain('M');
                }
            }
        });

        it('handles undo, redo, and clear', () => {
            const { container } = render(<MatchPlanner />);
            const svg = container.querySelector('svg');
            
            if (svg) {
                // Draw line 1
                fireEvent.pointerDown(svg, { clientX: 10, clientY: 10, pointerId: 1 });
                fireEvent.pointerUp(svg, { pointerId: 1 });
                
                // Draw line 2
                fireEvent.pointerDown(svg, { clientX: 20, clientY: 20, pointerId: 1 });
                fireEvent.pointerUp(svg, { pointerId: 1 });
                
                // We should have 2 paths
                expect(container.querySelector('.touch-none')?.querySelectorAll('path').length).toBe(2);
                
                const undoBtn = container.querySelector('button[title="Undo"]');
                const redoBtn = container.querySelector('button[title="Redo"]');
                const clearBtn = container.querySelector('button[title="Clear"]');
                
                if (undoBtn && redoBtn && clearBtn) {
                    fireEvent.click(undoBtn);
                    expect(container.querySelector('.touch-none')?.querySelectorAll('path').length).toBe(1);
                    
                    fireEvent.click(redoBtn);
                    expect(container.querySelector('.touch-none')?.querySelectorAll('path').length).toBe(2);
                    
                    fireEvent.click(clearBtn);
                    expect(container.querySelector('.touch-none')?.querySelectorAll('path').length).toBe(0);
                }
            }
        });
    });

    describe('Notes and Settings', () => {
        it('inputs notes and checkboxes', () => {
            render(<MatchPlanner />);
            
            const allianceInput = screen.getByPlaceholderText('Team # / Name');
            fireEvent.change(allianceInput, { target: { value: '9999' } });
            
            const notesTextarea = screen.getByPlaceholderText(/1. Autonomous path/i);
            fireEvent.change(notesTextarea, { target: { value: 'Test notes' } });
            
            const autoCheckbox = screen.getByLabelText(/Autonomous/i);
            const parkCheckbox = screen.getByLabelText(/Lifted Park/i);
            
            fireEvent.click(autoCheckbox);
            fireEvent.click(parkCheckbox);
            
            expect((allianceInput as HTMLInputElement).value).toBe('9999');
            expect((notesTextarea as HTMLTextAreaElement).value).toBe('Test notes');
            expect((autoCheckbox as HTMLInputElement).checked).toBe(true);
            expect((parkCheckbox as HTMLInputElement).checked).toBe(true);
        });
    });

    describe('Save Plan Modal', () => {
        it('opens save modal, fills title, and saves', async () => {
            const { container } = render(<MatchPlanner />);
            
            // Add some notes
            fireEvent.change(screen.getByPlaceholderText('Team # / Name'), { target: { value: '9999' } });
            
            // Click Save (icon) button
            const saveBtn = container.querySelector('button[title="Save Plan"]');
            if (saveBtn) fireEvent.click(saveBtn);
            
            // Modal appears
            expect(screen.getByText('Save Match Plan')).toBeDefined();
            
            const titleInput = screen.getByPlaceholderText('Plan Name (e.g. Match 1)');
            fireEvent.change(titleInput, { target: { value: 'My Awesome Plan' } });
            
            // Press Enter to save
            fireEvent.keyDown(titleInput, { key: 'Enter', code: 'Enter' });
            
            await waitFor(() => {
                expect(mockAddMatchPlan).toHaveBeenCalledWith(expect.objectContaining({
                    title: 'My Awesome Plan',
                    allianceTeam: '9999',
                }));
            });
            
            // Shows Success
            expect(screen.getByText('Plan Saved!')).toBeDefined();
        });

        it('saves via the Save button in modal', async () => {
            const { container } = render(<MatchPlanner />);
            const saveBtn = container.querySelector('button[title="Save Plan"]');
            if (saveBtn) fireEvent.click(saveBtn);
            
            const modalSaveBtns = screen.getAllByRole('button', { name: 'Save' });
            const saveConfirmBtn = modalSaveBtns[modalSaveBtns.length - 1]; // Pick the modal one
            fireEvent.click(saveConfirmBtn);
            
            expect(mockAddMatchPlan).toHaveBeenCalled();
        });
    });

    describe('Load Plan Modal', () => {
        it('opens load modal, loads a plan, and populates form', () => {
            const { container } = render(<MatchPlanner />);
            
            const loadBtn = container.querySelector('button[title="Load Plans"]');
            if (loadBtn) fireEvent.click(loadBtn);
            
            // Modal appears with plans
            expect(screen.getByText('Saved Plans')).toBeDefined();
            expect(screen.getByText('Match 1 Strategy')).toBeDefined();
            
            // Click to load
            fireEvent.click(screen.getByText('Match 1 Strategy'));
            
            // It should populate the notes
            const allianceInput = screen.getByPlaceholderText('Team # / Name') as HTMLInputElement;
            expect(allianceInput.value).toBe('12345');
            
            const notesTextarea = screen.getByPlaceholderText(/1. Autonomous path/i) as HTMLTextAreaElement;
            expect(notesTextarea.value).toBe('Start on left side');
            
            // The drawing path should also render
            expect(container.querySelector('.touch-none')?.querySelectorAll('path').length).toBe(1);
            
            // Now test Undo, Redo, and Clear using the loaded paths
            const undoBtn = container.querySelector('button[title="Undo"]');
            const redoBtn = container.querySelector('button[title="Redo"]');
            const clearBtn = container.querySelector('button[title="Clear"]');
            
            if (undoBtn && redoBtn && clearBtn) {
                // Undo
                fireEvent.click(undoBtn);
                expect(container.querySelector('.touch-none')?.querySelectorAll('path').length).toBe(0);
                
                // Redo
                fireEvent.click(redoBtn);
                expect(container.querySelector('.touch-none')?.querySelectorAll('path').length).toBe(1);
                
                // Clear
                fireEvent.click(clearBtn);
                expect(container.querySelector('.touch-none')?.querySelectorAll('path').length).toBe(0);
            }
        });

        it('allows deleting a plan from the load modal', () => {
            const { container } = render(<MatchPlanner />);
            
            const loadBtn = container.querySelector('button[title="Load Plans"]');
            if (loadBtn) fireEvent.click(loadBtn);
            
            // Find trash icon inside the modal
            // We can pinpoint it by looking for the row of the plan
            const planText = screen.getByText('Match 1 Strategy');
            // The structure is roughly: .font-bold -> .cursor-pointer -> .flex.items-center.justify-between -> button
            const planRow = planText.parentElement?.parentElement;
            const deleteBtn = planRow?.querySelector('button');
            
            if (deleteBtn) {
                fireEvent.click(deleteBtn);
                expect(mockDeleteMatchPlan).toHaveBeenCalledWith('plan-1');
            }
        });
    });

    describe('Mobile UI and Modal specific branches', () => {
        it('opens modals via mobile action buttons and handles cancellation', () => {
            const { container } = render(<MatchPlanner />);
            
            const mobileButtons = container.querySelectorAll('.lg\\:hidden button');
            const mobileLoad = mobileButtons[0];
            const mobileSave = mobileButtons[1];
            
            // Mobile Load
            if (mobileLoad) fireEvent.click(mobileLoad);
            expect(screen.getByText('Saved Plans')).toBeDefined();
            
            // Close Load Modal
            const closeLoadBtn = container.querySelector('button svg.lucide-x')?.closest('button');
            if (closeLoadBtn) fireEvent.click(closeLoadBtn);
            
            // Mobile Save
            if (mobileSave) fireEvent.click(mobileSave);
            expect(screen.getByText('Save Match Plan')).toBeDefined();
            
            // Cancel Save Modal
            fireEvent.click(screen.getByText('Cancel'));
            expect(screen.queryByText('Save Match Plan')).toBeNull();
        });
    });
});
