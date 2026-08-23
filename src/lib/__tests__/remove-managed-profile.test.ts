/**
 * SEC-11 — a guardian removing one child, and the cascade the CLIENT has to mirror.
 *
 * The Privacy Policy says a guardian can ask us to delete everything associated with their child.
 * On the server that is one statement — `DELETE FROM managed_profiles` — because the schema does
 * the rest: `guardian_consents` cascades, and so does the child's `team_members` row, which
 * carries the GUARDIAN's `user_id` and therefore cannot be found by looking for the child's.
 *
 * WHAT THESE TESTS ARE FOR. The one-line version of this feature removes the profile from the
 * store and queues a delete, and it looks right in every screenshot: the child's card disappears.
 * What stays behind is their `team_members` row and their attendance, still in the local store,
 * still rendering into every count that reads from them — until the next full pull, which offline
 * may be days away. That is `docs/failure-modes.md` §9, the record's identity outliving the
 * record, and no assertion about `managedProfiles` alone would notice it.
 *
 * The queue side matters just as much and in the other direction: the cascade is the SERVER's
 * job, so this must queue exactly ONE write. Queueing the consents and the membership too is
 * three writes racing to delete rows the first one already took — the same act expressed twice
 * (§1), which is this project's most frequent defect class.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/lib/store';
import { db } from '@/lib/offline-db';
import type { ManagedProfile, TeamMember } from '@/types';

const GUARDIAN = 'guardian-1';
const TEAM = 'team-1';

const profile = (id: string, name: string): ManagedProfile => ({
    id,
    guardianUserId: GUARDIAN,
    fullName: name,
    notes: '',
    promotedToUserId: null,
    promotedAt: null,
    promotionCode: '',
    createdAt: 1000,
});

const member = (id: string, managedProfileId: string): TeamMember =>
    ({
        id,
        teamId: TEAM,
        userId: GUARDIAN,
        managedProfileId,
        role: 'student',
        status: 'approved',
        seatAssigned: true,
        fullName: 'child',
        email: null,
        avatarUrl: null,
        joinedAt: 1000,
    }) as unknown as TeamMember;

beforeEach(async () => {
    await db.syncQueue.clear();
    useAppStore.setState({
        currentTeamId: TEAM,
        managedProfiles: [profile('child-a', 'Robin'), profile('child-b', 'Sam')],
        guardianConsents: [
            { id: 'c-a', managedProfileId: 'child-a', guardianUserId: GUARDIAN, consentType: 'coppa', version: '1.0', consentedAt: 1000 },
            { id: 'c-b', managedProfileId: 'child-b', guardianUserId: GUARDIAN, consentType: 'coppa', version: '1.0', consentedAt: 1000 },
        ] as never,
        teamMembers: [member('m-a', 'child-a'), member('m-b', 'child-b')],
        meetingAttendance: [
            { id: 'a-1', meetingId: 'meet-1', teamMemberId: 'm-a', teamId: TEAM, status: 'present' },
            { id: 'a-2', meetingId: 'meet-1', teamMemberId: 'm-b', teamId: TEAM, status: 'present' },
        ] as never,
    });
});

describe('removeManagedProfile', () => {
    it('removes the child and everything that hangs off them', async () => {
        useAppStore.getState().removeManagedProfile('child-a');
        const state = useAppStore.getState();

        expect(state.managedProfiles.map((p) => p.id)).toEqual(['child-b']);
        expect(state.guardianConsents.map((c) => c.id)).toEqual(['c-b']);
        /*
         * The two that a profile-only removal leaves behind. Their child's name is gone from the
         * screen while their place on the team and their attendance keep counting.
         */
        expect(state.teamMembers.map((m) => m.id)).toEqual(['m-b']);
        expect(state.meetingAttendance.map((a) => a.id)).toEqual(['a-2']);
    });

    /*
     * THE CONTROL, and it is doing real work rather than making up a number. Every assertion above
     * is satisfied by `set({ managedProfiles: [], guardianConsents: [], teamMembers: [], ... })` —
     * a removal that empties everything passes them all and takes the OTHER child with it. This is
     * the sibling case the runbook calls out by name.
     */
    it('leaves their sibling completely alone', async () => {
        useAppStore.getState().removeManagedProfile('child-a');
        const state = useAppStore.getState();

        expect(state.managedProfiles.find((p) => p.id === 'child-b')).toBeDefined();
        expect(state.guardianConsents.find((c) => c.id === 'c-b')).toBeDefined();
        expect(state.teamMembers.find((m) => m.id === 'm-b')).toBeDefined();
        expect(state.meetingAttendance.find((a) => a.id === 'a-2')).toBeDefined();
    });

    it('queues exactly one write, because the cascade is the database\'s job', async () => {
        useAppStore.getState().removeManagedProfile('child-a');
        // `queueForSync` is fired and not awaited by the action (every slice does it that way);
        // let the microtask run before reading the queue.
        await new Promise((resolve) => setTimeout(resolve, 0));

        const queued = await db.syncQueue.toArray();
        expect(queued).toHaveLength(1);
        expect(queued[0].tableName).toBe('managed_profiles');
        expect(queued[0].operation).toBe('delete');
        expect((queued[0].data as { id: string }).id).toBe('child-a');
    });

    it('does nothing at all for a child who is not there', async () => {
        useAppStore.getState().removeManagedProfile('nobody');
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(useAppStore.getState().managedProfiles).toHaveLength(2);
        expect(await db.syncQueue.toArray()).toHaveLength(0);
    });
});
