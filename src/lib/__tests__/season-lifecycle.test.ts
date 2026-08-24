/**
 * Sprint 4 — the season lifecycle, at the store level.
 *
 * "New season = fresh start" is the product's central idea, and this file is where the
 * client half of it is pinned down: what a rollover clones, what it deliberately does not,
 * what an archived season refuses, and what deleting a season takes with it.
 *
 * The SERVER half — that an archived season and an unlicensed team are refused by RLS rather
 * than merely un-offered — is in `src/test/db/season-lifecycle.db.test.ts`, against real
 * Postgres. Neither is sufficient alone: this one proves the client does not queue work that
 * cannot land, that one proves the rule holds for a client that never heard about it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/lib/store';
import { db } from '@/lib/offline-db';
import { isSeasonArchived, canWriteToSeason, suggestNextSeasonName } from '@/lib/season-rules';
import type { Season } from '@/types';

const TEAM = 'team-1';
const S1 = 'season-1';

const season = (over: Partial<Season> = {}): Season => ({
    id: S1,
    name: '2026-2027 Season',
    gameTitle: '',
    fieldImageData: '',
    teamId: TEAM,
    isArchived: false,
    createdAt: 1000,
    ...over,
});

/**
 * Everything the queue holds, oldest first — the order a drain would push it in (B1).
 *
 * Store actions fire `queueForSync(...)` without awaiting it, so the Dexie writes are still
 * in flight when the action returns. The settle is what makes them observable; the ORDER
 * does not depend on it, because `queueForSync` allocates its timestamp at call time
 * precisely so that a burst of unawaited writes still drains in the order it was written.
 */
async function queued() {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const items = await db.syncQueue.orderBy('timestamp').toArray();
    return items.map((i) => ({ table: i.tableName, id: i.recordId, op: i.operation, data: i.data }));
}

beforeEach(async () => {
    await db.syncQueue.clear();
    useAppStore.setState({
        currentTeamId: TEAM,
        currentSeasonId: S1,
        seasons: [season()],
        subTeams: [
            { id: 'st-build', name: 'Build', memberIds: ['m1', 'm2'], seasonId: S1 },
            { id: 'st-prog', name: 'Programming', memberIds: ['m3'], seasonId: S1 },
        ],
        tasks: [],
        scoutingReports: [],
        matchPlans: [],
        checklistsBySeason: { [S1]: [{ id: 'c1', text: 'Charge battery', checked: true }] },
        checklistTemplates: [],
    });
});

describe('rollOverSeason', () => {
    it('creates the new season and switches to it', () => {
        const id = useAppStore.getState().rollOverSeason({
            name: '2027-2028 Season',
            gameTitle: 'DECODE',
        });

        const state = useAppStore.getState();
        expect(id).toBeTruthy();
        expect(state.currentSeasonId).toBe(id);

        const created = state.seasons.find((s) => s.id === id)!;
        expect(created.name).toBe('2027-2028 Season');
        expect(created.gameTitle).toBe('DECODE');
        expect(created.isArchived).toBe(false);
        expect(created.teamId).toBe(TEAM);
    });

    it('clones sub-team STRUCTURE with fresh ids and NO members', () => {
        // The single most important assertion in this file. The roster persists at team
        // level; who was on Build last year is last year's decision, and carrying it forward
        // silently re-assigns students who have graduated or moved to another group.
        const id = useAppStore.getState().rollOverSeason({ name: 'Next' })!;
        const cloned = useAppStore.getState().subTeams.filter((s) => s.seasonId === id);

        expect(cloned.map((s) => s.name).sort()).toEqual(['Build', 'Programming']);
        expect(cloned.every((s) => s.memberIds.length === 0)).toBe(true);
        // Fresh ids: reusing them would make the clone an UPDATE of last season's row.
        expect(cloned.some((s) => s.id === 'st-build' || s.id === 'st-prog')).toBe(false);
    });

    it('leaves the previous season’s sub-teams and their members untouched', () => {
        useAppStore.getState().rollOverSeason({ name: 'Next' });
        const old = useAppStore.getState().subTeams.filter((s) => s.seasonId === S1);

        expect(old).toHaveLength(2);
        expect(old.find((s) => s.id === 'st-build')!.memberIds).toEqual(['m1', 'm2']);
    });

    it('does not clone sub-teams when asked not to', () => {
        const id = useAppStore.getState().rollOverSeason({ name: 'Next', cloneSubTeams: false })!;
        expect(useAppStore.getState().subTeams.filter((s) => s.seasonId === id)).toHaveLength(0);
    });

    it('starts the sprint board, scouting log and match planner empty', () => {
        useAppStore.setState({
            tasks: [{ id: 't1', title: 'Old', description: '', status: 'Done', type: 'Feature', assignedTo: '', department: '', checklist: [], timeline: [], createdAt: 1, seasonId: S1 }],
            scoutingReports: [{ id: 'r1', teamNumber: '1', data: { hasAutonomous: false, autoScore: 0, intakeType: 'No Intake', autoAim: false, farShooting: false, shotsTaken: 0, shotsMissed: 0, parking: 'No Park', rating: 3, endGameNotes: '' }, seasonId: S1 }],
            matchPlans: [{ id: 'p1', title: 'Old', drawingData: null, notes: '', allianceTeam: '', partnerAutonomous: false, partnerPark: false, updatedAt: 1, seasonId: S1 }],
        });

        const id = useAppStore.getState().rollOverSeason({ name: 'Next' })!;
        const state = useAppStore.getState();

        expect(state.tasks.filter((t) => t.seasonId === id)).toHaveLength(0);
        expect(state.scoutingReports.filter((r) => r.seasonId === id)).toHaveLength(0);
        expect(state.matchPlans.filter((p) => p.seasonId === id)).toHaveLength(0);
        // ...and the previous season keeps all of it. "Full history backward."
        expect(state.tasks.filter((t) => t.seasonId === S1)).toHaveLength(1);
    });

    describe('the new season’s checklist', () => {
        it('copies the previous items UNTICKED, with fresh ids', () => {
            const id = useAppStore.getState().rollOverSeason({
                name: 'Next',
                checklistSource: 'previous',
            })!;
            const items = useAppStore.getState().checklistsBySeason[id];

            expect(items.map((i) => i.text)).toEqual(['Charge battery']);
            expect(items.every((i) => !i.checked)).toBe(true);
            expect(items[0].id).not.toBe('c1');
        });

        it('can start blank', () => {
            const id = useAppStore.getState().rollOverSeason({
                name: 'Next',
                checklistSource: 'blank',
            })!;
            expect(useAppStore.getState().checklistsBySeason[id]).toEqual([]);
        });

        it('can come from a team template', () => {
            useAppStore.setState({
                checklistTemplates: [{
                    id: 'tpl-1',
                    name: 'Standard',
                    seasonId: S1,
                    items: [{ id: 'x', text: 'Inspect wiring', checked: true }],
                }],
            });

            const id = useAppStore.getState().rollOverSeason({
                name: 'Next',
                checklistSource: 'template:tpl-1',
            })!;
            const items = useAppStore.getState().checklistsBySeason[id];

            expect(items.map((i) => i.text)).toEqual(['Inspect wiring']);
            expect(items[0].checked).toBe(false);
        });

        it('writes a checklist ROW even when it is empty (B20)', async () => {
            // Zero rows is not an empty checklist: a season with no row at all loses its
            // list on the first pull, because "the server sent nothing" and "the list is
            // empty" would be indistinguishable.
            const id = useAppStore.getState().rollOverSeason({
                name: 'Next',
                checklistSource: 'blank',
            })!;

            const checklistPush = (await queued()).find((q) => q.table === 'checklists');
            expect(checklistPush).toBeDefined();
            expect(checklistPush!.id).toBe(id);
            expect(checklistPush!.data.items).toEqual([]);
        });
    });

    describe('archiving the outgoing season', () => {
        it('archives it by default', () => {
            useAppStore.getState().rollOverSeason({ name: 'Next' });
            expect(useAppStore.getState().seasons.find((s) => s.id === S1)!.isArchived).toBe(true);
        });

        it('can be told not to', () => {
            useAppStore.getState().rollOverSeason({ name: 'Next', archivePrevious: false });
            expect(useAppStore.getState().seasons.find((s) => s.id === S1)!.isArchived).toBe(false);
        });

        it('queues the archive LAST, after work already done in that season', async () => {
            // ORDERING IS THE WHOLE POINT. The queue drains in timestamp order, and
            // `season_is_open` refuses a write to an archived season — so an edit made
            // before the rollover has to be ahead of the archive in the queue or the server
            // rejects it on arrival and the user's last hour of work dead-letters.
            useAppStore.setState({ checklistsBySeason: { [S1]: [{ id: 'c1', text: 'Charge battery', checked: false }] } });
            useAppStore.getState().toggleChecklistItem('c1');

            useAppStore.getState().rollOverSeason({ name: 'Next' });

            const order = await queued();
            const preRolloverEdit = order.findIndex((q) => q.table === 'checklists' && q.id === S1);
            const archive = order.findIndex((q) => q.table === 'seasons' && q.id === S1);

            expect(preRolloverEdit).toBeGreaterThanOrEqual(0);
            expect(archive).toBeGreaterThan(preRolloverEdit);
        });
    });

    describe('offline: everything is queued, in an order one drain can satisfy', () => {
        it('queues the season BEFORE the rows that reference it', async () => {
            // `season_id` is NOT NULL with a composite (season_id, team_id) foreign key, so
            // the season row must reach the server before its sub-teams and checklist or
            // their inserts fail the constraint. Nothing here talks to a server: a rollover
            // performed at a venue with no signal produces exactly this queue.
            const id = useAppStore.getState().rollOverSeason({ name: 'Next' })!;
            const order = await queued();

            const seasonAt = order.findIndex((q) => q.table === 'seasons' && q.id === id);
            const subTeamAt = order.findIndex((q) => q.table === 'sub_teams');
            const checklistAt = order.findIndex((q) => q.table === 'checklists' && q.id === id);

            expect(seasonAt).toBeGreaterThanOrEqual(0);
            expect(seasonAt).toBeLessThan(subTeamAt);
            expect(seasonAt).toBeLessThan(checklistAt);
        });

        it('sends the cloned sub-teams with no members', async () => {
            useAppStore.getState().rollOverSeason({ name: 'Next' });
            const pushes = (await queued()).filter((q) => q.table === 'sub_teams');

            expect(pushes).toHaveLength(2);
            expect(pushes.every((p) => p.data.memberIds.length === 0)).toBe(true);
            expect(pushes.every((p) => p.data.teamId === TEAM)).toBe(true);
        });
    });

    it('refuses without a team', () => {
        useAppStore.setState({ currentTeamId: null });
        expect(useAppStore.getState().rollOverSeason({ name: 'Next' })).toBeNull();
    });

    it('refuses without a name', () => {
        expect(useAppStore.getState().rollOverSeason({ name: '   ' })).toBeNull();
        expect(useAppStore.getState().seasons).toHaveLength(1);
    });
});

describe('an archived season queues no writes', () => {
    // The client half of "no edit/queue writes". The server refuses these regardless — see
    // the db suite — but a client that queues them anyway produces the silent-failure UX
    // this sprint exists to avoid: the row appears, "1 pending" appears, nothing lands.
    beforeEach(async () => {
        useAppStore.setState({ seasons: [season({ isArchived: true })] });
        await db.syncQueue.clear();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('refuses a new task', async () => {
        expect(useAppStore.getState().addTask({
            title: 'Nope', description: '', type: 'Feature', assignedTo: '', department: '',        })).toBeNull();
        expect(useAppStore.getState().tasks).toHaveLength(0);
        expect(await queued()).toHaveLength(0);
    });

    it('refuses to edit or delete an existing task in that season', async () => {
        useAppStore.setState({
            tasks: [{ id: 't1', title: 'Old', description: '', status: 'Done', type: 'Feature', assignedTo: '', department: '', checklist: [], timeline: [], createdAt: 1, seasonId: S1 }],
        });

        useAppStore.getState().updateTask('t1', { title: 'Edited' });
        expect(useAppStore.getState().tasks[0].title).toBe('Old');

        useAppStore.getState().deleteTask('t1');
        expect(useAppStore.getState().tasks).toHaveLength(1);

        expect(await queued()).toHaveLength(0);
    });

    it('refuses a checklist tick', async () => {
        useAppStore.getState().toggleChecklistItem('c1');
        expect(useAppStore.getState().checklistsBySeason[S1][0].checked).toBe(true); // unchanged
        expect(await queued()).toHaveLength(0);
    });

    it('refuses a scouting report and a match plan', async () => {
        useAppStore.getState().addScoutingReport({
            teamNumber: '1234',
            data: {
                hasAutonomous: false, autoScore: 0, intakeType: 'No Intake', autoAim: false,
                farShooting: false, shotsTaken: 0, shotsMissed: 0, parking: 'No Park',
                rating: 3, endGameNotes: '',
            },
        } as never);
        useAppStore.getState().addMatchPlan({
            title: 'Nope', drawingData: null, notes: '', allianceTeam: '',
            partnerAutonomous: false, partnerPark: false,
        });

        expect(useAppStore.getState().scoutingReports).toHaveLength(0);
        expect(useAppStore.getState().matchPlans).toHaveLength(0);
        expect(await queued()).toHaveLength(0);
    });

    it('refuses sub-team changes', async () => {
        useAppStore.getState().addSubTeam('Pit Crew');
        useAppStore.getState().toggleMemberInSubTeam('st-build', 'm9');
        useAppStore.getState().removeSubTeam('st-prog');

        const state = useAppStore.getState();
        expect(state.subTeams).toHaveLength(2);
        expect(state.subTeams.find((s) => s.id === 'st-build')!.memberIds).toEqual(['m1', 'm2']);
        expect(await queued()).toHaveLength(0);
    });

    it('still allows the season itself to be REOPENED', async () => {
        // `seasons` is deliberately not gated on its own archive flag, here or in the
        // database. Otherwise archiving would be a one-way door and a mistake would need a
        // support ticket to undo.
        useAppStore.getState().setSeasonArchived(S1, false);
        expect(useAppStore.getState().seasons[0].isArchived).toBe(false);
        expect((await queued()).some((q) => q.table === 'seasons')).toBe(true);
    });

    it('judges by the RECORD’s season, not the one on screen', async () => {
        // An open season is selected, but the task belongs to the archived one. Editing
        // last year's task is editing last year's task whichever season the picker shows.
        useAppStore.setState({
            seasons: [season({ isArchived: true }), season({ id: 'season-2', name: 'Now' })],
            currentSeasonId: 'season-2',
            tasks: [{ id: 't1', title: 'Old', description: '', status: 'Done', type: 'Feature', assignedTo: '', department: '', checklist: [], timeline: [], createdAt: 1, seasonId: S1 }],
        });

        useAppStore.getState().updateTask('t1', { title: 'Edited' });

        expect(useAppStore.getState().tasks[0].title).toBe('Old');
        expect(await queued()).toHaveLength(0);
    });
});

describe('deleteSeason cascades locally, the way the server does', () => {
    beforeEach(() => {
        useAppStore.setState({
            seasons: [season(), season({ id: 'season-2', name: 'Other' })],
            tasks: [
                { id: 't1', title: 'Doomed', description: '', status: 'Done', type: 'Feature', assignedTo: '', department: '', checklist: [], timeline: [], createdAt: 1, seasonId: S1 },
                { id: 't2', title: 'Survivor', description: '', status: 'Done', type: 'Feature', assignedTo: '', department: '', checklist: [], timeline: [], createdAt: 1, seasonId: 'season-2' },
            ],
            scoutingReports: [{ id: 'r1', teamNumber: '1', data: { hasAutonomous: false, autoScore: 0, intakeType: 'No Intake', autoAim: false, farShooting: false, shotsTaken: 0, shotsMissed: 0, parking: 'No Park', rating: 3, endGameNotes: '' }, seasonId: S1 }],
            matchPlans: [{ id: 'p1', title: 'Doomed', drawingData: null, notes: '', allianceTeam: '', partnerAutonomous: false, partnerPark: false, updatedAt: 1, seasonId: S1 }],
            /*
             * Meetings and attendance (FEAT-10). The fixture carries one of each in the doomed
             * season AND one of each in the surviving one, because a cascade that deletes
             * everything passes an assertion that only checks the doomed rows are gone.
             *
             * `meeting_attendance` has no `season_id` of its own — it hangs off its meeting —
             * so `a2` is the row that proves the cascade walks the relationship rather than
             * filtering on a field that is not there.
             */
            meetings: [
                { id: 'm1', title: 'Doomed build night', description: '', location: '', eventType: 'team_meeting', publicCode: '', attendanceRequired: true, startsAt: 1, seasonId: S1, teamId: 'team-1', recurrenceRule: '', seriesId: '', createdBy: 'tm-9' },
                { id: 'm2', title: 'Surviving build night', description: '', location: '', eventType: 'team_meeting', publicCode: '', attendanceRequired: true, startsAt: 1, seasonId: 'season-2', teamId: 'team-1', recurrenceRule: '', seriesId: '', createdBy: 'tm-9' },
            ],
            meetingAttendance: [
                { id: 'a1', meetingId: 'm1', teamMemberId: 'tm-1', status: 'present', method: 'coach', notes: '', attestedBy: 'tm-9' },
                { id: 'a2', meetingId: 'm2', teamMemberId: 'tm-1', status: 'present', method: 'coach', notes: '', attestedBy: 'tm-9' },
            ],
        });
    });

    it('removes every record the server’s ON DELETE CASCADE would', () => {
        // The asymmetry this fixes: the server cascades and the client did not, so local
        // state kept tasks, sub-teams, reports and plans pointing at a season id that no
        // longer existed anywhere. They rendered in no season (every view filters on the
        // current season), counted towards nothing, and survived every pull — a full pull
        // replaces a collection with what the server sent, and the server had never heard
        // of them.
        useAppStore.getState().deleteSeason(S1);
        const state = useAppStore.getState();

        expect(state.seasons.map((s) => s.id)).toEqual(['season-2']);
        expect(state.tasks.map((t) => t.id)).toEqual(['t2']);
        expect(state.subTeams).toHaveLength(0);
        expect(state.scoutingReports).toHaveLength(0);
        expect(state.matchPlans).toHaveLength(0);
        expect(state.checklistsBySeason[S1]).toBeUndefined();
        /*
         * FEAT-10. These two were absent from the cascade list while the docblock above it said
         * the server removes meetings — and the server does. So the rows went from the database
         * and stayed in the store, pointing at a season that exists nowhere.
         */
        expect(state.meetings.map((m) => m.id)).toEqual(['m2']);
        expect(state.meetingAttendance.map((a) => a.id)).toEqual(['a2']);
    });

    it('queues the attendance delete BEFORE its meeting’s (FEAT-10)', async () => {
        /*
         * `meeting_attendance` references `meetings (id, team_id)`, so the child has to land
         * first or it errors against a row that has already gone — and an error in the drain is
         * a retry, five of them, and then a dead letter the coach cannot act on.
         */
        await db.syncQueue.clear();
        useAppStore.getState().deleteSeason(S1);

        const order = await queued();
        const attendanceAt = order.findIndex((q) => q.table === 'meeting_attendance' && q.id === 'a1');
        const meetingAt = order.findIndex((q) => q.table === 'meetings' && q.id === 'm1');
        const seasonAt = order.findIndex((q) => q.table === 'seasons' && q.id === S1);

        expect(attendanceAt, 'the attendance delete was never queued').toBeGreaterThanOrEqual(0);
        expect(meetingAt, 'the meeting delete was never queued').toBeGreaterThanOrEqual(0);
        expect(attendanceAt).toBeLessThan(meetingAt);
        expect(meetingAt).toBeLessThan(seasonAt);

        // And the surviving season's rows are not queued at all.
        expect(order.filter((q) => q.id === 'm2' || q.id === 'a2')).toEqual([]);
    });

    it('moves the current season pointer off the deleted one', () => {
        useAppStore.getState().deleteSeason(S1);
        expect(useAppStore.getState().currentSeasonId).toBe('season-2');
    });

    it('queues the children’s deletes BEFORE the season’s', async () => {
        await db.syncQueue.clear();
        useAppStore.getState().deleteSeason(S1);

        const order = await queued();
        const seasonAt = order.findIndex((q) => q.table === 'seasons' && q.id === S1);
        const childAt = order.findIndex((q) => q.table === 'tasks' && q.id === 't1');

        expect(childAt).toBeGreaterThanOrEqual(0);
        expect(childAt).toBeLessThan(seasonAt);
    });

    it('leaves nothing unpushable for a season that never reached the server', async () => {
        // `queueForSync` collapses a delete onto a pending create by dropping both. So a
        // season created offline and deleted before it ever synced takes its unsynced
        // children with it, instead of leaving creates queued against a season the server
        // will never have heard of — which would retry five times and dead-letter.
        await db.syncQueue.clear();
        useAppStore.setState({ seasons: [season({ id: 'season-2', name: 'Other' })], currentSeasonId: 'season-2' });

        const fresh = useAppStore.getState().rollOverSeason({ name: 'Brand New', archivePrevious: false })!;
        expect((await queued()).length).toBeGreaterThan(0);

        useAppStore.getState().deleteSeason(fresh);
        const left = await queued();

        // The season and its cloned sub-teams are gone from the queue entirely.
        expect(left.filter((q) => q.table === 'seasons')).toEqual([]);
        expect(left.filter((q) => q.table === 'sub_teams')).toEqual([]);

        // The checklist leaves a DELETE behind, and that is correct rather than tidy. A
        // checklist is queued as an `update` (it is blob-synced and pushed as an upsert, so
        // the client cannot tell whether the server has the row), and the coalescing rule
        // for "delete after a pending update" is to replace it with the delete — which is
        // exactly what has to happen, or an upsert would stay queued against a season that
        // no longer exists and fail its foreign key five times over. Pushing it is a no-op:
        // a DELETE matching no row affects nothing and reports no error.
        expect(left.map((q) => ({ table: q.table, op: q.op }))).toEqual([
            { table: 'checklists', op: 'delete' },
        ]);
    });
});

describe('season-rules', () => {
    it('treats an unknown season as writable — the server still decides', () => {
        // The client may hold a record whose season it has not pulled yet. Refusing edits on
        // that basis would break the offline case this application is built around.
        expect(isSeasonArchived([], 'nobody-knows')).toBe(false);
        expect(canWriteToSeason([], 'nobody-knows', 'test')).toBe(true);
    });

    it('refuses with no season at all', () => {
        expect(canWriteToSeason([season()], null, 'test')).toBe(false);
    });

    describe('suggestNextSeasonName', () => {
        it('advances the year pair on the previous name', () => {
            expect(suggestNextSeasonName('2026-2027 Season')).toBe('2027-2028 Season');
            expect(suggestNextSeasonName('FTC 2026-2027')).toBe('FTC 2027-2028');
        });

        it('is relative, not calendar-driven — rolling over late offers the same answer', () => {
            const september = new Date('2027-09-01T00:00:00Z');
            const november = new Date('2027-11-20T00:00:00Z');
            expect(suggestNextSeasonName('2026-2027 Season', september))
                .toBe(suggestNextSeasonName('2026-2027 Season', november));
        });

        it('falls back to the FTC calendar when there is no year pair to advance', () => {
            // The season straddles a year boundary, so from August onwards the NEXT one is
            // the one being planned.
            expect(suggestNextSeasonName('Rookie Year', new Date('2026-09-10T00:00:00Z')))
                .toBe('2026-2027 Season');
            expect(suggestNextSeasonName(undefined, new Date('2027-03-10T00:00:00Z')))
                .toBe('2026-2027 Season');
        });
    });
});
