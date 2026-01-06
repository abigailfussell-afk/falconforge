import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './auth';
import { supabase } from './supabase';

/**
 * Current User Context
 * Provides the logged-in user's info across the app with offline support.
 * User info is cached in localStorage for offline access.
 */

export interface CurrentUser {
    id: string;
    email: string;
    fullName: string | null;
    avatarUrl: string | null;
}

interface CurrentUserContextType {
    currentUser: CurrentUser | null;
    isLoading: boolean;
    isOffline: boolean;
    displayName: string;
    initials: string;
}

const CACHE_KEY = 'ftc-current-user-cache';

const CurrentUserContext = createContext<CurrentUserContextType | undefined>(undefined);

function getCachedUser(): CurrentUser | null {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (e) {
        console.warn('Failed to parse cached user:', e);
    }
    return null;
}

function cacheUser(user: CurrentUser | null) {
    try {
        if (user) {
            localStorage.setItem(CACHE_KEY, JSON.stringify(user));
        } else {
            localStorage.removeItem(CACHE_KEY);
        }
    } catch (e) {
        console.warn('Failed to cache user:', e);
    }
}

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
    const { user, session, isLoading: authLoading, isConfigured } = useAuth();
    const [currentUser, setCurrentUser] = useState<CurrentUser | null>(getCachedUser);
    const [isLoading, setIsLoading] = useState(true);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

    // Track online/offline status
    useEffect(() => {
        const handleOnline = () => setIsOffline(false);
        const handleOffline = () => setIsOffline(true);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Sync user info from Supabase when authenticated
    useEffect(() => {
        async function syncUserProfile() {
            if (!isConfigured || !user || !session || !supabase) {
                // Use cached user if available when offline or not configured
                if (!user && !authLoading) {
                    setCurrentUser(getCachedUser());
                }
                setIsLoading(false);
                return;
            }

            try {
                // First try to get user profile from users table
                const { data: profile } = await supabase
                    .from('users')
                    .select('id, email, full_name, avatar_url')
                    .eq('id', user.id)
                    .single();

                // Type the profile data
                const profileData = profile as { full_name?: string | null; avatar_url?: string | null } | null;

                const userInfo: CurrentUser = {
                    id: user.id,
                    email: user.email || '',
                    fullName: profileData?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || null,
                    avatarUrl: profileData?.avatar_url || user.user_metadata?.avatar_url || null,
                };

                setCurrentUser(userInfo);
                cacheUser(userInfo);
            } catch (error) {
                console.warn('Failed to sync user profile, using auth data:', error);
                // Fallback to auth user data
                const userInfo: CurrentUser = {
                    id: user.id,
                    email: user.email || '',
                    fullName: user.user_metadata?.full_name || user.user_metadata?.name || null,
                    avatarUrl: user.user_metadata?.avatar_url || null,
                };
                setCurrentUser(userInfo);
                cacheUser(userInfo);
            }

            setIsLoading(false);
        }

        if (!authLoading) {
            syncUserProfile();
        }
    }, [user, session, authLoading, isConfigured]);

    // Clear cache on sign out
    useEffect(() => {
        if (!authLoading && !user && isConfigured) {
            cacheUser(null);
            setCurrentUser(null);
        }
    }, [user, authLoading, isConfigured]);

    // Compute display name and initials
    const displayName = currentUser?.fullName || currentUser?.email?.split('@')[0] || 'Guest';
    const initials = (() => {
        if (currentUser?.fullName) {
            const parts = currentUser.fullName.trim().split(/\s+/);
            if (parts.length >= 2) {
                return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
            }
            return parts[0]?.substring(0, 2).toUpperCase() || '?';
        }
        if (currentUser?.email) {
            return currentUser.email.substring(0, 2).toUpperCase();
        }
        return 'G';
    })();

    const value: CurrentUserContextType = {
        currentUser,
        isLoading: isLoading || authLoading,
        isOffline,
        displayName,
        initials,
    };

    return (
        <CurrentUserContext.Provider value={value}>
            {children}
        </CurrentUserContext.Provider>
    );
}

export function useCurrentUser() {
    const context = useContext(CurrentUserContext);
    if (context === undefined) {
        throw new Error('useCurrentUser must be used within a CurrentUserProvider');
    }
    return context;
}
