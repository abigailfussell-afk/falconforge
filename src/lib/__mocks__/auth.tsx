import React from 'react';
import { vi } from 'vitest';

/** A signed-in user, for components that only need auth to be *ready*. */
export const useAuth = vi.fn(() => ({
    user: { id: 'test-user' },
    session: { access_token: 'test-token' },
    isLoading: false,
    isConfigured: true,
    ageClassification: null,
}));

export const AuthProvider = ({ children }: { children: React.ReactNode }) => children;
