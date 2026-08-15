/**
 * B3 — a server pull must not wipe changes that have not been pushed yet.
 *
 * `updateLocalDatabase` replaces the whole collection, which is how deletions made on
 * another device propagate. It was also how records created offline disappeared: they are
 * absent from the server, so a full pull dropped them from the UI while they were still
 * sitting in the sync queue waiting to be sent.
 *
 * Only checklists guarded against this. Tasks, scouting reports, match plans, seasons and
 * sub-teams did not.
 *
 * The rule (matching B8): a record with a pending queue entry keeps its LOCAL version. It
 * is newer by definition -- it has not been sent yet.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { updateLocalDatabase, mergeIntoStore } from '@/lib/sync';
import { useAppStore } from '@/lib/store';
import type { Task } from '@/types';

const localTask = (id: string, title: string): Task => ({
    id,
    title,
    description: '',
    status: 'Backlog',
    type: 'Feature',
    assignedTo: '',
    department: '',
    tags: [],
    checklist: [],
    timeline: [],
    createdAt: 1000,
});

/** A row as it comes back from Supabase. */
const serverTask = (id: string, title: string) => ({
    id,
    title,
    description: '',
    status: 'Backlog',
    type: 'Feature',
    assigned_to: null,
    sub_team_id: null,
    tags: [],
    checklist: [],
    timeline: [],
    created_at: new Date(1000).toISOString(),
    season_id: 'season-1',
});

beforeEach(() => {
    useAppStore.setState({ tasks: [], scoutingReports: [], matchPlans: [], subTeams: [], seasons: [] });
});

describe('full pull preserves unpushed local records (B3)', () => {
    it('keeps a task created offline that the server has never seen', () => {
        useAppStore.setState({ tasks: [localTask('offline-1', 'Built offline at the venue')] });

        // A full pull returns only what the server knows about.
        updateLocalDatabase('tasks', [serverTask('server-1', 'From another device')],
            new Set(['offline-1']));

        const ids = useAppStore.getState().tasks.map((t) => t.id).sort();
        expect(ids).toEqual(['offline-1', 'server-1']);
    });

    it('used to lose that task when nothing was pending', () => {
        // Same pull with no pending ids: the replace semantics still apply, which is what
        // makes cross-device deletion work. This pins that the guard is targeted, not a
        // blanket disabling of replacement.
        useAppStore.setState({ tasks: [localTask('deleted-elsewhere', 'Removed on another device')] });

        updateLocalDatabase('tasks', [serverTask('server-1', 'Still here')], new Set());

        expect(useAppStore.getState().tasks.map((t) => t.id)).toEqual(['server-1']);
    });

    it('keeps the local version when the server also has the record', () => {
        useAppStore.setState({ tasks: [localTask('shared-1', 'My unsynced edit')] });

        updateLocalDatabase('tasks', [serverTask('shared-1', 'Server version')],
            new Set(['shared-1']));

        const tasks = useAppStore.getState().tasks;
        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe('My unsynced edit');
    });

    it('still applies cross-device deletions to records with nothing pending', () => {
        useAppStore.setState({
            tasks: [localTask('keep-me', 'Unsynced'), localTask('delete-me', 'Deleted elsewhere')],
        });

        updateLocalDatabase('tasks', [], new Set(['keep-me']));

        expect(useAppStore.getState().tasks.map((t) => t.id)).toEqual(['keep-me']);
    });

    it('protects sub-teams, scouting reports and match plans too, not just tasks', () => {
        useAppStore.setState({
            subTeams: [{ id: 'st-local', name: 'Drive', memberIds: [] }],
        });

        updateLocalDatabase('subTeams', [{ id: 'st-server', name: 'Build', member_ids: [] }],
            new Set(['st-local']));

        expect(useAppStore.getState().subTeams.map((s) => s.id).sort())
            .toEqual(['st-local', 'st-server']);
    });
});

describe('delta merge does not overwrite unpushed local edits (B8)', () => {
    it('drops an incoming update for a record the user has edited locally', () => {
        useAppStore.setState({ tasks: [localTask('shared-1', 'What I am typing')] });

        mergeIntoStore('tasks', [serverTask('shared-1', "Teammate's version")],
            new Set(['shared-1']));

        expect(useAppStore.getState().tasks[0].title).toBe('What I am typing');
    });

    it('accepts incoming updates for records with nothing pending', () => {
        useAppStore.setState({ tasks: [localTask('shared-1', 'Old title')] });

        mergeIntoStore('tasks', [serverTask('shared-1', 'Updated by teammate')], new Set());

        expect(useAppStore.getState().tasks[0].title).toBe('Updated by teammate');
    });

    it('still adds brand new records from other devices', () => {
        useAppStore.setState({ tasks: [localTask('mine', 'Mine')] });

        mergeIntoStore('tasks', [serverTask('theirs', 'Theirs')], new Set(['mine']));

        expect(useAppStore.getState().tasks.map((t) => t.id).sort()).toEqual(['mine', 'theirs']);
    });
});
