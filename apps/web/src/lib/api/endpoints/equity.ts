// Equity API endpoints

import { fetchAPI } from '../client';
import type {
    EquityHistoricalResponse,
    EquityProfileResponse,
    CompanyNewsResponse,
    CompanyEventsResponse,
    AnalystEstimatesResponse,
    FundamentalAnalysisResponse,
    ShareholdersResponse,
    OfficersResponse,
    IntradayResponse,
    FinancialRatiosResponse,
    RatioHistoryResponse,
    ForeignTradingResponse,
    TransactionFlowResponse,
    SubsidiariesResponse,
    BalanceSheetResponse,
    IncomeStatementResponse,
    CashFlowResponse,
} from '@/types/equity';

// Quote data for real-time price information
export interface QuoteData {
    symbol: string;
    price: number | null;
    open: number | null;
    day_open?: number | null;
    high: number | null;
    day_high?: number | null;
    low: number | null;
    day_low?: number | null;
    prevClose: number | null;
    prev_close?: number | null;
    reference_price?: number | null;
    ref_price?: number | null;
    change: number | null;
    change_1d?: number | null;
    changePct: number | null;
    change_pct?: number | null;
    changePercent?: number | null;
    volume: number | null;
    value: number | null;
    updatedAt: string | null;
    updated_at?: string | null;
}

export interface QuoteResponse {
    symbol: string;
    data: QuoteData;
    cached: boolean;
}

export async function getHistoricalPrices(
    symbol: string,
    options?: {
        startDate?: string;
        endDate?: string;
        interval?: string;
        source?: string;
        adjustmentMode?: 'raw' | 'adjusted';
        signal?: AbortSignal;
    }
): Promise<EquityHistoricalResponse> {
    return fetchAPI<EquityHistoricalResponse>('/equity/historical', {
        params: {
            symbol,
            start_date: options?.startDate,
            end_date: options?.endDate,
            interval: options?.interval,
            source: options?.source,
            adjustment_mode: options?.adjustmentMode,
        },
        signal: options?.signal,
    });
}

export async function getProfile(symbol: string, signal?: AbortSignal): Promise<EquityProfileResponse> {
    return fetchAPI<EquityProfileResponse>(`/equity/${symbol}/profile`, {
        timeout: 20000,
        signal,
    });
}

export async function getQuote(symbol: string, signal?: AbortSignal): Promise<QuoteResponse> {
    return fetchAPI<QuoteResponse>(`/equity/${symbol}/quote`, {
        timeout: 20000,
        signal
    });
}

export async function getCompanyNews(
    symbol: string,
    options?: { limit?: number }
): Promise<CompanyNewsResponse> {
    return fetchAPI<CompanyNewsResponse>(`/equity/${symbol}/news`, {
        params: {
            limit: options?.limit,
        },
    });
}

export async function getCompanyEvents(
    symbol: string,
    options?: { limit?: number }
): Promise<CompanyEventsResponse> {
    return fetchAPI<CompanyEventsResponse>(`/equity/${symbol}/events`, {
        params: {
            limit: options?.limit,
        },
    });
}

export async function getAnalystEstimates(symbol: string): Promise<AnalystEstimatesResponse> {
    return fetchAPI<AnalystEstimatesResponse>(`/equity/${symbol}/analyst-estimates`);
}

export async function getFundamentalAnalysis(symbol: string, signal?: AbortSignal): Promise<FundamentalAnalysisResponse> {
    return fetchAPI<FundamentalAnalysisResponse>(`/equity/${symbol}/fundamental-analysis`, {
        timeout: 20000,
        signal,
    });
}

export async function getShareholders(symbol: string): Promise<ShareholdersResponse> {
    return fetchAPI<ShareholdersResponse>(`/equity/${symbol}/shareholders`);
}

export async function getOfficers(symbol: string): Promise<OfficersResponse> {
    return fetchAPI<OfficersResponse>(`/equity/${symbol}/officers`);
}

export async function getIntraday(
    symbol: string,
    options?: { interval?: string; signal?: AbortSignal }
): Promise<IntradayResponse> {
    return fetchAPI<IntradayResponse>(`/equity/${symbol}/intraday`, {
        params: {
            interval: options?.interval,
        },
        signal: options?.signal,
    });
}

export async function getFinancialRatios(
    symbol: string,
    options?: { period?: string; signal?: AbortSignal }
): Promise<FinancialRatiosResponse> {
    return fetchAPI<FinancialRatiosResponse>(`/equity/${symbol}/ratios`, {
        params: {
            period: options?.period,
        },
        signal: options?.signal,
    });
}

export async function getRatioHistory(
    symbol: string,
    options?: { periods?: number; signal?: AbortSignal }
): Promise<RatioHistoryResponse> {
    return fetchAPI<RatioHistoryResponse>(`/equity/${symbol}/ratio-history`, {
        params: {
            periods: options?.periods,
        },
        signal: options?.signal,
    });
}

export async function getForeignTrading(symbol: string): Promise<ForeignTradingResponse> {
    return fetchAPI<ForeignTradingResponse>(`/equity/${symbol}/foreign-trading`);
}

export async function getTransactionFlow(symbol: string): Promise<TransactionFlowResponse> {
    return fetchAPI<TransactionFlowResponse>(`/equity/${symbol}/transaction-flow`);
}

export async function getSubsidiaries(symbol: string): Promise<SubsidiariesResponse> {
    return fetchAPI<SubsidiariesResponse>(`/equity/${symbol}/subsidiaries`);
}

export async function getBalanceSheet(
    symbol: string,
    options?: { period?: string; signal?: AbortSignal }
): Promise<BalanceSheetResponse> {
    return fetchAPI<BalanceSheetResponse>(`/equity/${symbol}/balance-sheet`, {
        params: {
            period: options?.period,
        },
        signal: options?.signal,
    });
}

export async function getIncomeStatement(
    symbol: string,
    options?: { period?: string; signal?: AbortSignal }
): Promise<IncomeStatementResponse> {
    return fetchAPI<IncomeStatementResponse>(`/equity/${symbol}/income-statement`, {
        params: {
            period: options?.period,
        },
        signal: options?.signal,
    });
}

export async function getCashFlow(
    symbol: string,
    options?: { period?: string; signal?: AbortSignal }
): Promise<CashFlowResponse> {
    return fetchAPI<CashFlowResponse>(`/equity/${symbol}/cash-flow`, {
        params: {
            period: options?.period,
        },
        signal: options?.signal,
    });
}
