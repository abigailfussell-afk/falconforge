import type { AttestationType } from '../types';

/**
 * Current versions of the legal documents. Raising one requires re-acceptance.
 *
 * THIS IS THE ONLY PLACE A VERSION IS WRITTEN. `LegalPage` reads the number from here rather than
 * stating its own, because a page that carried its own version could display 2.0 while the app
 * still accepted 1.0 — and both numbers would look correct in isolation.
 *
 * Sprint 6 rewrote the three documents substantively (no uptime guarantee, discontinuation at any
 * time, licence and seat terms, discretionary refunds, the COPPA posture spelled out), so the
 * three that have prose behind them go to 2.0. Since Sprint 6 the previous acceptance is KEPT
 * rather than overwritten — `user_attestations`' unique key includes `version` — so raising a
 * number no longer destroys the record of what somebody agreed to before.
 *
 * The bare age and acknowledgement types stay at 1.0 deliberately: nothing about what they assert
 * has changed, and forcing re-acceptance of "I am 18 or over" because the ToS was reworded trains
 * people to click through without reading.
 *
 * WHY IT LIVES IN ITS OWN FILE. It used to sit in `attestations.ts`, which imports the Supabase
 * client and therefore `import.meta.env` — so nothing outside Vite could read it. The e2e pack
 * creates accounts through the admin API and has to send `privacy_version` in the signup metadata
 * exactly as the real form does (`handle_new_user` records the consent at the version it is
 * told), and its only options were to import a module that throws in Node or to write the number
 * down a second time. A second copy of a version number is the defect migration
 * `20260821000000_signup_attestation_version.sql` exists because of, so the constant moved
 * instead. `attestations.ts` re-exports it, so every existing importer is unaffected.
 */
export const ATTESTATION_VERSIONS: Record<AttestationType, string> = {
    terms: '2.0',
    privacy: '2.0',
    community_guidelines: '2.0',
    age_18_plus: '1.0',
    coppa_responsibility: '1.0',
    billing_acknowledgement: '1.0',
    age_13_plus: '1.0',
    // Combined types, whose text is the documents above — so they move with them.
    privacy_and_guidelines: '2.0',
    coach_terms: '2.0',
};
