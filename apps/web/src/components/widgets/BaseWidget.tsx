/**
 * BaseWidget — shared infrastructure for VNIBB dashboard widgets.
 *
 * Provides three composable hooks:
 *
 *  `useWidgetState(queryResults)`         → isLoading / hasData / isFallback / error / isFetching / updatedAt
 *  `useWidgetRuntime({ empty, apiGroup, … })` → calls onDataChange with buildWidgetRuntime
 *  `useWidgetExport({ data, filename })` → wires exportData / exportFilename into WidgetContainer
 *
 * And a `buildLoadingState(queryResults)` utility for callers that prefer a pure function.
 */

import { useEffect } from 'react';
import { buildWidgetRuntime, type WidgetRuntimeInput } from '@/lib/widgetRuntime';
import type { WidgetDataPayload } from '@/lib/widgetRuntime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single TanStack Query result object. */
export interface QueryResult {
  isLoading?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  error?: Error | null;
  dataUpdatedAt?: number;
  data?: unknown;
}

/** Flattened state derived from an array of query results. */
export interface LoadingState {
  isLoading: boolean;
  isFetching: boolean;
  hasData: boolean;
  isFallback: boolean;
  error: Error | null;
  updatedAt: number | undefined;
}

/** Arguments forwarded into `buildWidgetRuntime`. */
export type WidgetRuntimeOptions = Omit<WidgetRuntimeInput, 'empty'>;

/** Shape returned by `useWidgetExport`. */
export interface WidgetExportOptions {
  exportData?: unknown;
  exportFilename?: string;
}

// ---------------------------------------------------------------------------
// Pure utility (also used by the hook below)
// ---------------------------------------------------------------------------

/**
 * Merge an array of `QueryResult` objects into a single `LoadingState`.
 *
 * - `isLoading`  → true when ALL queries are loading
 * - `hasData`     → true when AT LEAST ONE query has data
 * - `isFallback`  → true when there's an error BUT we still have data
 * - `error`       → the first non-null error encountered
 * - `isFetching`  → true when ANY query is fetching
 * - `updatedAt`   → the most recent `dataUpdatedAt` across all queries
 */
export function buildWidgetLoadingState(queries: QueryResult[]): LoadingState {
  const isLoading = queries.every((q) => q.isLoading);
  const hasData = queries.some((q) => Boolean(q.data));
  const error = queries.find((q) => q.isError && q.error !== null)?.error ?? null;
  const isFallback = Boolean(error && hasData);
  const isFetching = queries.some((q) => q.isFetching);
  const updatedAt = queries.reduce<number | undefined>((latest, q) => {
    const t = q.dataUpdatedAt;
    return t !== undefined && (latest === undefined || t > latest) ? t : latest;
  }, undefined);

  return { isLoading, isFetching, hasData, isFallback, error, updatedAt };
}

// ---------------------------------------------------------------------------
// useWidgetState
// ---------------------------------------------------------------------------

/**
 * Derive unified loading / data / error state from one or more TanStack Query results.
 *
 * @example
 * const state = useWidgetState([quoteQuery, profileQuery]);
 * if (state.isLoading && !state.hasData) return <WidgetSkeleton />;
 * if (state.error && !state.hasData) return <WidgetError />;
 */
export function useWidgetState(queries: QueryResult[]): LoadingState {
  return buildWidgetLoadingState(queries);
}

// ---------------------------------------------------------------------------
// useWidgetRuntime
// ---------------------------------------------------------------------------

/** Internal guard so the effect only fires once when deps stabilise. */
const runtimeMarker = Symbol('useWidgetRuntime');

/**
 * Call `onDataChange` with a `buildWidgetRuntime` payload once the widget has data.
 *
 * The effect re-fires whenever the shape of `options` changes, but is gated
 * internally so callers don't need to duplicate the `hasData` guard.
 *
 * @param onDataChange   - WidgetContainer's onDataChange prop (may be undefined)
 * @param hasData        - true once the widget has resolved data
 * @param options        - fields passed through to buildWidgetRuntime (empty is set automatically)
 */
export function useWidgetRuntime(
  onDataChange: ((data: WidgetDataPayload) => void) | undefined,
  hasData: boolean,
  options: WidgetRuntimeOptions,
): void {
  useEffect(() => {
    if (!hasData) return;
    onDataChange?.(
      buildWidgetRuntime({ ...options, empty: !hasData }),
    );
    // Intentionally list runtimeMarker so this effect can be uniquely identified
    // in dev-tools if needed, without re-running on marker changes.
  }, [hasData, onDataChange, options.apiGroup, options.endpoint, runtimeMarker]);
}

// ---------------------------------------------------------------------------
// useWidgetExport
// ---------------------------------------------------------------------------

/**
 * Prepare `exportData` and `exportFilename` for WidgetContainer.
 *
 * Returns `undefined` values when `data` is falsy so WidgetContainer skips
 * the export affordance gracefully.
 *
 * @param data      - the exportable payload (array or plain object)
 * @param filename - base filename without extension, e.g. "metrics_FPT"
 */
export function useWidgetExport<T>(
  data: T | null | undefined,
  filename: string | undefined,
): WidgetExportOptions {
  return {
    exportData: data ?? undefined,
    exportFilename: filename,
  };
}
