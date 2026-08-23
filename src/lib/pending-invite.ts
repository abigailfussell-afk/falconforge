/**
 * The invite code a student arrived with, carried across sign-up (WALK-B-04).
 *
 * WHAT WAS BROKEN. A coach shares `https://falcon-forge.com/#/join/GYSQ6VQS`. Signed out, that
 * page said "You need to sign in or create an account" behind a link to
 * `/login?redirect=/join/GYSQ6VQS` — and nothing has ever read `redirect`. The parameter this
 * app actually uses is `next` (`navigation.ts`), so the code was discarded at the first click.
 * A gate with no door, `docs/failure-modes.md` §7.
 *
 * AND `next` ALONE WOULD NOT HAVE FIXED IT, which is why this module exists rather than a
 * one-word rename. Sign-up in production is a round trip through EMAIL: the student submits the
 * form, closes the tab, opens their mail app, and taps a confirmation link that starts a fresh
 * navigation with none of the original URL's query on it. On a phone the page they came from is
 * gone. `docs/environment-divergences.md` §1 is the whole story — locally there is no
 * confirmation step, so this path has never once run the way a real student runs it.
 *
 * So the code is stored, not passed. It survives the tab closing, which is the actual
 * requirement.
 *
 * WHAT THIS IS NOT. It is not a credential and it is not an authorisation. Redeeming it still
 * goes through `join_team_with_invite`, which puts the student in the PENDING queue and refuses
 * an expired or used-up code. The worst a tampered value can do is fail that RPC — which is why
 * this stores a plain string rather than anything signed, and why the validation below is about
 * keeping rubbish out of the UI rather than about security.
 */

const KEY = 'falconforge.pendingInviteCode';

/**
 * Invite codes are 8 hex-ish characters from `create_team_as_admin` / `InviteManager`, and
 * `JoinTeam` accepts anything of length ≥ 6. Bounded and character-restricted here so that a
 * hand-edited localStorage value cannot put arbitrary text on the onboarding screen — the code
 * is rendered to the user, so it is untrusted content in the ordinary sense.
 */
const CODE_PATTERN = /^[A-Z0-9-]{6,16}$/;

function storage(): Storage | null {
    // Guarded rather than assumed: this module is imported by components that render under
    // jsdom and, in Safari's private mode, `localStorage` access throws rather than returning
    // null. `docs/failure-modes.md` §11's shape — a thing that can fire where you did not
    // expect it to.
    try {
        if (typeof window === 'undefined' || !window.localStorage) return null;
        return window.localStorage;
    } catch {
        return null;
    }
}

/** Normalise the way `JoinTeam` does, so a stored code and a typed one are the same string. */
export function normaliseInviteCode(raw: string | null | undefined): string | null {
    const code = (raw ?? '').trim().toUpperCase();
    return CODE_PATTERN.test(code) ? code : null;
}

/**
 * Remember the code this person is trying to use, for after they have an account.
 *
 * Overwrites rather than accumulating: somebody who follows two invite links is trying to join
 * the second team, and a queue of stale codes is a worse answer than the most recent one.
 */
export function rememberInviteCode(raw: string | null | undefined): void {
    const code = normaliseInviteCode(raw);
    const store = storage();
    if (!code || !store) return;
    try {
        store.setItem(KEY, code);
    } catch {
        /* Quota, or a browser that refuses. Losing the shortcut is not worth an error. */
    }
}

/** The remembered code, or null. Re-validated on read: the value is user-editable. */
export function readInviteCode(): string | null {
    const store = storage();
    if (!store) return null;
    try {
        return normaliseInviteCode(store.getItem(KEY));
    } catch {
        return null;
    }
}

/**
 * Forget it.
 *
 * Called when the code is USED — successfully or not — rather than only on success. A code the
 * server rejected as expired must not reappear as the first suggestion on every subsequent
 * visit to onboarding, offering a student the same dead end for ever.
 */
export function clearInviteCode(): void {
    const store = storage();
    if (!store) return;
    try {
        store.removeItem(KEY);
    } catch {
        /* ignore */
    }
}
