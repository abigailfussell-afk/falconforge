import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';

interface AuthState {
    user: User | null;
    session: Session | null;
    isLoading: boolean;
    isConfigured: boolean;
}

interface AuthContextType extends AuthState {
    signInWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>;
    signUpWithEmail: (email: string, password: string, fullName: string) => Promise<{ error: AuthError | null }>;
    signInWithGoogle: () => Promise<{ error: AuthError | null }>;
    signInWithMicrosoft: () => Promise<{ error: AuthError | null }>;
    signOut: () => Promise<void>;
    resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
    updateProfile: (fullName: string) => Promise<{ error: AuthError | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = useState<AuthState>({
        user: null,
        session: null,
        isLoading: true,
        isConfigured: isSupabaseConfigured(),
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
            .select('id')
            .eq('id', user.id)
            .single();

        // Create profile if it doesn't exist
        if (!existingUser) {
            await supabase.from('users').insert({
                id: user.id,
                email: user.email!,
                full_name: user.user_metadata.full_name || user.user_metadata.name || null,
                avatar_url: user.user_metadata.avatar_url || null,
            } as any);
        }
    };

    const signInWithEmail = useCallback(async (email: string, password: string) => {
        if (!supabase) return { error: { message: 'Supabase not configured' } as AuthError };

        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error };
    }, []);

    const signUpWithEmail = useCallback(async (email: string, password: string, fullName: string) => {
        if (!supabase) return { error: { message: 'Supabase not configured' } as AuthError };

        const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                },
            },
        });
        return { error };
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
            // In demo mode, still clear the local state
            setState(prev => ({
                ...prev,
                user: null,
                session: null,
            }));
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

    const value: AuthContextType = {
        ...state,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signInWithMicrosoft,
        signOut,
        resetPassword,
        updateProfile,
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

// Hook to require authentication
export function useRequireAuth() {
    const auth = useAuth();

    if (!auth.isConfigured) {
        // In demo mode, allow access
        return { ...auth, isDemoMode: true };
    }

    return { ...auth, isDemoMode: false };
}
