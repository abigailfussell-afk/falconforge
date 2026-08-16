/**
 * The localStorage key holding the signed-in person's cached profile.
 *
 * It lives in its own module purely so `sign-out.ts` can clear it without importing
 * `auth.tsx` — auth imports the store, the store imports offline-db, and sign-out imports
 * both, so a direct import would close a cycle.
 *
 * The name is a leftover from before the rename to FalconForge and is deliberately NOT
 * changed: renaming it would strand the cached profile of everyone with the app already
 * installed, and the only visible effect would be their name reading "Guest" until the next
 * successful profile read — which for a PWA opened offline at a venue could be a while.
 */
export const PROFILE_CACHE_KEY = 'ftc-current-user-cache';
