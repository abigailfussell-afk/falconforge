/**
 * Attestations Module
 * Manages legal acknowledgements for Terms, Privacy Policy, Community Guidelines, etc.
 */

import { supabase, isSupabaseConfigured } from './supabase';
import type { AttestationType, GuardianConsentType } from '../types';
import { ATTESTATION_VERSIONS } from './attestation-versions';

/*
 * `ATTESTATION_VERSIONS` lives in its own module and is re-exported here.
 *
 * It has to be readable outside Vite: the e2e pack creates accounts through the admin API and
 * must send `privacy_version` in the signup metadata exactly as the real form does, and this
 * file imports the Supabase client, which reads `import.meta.env` and throws in Node. Writing
 * the number down a second time is the defect `20260821000000_signup_attestation_version.sql`
 * exists because of, so the constant moved rather than being copied. Every existing importer
 * reads it from here unchanged.
 */
export { ATTESTATION_VERSIONS } from './attestation-versions';

/**
 * Current versions of what a GUARDIAN consents to, on a child's behalf.
 *
 * Three of the four ARE the documents above, and are read from them rather than restated. That
 * is not tidiness: `docs/failure-modes.md` section 1 is "one concept implemented N times, then
 * drifting apart", and a second table of version numbers is that defect pre-assembled — the
 * next legal rewrite would raise `ATTESTATION_VERSIONS.terms` and leave every guardian recorded
 * against the old text, which is precisely what happened between Sprint 3 and Sprint 6 when the
 * number was duplicated into a database trigger.
 *
 * `coppa_data_collection` is the one with no equivalent: it is the guardian's consent to
 * FalconForge holding their child's data at all, which no account-holder gives for themselves.
 * It carries its own number because it has its own text.
 */
export const GUARDIAN_CONSENT_VERSIONS: Record<GuardianConsentType, string> = {
    coppa_data_collection: '1.0',
    terms: ATTESTATION_VERSIONS.terms,
    privacy: ATTESTATION_VERSIONS.privacy,
    community_guidelines: ATTESTATION_VERSIONS.community_guidelines,
};

/**
 * What a guardian must consent to before a child can be added.
 *
 * All four, collected in one sitting on the "add a child" screen. This is the whole reason the
 * guardian creates the profile rather than the coach (plan section 3): consent and the child's
 * data arrive together, so there is no window in which a child's name is held without a lawful
 * basis and nothing to chase by email afterwards.
 */
export const GUARDIAN_REQUIRED_CONSENTS: GuardianConsentType[] = [
    'coppa_data_collection',
    'terms',
    'privacy',
    'community_guidelines',
];

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
/**
 * WHERE "LATER" IS REMEMBERED (WALK-A-07).
 *
 * "Later" used to be a `useState` flag, so it lasted exactly as long as the page did. The
 * walkthrough hit the prompt on EVERY navigation and reload — 60+ times in one run, across
 * eight scripts — and had to add a `dismissLater()` call after every `page.goto`. On a phone
 * that is the modal returning on every cold start and every PWA resume, which is precisely
 * the moment a student is scanning a QR code to check in.
 *
 * Keyed by user id, because a shared team laptop must not snooze the next person; and
 * carrying the VERSIONS that were dismissed, because "please accept 2.0" answered with
 * "later" says nothing about 3.0. A rewrite therefore asks again immediately rather than
 * being silently covered by an old snooze.
 */
const SNOOZE_KEY = 'falconforge-attestation-snooze';

/** How long "Later" lasts. A week: long enough to cover a competition and the travel around it. */
export const ATTESTATION_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

interface AttestationSnooze {
    userId: string;
    /** The exact set of documents-and-versions that were dismissed. */
    signature: string;
    until: number;
}

/** What was asked, as one comparable string. */
export function attestationSignature(types: AttestationType[]): string {
    return [...types]
        .sort()
        .map((type) => `${type}@${ATTESTATION_VERSIONS[type]}`)
        .join(',');
}

/** Record that this user asked to be reminded later about exactly these documents. */
export function snoozeAttestations(userId: string, types: AttestationType[], now = Date.now()): void {
    try {
        const record: AttestationSnooze = {
            userId,
            signature: attestationSignature(types),
            until: now + ATTESTATION_SNOOZE_MS,
        };
        localStorage.setItem(SNOOZE_KEY, JSON.stringify(record));
    } catch {
        /* Private mode / storage disabled: the prompt simply behaves as it did before. */
    }
}

/**
 * Is this exact ask still snoozed for this user?
 *
 * Returns false for a different user, a different set of documents, a different version, an
 * expired window, or anything unparseable — every "we are not sure" answer shows the prompt,
 * because failing towards asking is the right direction for a consent refresh.
 */
export function isAttestationSnoozed(
    userId: string,
    types: AttestationType[],
    now = Date.now(),
): boolean {
    try {
        const raw = localStorage.getItem(SNOOZE_KEY);
        if (!raw) return false;
        const record = JSON.parse(raw) as Partial<AttestationSnooze>;
        return (
            record.userId === userId &&
            record.signature === attestationSignature(types) &&
            typeof record.until === 'number' &&
            record.until > now
        );
    } catch {
        return false;
    }
}

/** Drop the snooze — on sign-out, and once the documents are actually accepted. */
export function clearAttestationSnooze(): void {
    try {
        localStorage.removeItem(SNOOZE_KEY);
    } catch {
        /* as above */
    }
}

export async function getOutdatedAttestations(
    types: AttestationType[],
    userId: string,
): Promise<AttestationType[]> {
    /*
     * THE USER IS PASSED IN, NOT FETCHED.
     *
     * The first draft called `supabase.auth.getUser()` here, which is a second round-trip for
     * something every caller already has from `useAuth()` — and it made this function unusable
     * from a mounted effect in any test that mocks the Supabase client without stubbing `auth`.
     * That produced 44 warnings across `Dashboard.test.tsx` before it produced a single useful
     * signal. `recordAttestation` still fetches, because it is called from flows that do not
     * have the auth context to hand; this one always does.
     *
     * EVERY FAILURE PATH RETURNS `[]`, NOT `types`.
     *
     * Also from the first draft: returning `types` when Supabase was unconfigured meant "assume
     * everything needs re-accepting", which is fail-CLOSED and wrong twice over — in demo mode it
     * prompts somebody with no account to accept terms that cannot be recorded, and on a flaky
     * connection it produces a dialog that reappears on every failed read, a nag with no way to
     * comply. "We cannot tell" is not "you are out of date".
     */
    if (!supabase || !isSupabaseConfigured() || types.length === 0 || !userId) return [];

    try {
        const { data, error } = await supabase
            .from('user_attestations')
            .select('attestation_type, version')
            .eq('user_id', userId)
            .in('attestation_type', types);

        if (error) {
            console.warn('Could not read attestations; assuming they are current:', error.message);
            return [];
        }

        const accepted = new Set(
            (data ?? []).map((row) => `${row.attestation_type}@${row.version}`),
        );
        return types.filter((type) => !accepted.has(`${type}@${ATTESTATION_VERSIONS[type]}`));
    } catch (err) {
        // Called from a mounted effect, so an unguarded throw here becomes an unhandled rejection
        // rather than a handled failure.
        console.warn('Could not read attestations; assuming they are current:', err);
        return [];
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

