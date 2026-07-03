// Derivatives queries: futures contracts and history

'use client';

import { useQuery } from '@tanstack/react-query';
import * as api from '../api';

// ============ Query Keys ============

export const derivativesQueryKeys = {
    derivativesContracts: () => ['derivativesContracts'] as const,
    derivativesHistory: (symbol: string) => ['derivativesHistory', symbol] as const,
};

// ============ Derivatives Queries ============

export function useDerivativesContracts(enabled = true) {
    return useQuery({
        queryKey: derivativesQueryKeys.derivativesContracts(),
        queryFn: () => api.getDerivativesContracts(),
        enabled,
        staleTime: 5 * 60 * 1000,
    });
}

export function useDerivativesHistory(
    symbol: string,
    options?: { startDate?: string; endDate?: string; enabled?: boolean }
) {
    return useQuery({
        queryKey: derivativesQueryKeys.derivativesHistory(symbol),
        queryFn: () => api.getDerivativesHistory(symbol, options),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 1000,
    });
}
