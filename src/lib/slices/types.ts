import type { AppState } from '../store';

/**
 * Typed `set`/`get` for slice creators.
 *
 * Every slice in this folder took `(set: any, get: any)`, which meant a slice could read a
 * field that does not exist and write one the store has never heard of, and nothing would
 * say so until it was noticed on screen. Rule 4 in the plan asks for typed slices
 * specifically; this is the smallest thing that delivers it without dragging Zustand's
 * middleware-mutator generics through every file.
 *
 * The `AppState` import is type-only, so the cycle it forms with `store.ts` (which imports
 * the slices' value exports) is erased at compile time and never exists at runtime.
 */
export type SliceSet = (
    partial: Partial<AppState> | ((state: AppState) => Partial<AppState>),
) => void;

export type SliceGet = () => AppState;

export type SliceCreator<T> = (set: SliceSet, get: SliceGet) => T;
