/**
 * Sprint 4 — the season lifecycle, against a real database.
 *
 * The client-side half is in `src/lib/__tests__/season-lifecycle.test.ts`: what a rollover
 * clones, what it refuses to queue. This file asks the questions only Postgres can answer:
 *
 *   1. Does a rollover performed with NO NETWORK actually land, in one drain, against
 *      `season_id NOT NULL` and a composite `(season_id, team_id)` foreign key? That
 *      ordering is the sprint's exit criterion and it is not provable against a mock.
 *   2. Is an archived season read-only IN THE DATABASE — not merely un-offered by a client
 *      that happens to know about the archive? The client that matters here is the one that
 *      was offline during the rollover and still thinks last season is current.
 *   3. Does work queued BEFORE the rollover still land after it? The archive closes the
 *      season, so getting that order wrong silently dead-letters the user's last hour.
 *
 * Everything runs through the real store actions and the real drain, with a real JWT, so a
 * policy refusal shows up here the same way it would in a browser.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Fixtures, mintAccessToken, type TestTeam } from './fixtures';
import { serviceClient } from './stack';
import type { Database } from '@/lib/database.types';
import type { ChecklistItem } from '@/types';

/**
 * Read a checklist row's `items`.
 *
 * The column is `jsonb`, so the generated type is `Json` — structurally unrelated to
 * `ChecklistItem[]`, which is the whole reason blob-synced records get their own handling
 * in `sync.ts` rather than a registry entry. One narrowing point, named, rather than a cast
 * at each assertion.
 */
const items = (row: { items: unknown }): ChecklistItem[] => row.items as ChecklistItem[];
import { signInAppClientAs, signOutAppClient } from './setup';
import { useAppStore } from '@/lib/store';
import { db } from '@/lib/offline-db';
import { drainSyncQueue } from '@/lib/sync';
import { pullFromServer } from '@/lib/server-pull';

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('rollover');
    // The admin, because a rollover is `can_manage_structure` (admin or coach).
    signInAppClientAs(mintAccessToken(team.admin.id, team.admin.email));
});

afterAll(async () => {
    signOutAppClient();
    await fixtures.cleanup();
});

/**
 * Put the store into the state a client has after opening this team, WITHOUT talking to the
 * server — which is what "offline" means for a rollover.
 */
beforeEach(async () => {
    await db.syncQueue.clear();
    await db.syncFailures.clear();
    await svc.from('seasons').update({ is_archived: false } as never).eq('team_id', team.id);

    useAppStore.setState({
        currentTeamId: team.id,
        currentSeasonId: team.seasonId,
        seasons: [{
            id: team.seasonId,
            name: 'rollover Season',
            gameTitle: '',
            fieldImageData: '',
            teamId: team.id,
            isArchived: false,
            createdAt: Date.now(),
        }],
        subTeams: [{
            id: team.subTeamId,
            name: 'Build',
            memberIds: [team.users.student.memberId],
            seasonId: team.seasonId,
        }],
        tasks: [],
        scoutingReports: [],
        matchPlans: [],
        checklistsBySeason: { [team.seasonId]: [{ id: 'c1', text: 'Charge battery', checked: true }] },
        checklistTemplates: [],
    });
});

/**
 * Drain the queue the way the app does — after letting the store's writes reach it.
 *
 * Store actions fire `queueForSync(...)` and return without awaiting, so the Dexie
 * transactions are still in flight when the action returns. In the app that is invisible
 * (a drain is triggered by a timer or a connectivity change, never in the same tick); in a
 * test that calls `drainSyncQueue()` on the next line it means draining an empty queue and
 * concluding, wrongly, that nothing was pushed.
 *
 * The ORDER of what lands is not what this settles — `queueForSync` allocates its timestamp
 * at call time precisely so a burst of unawaited writes still drains in the order it was
 * written. This only waits for them to exist.
 */
async function settleAndDrain() {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return drainSyncQueue();
}

type SeasonRow = Database['public']['Tables']['seasons']['Row'];
type SubTeamRow = Database['public']['Tables']['sub_teams']['Row'];
type ChecklistRow = Database['public']['Tables']['checklists']['Row'];
type TaskRow = Database['public']['Tables']['tasks']['Row'];

/** Rows the server actually holds for a season. */
async function serverState(seasonId: string) {
    const [season, subTeams, checklists, tasks] = await Promise.all([
        svc.from('seasons').select('*').eq('id', seasonId).maybeSingle<SeasonRow>(),
        svc.from('sub_teams').select('*').eq('season_id', seasonId).returns<SubTeamRow[]>(),
        svc.from('checklists').select('*').eq('season_id', seasonId).returns<ChecklistRow[]>(),
        svc.from('tasks').select('*').eq('season_id', seasonId).returns<TaskRow[]>(),
    ]);
    return {
        season: season.data,
        subTeams: subTeams.data ?? [],
        checklists: checklists.data ?? [],
        tasks: tasks.data ?? [],
    };
}

describe('a rollover performed offline syncs cleanly in one drain', () => {
    it('lands the season, its cloned sub-teams and its checklist', async () => {
        const newSeasonId = useAppStore.getState().rollOverSeason({
            name: '2027-2028 Season',
            gameTitle: 'DECODE',
        })!;
        expect(newSeasonId).toBeTruthy();

        // Nothing has touched the network yet. This is the state of a device that did the
        // rollover in a gym with no signal.
        expect(await db.syncQueue.count()).toBeGreaterThan(0);

        // ONE drain. `season_id` is NOT NULL with a composite (season_id, team_id) foreign
        // key, so if the season were pushed after its children every child would fail its
        // constraint; the queue's timestamp order is what makes a single pass enough.
        const drain = await settleAndDrain();

        expect(drain.retried, 'a push was refused or failed a constraint').toBe(0);
        expect(drain.deadLettered).toBe(0);
        expect(await db.syncQueue.count()).toBe(0);
        expect(await db.syncFailures.count()).toBe(0);

        const state = await serverState(newSeasonId);
        expect(state.season).not.toBeNull();
        expect(state.season!.name).toBe('2027-2028 Season');
        expect(state.season!.game_title).toBe('DECODE');
        expect(state.season!.is_archived).toBe(false);
        expect(state.season!.team_id).toBe(team.id);
    });

    it('clones sub-team structure with NO member assignments', async () => {
        const newSeasonId = useAppStore.getState().rollOverSeason({ name: 'Next' })!;
        await settleAndDrain();

        const state = await serverState(newSeasonId);
        expect(state.subTeams).toHaveLength(1);
        expect(state.subTeams[0].name).toBe('Build');
        // The line that matters. The roster persists at team level; sub-team assignments are
        // a season's decision, and carrying them forward re-assigns students who have left.
        expect(state.subTeams[0].member_ids).toEqual([]);
        expect(state.subTeams[0].id).not.toBe(team.subTeamId);
    });

    it('gives the new season a fresh checklist whose row id is the NEW season id', async () => {
        const newSeasonId = useAppStore.getState().rollOverSeason({ name: 'Next' })!;
        await settleAndDrain();

        const state = await serverState(newSeasonId);
        expect(state.checklists).toHaveLength(1);
        // The convention `checklists_one_per_season` is the other half of: the row id IS the
        // season id, so two offline devices converge on one row instead of racing to make
        // two. A cloned checklist gets the NEW season's id, never the old one's.
        expect(state.checklists[0].id).toBe(newSeasonId);
        expect(state.checklists[0].is_template).toBe(false);
        expect(state.checklists[0].items).toEqual([
            expect.objectContaining({ text: 'Charge battery', checked: false }),
        ]);
    });

    it('starts the new season with an empty sprint board', async () => {
        // Seed the OUTGOING season with a task, so "empty" is a result rather than a
        // restatement of an empty fixture.
        await svc.from('tasks').insert({
            team_id: team.id, season_id: team.seasonId, title: 'last year',
        } as never);

        const newSeasonId = useAppStore.getState().rollOverSeason({ name: 'Next' })!;
        await settleAndDrain();

        expect((await serverState(newSeasonId)).tasks).toHaveLength(0);
        // ...and the previous season keeps everything. "Full history backward."
        expect((await serverState(team.seasonId)).tasks.length).toBeGreaterThan(0);
    });

    it('archives the outgoing season, and a pull brings that back', async () => {
        const newSeasonId = useAppStore.getState().rollOverSeason({ name: 'Next' })!;
        await settleAndDrain();

        const previous = await serverState(team.seasonId);
        expect(previous.season!.is_archived).toBe(true);

        // Round trip: the flag has to survive the read path as well as the write path, or a
        // second device never learns the season is closed.
        useAppStore.setState({ seasons: [] });
        await pullFromServer({ teamId: team.id, tables: ['seasons'], mode: 'full' });

        const seasons = useAppStore.getState().seasons;
        expect(seasons.find((s) => s.id === team.seasonId)!.isArchived).toBe(true);
        expect(seasons.find((s) => s.id === newSeasonId)!.isArchived).toBe(false);
    });

    it('lands work queued BEFORE the rollover, rather than dead-lettering it', async () => {
        // The failure this prevents: a coach ticks a checklist item, then rolls over. The
        // archive closes the old season, `season_is_open` refuses writes to it — so if the
        // archive were pushed first, that tick would be refused, retried five times over
        // nine minutes and parked, with the sync indicator saying nothing useful.
        useAppStore.getState().toggleChecklistItem('c1');
        await new Promise((resolve) => setTimeout(resolve, 20));

        useAppStore.getState().rollOverSeason({ name: 'Next' });
        const drain = await settleAndDrain();

        expect(drain.retried, 'the pre-rollover edit was refused').toBe(0);
        expect(drain.deadLettered).toBe(0);

        const previous = await serverState(team.seasonId);
        expect(items(previous.checklists[0])).toEqual([
            expect.objectContaining({ text: 'Charge battery', checked: false }),
        ]);
        expect(previous.season!.is_archived).toBe(true);
    });
});

describe('an archived season is read-only IN THE DATABASE', () => {
    /*
     * Not "the buttons are disabled". The client that matters is the one that was offline
     * when the season was archived on another device: it still believes last season is
     * current, its `isArchived` flag is stale, and every guard in the store passes. RLS is
     * what stops it, which is the same argument Sprint 3 made for licensing.
     */
    beforeEach(async () => {
        await svc.from('seasons').update({ is_archived: true } as never).eq('id', team.seasonId);
    });

    const denied = async (label: string, query: PromiseLike<{ data: unknown[] | null; error: unknown }>) => {
        const { data, error } = await query;
        if (error) return;
        expect(data ?? [], `${label} was NOT refused`).toEqual([]);
    };

    it('refuses INSERT, UPDATE and DELETE of a task', async () => {
        const client = team.admin.client;

        await denied('INSERT a task into an archived season',
            client.from('tasks')
                .insert({ team_id: team.id, season_id: team.seasonId, title: 'too late' } as never)
                .select());

        await denied('UPDATE a task in an archived season',
            client.from('tasks').update({ title: 'edited' } as never).eq('id', team.taskId).select());

        await denied('DELETE a task from an archived season',
            client.from('tasks').delete().eq('id', team.taskId).select());
    });

    it('refuses scouting reports, match plans and checklists', async () => {
        const client = team.admin.client;

        await denied('INSERT a scouting report',
            client.from('scouting_reports')
                .insert({ team_id: team.id, season_id: team.seasonId, opponent_team_number: '1' } as never)
                .select());

        await denied('UPDATE a match plan',
            client.from('match_plans').update({ notes: 'edited' } as never).eq('id', team.matchPlanId).select());

        await denied('UPDATE the checklist',
            client.from('checklists').update({ items: [] } as never).eq('id', team.checklistId).select());
    });

    it('refuses sub-team changes, which are `can_manage_structure` rather than content', async () => {
        // Two different capabilities gate these tables; the archive rule has to be on both,
        // or a coach can still redraw last season's sub-teams.
        await denied('INSERT a sub-team into an archived season',
            team.admin.client.from('sub_teams')
                .insert({ team_id: team.id, season_id: team.seasonId, name: 'Late Crew' } as never)
                .select());

        await denied('UPDATE a sub-team in an archived season',
            team.admin.client.from('sub_teams')
                .update({ name: 'Renamed' } as never).eq('id', team.subTeamId).select());
    });

    it('refuses meeting attendance, which reaches its season through the meeting', async () => {
        // The one season-scoped table with no `season_id` of its own. Left ungated it would
        // be the single table on which an archived season still accepted writes.
        await denied('UPDATE attendance for an archived season’s meeting',
            team.admin.client.from('meeting_attendance')
                .update({ status: 'absent' } as never).eq('id', team.attendanceId).select());
    });

    it('still allows every READ — the history is the point', async () => {
        const tasks = await team.admin.client
            .from('tasks').select('id, title').eq('id', team.taskId)
            .returns<{ id: string; title: string }[]>();

        expect(tasks.error).toBeNull();
        expect(tasks.data, 'an archived season lost access to its own data').toHaveLength(1);

        const subTeams = await team.admin.client.from('sub_teams').select('id').eq('season_id', team.seasonId);
        expect(subTeams.data).not.toHaveLength(0);
    });

    it('can be REOPENED — archival is not a one-way door', async () => {
        // `seasons` is deliberately not gated on its own archive flag. If it were, a season
        // closed by mistake could only be reopened with a service key.
        const { error } = await team.admin.client
            .from('seasons')
            .update({ is_archived: false } as never)
            .eq('id', team.seasonId)
            .select();

        expect(error).toBeNull();

        const { error: writeError } = await team.admin.client
            .from('tasks')
            .update({ title: 'editable again' } as never)
            .eq('id', team.taskId)
            .select();
        expect(writeError).toBeNull();
    });

    it('does not leak the rule across seasons — an OPEN season still accepts writes', async () => {
        // The positive control. A predicate that returned false for everything would satisfy
        // every assertion above while breaking the application completely.
        const { data: other } = await svc
            .from('seasons')
            .insert({ team_id: team.id, name: 'still open' } as never)
            .select()
            .single<{ id: string }>();

        const { error } = await team.admin.client
            .from('tasks')
            .insert({ team_id: team.id, season_id: other!.id, title: 'fine' } as never)
            .select();

        expect(error, 'an open season was refused a write').toBeNull();
        await svc.from('seasons').delete().eq('id', other!.id);
    });
});

describe('a season deletion cascades on the server, and the client matches it', () => {
    it('removes every season-scoped row, locally and remotely', async () => {
        const newSeasonId = useAppStore.getState().rollOverSeason({ name: 'Doomed' })!;
        await settleAndDrain();
        expect((await serverState(newSeasonId)).subTeams).toHaveLength(1);

        useAppStore.getState().deleteSeason(newSeasonId);
        const drain = await settleAndDrain();
        expect(drain.deadLettered).toBe(0);

        const after = await serverState(newSeasonId);
        expect(after.season).toBeNull();
        expect(after.subTeams).toHaveLength(0);
        expect(after.checklists).toHaveLength(0);

        // And the client agrees, rather than keeping orphans pointing at a season id that
        // exists nowhere — records that render in no season and survive every pull.
        const state = useAppStore.getState();
        expect(state.seasons.find((s) => s.id === newSeasonId)).toBeUndefined();
        expect(state.subTeams.filter((s) => s.seasonId === newSeasonId)).toHaveLength(0);
        expect(state.checklistsBySeason[newSeasonId]).toBeUndefined();
    });
});

describe('checklist templates', () => {
    it('saves one without disturbing the season’s working checklist', async () => {
        const templateId = useAppStore.getState().saveChecklistAsTemplate('Standard pre-match')!;
        expect(templateId).toBeTruthy();

        const drain = await settleAndDrain();
        expect(drain.retried + drain.deadLettered).toBe(0);

        const { data: rows } = await svc
            .from('checklists').select('*').eq('team_id', team.id).eq('is_template', true)
            .returns<ChecklistRow[]>();

        expect(rows).toHaveLength(1);
        expect(rows![0].id).toBe(templateId);
        expect(rows![0].name).toBe('Standard pre-match');
        // Stored unticked: a template records what a team checks, not the state of one match.
        expect(items(rows![0])[0].checked).toBe(false);

        // `checklists_one_per_season` exempts templates, so the season still has exactly one
        // WORKING checklist and its id is still the season id.
        const working = (await serverState(team.seasonId)).checklists.filter((c) => !c.is_template);
        expect(working).toHaveLength(1);
        expect(working[0].id).toBe(team.seasonId);

        // The template pull reads them back; the working pull must not see them.
        useAppStore.setState({ checklistTemplates: [] });
        const { pullChecklistTemplates } = await import('@/lib/server-pull');
        await pullChecklistTemplates(team.id);
        expect(useAppStore.getState().checklistTemplates.map((t) => t.id)).toContain(templateId);

        await svc.from('checklists').delete().eq('id', templateId);
    });

    it('can be saved while looking at an ARCHIVED season', async () => {
        /*
         * The regression test for a defect this sprint introduced and a browser found.
         *
         * A template's `season_id` records where it was captured FROM — provenance, not
         * scope. The archive gate treated it as scope, so saving a template while browsing
         * last season was refused by `checklists_insert_content`: the UI offered it, the row
         * appeared in the library, the push retried, and the sync indicator gave no reason.
         * Exactly the silent-write failure the sprint exists to prevent, reintroduced by the
         * sprint itself.
         *
         * Looking back at the checklist a team spent a season refining is the single most
         * likely moment to want to save one, so the fix is the policy exemption rather than
         * a disabled button.
         */
        await svc.from('seasons').update({ is_archived: true } as never).eq('id', team.seasonId);

        const templateId = useAppStore.getState().saveChecklistAsTemplate('From the archive')!;
        const drain = await settleAndDrain();

        expect(drain.retried, 'saving a template from an archived season was refused').toBe(0);
        expect(drain.deadLettered).toBe(0);

        const { data: rows } = await svc
            .from('checklists').select('id, is_template').eq('id', templateId).returns<ChecklistRow[]>();
        expect(rows, 'the template never landed').toHaveLength(1);
        expect(rows![0].is_template).toBe(true);

        await svc.from('checklists').delete().eq('id', templateId);
    });

    it('cannot be flipped into a working checklist for an archived season', async () => {
        // The exemption's escape hatch, closed. UPDATE's WITH CHECK sees the row as it would
        // BECOME — a working checklist in a closed season — and refuses.
        const templateId = useAppStore.getState().saveChecklistAsTemplate('Smuggler')!;
        await settleAndDrain();
        await svc.from('seasons').update({ is_archived: true } as never).eq('id', team.seasonId);

        const { data, error } = await team.admin.client
            .from('checklists')
            .update({ is_template: false } as never)
            .eq('id', templateId)
            .select();

        if (!error) expect(data ?? [], 'a template was flipped into an archived season').toEqual([]);

        const { data: after } = await svc
            .from('checklists').select('is_template').eq('id', templateId).returns<ChecklistRow[]>();
        expect(after![0].is_template).toBe(true);

        await svc.from('checklists').delete().eq('id', templateId);
    });
});

describe('the client reads its own entitlement', () => {
    it('reports active for a licensed team and read_only when the licence is revoked', async () => {
        const { pullEntitlement } = await import('@/lib/server-pull');

        await pullEntitlement(team.id);
        expect(useAppStore.getState().entitlement?.status).toBe('active');

        await fixtures.revokeLicense(team.id);
        await pullEntitlement(team.id);
        expect(useAppStore.getState().entitlement?.status).toBe('read_only');

        await fixtures.restoreLicense(team.id);
        await pullEntitlement(team.id);
        expect(useAppStore.getState().entitlement?.status).toBe('active');
    });
});
