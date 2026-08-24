/**
 * FEAT-14 — a sub-team can be renamed.
 *
 * It could not be. `createSubTeamSlice` exposed add / remove / toggleMember and nothing else,
 * and `SubTeamManager` rendered the name as text. So "Programing" was fixed by deleting the
 * sub-team and making a new one — and delete takes the member assignments with it, which makes
 * the cost of a one-character typo re-assigning the whole team.
 *
 * WHAT WOULD MAKE THESE FAIL. Removing `renameSubTeam` from the slice fails the store tests;
 * removing the pencil control fails the component tests; making the input write straight to the
 * store fails the Cancel test, which is the one that matters most. That last shape is FEAT-04,
 * live in `SprintTaskDetail` today: checklist edits mutate the store's own objects, so Cancel
 * cannot revert. Writing the rename the same way would have shipped the same defect twice.
 *
 * THE ARCHIVED-SEASON CASE IS ASSERTED, not assumed. Every other write in this slice refuses a
 * prior season, `season_is_open` refuses the UPDATE server-side, and a rename that skipped the
 * guard would be a control that looks live, does nothing and says nothing —
 * `docs/failure-modes.md` §8, seven instances.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SubTeamManager from '../SubTeamManager';
import { useAppStore } from '@/lib/store';
import { queueForSync } from '@/lib/offline-db';

vi.mock('@/lib/offline-db', async (importOriginal) => {
    // Partial, not a hand-written stand-in: the store's persist middleware needs
    // `indexedDBStorage` from the real module, and five test files in this repo omit it from an
    // inline factory and silently lose persistence. Only `queueForSync` is replaced.
    const actual = await importOriginal<typeof import('@/lib/offline-db')>();
    return { ...actual, queueForSync: vi.fn().mockResolvedValue(undefined) };
});

const SEASON = {
    id: 'season-1',
    name: '2026-27',
    gameTitle: '',
    fieldImageData: '',
    isArchived: false,
    createdAt: 1000,
};

const setup = (over: Record<string, unknown> = {}) => {
    useAppStore.setState({
        currentTeamId: 'team-1',
        currentSeasonId: 'season-1',
        seasons: [SEASON],
        subTeams: [{ id: 'st-1', name: 'Programing', memberIds: [], seasonId: 'season-1' }],
        teamMembers: [],
        entitlement: null,
        ...over,
    } as never);
};

const renderManager = () =>
    render(
        <SubTeamManager
            subTeams={useAppStore.getState().subTeams}
            teamMembers={[]}
            getMemberDisplayName={() => 'Someone'}
        />,
    );

beforeEach(() => {
    vi.clearAllMocks();
    setup();
});

describe('renameSubTeam (store)', () => {
    it('renames the sub-team and queues one update', () => {
        useAppStore.getState().renameSubTeam('st-1', 'Programming');

        expect(useAppStore.getState().subTeams[0].name).toBe('Programming');
        expect(queueForSync).toHaveBeenCalledTimes(1);
        // The arguments, not the call count: Sprint 5 found `toHaveBeenCalledTimes(1)` cannot
        // see which columns were requested, and a rename queued as a `create` would pass a
        // count assertion and dead-letter on a duplicate primary key.
        expect(queueForSync).toHaveBeenCalledWith(
            'sub_teams',
            'st-1',
            'update',
            expect.objectContaining({ id: 'st-1', name: 'Programming', teamId: 'team-1' }),
            /*
             * ...and the row BEFORE the rename (SYNC-06). Without it the drain has nothing to
             * diff against and falls back to pushing every column, which is the whole-row
             * last-write-wins this project spent Sprint 25 removing — so the fifth argument is
             * asserted rather than ignored with a looser matcher.
             */
            expect.objectContaining({ id: 'st-1', name: 'Programing', teamId: 'team-1' }),
        );
    });

    it('keeps the member assignments, which is the whole point of not deleting', () => {
        setup({ subTeams: [{ id: 'st-1', name: 'Programing', memberIds: ['m-1', 'm-2'], seasonId: 'season-1' }] });

        useAppStore.getState().renameSubTeam('st-1', 'Programming');

        expect(useAppStore.getState().subTeams[0].memberIds).toEqual(['m-1', 'm-2']);
    });

    it('ignores an empty or whitespace-only name rather than storing one', () => {
        useAppStore.getState().renameSubTeam('st-1', '   ');

        expect(useAppStore.getState().subTeams[0].name).toBe('Programing');
        expect(queueForSync).not.toHaveBeenCalled();
    });

    it('trims, and does nothing when the trimmed name is unchanged', () => {
        useAppStore.getState().renameSubTeam('st-1', '  Programing  ');

        expect(useAppStore.getState().subTeams[0].name).toBe('Programing');
        expect(queueForSync).not.toHaveBeenCalled();
    });

    it('refuses to rename a sub-team belonging to an archived season', () => {
        setup({ seasons: [{ ...SEASON, isArchived: true }] });

        useAppStore.getState().renameSubTeam('st-1', 'Programming');

        expect(useAppStore.getState().subTeams[0].name).toBe('Programing');
        expect(queueForSync).not.toHaveBeenCalled();
    });
});

describe('renaming in SubTeamManager', () => {
    it('offers a rename control and commits the new name', () => {
        renderManager();

        fireEvent.click(screen.getByTestId('rename-sub-team'));
        fireEvent.change(screen.getByTestId('rename-sub-team-input'), {
            target: { value: 'Programming' },
        });
        fireEvent.click(screen.getByTestId('rename-sub-team-save'));

        expect(useAppStore.getState().subTeams[0].name).toBe('Programming');
    });

    it('commits on Enter', () => {
        renderManager();

        fireEvent.click(screen.getByTestId('rename-sub-team'));
        const input = screen.getByTestId('rename-sub-team-input');
        fireEvent.change(input, { target: { value: 'Programming' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(useAppStore.getState().subTeams[0].name).toBe('Programming');
    });

    it('leaves the store untouched when the rename is cancelled', () => {
        renderManager();

        fireEvent.click(screen.getByTestId('rename-sub-team'));
        fireEvent.change(screen.getByTestId('rename-sub-team-input'), {
            target: { value: 'Something else entirely' },
        });
        fireEvent.click(screen.getByTestId('rename-sub-team-cancel'));

        expect(useAppStore.getState().subTeams[0].name).toBe('Programing');
        expect(queueForSync).not.toHaveBeenCalled();
        expect(screen.queryByTestId('rename-sub-team-input')).toBeNull();
    });

    it('leaves the store untouched when the rename is dismissed with Escape', () => {
        renderManager();

        fireEvent.click(screen.getByTestId('rename-sub-team'));
        const input = screen.getByTestId('rename-sub-team-input');
        fireEvent.change(input, { target: { value: 'Something else entirely' } });
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(useAppStore.getState().subTeams[0].name).toBe('Programing');
        expect(queueForSync).not.toHaveBeenCalled();
    });

    it('caps the rename input at the same length as every other name field', () => {
        renderManager();
        fireEvent.click(screen.getByTestId('rename-sub-team'));

        // 120 — the column's CHECK. A longer client cap is a dead-lettered write with no screen
        // able to explain it (see src/lib/text-limits.ts).
        expect(screen.getByTestId('rename-sub-team-input')).toHaveAttribute('maxLength', '120');
    });

    it('disables the rename control on an archived season, with the reason on it', () => {
        setup({ seasons: [{ ...SEASON, isArchived: true }] });
        renderManager();

        const button = screen.getByTestId('rename-sub-team');
        expect(button).toBeDisabled();
        // A disabled control that does not say why is the same dead end with better manners.
        expect(button.getAttribute('title')).toBeTruthy();
        expect(button.getAttribute('title')).not.toBe('Rename sub-team');
    });
});
