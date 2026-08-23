/**
 * SEC-09 — how long an invite code lasts, and who says so.
 *
 * `invites.expires_at` defaulted to 24 hours, and `create_team_as_admin` inserts the row
 * without naming the column — so the code on the "Team Created Successfully!" screen died
 * overnight while the codes `InviteManager` generated lasted a week. One concept, two numbers,
 * nothing comparing them (`docs/failure-modes.md` §12), and the cost lands on the first-run
 * experience of every beta team.
 *
 * The tests below assert the DEFAULT and the RPC separately, because the RPC relying on the
 * default is the whole design: if a later change gives `create_team_as_admin` its own literal,
 * the second test keeps passing and the third — which compares the two paths — does not.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Fixtures } from './fixtures';
import { serviceClient, userClient } from './stack';

let fixtures: Fixtures;
const svc = serviceClient();
const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(() => {
    fixtures = new Fixtures();
});

afterAll(async () => {
    await fixtures.cleanup();
});

/** Days between an invite's creation and its expiry, rounded to the nearest tenth. */
function lifetimeDays(row: { created_at: string | null; expires_at: string | null }) {
    expect(row.expires_at, 'the invite has no expiry at all').not.toBeNull();
    expect(row.created_at).not.toBeNull();
    const ms = new Date(row.expires_at!).getTime() - new Date(row.created_at!).getTime();
    return Math.round((ms / DAY_MS) * 10) / 10;
}

describe('SEC-09 — the invite lifetime', () => {
    it('the column DEFAULT is a week, not a night', async () => {
        const team = await fixtures.createTeam('sec09-default');

        const { data } = await svc
            .from('invites')
            .insert({
                team_id: team.id,
                code: `SEC09${Math.floor(Math.random() * 1000)}`,
                created_by: team.admin.id,
            } as never)
            .select('created_at, expires_at')
            .single();

        expect(lifetimeDays(data as never), 'a hand-inserted invite still expires overnight')
            .toBe(7);
    });

    it('create_team_as_admin issues a code that lasts a week and says when it stops', async () => {
        const founder = await fixtures.createUser('sec09-founder');
        await fixtures.attest(founder.id, 'coach_terms', '2.0');

        const { data } = await userClient(founder.token).rpc('create_team_as_admin', {
            team_name: 'SEC-09 Registration',
            season_name: '2026-2027',
        });
        const result = data as {
            success: boolean;
            team_id: string;
            invite_code: string;
            invite_expires_at: string | null;
        };
        expect(result.success).toBe(true);

        try {
            /*
             * The RPC must RETURN the expiry, not just set it. The success screen prints a date,
             * and a screen that computes its own from a client constant is the same duplication
             * this finding is about, one layer up.
             */
            expect(
                result.invite_expires_at,
                'create_team_as_admin does not tell the client when the code stops working',
            ).not.toBeNull();

            const { data: row } = await svc
                .from('invites')
                .select('created_at, expires_at')
                .eq('team_id', result.team_id)
                .single();

            expect(lifetimeDays(row as never), 'the registration code still expires overnight')
                .toBe(7);
            expect(
                new Date(result.invite_expires_at!).getTime(),
                'the date the client was given is not the date on the row',
            ).toBe(new Date((row as { expires_at: string }).expires_at).getTime());
        } finally {
            await svc.from('teams').delete().eq('id', result.team_id);
        }
    });

    it('the code it issues is still usable a day later, which is what SEC-09 broke', async () => {
        /*
         * The behavioural end of it. `join_team_with_invite` matches
         * `expires_at IS NULL OR expires_at > now()`, so "the default is 7 days" is only worth
         * asserting if the join actually succeeds after the old 24-hour cliff. The clock is
         * moved by ageing the ROW rather than the database: a code created 25 hours ago.
         */
        const team = await fixtures.createTeam('sec09-join');
        const code = `SEC09J${Math.floor(Math.random() * 1000)}`;

        const { data: invite } = await svc
            .from('invites')
            .insert({ team_id: team.id, code, created_by: team.admin.id } as never)
            .select('id')
            .single();

        await svc
            .from('invites')
            .update({
                created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
                expires_at: new Date(Date.now() + 6 * DAY_MS).toISOString(),
            } as never)
            .eq('id', (invite as { id: string }).id);

        const joiner = await fixtures.createUser('sec09-joiner', '13_to_17');
        const { data } = await userClient(joiner.token).rpc('join_team_with_invite', {
            invite_code: code,
        });

        expect(data, 'a code 25 hours old was refused').toMatchObject({ success: true });
    });
});
