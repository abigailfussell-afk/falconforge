/**
 * What a beta "it's broken" email actually carries (OPS-03, OPS-05).
 *
 * Before this it carried the reporter's prose and nothing else. The subject said `0.1.0` — a
 * package version unchanged since January, identical across eighteen production deploys — under
 * a comment claiming the id attached the report to a build. OPS-05's summary is exact: what
 * Kevin could see was "the email text, and — if he asks for it — a console screenshot".
 *
 * The other half of these assertions is what must NOT be in it. A support address is not a place
 * minors' data should arrive by accident, and a context-gatherer is the kind of thing that
 * quietly grows a field.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { collectFeedbackContext, feedbackMailto, FEEDBACK_EMAIL } from '../feedback';
import { recordServerContact, resetServerReachability } from '../server-reachability';

/** The decoded body of a mailto, which is what somebody's mail client shows them. */
function bodyOf(mailto: string): string {
    const query = mailto.slice(mailto.indexOf('?') + 1);
    return decodeURIComponent(new URLSearchParams(query).get('body') ?? '');
}

function subjectOf(mailto: string): string {
    const query = mailto.slice(mailto.indexOf('?') + 1);
    return decodeURIComponent(new URLSearchParams(query).get('subject') ?? '');
}

beforeEach(() => {
    resetServerReachability();
    window.location.hash = '#/app/board';
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('the report identifies the build (OPS-03)', () => {
    it('names a build in the subject and the body', () => {
        const mailto = feedbackMailto(collectFeedbackContext());

        // In a unit run there is no Vite `define`, so the guard in `build-id.ts` answers
        // `local` — which is the honest answer and the one that must not throw.
        expect(subjectOf(mailto)).toMatch(/FalconForge beta feedback \(.+\)/);
        expect(bodyOf(mailto)).toMatch(/^build: .+$/m);
    });

    it('does not say 0.1.0, which is what it said for eighteen deploys', () => {
        expect(subjectOf(feedbackMailto(collectFeedbackContext()))).not.toContain('0.1.0');
    });
});

describe('the report says what the app was doing (OPS-05)', () => {
    it('carries the screen, the queue, the team and both connectivity answers', () => {
        recordServerContact(true);
        const body = bodyOf(
            feedbackMailto(collectFeedbackContext({ pending: 3, failed: 1 }, 'team-42')),
        );

        expect(body).toContain('screen: #/app/board');
        expect(body).toContain('unsent changes: 3 queued, 1 parked');
        expect(body).toContain('team: team-42');
        expect(body).toMatch(/device online: (yes|no)/);
        expect(body).toContain('server: reachable');
    });

    it('distinguishes "the device is online" from "the server is answering"', () => {
        // The conflation SYNC-07 exists because of. An email that says only `online: yes`
        // sends somebody looking at the wrong layer.
        recordServerContact(false);
        const body = bodyOf(feedbackMailto(collectFeedbackContext()));

        expect(body).toContain('server: NOT reachable');
    });

    it('says so when nothing has been asked yet, rather than implying a failure', () => {
        const body = bodyOf(feedbackMailto(collectFeedbackContext()));
        expect(body).toContain('server: not contacted this session');
    });

    it('says "none open" rather than "null" when there is no team', () => {
        expect(bodyOf(feedbackMailto(collectFeedbackContext()))).toContain('team: none open');
    });
});

describe('what the report must NOT carry', () => {
    it('contains no member names, task titles or emails beyond the recipient', () => {
        recordServerContact(true);
        const mailto = feedbackMailto(
            collectFeedbackContext({ pending: 2, failed: 0 }, 'team-42'),
        );
        const body = bodyOf(mailto);

        // The only address in the whole string is the one it is sent to.
        const addresses = mailto.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? [];
        expect(new Set(addresses)).toEqual(new Set([FEEDBACK_EMAIL]));

        // And the context block is a fixed shape: every line is one of these keys.
        const contextLines = body.split('\n').slice(body.split('\n').indexOf('— — — — —') + 1);
        const keyed = contextLines.filter((l) => l.includes(':'));
        for (const line of keyed) {
            expect(
                line,
                `an unexpected field reached the support address: "${line}"`,
            ).toMatch(/^(build|screen|device online|server|unsent changes|team):/);
        }
    });

    it('tells the reporter what it is sending', () => {
        // Attaching diagnostics silently to an email somebody is about to send is not on.
        const body = bodyOf(feedbackMailto(collectFeedbackContext()));
        expect(body).toContain('no names and nothing from your team');
    });
});

describe('gathering the context never throws', () => {
    it('degrades to strings when the browser globals are missing', () => {
        // It runs while somebody is reporting that something is broken. A gatherer that can
        // fail turns the feedback link into the second bug of the evening.
        vi.stubGlobal('navigator', undefined);
        expect(() => collectFeedbackContext()).not.toThrow();
        const context = collectFeedbackContext();
        expect(context.route).toBeTypeOf('string');
    });
});
