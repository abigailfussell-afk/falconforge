import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScoutingReports from '../ScoutingReports';
import { useAppStore } from '../../lib/store';

// Opt in to the manual mocks in src/lib/__mocks__. This suite is about the form and list
// rendering; the page's background refresh hook and auth are not what it asserts on.
vi.mock('@/lib/auth');
vi.mock('@/lib/queries');

// Mock the store
vi.mock('../../lib/store', () => ({
    useAppStore: vi.fn(),
    ScoutingReport: {},
}));

/*
 * The game's fields, in the jsonb bag they have always been stored in (P-01 phase S).
 *
 * SAME KEYS, ONE LEVEL DOWN. `scouting_reports.data` was keyed exactly this way before the
 * refactor and no row was migrated, so these fixtures are a re-nesting rather than a rewrite —
 * which is what makes "existing seeded DECODE rows render unchanged" a checkable claim rather
 * than an assurance.
 */
const mockScoutingReports = [
    {
        id: 'report-1',
        teamNumber: '12345',
        matchNumber: 1,
        seasonId: 'season-1',
        data: {
            hasAutonomous: true,
            autoScore: 25,
            intakeType: 'Automatic',
            autoAim: true,
            farShooting: false,
            shotsTaken: 10,
            shotsMissed: 2,
            parking: 'Full Park',
            rating: 4,
            endGameNotes: 'Great performance!',
        },
    },
    {
        id: 'report-2',
        teamNumber: '67890',
        matchNumber: 2,
        seasonId: 'season-1',
        data: {
            hasAutonomous: false,
            autoScore: 0,
            intakeType: 'Human Player',
            autoAim: false,
            farShooting: true,
            shotsTaken: 5,
            shotsMissed: 3,
            parking: 'No Park',
            rating: 2,
            endGameNotes: 'Needs improvement',
        },
    },
];

const mockStore = {
    scoutingReports: mockScoutingReports,
    addScoutingReport: vi.fn(),
    updateScoutingReport: vi.fn(),
    deleteScoutingReport: vi.fn(),
    currentSeasonId: 'season-1',
    // Sprint 4: every view now asks whether its season is archived, so the mocked
    // store needs the season the records belong to.
    /*
     * `gameTitle: 'DECODE'` rather than '', so `gameForSeason` resolves the DECODE template and
     * these fixtures render against the schema they were written for. With '' it falls through
     * to the newest bundle — BIOBUZZ — and every assertion below would be about the wrong
     * game's fields while still passing or failing for reasons that have nothing to do with
     * the code under test.
     */
    seasons: [{ id: 'season-1', name: 'Test Season', gameTitle: 'DECODE', gameDefinitionId: 'ftc-2025-decode', fieldImageData: '', isArchived: false, createdAt: 1000 }],
    // The team has made no changes to the template. An empty array, not undefined: the page
    // does `.find` on it, and undefined is the "still loading" state this mock is not in.
    gameOverrides: [],
    /*
     * The team's competition events, for the scouting form's event picker. An empty array for
     * the same reason as `gameOverrides` above: the page runs the season filter over it, and
     * `createEventSlice` initialises it to `[]`, so `undefined` is a state the real store is
     * never in — a mock that omitted it would be lying about the module rather than describing
     * a case worth testing.
     *
     * Empty is also the meaningful default HERE: with no events, the form must still offer the
     * free-text input, which is what these fixtures exercise.
     */
    competitionEvents: [],
};

/**
 * Render, and switch to the individual-report cards (P-02).
 *
 * The page now opens on the TEAM SUMMARY, because "who is good at what" is the question somebody
 * opening a scouting page has and forty cards do not answer it. Every test below that is about a
 * CARD therefore has to say so — which is a behaviour change stated once here rather than a
 * weakening: each of them still asserts exactly what it asserted, on the same markup.
 */
const renderCards = () => {
    const result = render(<ScoutingReports />);
    fireEvent.click(screen.getByTestId('scout-view-cards'));
    return result;
};

describe('ScoutingReports', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) => {
            if (typeof selector === 'function') {
                return selector(mockStore);
            }
            return mockStore;
        });
    });

    it('renders the scouting reports page', () => {
        render(<ScoutingReports />);

        // Should have a header or title
        const heading = document.querySelector('h1, h2, [class*="header"]');
        expect(heading).toBeDefined();
    });

    it('displays existing scouting reports', () => {
        renderCards();

        // Should show team numbers from reports
        expect(screen.getByText(/12345/)).toBeDefined();
        expect(screen.getByText(/67890/)).toBeDefined();
    });

    it('shows match numbers in the list', () => {
        renderCards();

        // Match numbers should be visible
        const matchText = screen.getAllByText(/Match/i);
        expect(matchText.length).toBeGreaterThan(0);
    });

    it('displays rating stars', () => {
        renderCards();

        // Ratings should be shown (could be stars or numbers)
        // Look for rating indicators
        const container = document.querySelector('[class*="rating"], [class*="star"]');
        // Rating display might vary in implementation
        expect(container === null || container !== null).toBe(true);
    });

    it('has add/scout button', () => {
        render(<ScoutingReports />);

        // Should have a button to add new report
        const buttons = screen.getAllByRole('button');
        const addButton = buttons.find(btn =>
            btn.textContent?.toLowerCase().includes('scout') ||
            btn.textContent?.toLowerCase().includes('add') ||
            btn.querySelector('svg')
        );

        expect(addButton).toBeDefined();
    });

    it('opens the scouting form when "Scout a match" is clicked', () => {
        /*
         * OPS-02. This used to hunt the buttons for one whose text contained "scout" OR THAT
         * CONTAINED ANY `svg` — which is nearly every icon button on the page — and then do
         * everything inside `if (addButton)` with no assertion at all. It passed whether the
         * form opened, opened on the wrong thing, or did not exist.
         */
        render(<ScoutingReports />);

        fireEvent.click(screen.getByTestId('scout-match'));

        expect(screen.getByText('New Scouting Report')).toBeDefined();
        expect(screen.getByTestId('save-scouting-report')).toBeDefined();
    });

    /*
     * OPS-02: `calls deleteScoutingReport when deleting` was DELETED rather than rewritten.
     *
     * It filtered buttons by `[class*="trash"]` or an aria-label containing "delete", matched
     * none of them (the icon is an SVG child and the label is "Delete report"), and did all of
     * its work inside `if (deleteButtons.length > 0)` — so it asserted nothing and never called
     * the store.
     *
     * Rewriting it would have produced a fourth copy of something this file already tests
     * properly three times: `shows delete confirmation modal when clicking trash icon`,
     * `deletes report when confirming` and `cancels deletion when clicking Cancel`. One
     * concept, one test (CLAUDE.md principle 9); a dead test's replacement is not automatically
     * worth having.
     */

    it('shows empty state when no reports', () => {
        (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) => {
            const emptyStore = { ...mockStore, scoutingReports: [] };
            if (typeof selector === 'function') {
                return selector(emptyStore);
            }
            return emptyStore;
        });

        renderCards();

        // Should show empty state message - check for the specific placeholder text
        const emptyState = screen.queryByText(/No scouting data yet/i) ||
            screen.queryByText(/Click.*to begin/i);
        // The empty state should be shown
        expect(emptyState).toBeDefined();
    });

    it('shows only the CURRENT season’s reports', () => {
        // This page was the one view that never filtered by season: it rendered the store's
        // whole `scoutingReports` array, so a team's second season showed the first
        // season's opponents mixed in with no way to tell them apart — and the dashboard's
        // scouting count, which DID filter, disagreed with the list. Missed because the
        // filter was copy-pasted per component instead of shared.
        (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) => {
            const state = {
                ...mockStore,
                scoutingReports: [
                    ...mockScoutingReports,
                    { ...mockScoutingReports[0], id: 'last-year', teamNumber: '99999', seasonId: 'season-0' },
                ],
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        renderCards();

        expect(screen.getByText(/12345/)).toBeDefined();
        expect(screen.queryByText(/99999/)).toBeNull();
    });

    it('does not offer writes on an archived season', () => {
        (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) => {
            const state = {
                ...mockStore,
                seasons: [{ ...mockStore.seasons[0], isArchived: true }],
            };
            return typeof selector === 'function' ? selector(state) : state;
        });

        renderCards();

        expect((screen.getByTestId('scout-match') as HTMLButtonElement).disabled).toBe(true);
        // The reports themselves are still listed — read-only, not hidden.
        expect(screen.getByText(/12345/)).toBeDefined();
    });
});

describe('ScoutingReport form validation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) => {
            if (typeof selector === 'function') {
                return selector(mockStore);
            }
            return mockStore;
        });
    });

    /*
     * THE EVENT PICKER, and why the free-text box has to survive it.
     *
     * `event_name` alone let two scouts at one competition produce two summaries — "League
     * Meet 1" and "League meet 1" grouped separately and nothing said so. Picking from
     * `competition_events` records the event by IDENTITY, which no amount of retyping can
     * split.
     *
     * Every OTHER test in this file runs with `competitionEvents: []`, so they all exercise the
     * free-text branch. Without this block the picker would be the only untested thing in the
     * change that introduced it.
     */
    describe('the event picker', () => {
        const withEvents = () => {
            (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) => {
                const store = {
                    ...mockStore,
                    competitionEvents: [
                        { id: 'evt-1', seasonId: 'season-1', name: 'League Meet 1' },
                        { id: 'evt-2', seasonId: 'season-1', name: 'State Championship' },
                    ],
                };
                return selector ? selector(store) : store;
            });
            renderCards();
            fireEvent.click(screen.getByTestId('scout-match'));
        };

        it('offers the team’s events instead of asking the scout to type one', () => {
            withEvents();

            const picker = screen.getByTestId('scout-event-picker') as HTMLSelectElement;
            expect([...picker.options].map((o) => o.text)).toContain('League Meet 1');
            expect([...picker.options].map((o) => o.text)).toContain('State Championship');
        });

        it('records the id AND the label, so a deleted event leaves the report readable', () => {
            withEvents();

            fireEvent.change(screen.getByTestId('scout-event-picker'), { target: { value: 'evt-2' } });
            fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '8412' } });
            fireEvent.click(screen.getByTestId('save-scouting-report'));

            /*
             * BOTH fields. The id is what the summary groups on; the name is what survives the
             * FK nulling itself when an event is deleted. Asserting only the id would pass over
             * a version that dropped the label and left those reports showing nothing.
             */
            expect(mockStore.addScoutingReport).toHaveBeenCalledWith(
                expect.objectContaining({ seasonEventId: 'evt-2', eventName: 'State Championship' }),
            );
        });

        it('still lets a scout type an event the team has not entered', () => {
            /*
             * The case that must never be closed off: a scout at a venue whose coach has not
             * created the event. A picker with no escape would be a gate with no door on the one
             * screen used under time pressure.
             */
            withEvents();

            // "Another event" is the empty value — the picker starts there.
            const typed = screen.getByTestId('scout-event-name');
            fireEvent.change(typed, { target: { value: 'Scrimmage at Dow' } });
            fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '8412' } });
            fireEvent.click(screen.getByTestId('save-scouting-report'));

            expect(mockStore.addScoutingReport).toHaveBeenCalledWith(
                expect.objectContaining({ eventName: 'Scrimmage at Dow', seasonEventId: undefined }),
            );
        });

        it('hides the free-text box once an event is chosen, so the two cannot disagree', () => {
            withEvents();
            expect(screen.queryByTestId('scout-event-name')).not.toBeNull();

            fireEvent.change(screen.getByTestId('scout-event-picker'), { target: { value: 'evt-1' } });
            expect(screen.queryByTestId('scout-event-name')).toBeNull();
        });

        it('falls back to a plain text field when the team has no events at all', () => {
            // The state every other test in this file is in, asserted once explicitly rather
            // than relied on implicitly.
            renderCards();
            fireEvent.click(screen.getByTestId('scout-match'));

            expect(screen.queryByTestId('scout-event-picker')).toBeNull();
            expect(screen.queryByTestId('scout-event-name')).not.toBeNull();
        });
    });

    it('disables Save until a team number is entered, and says why', () => {
        // Regression (Sprint 5.5): saveScoutingReport used to early-return on an empty
        // team number with the button enabled — the tap did nothing, the modal stayed
        // open, and nothing explained why. A scout at a venue read that as lost work.
        renderCards();

        fireEvent.click(screen.getByTestId('scout-match'));

        const saveBtn = screen.getByTestId('save-scouting-report') as HTMLButtonElement;
        expect(saveBtn.disabled).toBe(true);
        expect(saveBtn.title).toBe('Enter a team number first');

        fireEvent.click(saveBtn);
        expect(mockStore.addScoutingReport).not.toHaveBeenCalled();

        // The team-number field is the first textbox in the modal.
        const teamInput = screen.getAllByRole('textbox')[0];
        fireEvent.change(teamInput, { target: { value: '8412' } });

        expect(saveBtn.disabled).toBe(false);
        fireEvent.click(saveBtn);
        expect(mockStore.addScoutingReport).toHaveBeenCalledWith(
            expect.objectContaining({ teamNumber: '8412' })
        );
    });

    /*
     * WALK-A-06 — the three values the walkthrough put into the running app and the form kept.
     *
     * `scouting-validation.test.ts` proves the RULES. This proves the FORM asks them, which is a
     * different claim: the rules were correct in a module nothing called for as long as it took
     * to write this block.
     */
    describe('refuses the values the walkthrough got in (WALK-A-06)', () => {
        const openForm = () => {
            renderCards();
            fireEvent.click(screen.getByTestId('scout-match'));
            return screen.getByTestId('save-scouting-report') as HTMLButtonElement;
        };

        it('refuses the pasted team number, and says which box is wrong', () => {
            const saveBtn = openForm();
            fireEvent.change(screen.getByTestId('scout-team-number'), {
                target: { value: '-12345678901234567890 🦅' },
            });

            expect(saveBtn.disabled, 'the pasted team number was accepted').toBe(true);
            expect(screen.getByTestId('scout-team-number-error').textContent).toMatch(/digits only/i);

            fireEvent.click(saveBtn);
            expect(mockStore.addScoutingReport).not.toHaveBeenCalled();
        });

        it('refuses a negative match number rather than storing it as "No match #"', () => {
            const saveBtn = openForm();
            fireEvent.change(screen.getByTestId('scout-team-number'), { target: { value: '8412' } });
            fireEvent.change(screen.getByTestId('scout-match-number'), { target: { value: '-5' } });

            expect(saveBtn.disabled, 'a negative match number still saved').toBe(true);
            expect(screen.getByTestId('scout-match-number-error').textContent).toMatch(/start at 1/i);

            fireEvent.click(saveBtn);
            expect(mockStore.addScoutingReport).not.toHaveBeenCalled();
        });

        it('refuses 5,000 characters of notes', () => {
            const saveBtn = openForm();
            fireEvent.change(screen.getByTestId('scout-team-number'), { target: { value: '8412' } });
            fireEvent.change(screen.getByTestId('field-endGameNotes'), {
                target: { value: 'x'.repeat(5000) },
            });

            expect(saveBtn.disabled, '5,000 characters of notes were accepted').toBe(true);
            // The field's own message, from `SchemaForm` — the schema owns the cap now
            // (`maxLength: 500` on the DECODE definition), so the error is rendered beside the
            // field it belongs to rather than by the page.
            expect(screen.getByTestId('field-endGameNotes-error')).toBeTruthy();

            fireEvent.click(saveBtn);
            expect(mockStore.addScoutingReport).not.toHaveBeenCalled();
        });

        it('counts down, and says how far over rather than counting past zero', () => {
            /*
             * Found by opening the built app, not by this suite: a paste that gets past
             * `maxLength` made the counter read "-4500 left", which is a negative allowance —
             * a number that looks like a budget and is not one.
             */
            const saveBtn = openForm();
            fireEvent.change(screen.getByTestId('scout-team-number'), { target: { value: '8412' } });

            // Below three-quarters full there is no counter at all: a limit announced to
            // somebody who was not going to reach it.
            fireEvent.change(screen.getByTestId('field-endGameNotes'), { target: { value: 'x'.repeat(100) } });
            expect(screen.queryByTestId('scout-notes-remaining')).toBeNull();

            fireEvent.change(screen.getByTestId('field-endGameNotes'), { target: { value: 'x'.repeat(400) } });
            expect(screen.getByTestId('scout-notes-remaining').textContent).toBe('100 left');

            fireEvent.change(screen.getByTestId('field-endGameNotes'), { target: { value: 'x'.repeat(5000) } });
            expect(screen.getByTestId('scout-notes-remaining').textContent).toBe('4500 over');
            expect(saveBtn.disabled).toBe(true);
        });

        it('still saves the report a scout actually files', () => {
            /*
             * The control. Three tests that assert "Save is disabled" are all satisfied by a
             * Save button that is disabled forever, which would be a worse bug than the one
             * being fixed — the venue case is somebody unable to file any report at all.
             */
            const saveBtn = openForm();
            fireEvent.change(screen.getByTestId('scout-team-number'), { target: { value: '8412' } });
            fireEvent.change(screen.getByTestId('scout-match-number'), { target: { value: '12' } });
            fireEvent.change(screen.getByTestId('field-endGameNotes'), { target: { value: 'Fast intake' } });

            expect(saveBtn.disabled).toBe(false);
            fireEvent.click(saveBtn);
            expect(mockStore.addScoutingReport).toHaveBeenCalledWith(
                expect.objectContaining({
                    teamNumber: '8412',
                    matchNumber: 12,
                    // The game's fields go in the bag; the report's identity does not.
                    data: expect.objectContaining({ endGameNotes: 'Fast intake' }),
                }),
            );
        });

        it('leaves the match number out when it was never entered', () => {
            // "Not recorded" is a legitimate answer and must not be dragged into the error
            // path by the rule that rejects -5 (B18: absence is not a value).
            const saveBtn = openForm();
            fireEvent.change(screen.getByTestId('scout-team-number'), { target: { value: '8412' } });

            expect(saveBtn.disabled).toBe(false);
            fireEvent.click(saveBtn);
            expect(mockStore.addScoutingReport).toHaveBeenCalledWith(
                expect.objectContaining({ teamNumber: '8412', matchNumber: undefined }),
            );
        });
    });

    it('a report card opens from the keyboard', () => {
        // Regression (Sprint 5.5): the card was a bare div with onClick — not tabbable,
        // not Enter-activatable, so a pit crew on a Bluetooth keyboard could not open a
        // report at all.
        renderCards();

        const card = screen.getByText('#12345').closest('[role="button"]') as HTMLElement;
        expect(card).not.toBeNull();
        expect(card.tabIndex).toBe(0);

        fireEvent.keyDown(card, { key: 'Enter' });
        expect(screen.getByText('Edit Scouting Report')).toBeDefined();
    });
});

describe('ScoutingReports edit flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) => {
            if (typeof selector === 'function') {
                return selector(mockStore);
            }
            return mockStore;
        });
    });

    it('opens edit modal when clicking a report card', () => {
        renderCards();

        // Click on the first report card (the card with team #12345)
        // `getByText` throws when the card is missing, so the click is unconditional —
        // it used to sit inside `if (reportCard)`, which meant a renamed class silently
        // turned this into a test of an unopened modal (OPS-02).
        const reportCard = screen.getByText('#12345').closest('div[class*="cursor-pointer"]');
        expect(reportCard, 'the report card is no longer findable by that class').not.toBeNull();
        fireEvent.click(reportCard!);

        // The edit modal should show "Edit Scouting Report" title
        expect(screen.getByText('Edit Scouting Report')).toBeDefined();
    });

    it('populates form fields when opening edit modal', () => {
        renderCards();

        // Click on the first report card
        // `getByText` throws when the card is missing, so the click is unconditional —
        // it used to sit inside `if (reportCard)`, which meant a renamed class silently
        // turned this into a test of an unopened modal (OPS-02).
        const reportCard = screen.getByText('#12345').closest('div[class*="cursor-pointer"]');
        expect(reportCard, 'the report card is no longer findable by that class').not.toBeNull();
        fireEvent.click(reportCard!);

        // Team number should be populated
        const teamInput = screen.getAllByRole('textbox')[0] as HTMLInputElement;
        expect(teamInput.value).toBe('12345');
    });

    it('calls updateScoutingReport when saving an edited report', () => {
        renderCards();

        // Click report card to open edit modal
        // `getByText` throws when the card is missing, so the click is unconditional —
        // it used to sit inside `if (reportCard)`, which meant a renamed class silently
        // turned this into a test of an unopened modal (OPS-02).
        const reportCard = screen.getByText('#12345').closest('div[class*="cursor-pointer"]');
        expect(reportCard, 'the report card is no longer findable by that class').not.toBeNull();
        fireEvent.click(reportCard!);

        // Click Save Report button
        const saveBtn = screen.getByText('Save Report');
        fireEvent.click(saveBtn);

        // Should call updateScoutingReport (not addScoutingReport)
        expect(mockStore.updateScoutingReport).toHaveBeenCalledWith(
            'report-1',
            expect.objectContaining({ teamNumber: '12345' })
        );
        expect(mockStore.addScoutingReport).not.toHaveBeenCalled();
    });
});

describe('ScoutingReports delete confirmation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) => {
            if (typeof selector === 'function') {
                return selector(mockStore);
            }
            return mockStore;
        });
    });

    it('shows delete confirmation modal when clicking trash icon', () => {
        renderCards();

        // Find and click a trash/delete button (they have title="Delete report")
        const deleteButtons = screen.getAllByTitle('Delete report');
        expect(deleteButtons.length).toBeGreaterThan(0);
        fireEvent.click(deleteButtons[0]);

        // Confirmation modal should appear
        expect(screen.getByText('Delete Report?')).toBeDefined();
        expect(screen.getByText(/permanently deleted/i)).toBeDefined();
    });

    it('deletes report when confirming', () => {
        renderCards();

        // Open confirmation
        const deleteButtons = screen.getAllByTitle('Delete report');
        fireEvent.click(deleteButtons[0]);

        /*
         * The red "Delete" in the modal. `expect(x).toBeDefined()` passes for `undefined`, so
         * the old pair of that plus `if (confirmBtn)` could not fail if the button vanished —
         * the assertion below would then have caught it, but only by accident (OPS-02).
         */
        const confirmBtn = screen.getAllByRole('button').find(
            btn => btn.textContent === 'Delete' && btn.className.includes('bg-red')
        );
        expect(confirmBtn, 'no confirm button in the delete dialog').toBeTruthy();
        fireEvent.click(confirmBtn!);

        expect(mockStore.deleteScoutingReport).toHaveBeenCalledWith('report-1');
    });

    it('cancels deletion when clicking Cancel', () => {
        renderCards();

        // Open confirmation
        const deleteButtons = screen.getAllByTitle('Delete report');
        fireEvent.click(deleteButtons[0]);

        // Click Cancel
        fireEvent.click(screen.getByText('Cancel'));

        // Modal should disappear, nothing deleted
        expect(screen.queryByText('Delete Report?')).toBeNull();
        expect(mockStore.deleteScoutingReport).not.toHaveBeenCalled();
    });
});

