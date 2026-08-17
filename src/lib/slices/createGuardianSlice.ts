import type { ManagedProfile, GuardianConsent, GuardianConsentType } from '../../types';
import { generateId, queueForSync } from '../offline-db';
import { GUARDIAN_CONSENT_VERSIONS } from '../attestations';
import type { SliceCreator } from './types';

/**
 * A guardian's children, and the consents they have given for each.
 *
 * WHOSE DATA THIS IS
 *
 * Not the team's. A `managed_profiles` row belongs to the guardian who created it, outlives any
 * one team and any one season, and is retained even after the child is promoted to their own
 * login — as the record of why that child was rostered. Everything else in `slices/` is scoped
 * to the open team; this is scoped to the signed-in user, which is why the registry had to grow
 * an explicit `scope` (see `EntityScope`) rather than these tables being quietly added to a pull
 * that filters on `team_id`.
 *
 * WHAT IS OFFLINE HERE
 *
 * Everything, through the ordinary queue. The hand-off's own framing was that "a guardian
 * managing profiles is doing something inherently online-ish", and that is true of the common
 * case — but the expensive case is a parent standing in a school car park at the first meeting
 * of the season, on the venue WiFi that this whole application exists to survive, typing their
 * child's name in. If that write is lost, the child is not on the roster and nobody finds out
 * until the coach takes attendance.
 *
 * WHAT IS NOT HERE
 *
 * Anything that renders the team as the child. There is no act-as mode (plan section 3): a
 * guardian sees their children and never becomes one. Joining a team on a child's behalf writes
 * `team_members`, which is server-side through `join_team_with_invite` like every other join.
 */
export interface GuardianSlice {
    managedProfiles: ManagedProfile[];
    guardianConsents: GuardianConsent[];

    /**
     * Add a child, with the consents the guardian gave in the same sitting.
     *
     * The consents are NOT optional and the signature says so. A profile with no
     * `coppa_data_collection` consent is a child's name held with no lawful basis for holding
     * it, and the whole point of the guardian-creates-the-profile decision (plan section 3) is
     * that consent and the child's data arrive together, so there is nothing to chase.
     *
     * Returns the new profile's id.
     */
    addManagedProfile: (
        input: { fullName: string; notes?: string },
        guardianUserId: string,
        consentTypes: GuardianConsentType[],
    ) => string;

    updateManagedProfile: (id: string, updates: { fullName?: string; notes?: string }) => void;

    setManagedProfiles: (profiles: ManagedProfile[]) => void;
    setGuardianConsents: (consents: GuardianConsent[]) => void;
}

export const guardianInitialState = {
    managedProfiles: [] as ManagedProfile[],
    guardianConsents: [] as GuardianConsent[],
};

export const createGuardianSlice: SliceCreator<GuardianSlice> = (set, get) => ({
    ...guardianInitialState,

    addManagedProfile: (input, guardianUserId, consentTypes) => {
        const fullName = input.fullName.trim();
        // The database has a not-blank CHECK on `full_name`, so an empty name is a push that
        // could only ever fail its constraint and land in the dead-letter store — the C6 shape.
        // The form disables its submit for the same reason; this is the second line.
        if (!fullName || !guardianUserId) {
            console.warn('[store] addManagedProfile ignored: needs a name and a guardian');
            return '';
        }

        const profile: ManagedProfile = {
            id: generateId(),
            guardianUserId,
            fullName,
            notes: input.notes?.trim() || '',
            // No promotion is offered for a child who has just been added. The column is
            // server-written only (see the registry's `serverAssigned`), so this is the local
            // mirror of "NULL", not a value being sent anywhere.
            promotionCode: '',
        };

        const consents: GuardianConsent[] = consentTypes.map((consentType) => ({
            id: generateId(),
            managedProfileId: profile.id,
            guardianUserId,
            consentType,
            /*
             * THE CLIENT OWNS THE VERSION, and this is the line that makes that true.
             *
             * `GUARDIAN_CONSENT_VERSIONS` is the only place these numbers are written down,
             * and three of its four entries are read straight out of `ATTESTATION_VERSIONS`
             * so the shared documents cannot drift. The database's DEFAULT of '1.0' was
             * dropped in Sprint 9 precisely so this cannot be skipped: the column is NOT NULL
             * with no default, so a consent that does not say which version it displayed
             * fails rather than inventing one.
             *
             * A `?? '1.0'` here would put the defect back one layer up, which is exactly how
             * it got into `handle_new_user` in the first place.
             */
            version: GUARDIAN_CONSENT_VERSIONS[consentType],
        }));

        set((s) => ({
            managedProfiles: [...s.managedProfiles, profile],
            guardianConsents: [...s.guardianConsents, ...consents],
        }));

        /*
         * Profile first, then consents. `guardian_consents` has a composite foreign key into
         * `managed_profiles(id, guardian_user_id)`, so a consent that reaches the server before
         * its profile is refused — five retries and then the dead-letter store, for a child who
         * looks correctly added on this device.
         *
         * The queue drains in insertion order by timestamp (B1), and `queueForSync` allocates
         * that timestamp before entering its Dexie transaction (B1, the second time), so
         * queueing in this order is enough — and it is the ONLY thing that makes the push
         * safe. The drain does not consult the registry's array order, so reversing these two
         * statements is sufficient to strand every consent in the queue. Verified by doing it:
         * `guardian-sync.db.test.ts` goes red with two items still queued after a full drain.
         */
        queueForSync('managed_profiles', profile.id, 'create', profile).catch(console.error);
        for (const consent of consents) {
            queueForSync('guardian_consents', consent.id, 'create', consent).catch(console.error);
        }

        return profile.id;
    },

    updateManagedProfile: (id, updates) => {
        const existing = get().managedProfiles.find((p) => p.id === id);
        if (!existing) return;

        const fullName = updates.fullName?.trim();
        if (updates.fullName !== undefined && !fullName) {
            console.warn('[store] updateManagedProfile ignored: a child must have a name');
            return;
        }

        const next: ManagedProfile = {
            ...existing,
            ...(fullName ? { fullName } : {}),
            ...(updates.notes !== undefined ? { notes: updates.notes.trim() } : {}),
        };

        set((s) => ({ managedProfiles: s.managedProfiles.map((p) => (p.id === id ? next : p)) }));
        queueForSync('managed_profiles', id, 'update', next).catch(console.error);
    },

    setManagedProfiles: (managedProfiles) => set({ managedProfiles }),
    setGuardianConsents: (guardianConsents) => set({ guardianConsents }),
});
