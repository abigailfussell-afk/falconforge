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
};

// Attestations required for coaches creating a team
export const COACH_REQUIRED_ATTESTATIONS: AttestationType[] = [
    'age_18_plus',
    'terms',
    'billing_acknowledgement',
    'coppa_responsibility',
];

// Attestations required for non-coaches joining a team
export const MEMBER_REQUIRED_ATTESTATIONS: AttestationType[] = [
    'privacy',
    'community_guidelines',
    'age_13_plus',
];

/**
 * Check which attestations a user is missing
 */
export async function getMissingAttestations(
    userId: string,
    requiredTypes: AttestationType[]
): Promise<AttestationType[]> {
    if (!supabase || !isSupabaseConfigured()) {
        console.warn('Supabase not configured, cannot check attestations');
        return [];
    }

    try {
        const { data: existingAttestations, error } = await supabase
            .from('user_attestations')
            .select('attestation_type, version')
            .eq('user_id', userId) as { data: { attestation_type: string; version: string }[] | null; error: any };

        if (error) {
            console.error('Error fetching attestations:', error);
            return requiredTypes; // Assume all missing on error
        }

        const missing: AttestationType[] = [];

        for (const type of requiredTypes) {
            const existing = existingAttestations?.find(
                (a) => a.attestation_type === type
            );

            // Missing if no record or version is outdated
            if (!existing || existing.version !== ATTESTATION_VERSIONS[type]) {
                missing.push(type);
            }
        }

        return missing;
    } catch (err) {
        console.error('Exception checking attestations:', err);
        return requiredTypes;
    }
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

        // Upsert the attestation (insert or update on conflict)
        const { error } = await supabase
            .from('user_attestations')
            .upsert({
                user_id: user.id,
                attestation_type: attestationType,
                version: ATTESTATION_VERSIONS[attestationType],
                attested_at: new Date().toISOString(),
            } as any, {
                onConflict: 'user_id,attestation_type',
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

/**
 * Record multiple attestations at once
 */
export async function recordAttestations(
    attestationTypes: AttestationType[]
): Promise<{ success: boolean; error?: string }> {
    for (const type of attestationTypes) {
        const result = await recordAttestation(type);
        if (!result.success) {
            return result;
        }
    }
    return { success: true };
}

/**
 * Check if a user has a specific attestation (current version)
 */
export async function hasAttestation(
    userId: string,
    attestationType: AttestationType
): Promise<boolean> {
    const missing = await getMissingAttestations(userId, [attestationType]);
    return missing.length === 0;
}

/**
 * Check if user has all coach attestations
 */
export async function hasCoachAttestations(userId: string): Promise<boolean> {
    const missing = await getMissingAttestations(userId, COACH_REQUIRED_ATTESTATIONS);
    return missing.length === 0;
}

/**
 * Check if user has all member attestations
 */
export async function hasMemberAttestations(userId: string): Promise<boolean> {
    const missing = await getMissingAttestations(userId, MEMBER_REQUIRED_ATTESTATIONS);
    return missing.length === 0;
}
