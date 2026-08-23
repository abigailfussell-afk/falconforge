/**
 * WALK-B-04 — the invite code survives the round trip through sign-up.
 *
 * Exit criterion: *"hit `/#/join/CODE` signed-out → sign up → confirm → onboarding offers
 * 'Join <team> with CODE' first; code cleared on use. Red test: Onboarding renders the
 * stored-code action."*
 *
 * The store itself is here; the Onboarding half is `onboarding-stored-invite.test.tsx`.
 *
 * WHY A STORE AND NOT A URL PARAMETER, which is what the old code half-attempted. The link was
 * `/login?redirect=/join/CODE` and nothing has ever read `redirect` — this app's parameter is
 * `next`. But renaming it would not have fixed WALK-B-04 either: production sign-up is a round
 * trip through EMAIL (`docs/environment-divergences.md` §1), so the confirmation link starts a
 * fresh navigation with none of the original query on it, and on a phone the tab it came from
 * is gone. Both are fixed — `next` for a plain sign-IN, storage for a sign-UP — and only the
 * second one survives the mail app.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    rememberInviteCode,
    readInviteCode,
    clearInviteCode,
    normaliseInviteCode,
} from '@/lib/pending-invite';

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('remembering the code somebody arrived with', () => {
    /* THE RED TEST for the storage half: without `rememberInviteCode`, this is null. */
    it('survives being read back later', () => {
        rememberInviteCode('GYSQ6VQS');
        expect(readInviteCode()).toBe('GYSQ6VQS');
    });

    it('normalises the way the join form does, so both agree on one string', () => {
        rememberInviteCode('  gysq6vqs ');
        expect(readInviteCode()).toBe('GYSQ6VQS');
    });

    /*
     * Overwrite, not accumulate. Somebody who follows two invite links is trying to join the
     * SECOND team, and a queue of stale codes offers a worse answer than the newest one.
     */
    it('the most recent link wins', () => {
        rememberInviteCode('AAAA1111');
        rememberInviteCode('BBBB2222');
        expect(readInviteCode()).toBe('BBBB2222');
    });

    it('is gone once cleared', () => {
        rememberInviteCode('GYSQ6VQS');
        clearInviteCode();
        expect(readInviteCode()).toBeNull();
    });
});

describe('what it refuses to remember', () => {
    /*
     * The stored value is RENDERED to the user on the onboarding screen, so it is untrusted
     * content in the ordinary sense — `localStorage` is hand-editable and this is a public
     * client. Validating on the way in AND on the way out, because a value written by an older
     * build is not covered by today's write path.
     */
    it.each([
        ['too short', 'ABC'],
        ['too long', 'A'.repeat(32)],
        ['markup', '<img src=x onerror=alert(1)>'],
        ['a path', '../../etc/passwd'],
        ['empty', ''],
    ])('refuses %s', (_label, value) => {
        rememberInviteCode(value);
        expect(readInviteCode()).toBeNull();
        expect(normaliseInviteCode(value)).toBeNull();
    });

    it('refuses a hand-edited value on the way OUT as well as on the way in', () => {
        localStorage.setItem('falconforge.pendingInviteCode', '<script>bad()</script>');
        expect(readInviteCode()).toBeNull();
    });
});

describe('a browser that will not co-operate', () => {
    /*
     * Safari's private mode throws on `localStorage` access rather than returning null, and
     * quota errors throw on write. Losing a shortcut is not worth an unhandled exception on
     * the screen a student meets once — `docs/failure-modes.md` §11's shape.
     */
    it('a throwing setItem loses the shortcut and nothing else', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        expect(() => rememberInviteCode('GYSQ6VQS')).not.toThrow();
    });

    it('a throwing getItem reads as "nothing stored"', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        expect(readInviteCode()).toBeNull();
    });
});
