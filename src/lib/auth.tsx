import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';
import type { AgeClassification } from '../types';

interface AuthState {
    user: User | null;
    session: Session | null;
    isLoading: boolean;
    isConfigured: boolean;
    ageClassification: AgeClassification | null;
}

interface AuthContextType extends AuthState {
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = useState<AuthState>({
        user: null,
        session: null,
        isLoading: true,
        isConfigured: isSupabaseConfigured(),
        ageClassification: null,
    });

    useEffect(() => {
        if (!supabase) {
            setState(prev => ({ ...prev, isLoading: false }));
            return;
        }

        // Safety timeout for initial auth check (especially useful for offline PWA)
        const authTimeout = setTimeout(() => {
            setState(prev => {
                if (prev.isLoading) {
                    console.warn('Auth check timed out, proceeding to app...');
                    return { ...prev, isLoading: false };
                }
                return prev;
            });
        }, 1500);

        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            clearTimeout(authTimeout);
            setState(prev => ({
                ...prev,
                session,
                user: session?.user ?? null,
                isLoading: false,
            }));
        }).catch(err => {
            console.error('Auth session error:', err);
            clearTimeout(authTimeout);
            setState(prev => ({ ...prev, isLoading: false }));
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                setState(prev => ({
                    ...prev,
                    session,
                    user: session?.user ?? null,
                    isLoading: false,
                }));

                // Handle user profile creation on first sign up
                if (event === 'SIGNED_IN' && session?.user) {
                    await ensureUserProfile(session.user);
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

        // Now fetch the user's age classification for local state
        const { data: userData } = await supabase
            .from('users')
            .select('age_classification')
            .eq('id', user.id)
            .single() as { data: { age_classification: string | null } | null };

        if (userData?.age_classification) {
            setState(prev => ({
                ...prev,
                ageClassification: userData.age_classification as AgeClassification,
            }));
        } else if (ageFromMetadata) {
            // Fallback to metadata if DB query failed (e.g., RLS issues)
            setState(prev => ({
                ...prev,
                ageClassification: ageFromMetadata as AgeClassification,
            }));
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
            setState(prev => ({
                ...prev,
                user: data.user,
            }));
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

    const value: AuthContextType = {
        ...state,
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


