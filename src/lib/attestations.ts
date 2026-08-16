/**
 * Attestations Module
 * Manages legal acknowledgements for Terms, Privacy Policy, Community Guidelines, etc.
 */

import { supabase, isSupabaseConfigured } from './supabase';
import type { AttestationType } from '../types';

// Current versions of legal documents
// Increment these when documents are updated to require re-attestation
export const ATTESTATION_VERSIONS: Record<AttestationType, string> = {
    terms: '1.0',
    privacy: '1.0',
    community_guidelines: '1.0',
    age_18_plus: '1.0',
    coppa_responsibility: '1.0',
    billing_acknowledgement: '1.0',
    age_13_plus: '1.0',
    privacy_and_guidelines: '1.0',  // New combined type
    coach_terms: '1.0',              // New combined type
};

/**
 * Attestations required during signup, for every account 13+.
 *
 * Consumed by `Login`'s sign-up path. Under-13s never reach it: they cannot hold an account at
 * all under COPPA, and a guardian consents on their behalf through `guardian_consents`, which is
 * a different record with a different subject.
 */
export const SIGNUP_REQUIRED_ATTESTATIONS: AttestationType[] = [
    'privacy_and_guidelines',
];

/** Attestations required to create a team. Consumed by `CreateTeam`. */
export const COACH_REQUIRED_ATTESTATIONS: AttestationType[] = [
    'coach_terms',
];

/**
 * Attestations required to ACCEPT the admin role on an existing team.
 *
 * `enforce_member_role_eligibility` accepts `terms` as the transfer equivalent of the
 * `coach_terms` bundle that the create-team flow records — the trigger's own comment says so.
 * This is the one that had no way of being written before Sprint 6: the gate existed from
 * Sprint 3 and no code path ever satisfied it for a member who had not created a team.
 */
export const ADMIN_TRANSFER_REQUIRED_ATTESTATIONS: AttestationType[] = [
    'terms',
];

/**
 * Attestations required for a member joining an existing team: none.
 *
 * Empty on purpose rather than by omission — signup already collected privacy and guidelines,
 * and asking again at join time would be a second consent for the same thing. Kept as a named
 * constant so the join flow states that it asks for nothing, instead of the question never
 * having been considered.
 */
export const MEMBER_REQUIRED_ATTESTATIONS: AttestationType[] = [];

/**
 * Has this user accepted the CURRENT version of everything in `types`?
 *
 * The version split is deliberate and documented in the Sprint 6 migration: the DATABASE asks
 * only "have they accepted these terms at all" (consent identity), because the current version
 * number is a client artefact — `ATTESTATION_VERSIONS` — and duplicating it in a trigger would
 * create two sources of truth that drift on the next legal rewrite. Whether an acceptance is
 * CURRENT is this function's question (consent freshness).
 *
 * Returns the types still needing acceptance, so a caller can prompt for exactly those.
 */
export async function getOutdatedAttestations(
    types: AttestationType[],
): Promise<AttestationType[]> {
    if (!supabase || !isSupabaseConfigured() || types.length === 0) return types;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return types;

    const { data, error } = await supabase
        .from('user_attestations')
        .select('attestation_type, version')
        .eq('user_id', user.id)
        .in('attestation_type', types);

    // A read failure must not force somebody to re-accept terms they have already agreed to —
    // that is a nag loop for anyone with a flaky connection. Treat "cannot tell" as "fine".
    if (error) {
        console.warn('Could not read attestations; assuming they are current:', error.message);
        return [];
    }

    const accepted = new Set(
        (data ?? []).map((row) => `${row.attestation_type}@${row.version}`),
    );
    return types.filter((type) => !accepted.has(`${type}@${ATTESTATION_VERSIONS[type]}`));
}

/**
 * Record an attestation for the current user
 */
export async function recordAttestation(
    attestationType: AttestationType
): Promise<{ success: boolean; error?: string }> {
    if (!supabase || !isSupabaseConfigured()) {
        return { success: false, error: 'Supabase not configured' };
    }

    try {
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        /*
         * The conflict target names VERSION as well, and must.
         *
         * Sprint 6 widened the unique key to (user_id, attestation_type, version) so that
         * accepting a new version keeps the record of the previous acceptance instead of
         * overwriting it — the one question a legal attestation exists to answer. An upsert
         * naming only two of the three columns matches no unique index and errors outright,
         * so this is not a cosmetic change to keep in step with the migration.
         *
         * Still an upsert rather than an insert: re-accepting the SAME version is idempotent
         * (a double-click, a retried request) and should not surface as a duplicate-key error.
         */
        const { error } = await supabase
            .from('user_attestations')
            .upsert({
                user_id: user.id,
                attestation_type: attestationType,
                version: ATTESTATION_VERSIONS[attestationType],
                attested_at: new Date().toISOString(),
            } as any, {
                onConflict: 'user_id,attestation_type,version',
            });

        if (error) {
            console.error('Error recording attestation:', error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (err: any) {
        console.error('Exception recording attestation:', err);
        return { success: false, error: err.message };
    }
}

