import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import QueryProvider, { queryClient } from '../QueryProvider';

/**
 * C4 — the app used to nest two QueryClientProviders: one in main.tsx with a 5-minute
 * staleTime and this one with 30s. Because they nested, every useQuery resolved against the
 * inner client and the outer config was dead weight that read as if it were in effect.
 *
 * These tests pin the surviving client: descendants must receive the exported instance, and
 * its defaults must stay in step with the per-query staleTime in lib/queries.ts.
 */

function ClientProbe() {
    const client = useQueryClient();
    const queries = client.getDefaultOptions().queries;
    return (
        <div>
            <span data-testid="is-exported-client">{String(client === queryClient)}</span>
            <span data-testid="stale-time">{String(queries?.staleTime)}</span>
            <span data-testid="refetch-on-reconnect">{String(queries?.refetchOnReconnect)}</span>
            <span data-testid="retry">{String(queries?.retry)}</span>
        </div>
    );
}

describe('QueryProvider', () => {
    it('supplies the single exported QueryClient to descendants', () => {
        render(
            <QueryProvider>
                <ClientProbe />
            </QueryProvider>
        );

        expect(screen.getByTestId('is-exported-client')).toHaveTextContent('true');
    });

    it('uses the documented 30s staleTime that lib/queries.ts assumes', () => {
        render(
            <QueryProvider>
                <ClientProbe />
            </QueryProvider>
        );

        expect(screen.getByTestId('stale-time')).toHaveTextContent('30000');
        expect(screen.getByTestId('retry')).toHaveTextContent('1');
        // Reconnecting is when stale data is most likely in an offline-first app.
        expect(screen.getByTestId('refetch-on-reconnect')).toHaveTextContent('true');
    });
});
