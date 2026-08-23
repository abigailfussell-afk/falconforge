import type { AttestationType } from '../types';
import versions from './attestation-versions.json' with { type: 'json' };

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
 *
 * WHY THE VALUES ARE IN JSON NEXT DOOR, since Sprint 10. Moving the module was enough for the
 * e2e pack, which is TypeScript. It was not enough for `scripts/seed-review-states.mjs`, which
 * plain `node` runs: it could not import a `.ts` file at all, so it sent no `privacy_version` at
 * signup and hardcoded `'2.0'` where it wrote attestations directly. The trigger's fallback is
 * `'1.0'`, which is out of date — so every seeded review account met "We've updated our legal
 * documents" on its first screen, which is this module's own story reaching a third consumer.
 *
 * `.json` is the one format Vite, `tsc`, Playwright's loader and bare Node all read without a
 * build step or a version floor. The reasoning stays in this comment because JSON cannot hold
 * one — so raise a number HERE, in the file with the argument in it, and the JSON follows.
 *
 * `with { type: 'json' }` IS REQUIRED, and the Gate does not say so. Without it `tsc --noEmit`
 * passes, `vite build` passes and the whole unit suite passes, while every Playwright spec dies
 * on `Module … needs an import attribute of "type: json"` — its loader emits real ESM and Node
 * enforces the attribute. Found by running the e2e pack after a green Gate, which is
 * `docs/failure-modes.md` §0 in one line.
 *
 * The annotation below is load-bearing rather than decoration: `Record<AttestationType, string>`
 * is what makes `tsc` refuse a JSON file that has LOST a key — including one lost by being
 * misspelt, since the intended key then goes missing. Checked by removing `coach_terms` and
 * watching `tsc` fail with TS2741. It does not catch a purely EXTRA key: `Record` tolerates
 * excess properties from a non-literal source, and an extra key nothing reads is inert.
 */
export const ATTESTATION_VERSIONS: Record<AttestationType, string> = versions;
