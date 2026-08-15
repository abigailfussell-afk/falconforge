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

// Attestations required during signup (for all users 13+)
export const SIGNUP_REQUIRED_ATTESTATIONS: AttestationType[] = [
    'privacy_and_guidelines',
];

// Attestations required for coaches creating a team
export const COACH_REQUIRED_ATTESTATIONS: AttestationType[] = [
    'coach_terms',
];

// Attestations required for non-coaches joining a team (none - collected at signup now)
export const MEMBER_REQUIRED_ATTESTATIONS: AttestationType[] = [];

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

