import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000, // 30s — data is "fresh" for this long
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
