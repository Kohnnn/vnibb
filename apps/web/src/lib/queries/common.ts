// Common query utilities and shared types for TanStack Query hooks

'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { logClientError } from '../clientLogger';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '../pollingPolicy';
import { useDataSources } from '@/contexts/DataSourcesContext';
import type { VnstockSource } from '@/contexts/DataSourcesContext';

// Helper hook to get the preferred VnStock source
export function useVnstockSource(): VnstockSource {
    try {
        const { preferredVnstockSource } = useDataSources();
        return preferredVnstockSource;
    } catch {
        return 'KBS';
    }
}

// Re-export polling utilities
export { getAdaptiveRefetchInterval, POLLING_PRESETS } from '../pollingPolicy';

// Re-export client logger
export { logClientError } from '../clientLogger';

// Generic fetch options
export interface FetchOptions {
    signal?: AbortSignal;
    [key: string]: unknown;
}

// Query key factory types
export type QueryKeyFactory = (...args: unknown[]) => readonly unknown[];

// Query result type helper
export type QueryResult<T> = ReturnType<typeof useQuery<T>>;
