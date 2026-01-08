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
    signUpWithEmail: (email: string, password: string, fullName: string) => Promise<{ error: AuthError | null; user: any }>;
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

        // Check if user profile exists
        const { data: existingUser } = await supabase
            .from('users')
            .select('id, age_classification')
            .eq('id', user.id)
            .single() as { data: { id: string; age_classification: string | null } | null };

        // Create profile if it doesn't exist
        if (!existingUser) {
            // Check for pending age classification from signup
            const pendingAge = localStorage.getItem('pending_age_classification');
            const pendingAttestation = localStorage.getItem('pending_privacy_attestation');

            await supabase.from('users').insert({
                id: user.id,
                email: user.email!,
                full_name: user.user_metadata.full_name || user.user_metadata.name || null,
                avatar_url: user.user_metadata.avatar_url || null,
                age_classification: pendingAge || null,
            } as any);

            // Record pending attestation if it exists
            if (pendingAttestation === 'true') {
                await supabase.from('user_attestations').insert({
                    user_id: user.id,
                    attestation_type: 'privacy_and_guidelines',
                    version: '1.0',
                } as any);
            }

            // Clear localStorage
            localStorage.removeItem('pending_age_classification');
            localStorage.removeItem('pending_privacy_attestation');

            // Update local state
            if (pendingAge) {
                setState(prev => ({
                    ...prev,
                    ageClassification: pendingAge as AgeClassification,
                }));
            }
        } else {
            // Existing user - fetch age classification
            if (existingUser.age_classification) {
                setState(prev => ({
                    ...prev,
                    ageClassification: existingUser.age_classification as AgeClassification,
                }));
            }
        }
    };

    const signInWithEmail = useCallback(async (email: string, password: string) => {
        if (!supabase) return { error: { message: 'Supabase not configured' } as AuthError };

        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error };
    }, []);

    const signUpWithEmail = useCallback(async (email: string, password: string, fullName: string) => {
        if (!supabase) return { error: { message: 'Supabase not configured' } as AuthError, user: null };

        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
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

// Hook to require authentication - now always requires real auth
export function useRequireAuth() {
    const auth = useAuth();

    // Supabase must be configured for the app to work
    if (!auth.isConfigured) {
        throw new Error('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.');
    }

    return auth;
}

