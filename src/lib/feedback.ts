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

export const FEEDBACK_EMAIL = 'jkfussell@gmail.com';

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
