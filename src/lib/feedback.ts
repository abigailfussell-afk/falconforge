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
 * A ROLE ADDRESS, NOT A PERSON'S, AND IT HAS TO EXIST BEFORE THIS DEPLOYS.
 *
 * This string is compiled into the bundle a beta coach installs, and installed PWAs are not
 * reloaded on a schedule -- so whatever address ships first is the one people keep writing to
 * long after it is changed here. Moving it after beta means either running the old inbox
 * indefinitely or losing the reports sent to it, which is why it moves now rather than later.
 *
 * `support@falcon-forge.com` must be a working alias forwarding to Kevin's inbox before this
 * reaches production. If it is not, feedback does not bounce -- it is accepted by a domain
 * that drops it, which is the silent-failure shape rather than the loud one.
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
