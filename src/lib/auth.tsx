import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';
import { useAppStore } from './store';
import { withTimeout } from './timeout';
import { requestStoragePersistence } from './storage-persistence';
import { getMemberDisplayName, getMemberInitials } from './member-utils';
import { PROFILE_CACHE_KEY } from './profile-cache';
import { ATTESTATION_VERSIONS } from './attestations';
import type { AgeClassification } from '../types';

/**
 * Where Supabase sends the browser back to after an email link or an OAuth provider.
 *
 * THE ORIGIN ROOT, AND NOTHING ELSE. Both plausible-looking alternatives are broken, and one
 * of them is broken silently — which is why this is a named helper with the reasoning attached
 * rather than three string literals that each look obviously correct.
 *
 *   `${origin}/auth/reset-password`  — what this app shipped until Sprint 9. A NON-HASH path
 *   on a HashRouter app hosted on GitHub Pages: Pages has no such file and no `404.html`, so it
 *   answers with its own 404 page and THE APP NEVER BOOTS. React Router's catch-all never runs
 *   because nothing ever loaded. Password recovery was dead end to end in production.
 *
 *   `${origin}/#/auth/reset-password` — the obvious fix, and it silently discards the token.
 *   The implicit grant appends its own fragment, giving `/#/auth/reset-password#access_token=…`,
 *   and a URL has ONE fragment: supabase-js parses `url.hash.substring(1)` as a query string, so
 *   the first key it finds is `/auth/reset-password#access_token` rather than `access_token`.
 *   The session is never established, and the screen simply says the link is invalid. Verified
 *   against `parseParametersFromURL` in `@supabase/auth-js` rather than assumed — it returns
 *   `access_token: undefined` for that shape and the correct value for this one.
 *
 * So: land on `/`, which Pages serves, which leaves the fragment intact for
 * `detectSessionInUrl` to consume. Where the user goes NEXT is decided by the auth event
 * (`PASSWORD_RECOVERY`), not by the URL — see the `onAuthStateChange` handler. That also means
 * this one helper is correct for recovery, for OAuth and for email confirmation alike, instead
 * of each growing its own path for the next person to get wrong.
 *
 * NO `404.html` IS INVOLVED, deliberately. Adding one would not have fixed the original defect
 * (there was no matching route either, so the catch-all would still have discarded the token),
 * and with the redirect landing on `/` there is no 404 left to handle. A Pages SPA fallback for
 * OTHER deep non-hash links is a separate, real question; it is in the parking lot rather than
 * bundled in here on the strength of sounding related.
 */
export function authRedirectUrl(): string {
    return `${window.location.origin}/`;
}

/**
 * The hash route the user is sent to once a recovery session exists.
 *
 * Exported so the route table and the test assert against the same string.
 */
export const RESET_PASSWORD_PATH = '/auth/reset-password';

/**
 * The signed-in person's displayable profile.
 *
 * Distinct from `user`, and the distinction is the point: `user` is the Supabase AUTH
 * identity (id, email, raw user_metadata, JWT claims) and `profile` is the `users` table row
 * that the app actually renders — full name and avatar, resolved against auth metadata when
 * the row cannot be read, and cached so it survives a cold offline start.
 */
export interface UserProfile {
    id: string;
    email: string;
    fullName: string | null;
    avatarUrl: string | null;
}

interface AuthState {
    user: User | null;
    session: Session | null;
    isLoading: boolean;
    isSigningOut: boolean;
    isConfigured: boolean;
    ageClassification: AgeClassification | null;
    /** @see UserProfile — null until resolved, or when signed out. */
    profile: UserProfile | null;
    /** Whether the browser currently reports a connection. */
    isOffline: boolean;
}

interface AuthContextType extends AuthState {
    /** The profile's preferred display name, or "Guest" when there is no profile. */
    displayName: string;
    /** The profile's initials, or "G" when there is no profile. */
    initials: string;
    signInWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>;
    signUpWithEmail: (email: string, password: string, fullName: string, ageClassification?: AgeClassification) => Promise<{ error: AuthError | null; user: any }>;
    signInWithGoogle: () => Promise<{ error: AuthError | null }>;
    signInWithMicrosoft: () => Promise<{ error: AuthError | null }>;
    signOut: () => Promise<void>;
    resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
    updateProfile: (fullName: string) => Promise<{ error: AuthError | null }>;
    updateAgeClassification: (classification: AgeClassification) => Promise<{ error: AuthError | null; success: boolean }>;
}

/**
 * How long the app waits for the profile before showing itself anyway.
 *
 * Longer than `PER_QUERY_TIMEOUT_MS` (10s) would be pointless — this wraps a request that has
 * its own patience — and much shorter would flash the app before a fast connection has filled
 * the sidebar in. The profile is a cache; this is the point at which we stop pretending the
 * cache is a precondition.
 */
const PROFILE_SYNC_TIMEOUT_MS = 8_000;

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/*
 * PROFILE CACHE
 *
 * Lives here rather than in a second provider. `user-context.tsx` used to hold a
 * `CurrentUserProvider` wrapping the whole app inside `AuthProvider`, deriving its state from
 * `useAuth()` and doing its own `users` read — a second profile source and a second cache
 * over the same person. The two could disagree, and did in one visible way: `updateProfile`
 * here wrote the new full name into auth state immediately, while the cached copy the roster
 * and the activity feed rendered from was only refreshed on the next auth event, so renaming
 * yourself changed your name in the sidebar and not on your own comments.
 *
 * One provider, one read, one cache.
 */

function readCachedProfile(): UserProfile | null {
    try {
        const cached = localStorage.getItem(PROFILE_CACHE_KEY);
        return cached ? JSON.parse(cached) : null;
    } catch (e) {
        console.warn('[Auth] Failed to parse cached profile:', e);
        return null;
    }
}

function writeCachedProfile(profile: UserProfile | null) {
    try {
        if (profile) {
            localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
        } else {
            localStorage.removeItem(PROFILE_CACHE_KEY);
        }
    } catch (e) {
        console.warn('[Auth] Failed to cache profile:', e);
    }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = useState<AuthState>({
        user: null,
        session: null,
        isLoading: true,
        isSigningOut: false,
        isConfigured: isSupabaseConfigured(),
        ageClassification: null,
        // Seeded from the cache so a cold offline start renders a name rather than "Guest".
        profile: readCachedProfile(),
        isOffline: typeof navigator !== 'undefined' && !navigator.onLine,
    });

    // Connectivity. Components use this to stop offering actions that need a network — the
    // invite manager and the roster's role controls both write through Supabase directly
    // rather than through the sync queue, so for those two "offline" really does mean "not
    // now" rather than "later".
    useEffect(() => {
        const handleOnline = () => setState(prev => ({ ...prev, isOffline: false }));
        const handleOffline = () => setState(prev => ({ ...prev, isOffline: true }));

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    useEffect(() => {
        if (!supabase) {
            setState(prev => ({ ...prev, isLoading: false }));
            return;
        }

        // Safety timeout for initial auth check (especially useful for offline PWA).
        // 5s is generous enough for slow mobile networks while still preventing
        // indefinite hangs if Supabase is unreachable.
        const authTimeout = setTimeout(() => {
            setState(prev => {
                if (prev.isLoading) {
                    console.warn('Auth check timed out, proceeding to app...');
                    return { ...prev, isLoading: false };
                }
                return prev;
            });
        }, 5000);

        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            clearTimeout(authTimeout);
            
            // If we have a user, wait to set isLoading to false until we check profile
            if (session?.user) {
                setState(prev => ({
                    ...prev,
                    session,
                    user: session.user,
                }));
                // ensureUserProfile will call setState again or we rely on the sub
            } else {
                setState(prev => ({
                    ...prev,
                    session,
                    user: null,
                    isLoading: false,
                }));
            }
            // Keep store's currentUserId in sync with auth
            if (session?.user) {
                useAppStore.getState().setCurrentUserId(session.user.id);
            }
        }).catch(err => {
            console.error('Auth session error:', err);
            clearTimeout(authTimeout);
            setState(prev => ({ ...prev, isLoading: false }));
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                // Determine if we should hold the loading state
                // We hold it if someone just signed in or we have an initial session
                // because we need to fetch their ageClassification before rendering securely
                const needsProfileSync = (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user;

                setState(prev => ({
                    ...prev,
                    session,
                    user: session?.user ?? null,
                    // Keep loading true until profile is fetched, unless logging out
                    isLoading: needsProfileSync ? true : false,
                }));

                // Handle user profile creation / loading on sign up or sign in.
                //
                // Deferred out of this callback with setTimeout(0): supabase-js emits
                // SIGNED_IN / INITIAL_SESSION while it still holds the sb-*-auth-token
                // Web Lock, and ensureUserProfile's REST call needs getSession(), which
                // wants that same lock — awaiting it here deadlocks the auth client
                // (lock held, pending queue empty, "Preparing your workspace..." forever
                // on any reload with a stored session). Supabase's own docs require
                // deferring Supabase calls made from inside onAuthStateChange.
                if (needsProfileSync && session?.user) {
                    const user = session.user;
                    setTimeout(() => {
                        useAppStore.getState().setCurrentUserId(user.id);

                        /*
                         * ASK THE BROWSER TO KEEP THE OFFLINE COPY (SYNC-08).
                         *
                         * Everything this product is for is in IndexedDB under best-effort
                         * storage, which browsers evict under pressure — a student's full
                         * phone, or seven days of a school holiday on Safari. The queue would
                         * simply be empty afterwards, which is indistinguishable from having
                         * synced.
                         *
                         * Here rather than at app start because `persist()` is a permission
                         * request: after sign-in the person has an account and a team, which is
                         * when there is finally something worth keeping. Fire-and-forget — it
                         * never rejects, and a storage permission must not delay a sign-in.
                         */
                        void requestStoragePersistence();
                        /*
                         * BOUNDED, because `isLoading` is released nowhere else on this path.
                         *
                         * The 5s safety timeout above is cleared the moment `getSession()`
                         * resolves — including when it resolves WITH a user, which is exactly
                         * when `isLoading` is still true and the profile fetch has not started.
                         * So from that point the splash was held up by one un-timed-out network
                         * call: if `ensureUserProfile` never settled, "Preparing your
                         * workspace..." was permanent. supabase-js applies no request timeout of
                         * its own, so "never settles" is a real state, not a hypothetical.
                         *
                         * Reported from production, where the latency exists; it does not
                         * reproduce against a local stack on the same machine, which is why the
                         * suite never saw it.
                         *
                         * Releasing early is safe. The profile is a CACHE — `getMemberDisplayName`
                         * falls back to the email, and the real value lands whenever the request
                         * finishes. An app the user can use beats a spinner that is technically
                         * more correct.
                         */
                        withTimeout(ensureUserProfile(user), PROFILE_SYNC_TIMEOUT_MS, 'ensureUserProfile')
                            .catch((err) => {
                                console.warn('[auth] profile sync did not complete in time:', err);
                            })
                            .finally(() => {
                                setState(prev => ({
                                    ...prev,
                                    isLoading: false
                                }));
                            });
                    }, 0);
                }

                /*
                 * THE RECOVERY LINK HAS BEEN FOLLOWED.
                 *
                 * `detectSessionInUrl` has just consumed `#access_token=…&type=recovery` from
                 * the origin root and established a session, so the user is now signed in and
                 * would otherwise land on the dashboard with no idea that the link "did"
                 * anything — the classic redirect-discards-the-intent failure
                 * (`docs/failure-modes.md` §14), which is what the old broken flow degenerated
                 * into on the rare occasions the app booted at all.
                 *
                 * Navigating from here rather than from a route means the destination does not
                 * depend on the URL surviving the round trip, which is exactly what it could
                 * not do: there is only one fragment and Supabase needs it.
                 *
                 * `window.location.hash` rather than a router navigate: this module is outside
                 * the Router, and assigning the hash is what HashRouter listens to.
                 */
                if (event === 'PASSWORD_RECOVERY') {
                    window.location.hash = `#${RESET_PASSWORD_PATH}`;
                }

                if (event === 'SIGNED_OUT') {
                    useAppStore.getState().setCurrentUserId(null);
                    // Drop the cached profile with the session. On a shared team laptop the
                    // next person must not see the previous one's name in the sidebar while
                    // their own profile resolves.
                    writeCachedProfile(null);
                    setState(prev => ({ ...prev, profile: null }));
                    // We DO NOT reset isSigningOut here. Keeping it true ensures that 
                    // the screen stays on "Signing out securely..." until the browser 
                    // finishes executing window.location.reload()
                }
            }
        );

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    const ensureUserProfile = async (user: User) => {
        if (!supabase) return;

        // Get age classification from user_metadata (set during signup)
        const ageFromMetadata = user.user_metadata?.age_classification || null;
        const privacyAccepted = user.user_metadata?.privacy_accepted === true;

        /*
         * Upsert to handle both new users and existing ones — an RLS hiccup then reads as a
         * failed write rather than as "user not found".
         *
         * `age_classification` IS DELIBERATELY NOT IN THIS PAYLOAD, and the comment that used to
         * sit here claimed the opposite: "only set it if it comes from metadata (won't overwrite
         * existing)". It did overwrite. `ignoreDuplicates: false` means every conflicting column
         * in the payload is UPDATEd, so this ran on every boot and wrote signup metadata back
         * over the row — and signup metadata is frozen at the moment the account was created.
         * Found by running the app: correcting an account to `18_plus` through the profile
         * screen wrote the column, and the next reload put it back to `13_to_17` with no error
         * anywhere. Any correction path has the same fate, including the one planned for the
         * admin-nomination handshake, so the value could never have been changed at all.
         *
         * The row is created server-side by `handle_new_user`, which reads the same metadata, so
         * nothing is lost by leaving the column out. The backfill below covers the one case that
         * is not the trigger's: this upsert racing ahead of it on a brand-new account.
         */
        const { error: upsertError } = await supabase
            .from('users')
            .upsert({
                id: user.id,
                email: user.email!,
                full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
                avatar_url: user.user_metadata?.avatar_url || null,
            } as any, {
                onConflict: 'id',
                ignoreDuplicates: false, // Update on conflict
            });

        if (upsertError) {
            console.error('[Auth] Error upserting user profile:', upsertError);
        }

        // Record privacy attestation if accepted (only once)
        if (privacyAccepted) {
            // Check if attestation already exists
            const { data: existingAttestation } = await supabase
                .from('user_attestations')
                .select('id')
                .eq('user_id', user.id)
                .eq('attestation_type', 'privacy_and_guidelines')
                .single();

            if (!existingAttestation) {
                await supabase.from('user_attestations').insert({
                    user_id: user.id,
                    attestation_type: 'privacy_and_guidelines',
                    version: '1.0',
                } as any);
            }
        }

        /*
         * One read of the `users` row, for everything the app needs off it.
         *
         * This used to select only `age_classification`, and `CurrentUserProvider` made a
         * SECOND round trip to the same row for `full_name` and `avatar_url` — two reads of
         * one row on every sign-in, on a connection that is frequently a phone tethered in a
         * pit. The columns are merged into one select and the profile is derived here.
         */
        const { data: userData } = await supabase
            .from('users')
            .select('full_name, avatar_url, age_classification')
            .eq('id', user.id)
            .single() as {
                data: {
                    full_name: string | null;
                    avatar_url: string | null;
                    age_classification: string | null;
                } | null;
            };

        // Auth metadata is the fallback for each field independently, because the row read
        // can fail wholesale (offline, or an RLS refusal) while the JWT is still perfectly
        // good — and a signed-in person should never be rendered as "Guest".
        const profile: UserProfile = {
            id: user.id,
            email: user.email || '',
            fullName:
                userData?.full_name ||
                user.user_metadata?.full_name ||
                user.user_metadata?.name ||
                null,
            avatarUrl: userData?.avatar_url || user.user_metadata?.avatar_url || null,
        };
        writeCachedProfile(profile);

        /*
         * The row wins; metadata is only ever a fallback, and a backfill when the row has none.
         *
         * A row with no classification is the `handle_new_user` race (the upsert above can land
         * first), and NULL gates the whole under-13 flow — so it is written once, here, rather
         * than left for the next boot to guess at again. `update_user_age_classification` scopes
         * itself to `auth.uid()`, which is why the backfill goes through it rather than through
         * another upsert that would reintroduce exactly the clobber described above.
         */
        const resolvedAge = userData?.age_classification || ageFromMetadata;
        setState(prev => ({
            ...prev,
            profile,
            ...(resolvedAge ? { ageClassification: resolvedAge as AgeClassification } : {}),
        }));

        /*
         * Backfill LAST, and in a way that cannot cost anybody their session.
         *
         * A row with no classification is the `handle_new_user` race — the upsert above can land
         * first — and NULL gates the whole under-13 flow, so it is written once here rather than
         * left for the next boot to guess at again. It goes through
         * `update_user_age_classification`, which scopes itself to `auth.uid()`, rather than
         * through another upsert that would reintroduce the clobber described above.
         *
         * The first draft ran this BEFORE `setState` and an existing test caught it: a throw
         * here abandoned the whole profile sync, leaving `ageClassification` null and the user
         * on the forced age-profile screen with a perfectly good session. A best-effort write
         * must never be able to do that, so the state lands first and this cannot rethrow.
         */
        if (!userData?.age_classification && ageFromMetadata) {
            try {
                const { error: backfillError } = (await supabase.rpc('update_user_age_classification', {
                    classification: ageFromMetadata,
                })) ?? {};
                if (backfillError) console.error('[Auth] Could not backfill age classification:', backfillError);
            } catch (err) {
                console.error('[Auth] Could not backfill age classification:', err);
            }
        }
    };

    const signInWithEmail = useCallback(async (email: string, password: string) => {
        if (!supabase) return { error: { message: 'Supabase not configured' } as AuthError };

        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error };
    }, []);

    const signUpWithEmail = useCallback(async (email: string, password: string, fullName: string, ageClassification?: AgeClassification) => {
        if (!supabase) return { error: { message: 'Supabase not configured' } as AuthError, user: null };

        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                    age_classification: ageClassification || null,
                    privacy_accepted: ageClassification ? true : false,
                    /*
                     * The version the sign-up form displayed, carried to `handle_new_user`.
                     *
                     * The trigger used to hardcode '1.0'. Sprint 6 raised the documents to
                     * '2.0' on the client, so from then on every new account was recorded as
                     * having accepted a version the app considered stale, and was told on its
                     * first screen that the documents had changed since it accepted them --
                     * thirty seconds after it accepted them.
                     *
                     * `ATTESTATION_VERSIONS` stays the ONE place a version is written down;
                     * this hands the current value to the server rather than the server
                     * keeping a second copy that drifts. That property is why the trigger was
                     * wrong and why this is not the same mistake in a new place.
                     */
                    privacy_version: ATTESTATION_VERSIONS.privacy_and_guidelines,
                },
            },
        });
        return { error, user: data?.user || null };
    }, []);

    const signInWithGoogle = useCallback(async () => {
        if (!supabase) return { error: { message: 'Supabase not configured' } as AuthError };

        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                // See `authRedirectUrl`. Latent today because no provider is configured — and
                // fixed alongside the other two precisely so the next one to be enabled does
                // not inherit the bug.
                redirectTo: authRedirectUrl(),
            },
        });
        return { error };
    }, []);

    const signInWithMicrosoft = useCallback(async () => {
        if (!supabase) return { error: { message: 'Supabase not configured' } as AuthError };

        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'azure',
            options: {
                redirectTo: authRedirectUrl(),
                scopes: 'email profile openid',
            },
        });
        return { error };
    }, []);

    const signOut = useCallback(async () => {
        if (!supabase) {
            console.error('Cannot sign out: Supabase not configured');
            return;
        }
        
        // Let the app know we are signing out to engage loading states and prevent refetching
        setState(prev => ({
            ...prev,
            isSigningOut: true,
        }));
        
        await supabase.auth.signOut();
    }, []);

    const resetPassword = useCallback(async (email: string) => {
        if (!supabase) return { error: { message: 'Supabase not configured' } as AuthError };

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: authRedirectUrl(),
        });
        return { error };
    }, []);

    const updateProfile = useCallback(async (fullName: string) => {
        if (!supabase) return { error: { message: 'Supabase not configured' } as AuthError };

        const { data, error } = await supabase.auth.updateUser({
            data: { full_name: fullName }
        });

        // Update local state with the new user data
        if (!error && data.user) {
            setState(prev => {
                // The profile moves with the auth user. It did not before: the sidebar read
                // `user.user_metadata.full_name` and updated immediately, while the roster
                // and the activity feed read the separate cached profile and kept the old
                // name until the next auth event. Renaming yourself renamed you in one place.
                const profile = prev.profile
                    ? { ...prev.profile, fullName }
                    : prev.profile;
                if (profile) writeCachedProfile(profile);
                return { ...prev, user: data.user, profile };
            });
        }

        return { error };
    }, []);

    const updateAgeClassification = useCallback(async (classification: AgeClassification) => {
        if (!supabase) return { error: { message: 'Supabase not configured' } as AuthError, success: false };

        try {
            // Call the RPC function to update age classification
            const { data, error: rpcError } = await (supabase.rpc as any)('update_user_age_classification', {
                classification: classification,
            });

            if (rpcError) {
                return { error: { message: rpcError.message } as AuthError, success: false };
            }

            const result = data as { success: boolean; error?: string };
            if (!result.success) {
                return { error: { message: result.error || 'Failed to update age classification' } as AuthError, success: false };
            }

            // Update local state
            setState(prev => ({
                ...prev,
                ageClassification: classification,
            }));

            return { error: null, success: true };
        } catch (err: any) {
            return { error: { message: err.message } as AuthError, success: false };
        }
    }, []);

    // Signed-out or unresolved people read as "Guest"/"G" rather than the roster defaults
    // ("Unknown User"/"?"), since there is no member record to be unknown about.
    const value: AuthContextType = {
        ...state,
        displayName: getMemberDisplayName(state.profile, 'Guest'),
        initials: getMemberInitials(state.profile, 'G'),
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signInWithMicrosoft,
        signOut,
        resetPassword,
        updateProfile,
        updateAgeClassification,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}


