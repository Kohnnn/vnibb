// Screener API endpoints

import { fetchAPI } from '../client';
import type { ScreenerResponse } from '@/types/screener';

export interface ScreenerFilterParams {
    market?: string;
    exchange?: string;
    sector?: string;
    industry?: string;
    minPrice?: number;
    maxPrice?: number;
    minMarketCap?: number;
    maxMarketCap?: number;
    minVolume?: number;
    minPe?: number;
    maxPe?: number;
    minPb?: number;
    maxPb?: number;
    minRoe?: number;
    minROA?: number;
    minDebtToEquity?: number;
    maxDebtToEquity?: number;
    minCurrentRatio?: number;
    minQuickRatio?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
}

export async function getScreenerData(
    options?: ScreenerFilterParams,
    signal?: AbortSignal
): Promise<ScreenerResponse> {
    return fetchAPI<ScreenerResponse>('/screener', {
        params: {
            market: options?.market,
            exchange: options?.exchange,
            sector: options?.sector,
            industry: options?.industry,
            min_price: options?.minPrice,
            max_price: options?.maxPrice,
            min_market_cap: options?.minMarketCap,
            max_market_cap: options?.maxMarketCap,
            min_volume: options?.minVolume,
            min_pe: options?.minPe,
            max_pe: options?.maxPe,
            min_pb: options?.minPb,
            max_pb: options?.maxPb,
            min_roe: options?.minRoe,
            min_roa: options?.minROA,
            min_debt_to_equity: options?.minDebtToEquity,
            max_debt_to_equity: options?.maxDebtToEquity,
            min_current_ratio: options?.minCurrentRatio,
            min_quick_ratio: options?.minQuickRatio,
            sort_by: options?.sortBy,
            sort_order: options?.sortOrder,
            page: options?.page,
            page_size: options?.pageSize,
        },
        signal,
    });
}
