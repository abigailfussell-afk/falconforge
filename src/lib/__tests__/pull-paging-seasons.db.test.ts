/**
 * The read path at scale, and the read path with more than one season (SYNC-01, SYNC-03).
 *
 * Two defects, one change, and they have to be tested against a real PostgREST because both
 * are properties of the SERVER's answer rather than of the client's code:
 *
 *   - **SYNC-01.** PostgREST caps a response at `max_rows` (1,000) and does not say it has.
 *     `error` is null and the array is simply short. A full pull REPLACES the collection, so
 *     rows 1,001+ were deleted from the device; `newestUpdatedAt` then advanced the delta
 *     cursor past records that had never arrived, so nothing could bring them back. A mocked
 *     query builder cannot express any of that, which is why this file exists rather than a
 *     unit test with a stubbed `.range()`.
 *   - **SYNC-03.** Every app open re-downloaded every season's rows for ever. Scoping the
 *     pull to one season is most of the fix, and it is only safe if a season the pull did NOT
 *     ask about survives on the device — otherwise "fresh start" becomes "last year is gone".
 *
 * The 1,001-row case is the one that fails against the old code; 2,500 is the exit criterion's
 * number and is kept as the multi-page case (three pages, with the last one short).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Fixtures, type TestTeam } from '@/test/db/fixtures';
import { serviceClient } from '@/test/db/stack';
import { signInAppClientAs, signOutAppClient } from '@/test/db/setup';
import { useAppStore } from '@/lib/store';
import { getSyncMeta, queueForSync } from '@/lib/offline-db';
import { pullFromServer, fetchTeamData, fetchSeasonData, ensureSeasonFieldImage } from '@/lib/server-pull';
import { findEntity } from '@/lib/entity-registry';

let fixtures: Fixtures;
let team: TestTeam;
/** A second, archived season on the same team — last year, which must not vanish. */
let archivedSeasonId: string;
const svc = serviceClient();

/** PostgREST's `max_rows`, and therefore the page size the pull walks in. */
const PAGE = 1000;

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('paging');
    signInAppClientAs(team.users.coach.token);

    const archived = await svc
        .from('seasons')
        .insert({ team_id: team.id, name: '2025-2026 Season', is_archived: true })
        .select('id')
        .single();
    archivedSeasonId = archived.data!.id;
}, 120_000);

afterAll(async () => {
    signOutAppClient();
    await fixtures.cleanup();
});

beforeEach(() => {
    useAppStore.setState({
        currentTeamId: team.id,
        currentSeasonId: team.seasonId,
        tasks: [],
        seasons: [],
        subTeams: [],
        meetings: [],
        meetingAttendance: [],
        scoutingReports: [],
        matchPlans: [],
        teamMembers: [],
        checklistsBySeason: {},
    });
});

/** Insert `count` tasks into a season in one statement, and return how many the server holds. */
async function seedTasks(count: number, seasonId: string, prefix: string): Promise<number> {
    const rows = Array.from({ length: count }, (_, i) => ({
        team_id: team.id,
        season_id: seasonId,
        title: `${prefix} ${i}`,
    }));
    // Chunked because a single insert of thousands of rows exceeds PostgREST's body limits.
    for (let i = 0; i < rows.length; i += 500) {
        const { error } = await svc.from('tasks').insert(rows.slice(i, i + 500));
        expect(error, `seeding ${prefix} failed: ${error?.message}`).toBeNull();
    }
    const { count: total } = await svc
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('season_id', seasonId);
    return total ?? 0;
}

describe('a pull is not truncated at PostgREST’s row cap (SYNC-01)', () => {
    it('brings back all 1,001 rows, where one request returns 1,000', async () => {
        // 1,000 already exist from an earlier describe? No — each test seeds its own season,
        // and this one uses the team's current season, which starts with the fixture's task.
        const before = useAppStore.getState().tasks.length;
        expect(before).toBe(0);

        const seeded = await seedTasks(PAGE, team.seasonId, 'cap');
        expect(seeded, 'the fixture task plus 1,000 seeded ones').toBe(PAGE + 1);

        // What one request can return, which is what the old code asked for and believed.
        const oneRequest = await svc
            .from('tasks')
            .select('id')
            .eq('season_id', team.seasonId);
        expect(oneRequest.data!.length, 'the server did not truncate; this test proves nothing').toBe(PAGE);
        expect(oneRequest.error, 'truncation is silent — there is no error to notice').toBeNull();

        const received = await pullFromServer({
            teamId: team.id,
            seasonId: team.seasonId,
            tables: ['tasks'],
            mode: 'full',
        });

        expect(received.tasks).toBe(PAGE + 1);
        expect(useAppStore.getState().tasks).toHaveLength(PAGE + 1);
    }, 180_000);

    it('walks three pages for 2,500 rows and the store holds every one after fetchTeamData', async () => {
        const bulkSeason = await svc
            .from('seasons')
            .insert({ team_id: team.id, name: '2500-row season' })
            .select('id')
            .single();
        const seasonId = bulkSeason.data!.id;

        const seeded = await seedTasks(2_500, seasonId, 'bulk');
        expect(seeded).toBe(2_500);

        useAppStore.setState({ currentSeasonId: seasonId });
        await fetchTeamData(team.id);

        const tasks = useAppStore.getState().tasks.filter((t) => t.seasonId === seasonId);
        expect(tasks, 'fetchTeamData truncated the collection').toHaveLength(2_500);
        // Every row distinct: a paging bug that repeats a page would also reach 2,500.
        expect(new Set(tasks.map((t) => t.id)).size).toBe(2_500);

        // ...and a delta afterwards, over more rows than fit in one page, loses none of them.
        await svc
            .from('tasks')
            .update({ status: 'In Progress' })
            .eq('season_id', seasonId)
            .lt('title', 'bulk 3'); // 'bulk 0'..'bulk 2999' — the string range covers ~1,500

        const changed = await svc
            .from('tasks')
            .select('id', { count: 'exact', head: true })
            .eq('season_id', seasonId)
            .eq('status', 'In Progress');
        expect(changed.count, 'the delta case needs more than one page of changes').toBeGreaterThan(PAGE);

        await pullFromServer({ teamId: team.id, seasonId, tables: ['tasks'], mode: 'auto' });

        const after = useAppStore.getState().tasks.filter((t) => t.seasonId === seasonId);
        expect(after).toHaveLength(2_500);
        expect(after.filter((t) => t.status === 'In Progress')).toHaveLength(changed.count!);
    }, 300_000);

    it('leaves the cursor at the newest row of the LAST page, not the first', async () => {
        const seasonRow = await svc
            .from('seasons')
            .insert({ team_id: team.id, name: 'cursor season' })
            .select('id')
            .single();
        const seasonId = seasonRow.data!.id;
        await seedTasks(PAGE + 5, seasonId, 'cursor');

        await pullFromServer({ teamId: team.id, seasonId, tables: ['tasks'], mode: 'full' });

        const cursor = (await getSyncMeta()).cursors[`${team.id}:tasks:season:${seasonId}`];
        const newest = await svc
            .from('tasks')
            .select('updated_at')
            .eq('season_id', seasonId)
            .order('updated_at', { ascending: false })
            .limit(1)
            .single();

        expect(new Date(cursor).getTime(), 'the cursor stopped at a page boundary').toBe(
            new Date(newest.data!.updated_at!).getTime(),
        );
    }, 180_000);
});

describe('a pull is scoped to one season, and the others survive it (SYNC-03)', () => {
    it('does not fetch another season’s rows on open, and does not delete them either', async () => {
        await seedTasks(3, archivedSeasonId, 'last year');

        // Last year, loaded on demand the way the season picker loads it.
        await fetchSeasonData(team.id, archivedSeasonId, { mode: 'full' });
        const archivedTasks = useAppStore.getState().tasks.filter((t) => t.seasonId === archivedSeasonId);
        expect(archivedTasks.length, 'an archived season did not load on demand').toBeGreaterThanOrEqual(3);

        // Now this season, full — the pull that used to replace the whole collection.
        const received = await pullFromServer({
            teamId: team.id,
            seasonId: team.seasonId,
            tables: ['tasks'],
            mode: 'full',
        });

        const state = useAppStore.getState();
        expect(
            state.tasks.filter((t) => t.seasonId === archivedSeasonId).length,
            'refreshing this season deleted last season from the device',
        ).toBe(archivedTasks.length);
        expect(
            received.tasks,
            'the current-season pull fetched the archived season’s rows as well',
        ).toBe(state.tasks.filter((t) => t.seasonId === team.seasonId).length);
    }, 180_000);

    it('scopes meeting_attendance through its meeting, which has no season of its own', async () => {
        const oldMeeting = await svc
            .from('meetings')
            .insert({
                team_id: team.id,
                season_id: archivedSeasonId,
                title: 'Last season practice',
                starts_at: new Date('2025-11-04T23:00:00Z').toISOString(),
            })
            .select('id')
            .single();
        await svc.from('meeting_attendance').insert({
            team_id: team.id,
            meeting_id: oldMeeting.data!.id,
            team_member_id: team.users.student.memberId,
            status: 'present',
            method: 'coach',
        });

        const current = await pullFromServer({
            teamId: team.id,
            seasonId: team.seasonId,
            tables: ['meetings', 'meeting_attendance'],
            mode: 'full',
        });
        const currentAttendance = useAppStore.getState().meetingAttendance;
        expect(
            currentAttendance.some((a) => a.meetingId === oldMeeting.data!.id),
            'last season’s attendance came back with this season’s pull',
        ).toBe(false);

        const archived = await pullFromServer({
            teamId: team.id,
            seasonId: archivedSeasonId,
            tables: ['meetings', 'meeting_attendance'],
            mode: 'full',
        });
        expect(archived.meeting_attendance, 'the archived season’s attendance did not load').toBeGreaterThan(0);
        expect(current.meeting_attendance, 'the current-season pull returned no attendance at all').toBeGreaterThan(0);

        // Both seasons are on the device now: loading last year did not evict this year.
        const both = useAppStore.getState().meetingAttendance;
        expect(both.some((a) => a.meetingId === oldMeeting.data!.id), 'the archived row is missing').toBe(true);
        expect(both.some((a) => a.meetingId === team.meetingId), 'this season’s row was evicted').toBe(true);
    }, 120_000);
});

describe('the seasons pull leaves the field image behind (SYNC-03)', () => {
    const IMAGE = `data:image/png;base64,${'A'.repeat(2048)}`;

    it('does not carry field_image_data, and does not blank the one already on the device', async () => {
        await svc.from('seasons').update({ field_image_data: IMAGE }).eq('id', team.seasonId);

        await pullFromServer({ teamId: team.id, tables: ['seasons'], mode: 'full', seasonId: null });

        const pulled = useAppStore.getState().seasons.find((s) => s.id === team.seasonId)!;
        expect(pulled, 'the season did not arrive at all').toBeDefined();
        expect(
            pulled.fieldImageData,
            'the pull is still fetching the field image on every open',
        ).toBeUndefined();

        // It is fetched once, by the screens that show it...
        await ensureSeasonFieldImage(team.seasonId);
        expect(useAppStore.getState().seasons.find((s) => s.id === team.seasonId)!.fieldImageData).toBe(IMAGE);

        // ...and the next pull, which still does not carry the column, must not undo that.
        await pullFromServer({ teamId: team.id, tables: ['seasons'], mode: 'full', seasonId: null });
        expect(
            useAppStore.getState().seasons.find((s) => s.id === team.seasonId)!.fieldImageData,
            'a later pull blanked the image it had already fetched',
        ).toBe(IMAGE);

        await svc.from('seasons').update({ field_image_data: null }).eq('id', team.seasonId);
    }, 120_000);

    it('never writes the column back as NULL from a device that has not fetched it', () => {
        const seasons = findEntity('seasons')!;
        const notFetched = seasons.toRemote({ id: 's', name: 'x', gameTitle: '', isArchived: false, createdAt: 0, teamId: team.id } as never);
        expect(
            'field_image_data' in notFetched,
            'renaming a season would blank its field image on the server',
        ).toBe(false);

        const cleared = seasons.toRemote({ id: 's', name: 'x', gameTitle: '', fieldImageData: '', isArchived: false, createdAt: 0, teamId: team.id } as never);
        expect(cleared.field_image_data, 'pressing Remove Image no longer clears it').toBeNull();
    });
});

describe('the seasons column list tracks the table it is a list of', () => {
    /**
     * `pullColumns` is a hand-written list that must match the schema minus the deferred
     * columns — the shape of `docs/failure-modes.md` section 12, where nothing fails when the
     * two drift and the symptom is a column that quietly stops being read. So it is compared
     * to `information_schema` rather than trusted.
     */
    it('is every column of `seasons` except field_image_data', async () => {
        const seasons = findEntity('seasons')!;

        // A row read with `select=*` carries exactly the table's columns as its keys, so the
        // real schema is what this compares against rather than a second list in the test.
        const sample = await svc.from('seasons').select('*').eq('id', team.seasonId).single();
        const columns = Object.keys(sample.data!).sort();
        const expected = columns.filter((c) => c !== 'field_image_data');

        expect([...seasons.pullColumns!].sort()).toEqual(expected);
    });
});

describe('the B3 guard still holds with the pull scoped and paged', () => {
    it('keeps an un-pushed local task across a full, multi-page pull', async () => {
        const offlineId = crypto.randomUUID();
        useAppStore.setState({
            tasks: [
                {
                    id: offlineId,
                    title: 'Queued in a gym with no signal',
                    description: '',
                    status: 'Backlog',
                    type: 'Feature',
                    assignedTo: '',
                    department: '',
                    tags: [],
                    checklist: [],
                    timeline: [],
                    createdAt: Date.now(),
                    seasonId: team.seasonId,
                    teamId: team.id,
                },
            ],
        });
        await queueForSync('tasks', offlineId, 'create', { id: offlineId, teamId: team.id });

        await pullFromServer({ teamId: team.id, seasonId: team.seasonId, tables: ['tasks'], mode: 'full' });

        expect(
            useAppStore.getState().tasks.map((t) => t.id),
            'the offline task was wiped by a paged pull',
        ).toContain(offlineId);
    }, 180_000);
});
