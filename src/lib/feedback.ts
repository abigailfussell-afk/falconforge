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
 * WHAT THE MESSAGE CARRIES, AND WHY (OPS-03, OPS-05)
 *
 * It used to carry the reporter's prose and nothing else. `BUILD_ID` was `0.1.0` — a package
 * version unchanged since January, identical across eighteen production deploys — so the subject
 * line identified no build at all, under a comment claiming it attached the report to a version.
 *
 * The client already knows everything below; none of it needs a backend, and none of it is more
 * than the email itself already reveals. It is the difference between "it's broken" and a
 * reproduction:
 *
 *   - the build, now the commit SHA (OPS-03);
 *   - the route, because "the app crashed" and "the board crashed" are different bugs;
 *   - whether the device thought it was online, AND whether the server was actually answering —
 *     the two are not the same question and SYNC-07 exists because they were conflated;
 *   - how much work is queued or parked, which is the first thing to ask when somebody says
 *     their scouting never uploaded;
 *   - the team id, so the row can be found without a name-matching game over email.
 *
 * DELIBERATELY NOT INCLUDED: the user's name or email (the message carries them already), any
 * team member's name, and anything from a task, report or checklist. A support address is not a
 * place minors' data should arrive by accident.
 */
import { BUILD_LABEL } from './build-id';
import { getServerReachability, describeLastContact } from './server-reachability';

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

/** What the app knows about itself when somebody presses "Send feedback". */
export interface FeedbackContext {
    /** The hash route, e.g. `#/app/board`. */
    route: string;
    /** `navigator.onLine` — what the DEVICE thinks. */
    online: boolean;
    /** Whether the server has actually been answering. See SYNC-07. */
    server: string;
    /** Changes queued for a push. */
    pending: number;
    /** Changes parked in the dead-letter store. */
    failed: number;
    /** The open team, if any. An id, never a name. */
    teamId: string | null;
}

/**
 * Gather it, never throwing.
 *
 * This runs while somebody is trying to report that something is broken. A context-gatherer
 * that can itself fail turns "the feedback link did nothing" into the second bug of the
 * evening, so every field degrades to a string rather than an exception.
 */
export function collectFeedbackContext(
    counts: { pending: number; failed: number } = { pending: 0, failed: 0 },
    teamId: string | null = null,
): FeedbackContext {
    let route = 'unknown';
    let online = false;
    try {
        route = window.location.hash || '#/';
        online = navigator.onLine;
    } catch {
        /* not a browser */
    }

    let server = 'unknown';
    try {
        const reachability = getServerReachability();
        if (reachability.reachable === null) server = 'not contacted this session';
        else if (reachability.reachable) server = `reachable (last answered ${describeLastContact(reachability)})`;
        else server = 'NOT reachable';
    } catch {
        /* as above */
    }

    return { route, online, server, pending: counts.pending, failed: counts.failed, teamId };
}

/** The lines appended under the reporter's own words. */
function contextLines(context: FeedbackContext): string[] {
    return [
        '',
        '— — — — —',
        'Sent from FalconForge. The lines below help find the problem;',
        'they contain no names and nothing from your team’s work.',
        `build: ${BUILD_LABEL}`,
        `screen: ${context.route}`,
        `device online: ${context.online ? 'yes' : 'no'}`,
        `server: ${context.server}`,
        `unsent changes: ${context.pending} queued, ${context.failed} parked`,
        `team: ${context.teamId ?? 'none open'}`,
    ];
}

/**
 * The `mailto:` for a given moment.
 *
 * A function rather than the constant it used to be, because every field above is a fact about
 * NOW — the route, the queue depth, whether the server is answering. A constant computed at
 * module load would report the state the app was in when it started, which for a PWA that is
 * never reloaded could be days ago.
 */
export function feedbackMailto(context: FeedbackContext): string {
    const body = [
        'What happened:',
        '',
        '',
        'What you expected instead:',
        '',
        '',
        'Anything else:',
        '',
        '',
        ...contextLines(context),
    ].join('\n');

    return (
        `mailto:${FEEDBACK_EMAIL}` +
        `?subject=${encodeURIComponent(`FalconForge beta feedback (${BUILD_LABEL})`)}` +
        `&body=${encodeURIComponent(body)}`
    );
}
