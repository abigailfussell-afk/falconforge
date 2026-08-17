/**
 * Password recovery: the redirect that has to survive GitHub Pages AND HashRouter.
 *
 * THE DEFECT THIS COVERS was live in production and broken twice over. `resetPassword` sent
 * `redirectTo: ${origin}/auth/reset-password` — a non-hash path on a HashRouter app hosted on
 * Pages, which answers it with its own 404 page, so the app never booted and React Router's
 * catch-all never ran. And there was no `/auth/reset-password` route either, so even once it
 * booted the catch-all matched and silently discarded the recovery token.
 *
 * WHY THIS FILE ASSERTS AGAINST SUPABASE'S OWN PARSER rather than against a string.
 *
 * `expect(url).toBe('https://x.test/')` is satisfied by any implementation that happens to
 * produce that string, and says nothing about whether the token survives — which is the actual
 * property, and the one the obvious fix gets wrong. `${origin}/#/auth/reset-password` LOOKS
 * correct, is what a reasonable person writes, and silently loses the token, because a URL has
 * one fragment and the implicit grant appends its own. Running the real
 * `parseParametersFromURL` over the real shape is the difference between testing the harness
 * and testing the behaviour (`docs/failure-modes.md` §2).
 *
 * WHAT WOULD MAKE THESE FAIL: putting a path or a hash back into `authRedirectUrl()`. Both
 * regressions are asserted below as explicit counter-examples, so the file also documents why
 * the tempting alternatives are wrong.
 */
import { describe, it, expect } from 'vitest';
import { parseParametersFromURL } from '@supabase/auth-js/dist/main/lib/helpers';
import { authRedirectUrl, RESET_PASSWORD_PATH } from '@/lib/auth';

/**
 * What GoTrue actually does with `redirect_to` on the implicit grant: it appends its own
 * fragment. Reproducing that here is what makes the assertions below about the real flow
 * rather than about our own string.
 */
function asRecoveryLandingUrl(redirectTo: string): string {
    return `${redirectTo}#access_token=the-token&refresh_token=r&type=recovery`;
}

describe('the recovery redirect leaves the token readable', () => {
    it('produces a URL Supabase can still find the token in', () => {
        const landed = asRecoveryLandingUrl(authRedirectUrl());
        const params = parseParametersFromURL(landed);

        expect(params.access_token).toBe('the-token');
        expect(params.type).toBe('recovery');
    });

    it('lands on a path GitHub Pages will actually serve', () => {
        /*
         * Pages serves `index.html` for `/` and its own 404 page for anything else, and this
         * repo has no `404.html`. A redirect to any deeper path means the app never boots —
         * which is not a routing bug that a route can fix, because nothing ever loaded.
         */
        const url = new URL(authRedirectUrl());
        expect(url.pathname).toBe('/');
        expect(url.hash).toBe('');
        expect(url.search).toBe('');
    });
});

describe('the two shapes that look right and are not', () => {
    it('a non-hash path is why recovery was dead in production', () => {
        // The token parses fine — that was never the problem. The problem is that this URL is
        // a 404 on Pages, so nothing gets the chance to parse it.
        const landed = asRecoveryLandingUrl('https://falcon-forge.com/auth/reset-password');
        expect(parseParametersFromURL(landed).access_token).toBe('the-token');

        // ...and this is the part that kills it: a path Pages does not serve.
        expect(new URL('https://falcon-forge.com/auth/reset-password').pathname).not.toBe('/');
        expect(authRedirectUrl()).not.toContain('/auth/reset-password');
    });

    it('a HASH path silently discards the token', () => {
        /*
         * The obvious fix for the above, and the reason this file exists. Two fragments cannot
         * coexist: supabase-js parses everything after the FIRST '#' as a query string, so the
         * key it finds is `/auth/reset-password#access_token`, not `access_token`.
         *
         * A fix that shipped this would have looked correct in review, worked in no
         * environment, and produced "this link is invalid" for every user — the meta-class in
         * `docs/failure-modes.md` where the fix introduces the next defect.
         */
        const landed = asRecoveryLandingUrl('https://falcon-forge.com/#/auth/reset-password');
        const params = parseParametersFromURL(landed);

        expect(params.access_token).toBeUndefined();
        expect(params['/auth/reset-password#access_token']).toBe('the-token');

        expect(authRedirectUrl()).not.toContain('#');
    });
});

describe('the route the recovery session is sent to', () => {
    it('is a rooted hash path the router can match', () => {
        // Asserted against the exported constant the route table uses, so the two cannot
        // drift into disagreeing about the same string — the §1 class, seven display-name
        // implementations and counting.
        expect(RESET_PASSWORD_PATH).toBe('/auth/reset-password');
        expect(RESET_PASSWORD_PATH.startsWith('/')).toBe(true);
    });
});
