import { vi } from 'vitest';

/** Realtime is progressive enhancement; unit tests run with it disconnected. */
export const getRealtimeStatus = vi.fn(() => 'disconnected');
export const onRealtimeStatusChange = vi.fn(() => () => { });
export const setupRealtimeSubscription = vi.fn();
export const teardownRealtimeSubscription = vi.fn();
export const handleRealtimeDelete = vi.fn();
