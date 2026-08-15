import { vi } from 'vitest';

/**
 * The React Query hooks, inert.
 *
 * Opting in stops a component test from triggering a real background pull on mount. The
 * pull itself is covered against a real database in `server-pull.db.test.ts`.
 */
const idle = () => ({ isLoading: false, isError: false, data: null });

export const useTasksQuery = vi.fn(idle);
export const useScoutingQuery = vi.fn(idle);
export const useMatchPlansQuery = vi.fn(idle);
