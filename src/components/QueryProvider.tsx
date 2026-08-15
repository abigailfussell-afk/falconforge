import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

/**
 * The application's only QueryClient (C4).
 *
 * staleTime is 30s deliberately, and matches the per-query staleTime in `lib/queries.ts`.
 * The reasoning: this is an offline-first app where the store plus the sync queue — not
 * React Query — own the data. These queries exist to opportunistically freshen a view the
 * user is already looking at, so the window has to be short enough that a teammate's change
 * shows up during a competition, and long enough that tab-focus churn does not hammer a
 * flaky venue connection. refetchOnReconnect matters more than the interval: coming back
 * online is the moment stale data is most likely.
 */
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
        },
    },
});

interface QueryProviderProps {
    children: React.ReactNode;
}

export default function QueryProvider({ children }: QueryProviderProps) {
    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
}

/** Exposed for test cleanup */
export { queryClient };
