/**
 * Modest undo/redo stack for ProjectState snapshots.
 * Pure helpers — no React — so smoke tests can exercise push/undo/redo.
 */

import type { ProjectState } from "../schema/types";

export const HISTORY_LIMIT = 40;
export const VALUE_EDIT_DEBOUNCE_MS = 300;

export interface HistoryStack<T> {
  past: T[];
  present: T;
  future: T[];
}

export function cloneProjectState(state: ProjectState): ProjectState {
  return structuredClone(state);
}

export function createHistory<T>(present: T): HistoryStack<T> {
  return { past: [], present, future: [] };
}

export function canUndo<T>(h: HistoryStack<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: HistoryStack<T>): boolean {
  return h.future.length > 0;
}

/** Record `present` into past, set new present, clear future. */
export function pushHistory<T>(
  h: HistoryStack<T>,
  next: T,
  limit: number = HISTORY_LIMIT,
  clone: (v: T) => T = (v) => structuredClone(v)
): HistoryStack<T> {
  const past = [...h.past, clone(h.present)];
  const trimmed = past.length > limit ? past.slice(past.length - limit) : past;
  return {
    past: trimmed,
    present: next,
    future: [],
  };
}

export function undo<T>(
  h: HistoryStack<T>,
  clone: (v: T) => T = (v) => structuredClone(v)
): HistoryStack<T> {
  if (h.past.length === 0) return h;
  const previous = h.past[h.past.length - 1];
  return {
    past: h.past.slice(0, -1),
    present: previous,
    future: [clone(h.present), ...h.future],
  };
}

export function redo<T>(
  h: HistoryStack<T>,
  clone: (v: T) => T = (v) => structuredClone(v)
): HistoryStack<T> {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return {
    past: [...h.past, clone(h.present)],
    present: next,
    future: rest,
  };
}

/**
 * Apply a mutation with an optional coalesce window (e.g. typing).
 * When `coalesce` is true, skips pushing a new past entry (same typing burst).
 * When false, snapshots current present before applying.
 */
export function mutateWithHistory<T>(
  h: HistoryStack<T>,
  mutator: (present: T) => T,
  options: {
    coalesce?: boolean;
    limit?: number;
    clone?: (v: T) => T;
  } = {}
): HistoryStack<T> {
  const clone = options.clone ?? ((v: T) => structuredClone(v));
  const limit = options.limit ?? HISTORY_LIMIT;
  const next = mutator(h.present);
  if (options.coalesce) {
    return { ...h, present: next, future: [] };
  }
  return pushHistory(h, next, limit, clone);
}
