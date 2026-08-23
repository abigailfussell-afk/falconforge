/**
 * SEC-03 — the screen's half: "Remove" and "Reject" stopped being DELETEs.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * `member-removal.db.test.ts` proves the STATEMENT works against a real database — that
 * `update({status:'removed', seat_assigned:false})` succeeds for a student with an assigned
 * task where `delete()` comes back `23502`. It cannot notice if this component goes back to
 * calling `delete()`, which is precisely the drift that produced the finding: the plan and the
 * runbook both said the app never deletes a member while both of these handlers did.
 *
 * So the mock here REFUSES `.delete()` the way Postgres does, with the real error code and
 * message. That makes the assertions behavioural rather than about spelling: against the old
 * implementation the screen renders "Failed to remove member" and never calls
 * `onMembersChange`, which is exactly what a coach saw in October.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MemberManager from '../MemberManager';
import { supabaseSync } from '../../lib/supabase';
import type { TeamMember } from '../../types';

/** What Postgres actually returns for a DELETE of a member with an assigned task. */
const FK_REFUSAL = {
    data: null,
    error: {
        code: '23502',
        message: 'null value in column "team_id" of relation "tasks" violates not-null constraint',
    },
};

const updates: { payload: unknown; id: string | null }[] = [];
let deleteCalls = 0;

function makeBuilder(table: string) {
    let lastId: string | null = null;

    const builder: Record<string, unknown> = {
        select: () => builder,
        order: () =>
            // The pending-member fetch resolves here.
            Promise.resolve({ data: [], error: null }),
        eq: (_column: string, value: string) => {
            lastId = value;
            return builder;
        },
        update: (payload: unknown) => {
            const chain: Record<string, unknown> = {
                eq: (_c: string, value: string) => {
                    lastId = value;
                    updates.push({ payload, id: lastId });
                    return Promise.resolve({ data: [{ id: lastId }], error: null });
                },
            };
            return chain;
        },
        delete: () => {
            deleteCalls += 1;
            return {
                eq: () => Promise.resolve(FK_REFUSAL),
            };
        },
    };

    if (table !== 'team_members') throw new Error(`unexpected table ${table}`);
    return builder;
}

vi.mock('../../lib/supabase', () => ({
    isSupabaseConfigured: () => true,
    supabaseSync: { from: vi.fn((table: string) => makeBuilder(table)) },
}));

vi.mock('../../lib/auth', () => ({
    useAuth: () => ({
        profile: { id: 'admin-user', fullName: 'Team Admin' },
        isOffline: false,
    }),
}));

vi.mock('../../lib/entitlement', () => ({
    useEntitlement: () => ({
        isKnown: true,
        seatsUsed: 3,
        seatsTotal: null,
        seatsUnlimited: true,
        seatsRemaining: null,
        isAtCapacity: false,
    }),
}));

vi.mock('../../lib/attestations', async () => {
    const actual = await vi.importActual<typeof import('../../lib/attestations')>(
        '../../lib/attestations',
    );
    return { ...actual, recordAttestation: vi.fn().mockResolvedValue({ success: true }) };
});

const members: TeamMember[] = [
    {
        id: 'member-admin',
        teamId: 'team-1',
        userId: 'admin-user',
        role: 'admin',
        status: 'approved',
        fullName: 'Team Admin',
        email: 'admin@falconforge.test',
        seatAssigned: true,
    } as TeamMember,
    {
        id: 'member-student',
        teamId: 'team-1',
        userId: 'student-user',
        role: 'student',
        status: 'approved',
        fullName: 'Departing Student',
        email: 'student@falconforge.test',
        seatAssigned: true,
    } as TeamMember,
];

describe('MemberManager — removing a member (SEC-03)', () => {
    beforeEach(() => {
        updates.length = 0;
        deleteCalls = 0;
        (supabaseSync!.from as unknown as ReturnType<typeof vi.fn>).mockClear();
    });

    const openAndConfirmRemove = async () => {
        const onMembersChange = vi.fn();
        render(
            <MemberManager teamId="team-1" teamMembers={members} onMembersChange={onMembersChange} />,
        );

        await screen.findByText('Departing Student');
        const removeButtons = screen.getAllByTitle('Remove from team');
        fireEvent.click(removeButtons[0]);

        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
        return onMembersChange;
    };

    it('marks the member removed and releases their seat, in one statement', async () => {
        await openAndConfirmRemove();

        await waitFor(() => expect(updates).toHaveLength(1));
        expect(updates[0]).toEqual({
            payload: { status: 'removed', seat_assigned: false },
            id: 'member-student',
        });
    });

    it('never DELETEs, which is what the schema refuses', async () => {
        const onMembersChange = await openAndConfirmRemove();

        await waitFor(() => expect(onMembersChange).toHaveBeenCalled());
        expect(deleteCalls, 'the remove button still issues a DELETE').toBe(0);
    });

    it('does not show "Failed to remove member" — the message the old path produced', async () => {
        /*
         * The behavioural half. The mock refuses `.delete()` with the real `23502`, so the old
         * implementation lands in the catch, sets the error banner and never calls
         * `onMembersChange`. Asserting the absence of that banner is what makes this test about
         * the coach's experience rather than about which method name was typed.
         */
        const onMembersChange = await openAndConfirmRemove();

        await waitFor(() => expect(onMembersChange).toHaveBeenCalledTimes(1));
        expect(screen.queryByText('Failed to remove member')).toBeNull();
    });
});
