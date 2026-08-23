/**
 * SEC-11 — erasing a person, and deleting a team, as audited tools.
 *
 * The Privacy Policy promises: *"we remove your personal information and your memberships. Work
 * you contributed to a team stays with the team."* Both halves of that sentence are assertions,
 * and both are checked here — because the easy half to get right is the removal, and the half
 * that actually protects a team is the one where a deleted member's task survives with its
 * history intact.
 *
 * WHY THESE ARE db TESTS. Every rule here is a foreign key, a trigger, or a SECURITY DEFINER
 * function. `team_members` has five composite FKs pointing at it with ON DELETE SET NULL, four of
 * which cannot fire; `handle_new_user` copies `auth.users.email` into `public.users` on every
 * UPDATE. A mock can express none of that, and `docs/failure-modes.md` §2's worst variant is a
 * test asserting against a mock incapable of representing the property under test.
 *
 * THE TWO ASSERTIONS THAT EXIST BECAUSE THE RUNBOOK WAS WRONG, and which no amount of reading
 * would have produced:
 *
 *   - "the erasure survives a later write to the login" — `docs/beta-ops.md` anonymises
 *     `public.users` only, and `handle_new_user` fires on UPDATE of `auth.users` with
 *     `email = EXCLUDED.email`. The next password reset copies the real address back over the
 *     tombstone. The test simulates that write and requires the tombstone to hold.
 *   - "the login no longer works" — the runbook's final step is "delete the login in the
 *     dashboard", which is REFUSED for anyone who has ever owned a team (measured: refused for a
 *     team owner, succeeds for a student). Banning is one outcome for everybody.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures } from './fixtures';
import { serviceClient, userClient } from './stack';

let fixtures: Fixtures;
const svc = serviceClient();

/*
 * Teams created outside `Fixtures` are tracked by hand — Sprint 17's lesson, and Sprint 19's
 * parking lot is why it is repeated rather than assumed.
 */
const createdTeamIds: string[] = [];

/** An operator client. `platform_operators` is the gate every RPC here checks first. */
async function makeOperator(label: string) {
    const account = await fixtures.createUser(label);
    await fixtures.attest(account.id);
    await svc.from('platform_operators').insert({ user_id: account.id } as never);
    return { ...account, client: userClient(account.token) };
}

beforeAll(async () => {
    fixtures = new Fixtures();
}, 120_000);

afterAll(async () => {
    for (const id of createdTeamIds) await svc.from('teams').delete().eq('id', id);
    await fixtures.cleanup();
}, 120_000);

// =================================================================================================
describe('SEC-11 — erasing a person', () => {
    it('removes their personal information and leaves their work with the team', async () => {
        const team = await fixtures.createTeam('sec11-erase');
        const operator = await makeOperator('sec11-erase-op');
        const victim = team.users.student;

        // The member row, and something they contributed that must OUTLIVE them.
        const { data: member } = await svc
            .from('team_members').select('id').eq('team_id', team.id).eq('user_id', victim.id).single();
        const memberId = (member as { id: string }).id;

        await svc.from('tasks').update({ assigned_to: memberId } as never).eq('id', team.taskId);
        await svc.from('scouting_reports').update({ created_by: memberId } as never).eq('id', team.scoutingReportId);
        await svc.from('meeting_attendance')
            .insert({
                meeting_id: team.meetingId,
                team_id: team.id,
                team_member_id: memberId,
                status: 'present',
            } as never);

        /*
         * THE CONTROL. Everything below is "these things are gone" and "these things are not",
         * and neither means anything unless they were both there to begin with — a member with no
         * task and no attendance passes every assertion in this test (`failure-modes` §7).
         */
        const { count: beforeAttendance } = await svc
            .from('meeting_attendance').select('id', { count: 'exact', head: true })
            .eq('team_member_id', memberId);
        expect(beforeAttendance, 'the fixture has no attendance to erase').toBeGreaterThan(0);

        const { data: result } = await operator.client.rpc('operator_erase_user', {
            p_user_id: victim.id,
            p_notes: 'test erasure',
        });
        const erase = result as { success: boolean; error?: string; memberships_removed: number };
        expect(erase.success, `erase refused: ${erase.error}`).toBe(true);
        expect(erase.memberships_removed).toBeGreaterThan(0);

        // --- gone: the person -------------------------------------------------------------
        const { data: profile } = await svc
            .from('users').select('email, full_name, avatar_url').eq('id', victim.id).single();
        const p = profile as { email: string; full_name: string; avatar_url: string | null };
        expect(p.email).toBe(`erased-${victim.id.replace(/-/g, '')}@erased.invalid`);
        expect(p.full_name).toBe('Erased user');
        expect(p.avatar_url).toBeNull();

        // --- gone: their memberships and their own attendance -----------------------------
        const { count: memberships } = await svc
            .from('team_members').select('id', { count: 'exact', head: true }).eq('user_id', victim.id);
        expect(memberships).toBe(0);

        const { count: attendance } = await svc
            .from('meeting_attendance').select('id', { count: 'exact', head: true })
            .eq('team_member_id', memberId);
        expect(attendance).toBe(0);

        /*
         * --- KEPT: their work, which is the half of the policy sentence that is easy to break.
         * The task still exists and still belongs to the team; only the pointer to a person is
         * gone. A cascade here instead of a SET NULL would delete a team's planning because a
         * student left, and nothing else in this suite would notice.
         */
        const { data: task } = await svc
            .from('tasks').select('id, team_id, assigned_to, title').eq('id', team.taskId).single();
        expect(task, 'the erased member took a task with them').not.toBeNull();
        expect((task as { assigned_to: string | null }).assigned_to).toBeNull();
        expect((task as { team_id: string }).team_id).toBe(team.id);

        const { data: report } = await svc
            .from('scouting_reports').select('id, created_by').eq('id', team.scoutingReportId).single();
        expect(report, 'the erased member took a scouting report with them').not.toBeNull();
        expect((report as { created_by: string | null }).created_by).toBeNull();
    });

    /*
     * THE DEFECT THE RUNBOOK HAS AND THIS FUNCTION DOES NOT.
     *
     * `handle_new_user()` fires AFTER INSERT **OR UPDATE** on `auth.users`, and its upsert says
     * `email = EXCLUDED.email` — "GoTrue owns the address; there is no other writer". The runbook
     * writes the tombstone to `public.users` only, so the next time GoTrue touches that row for
     * any reason the real address is copied straight back.
     *
     * The UPDATE below is what a password reset or an email confirmation looks like from the
     * database's side: a write to the auth row that changes something else entirely.
     */
    it('the erasure survives a later write to the login', async () => {
        const team = await fixtures.createTeam('sec11-durable');
        const operator = await makeOperator('sec11-durable-op');
        const victim = team.users.mentor;

        const { data: before } = await svc.from('users').select('email').eq('id', victim.id).single();
        const realEmail = (before as { email: string }).email;
        expect(realEmail).toContain('@');

        await operator.client.rpc('operator_erase_user', { p_user_id: victim.id, p_notes: undefined });

        // GoTrue writes the row for an unrelated reason — a password reset, a confirmation.
        const { error: touchError } = await svc.auth.admin.updateUserById(victim.id, {
            user_metadata: { some_unrelated_field: 'changed' },
        });
        expect(touchError, `could not simulate a GoTrue write: ${touchError?.message}`).toBeNull();

        const { data: after } = await svc.from('users').select('email, full_name').eq('id', victim.id).single();
        const a = after as { email: string; full_name: string };
        expect(a.email, 'a later auth write restored the real address over the tombstone').not.toBe(realEmail);
        expect(a.email).toContain('@erased.invalid');
        expect(a.full_name).toBe('Erased user');
    });

    /*
     * The runbook ends "then delete the login in the Supabase dashboard". Measured: that is
     * REFUSED for anyone who has ever owned a team, because `public.users` cascades from
     * `auth.users` and four NO ACTION references refuse the cascade. So the login is banned
     * instead — one outcome for every person rather than a procedure that half-works.
     */
    it('disables the login rather than leaving a working one', async () => {
        const team = await fixtures.createTeam('sec11-login');
        const operator = await makeOperator('sec11-login-op');
        const victim = team.users.coach;

        await operator.client.rpc('operator_erase_user', { p_user_id: victim.id, p_notes: undefined });

        const { data: authUser } = await svc.auth.admin.getUserById(victim.id);
        expect(authUser.user, 'the auth row vanished, which this function does not do').not.toBeNull();
        const banned = (authUser.user as unknown as { banned_until: string | null }).banned_until;
        expect(banned, 'the login was left active after erasure').not.toBeNull();
        expect(new Date(banned!).getTime()).toBeGreaterThan(Date.now());
        expect(authUser.user?.email).toContain('@erased.invalid');
    });

    it('refuses to strand a team whose only administrator they are', async () => {
        const team = await fixtures.createTeam('sec11-sole');
        const operator = await makeOperator('sec11-sole-op');

        const { data } = await operator.client.rpc('operator_erase_user', {
            p_user_id: team.admin.id,
            p_notes: undefined,
        });
        const r = data as { success: boolean; error_code: string; error: string };

        expect(r.success).toBe(false);
        expect(r.error_code).toBe('sole_admin');
        // The message has to name the team, or the operator cannot act on it.
        expect(r.error).toContain(team.name);

        // And nothing happened: a refusal that half-ran would be worse than one that failed.
        const { count } = await svc
            .from('team_members').select('id', { count: 'exact', head: true }).eq('user_id', team.admin.id);
        expect(count, 'the refusal still removed a membership').toBeGreaterThan(0);
    });

    it('is refused to anyone who is not a platform operator', async () => {
        const team = await fixtures.createTeam('sec11-authz');

        const { data } = await team.admin.client.rpc('operator_erase_user', {
            p_user_id: team.users.student.id,
            p_notes: undefined,
        });
        expect((data as { success: boolean; error_code: string }).success).toBe(false);
        expect((data as { error_code: string }).error_code).toBe('not_operator');

        const { count } = await svc
            .from('team_members').select('id', { count: 'exact', head: true })
            .eq('user_id', team.users.student.id);
        expect(count, 'a non-operator erased somebody').toBeGreaterThan(0);
    });

    /*
     * The audit row records the SHAPE of what was removed and NOT who it was by name. An audit
     * log that keeps the email address it just erased is not an erasure, and this is the
     * assertion that stops a well-meaning future edit adding it "for traceability".
     */
    it('records what it did without recording who it was', async () => {
        const team = await fixtures.createTeam('sec11-audit');
        const operator = await makeOperator('sec11-audit-op');
        const victim = team.users.student;
        const { data: before } = await svc.from('users').select('email, full_name').eq('id', victim.id).single();
        const real = before as { email: string; full_name: string };

        await operator.client.rpc('operator_erase_user', { p_user_id: victim.id, p_notes: 'GDPR request 7' });

        const { data: rows } = await svc
            .from('operator_actions').select('action, team_id, detail, notes')
            .eq('action', 'user_erase').eq('operator_user_id', operator.id);
        const entry = (rows as { action: string; team_id: string | null; detail: Record<string, unknown>; notes: string }[])[0];

        expect(entry, 'the erasure was not recorded at all').toBeTruthy();
        expect(entry.team_id, 'an erasure is not an action against one team').toBeNull();
        expect(entry.notes).toBe('GDPR request 7');
        expect(entry.detail.user_id).toBe(victim.id);
        expect(entry.detail.memberships_removed).toBeGreaterThan(0);

        const asText = JSON.stringify(entry).toLowerCase();
        expect(asText, 'the audit row kept the email address it erased').not.toContain(real.email.toLowerCase());
        expect(asText, 'the audit row kept the name it erased').not.toContain(real.full_name.toLowerCase());
    });
});

// =================================================================================================
describe('SEC-11 — deleting a team', () => {
    it('requires the name typed exactly, and changes nothing when it is wrong', async () => {
        const team = await fixtures.createTeam('sec11-confirm');
        const operator = await makeOperator('sec11-confirm-op');

        for (const wrong of ['', 'not the name', team.name.toLowerCase(), `${team.name} `.repeat(2)]) {
            const { data } = await operator.client.rpc('operator_delete_team', {
                p_team_id: team.id,
                p_confirm_name: wrong,
                p_notes: undefined,
            });
            const r = data as { success: boolean; error_code: string; error: string };
            expect(r.success, `"${wrong}" was accepted as confirmation`).toBe(false);
            expect(r.error_code).toBe('name_mismatch');
            expect(r.error, 'the refusal does not say what to type').toContain(team.name);
        }

        // Lower-case is deliberately NOT accepted: an operator who cannot reproduce the name is
        // not looking at the team they think they are.
        const { data: still } = await svc.from('teams').select('id').eq('id', team.id).single();
        expect(still, 'a refused delete removed the team anyway').not.toBeNull();
    });

    it('deletes the team and everything that cascades from it', async () => {
        const team = await fixtures.createTeam('sec11-delete');
        const operator = await makeOperator('sec11-delete-op');

        // The control again: there has to be content for "it is gone" to mean anything.
        const { count: tasksBefore } = await svc
            .from('tasks').select('id', { count: 'exact', head: true }).eq('team_id', team.id);
        expect(tasksBefore).toBeGreaterThan(0);

        const { data, error: rpcError } = await operator.client.rpc('operator_delete_team', {
            p_team_id: team.id,
            p_confirm_name: team.name,
            p_notes: 'closing the beta team',
        });
        /*
         * The transport error FIRST. A function that RAISES returns null data, and asserting
         * `data.success` on that reads "Cannot read properties of null" — which says nothing about
         * why the delete failed and sent the first debugging pass in the wrong direction.
         */
        expect(rpcError, `operator_delete_team raised: ${rpcError?.message} ${rpcError?.details ?? ''}`).toBeNull();
        const r = data as unknown as { success: boolean; error?: string; members_removed: number; tasks_removed: number };
        expect(r.success, `delete refused: ${r.error}`).toBe(true);
        expect(r.tasks_removed).toBe(tasksBefore);

        const cascading = ['teams', 'team_members', 'seasons', 'tasks', 'meetings', 'sub_teams', 'invites'] as const;
        for (const table of cascading) {
            const column = table === 'teams' ? 'id' : 'team_id';
            const { count } = await svc
                .from(table).select('id', { count: 'exact', head: true }).eq(column, team.id);
            expect(count, `${table} still has rows for the deleted team`).toBe(0);
        }

        /*
         * PEOPLE ARE NOT DELETED WITH THE TEAM. Someone who leaves a closed team still has an
         * account — erasing them is the other function, and doing it here would make "delete this
         * team" quietly also mean "delete these fifteen students".
         */
        const { data: stillAUser } = await svc
            .from('users').select('id').eq('id', team.admin.id).single();
        expect(stillAUser, 'deleting a team deleted a person').not.toBeNull();
    });

    /*
     * THE AUDIT ROW OUTLIVES ITS SUBJECT, which it did not before this migration:
     * `operator_actions.team_id` was NOT NULL with ON DELETE CASCADE, so deleting a team deleted
     * the record of its own deletion — an audit log that erases exactly the entries most worth
     * keeping.
     */
    it('leaves a legible record behind after the team it points at is gone', async () => {
        const team = await fixtures.createTeam('sec11-audit-team');
        const operator = await makeOperator('sec11-audit-team-op');
        const name = team.name;

        const { data: deleted } = await operator.client.rpc('operator_delete_team', {
            p_team_id: team.id,
            p_confirm_name: name,
            p_notes: 'why it went',
        });
        expect(
            (deleted as unknown as { success: boolean; error?: string }).success,
            `the delete itself was refused: ${(deleted as unknown as { error?: string }).error}`,
        ).toBe(true);

        const { data: rows } = await svc
            .from('operator_actions').select('action, team_id, detail, notes')
            .eq('action', 'team_delete').eq('operator_user_id', operator.id);
        const entry = (rows as { team_id: string | null; detail: Record<string, unknown>; notes: string }[])[0];

        expect(entry, 'the delete took its own audit row with it').toBeTruthy();
        expect(entry.team_id, 'the FK should have been set null by the cascade').toBeNull();
        // And it is still readable, which is the whole point of copying the identity in.
        expect(entry.detail.team_name).toBe(name);
        expect(entry.detail.team_id).toBe(team.id);
        expect(entry.notes).toBe('why it went');
    });

    it('is refused to anyone who is not a platform operator', async () => {
        const team = await fixtures.createTeam('sec11-delete-authz');

        const { data } = await team.admin.client.rpc('operator_delete_team', {
            p_team_id: team.id,
            p_confirm_name: team.name,
            p_notes: undefined,
        });
        expect((data as { success: boolean }).success).toBe(false);
        expect((data as { error_code: string }).error_code).toBe('not_operator');

        const { data: still } = await svc.from('teams').select('id').eq('id', team.id).single();
        expect(still, 'a team admin deleted their own team through the operator RPC').not.toBeNull();
    });
});
