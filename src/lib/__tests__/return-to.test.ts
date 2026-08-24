/**
 * Carrying a destination through the login screen.
 *
 * A QR poster encodes `…/#/app/checkin/0842`. Scanning it while signed out used to hit the
 * `user ? … : <Navigate to="/" />` guard, which threw the destination away and left a student
 * on the marketing page — one tap from checking in, and instead reading about robots. Rule 4 of
 * the design brief says a scan while logged out routes through login and then COMPLETES the
 * check-in.
 *
 * The interesting half of this is the reading, not the writing: the value arrives from a URL,
 * so it is attacker-controlled in the ordinary sense, and an unvalidated one turns the login
 * page into an open redirect.
 */
import { describe, it, expect } from 'vitest';
import { loginWithReturnTo, readReturnTo, RETURN_TO_PARAM } from '@/lib/navigation';

describe('building the login URL', () => {
    it('carries an in-app destination', () => {
        expect(loginWithReturnTo('/app/checkin/0842')).toBe(
            `/login?${RETURN_TO_PARAM}=%2Fapp%2Fcheckin%2F0842`,
        );
    });

    it('round-trips through the reader', () => {
        const url = loginWithReturnTo('/app/meetings/abc-123/roster');
        expect(readReturnTo(url.slice(url.indexOf('?')))).toBe('/app/meetings/abc-123/roster');
    });

    it('does not bother remembering the landing page', () => {
        // "/" is where you end up having LOST a destination, so remembering it is noise.
        expect(loginWithReturnTo('/')).toBe('/login');
        expect(loginWithReturnTo('')).toBe('/login');
    });

    it('refuses to remember the login page itself', () => {
        // Otherwise signing in returns you to the sign-in form, which is a loop.
        expect(loginWithReturnTo('/login')).toBe('/login');
        expect(loginWithReturnTo('/login?next=%2Fapp')).toBe('/login');
    });
});

describe('reading a destination back', () => {
    it('returns null when there is none', () => {
        expect(readReturnTo('')).toBeNull();
        expect(readReturnTo('?mode=signup')).toBeNull();
    });

    it('REFUSES an absolute URL', () => {
        // The open-redirect case. A link of this shape in a phishing email would otherwise
        // send somebody from our login form to somebody else's.
        expect(readReturnTo('?next=https://evil.example/steal')).toBeNull();
        expect(readReturnTo('?next=http://evil.example')).toBeNull();
    });

    it('REFUSES a protocol-relative URL', () => {
        // `//host` is the one that gets missed: it starts with a slash and is still absolute.
        expect(readReturnTo('?next=//evil.example/steal')).toBeNull();
    });

    it('REFUSES a backslash-prefixed URL (GHSA-wrjc-x8rr-h8h6)', () => {
        /*
         * The bypass of the check above. Browsers normalise a leading `/\` to `//`, so
         * `/\evil.example` starts with exactly one slash and still resolves protocol-relative
         * — which is why the advisory exists at all, against a library whose own guard had the
         * same shape as ours. react-router 6 has no fix; v7 is a breaking change this app is
         * not taking before kickoff (OPS-12).
         *
         * Not reachable through THIS app, because a HashRouter assigns `location.hash` and a
         * fragment cannot leave the origin. Refused anyway: the unreachability is a property of
         * the router, and this function is where the rule about attacker-controlled
         * destinations is supposed to live.
         */
        const bs = String.fromCharCode(92);
        expect(readReturnTo(`?next=${encodeURIComponent('/' + bs + 'evil.example')}`)).toBeNull();
        expect(readReturnTo(`?next=${encodeURIComponent('/app' + bs + bs + 'evil.example')}`)).toBeNull();
    });

    it('refuses anything that is not rooted', () => {
        expect(readReturnTo('?next=app/checkin/0842')).toBeNull();
        expect(readReturnTo('?next=javascript:alert(1)')).toBeNull();
    });

    it('accepts an ordinary in-app path', () => {
        expect(readReturnTo('?next=%2Fapp%2Fcheckin%2F0842')).toBe('/app/checkin/0842');
    });
});
