import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';
import { useAppStore } from './store';
import { getMemberDisplayName, getMemberInitials } from './member-utils';
import { PROFILE_CACHE_KEY } from './profile-cache';
import type { AgeClassification } from '../types';

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

                // Handle user profile creation / loading on sign up or sign in
                if (needsProfileSync && session?.user) {
                    useAppStore.getState().setCurrentUserId(session.user.id);
                    await ensureUserProfile(session.user);
                    
                    // Once profile is ensured, finally release the loading lock
                    setState(prev => ({
                        ...prev,
                        isLoading: false
                    }));
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

        // Use upsert to handle both new users and existing users
        // This avoids issues with RLS errors causing false "user not found" results
        const { error: upsertError } = await supabase
            .from('users')
            .upsert({
                id: user.id,
                email: user.email!,
                full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
                avatar_url: user.user_metadata?.avatar_url || null,
                // Only set age_classification if it comes from metadata (won't overwrite existing)
                ...(ageFromMetadata ? { age_classification: ageFromMetadata } : {}),
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

        const resolvedAge = userData?.age_classification || ageFromMetadata;
        setState(prev => ({
            ...prev,
            profile,
            ...(resolvedAge ? { ageClassification: resolvedAge as AgeClassification } : {}),
        }));
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
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });
        return { error };
    }, []);

    const signInWithMicrosoft = useCallback(async () => {
        if (!supabase) return { error: { message: 'Supabase not configured' } as AuthError };

        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'azure',
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
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
            redirectTo: `${window.location.origin}/auth/reset-password`,
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


