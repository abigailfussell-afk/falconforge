/**
 * Where beta feedback goes.
 *
 * A `mailto:` rather than an in-app form, and that is a considered choice rather than a corner
 * cut. A form needs somewhere to POST, and the only backend is Supabase — so it would mean a
 * table that anonymous or any authenticated user may INSERT into, which is an unauthenticated
 * write endpoint on the database holding every team's data. Default-deny should not acquire one
 * of those to save a coach opening their mail client. For a beta of a handful of teams, this is
 * the right amount of machinery, and it has the property a form does not: the reporter's address
 * comes with it, so somebody can actually reply.
 *
 * The build id rides along in the subject so a report is attached to a version rather than to
 * "last Tuesday". `BUILD_ID` is Vite's mode plus the package version — not a git SHA, because
 * the SHA is not available to the client at build time without wiring it through CI, and a
 * wrong-looking SHA is worse than an honest coarse one.
 */
const VERSION = '0.1.0';
const BUILD_ID = `${VERSION}${import.meta.env.PROD ? '' : '-dev'}`;

/*
 * A ROLE ADDRESS, NOT A PERSON'S.
 *
 * This string is compiled into the bundle a beta coach installs, and installed PWAs are not
 * reloaded on a schedule -- so whatever address ships first is the one people keep writing to
 * long after it is changed here. That is why it moved before beta rather than after.
 *
 * LIVE AND TESTED END TO END, 2026-08-22. Mail to this address is received by Resend (root MX)
 * and relayed to a real inbox by `supabase/functions/forward-support-email`, which is the
 * project's only Edge Function. It shipped for four days pointing at a domain with no MX
 * record at all, which was a deliberate call and the wrong-looking half of it: an address that
 * cannot receive does not bounce visibly to the person writing, it just never arrives.
 *
 * If this address ever stops working the symptom is silence, not an error, so the check worth
 * repeating is the one in `docs/beta-ops.md`: send a real message from outside and confirm it
 * lands. A 200 in the function logs proves the webhook was accepted, never that mail arrived.
 */
export const FEEDBACK_EMAIL = 'support@falcon-forge.com';

export const FEEDBACK_MAILTO =
    `mailto:${FEEDBACK_EMAIL}` +
    `?subject=${encodeURIComponent(`FalconForge beta feedback (${BUILD_ID})`)}` +
    `&body=${encodeURIComponent(
        [
            'What happened:',
            '',
            '',
            'What you expected instead:',
            '',
            '',
            'Anything else (which screen, whether you were online):',
            '',
            '',
            `— sent from FalconForge ${BUILD_ID}`,
        ].join('\n'),
    )}`;
