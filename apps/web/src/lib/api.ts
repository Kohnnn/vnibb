// API client for VNIBB backend

import {
    appwriteClearSessionHint,
    appwriteCreateJWT,
    authProvider,
    isAppwriteConfigured,
    isAppwriteUnauthorizedError,
} from './appwrite';
import { env } from './env';
import { isSupabaseConfigured, supabase } from './supabase';
import type { AISettings } from './aiSettings';

const LOCALHOST_OR_LOOPBACK_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i

function getRuntimeApiBaseUrl(rawValue: string): string {
    const trimmed = rawValue.replace(/\/$/, '')
    if (!trimmed) return trimmed

    if (typeof window === 'undefined') {
        return trimmed
    }

    const pageIsHttps = window.location.protocol === 'https:'
    const pageIsLocal = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
    const targetIsHttp = trimmed.startsWith('http://')
    const targetIsLocal = LOCALHOST_OR_LOOPBACK_RE.test(trimmed)

    if (!pageIsHttps || !targetIsHttp) {
        return trimmed
    }

    return targetIsLocal ? trimmed : trimmed.replace(/^http:/, 'https:')
}

export const API_BASE_URL = `${getRuntimeApiBaseUrl(env.apiUrl)}/api/v1`;


interface FetchOptions extends RequestInit {
    params?: Record<string, string | number | boolean | undefined>;
    timeout?: number; // Custom timeout in milliseconds
    auth?: 'required' | 'optional' | 'none';
}

/**
 * Custom API Error class with additional details
 */
export class APIError extends Error {
    status?: number;
    statusText?: string;

    constructor(message: string, status?: number, statusText?: string) {
        super(message);
        this.name = 'APIError';
        this.status = status;
        this.statusText = statusText;
    }
}

/**
 * Specialized error for 429 Rate Limit responses
 */
export class RateLimitError extends APIError {
    retryAfter: number; // in seconds

    constructor(message: string, retryAfter: number = 60) {
        super(message, 429, 'Too Many Requests');
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}


/**
 * Wrapper for fetch with error handling and query params
 * - Adds configurable timeout (default 30s, can be overridden)
 * - Detects network errors
 * - Provides structured error responses
 * - Supports abort signals from calling code
 */
async function fetchAPI<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
    const { params, timeout = 30000, signal, auth = 'none', ...fetchOptions } = options;

    let url = `${API_BASE_URL}${endpoint}`;

    if (params) {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined) {
                searchParams.append(key, String(value));
            }
        });
        const queryString = searchParams.toString();
        if (queryString) {
            url += `?${queryString}`;
        }
    }

    const isBrowser = typeof window !== 'undefined';

    if (isBrowser && window.location.protocol === 'https:' && API_BASE_URL.startsWith('http://')) {
        throw new APIError(
            'Mixed content blocked. API URL must use HTTPS for secure pages.',
            0,
            'MixedContent'
        );
    }

    // Network connectivity check
    if (isBrowser && !navigator.onLine) {
        throw new APIError('You are offline. Please check your internet connection.', 0, 'Offline');
    }

    // Set timeout for requests (configurable, default 30s)
    // Always use an internal controller so timeout and external abort can coexist.
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (signal) {
        if (signal.aborted) {
            controller.abort();
        } else {
            signal.addEventListener('abort', abortFromCaller, { once: true });
        }
    }
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeout);
    const requestSignal = controller.signal;
    const method = String(fetchOptions.method || 'GET').toUpperCase();
    const headers = new Headers(fetchOptions.headers || {});
    const rawBody = fetchOptions.body;
    const shouldJsonEncodeBody =
        rawBody !== undefined &&
        rawBody !== null &&
        typeof rawBody === 'object' &&
        !(rawBody instanceof FormData) &&
        !(rawBody instanceof URLSearchParams) &&
        !(rawBody instanceof Blob) &&
        !(rawBody instanceof ArrayBuffer);
    const requestBody = shouldJsonEncodeBody ? JSON.stringify(rawBody) : rawBody;
    const hasBody = requestBody !== undefined && requestBody !== null;

    if (auth !== 'none' && !headers.has('Authorization')) {
        const token = await getAuthorizationToken();
        if (!token && auth === 'required') {
            throw new APIError('Authentication required. Please log in.', 401, 'Unauthorized');
        }
        if (token) {
            headers.set('Authorization', `Bearer ${token}`);
        }
    }

    if (hasBody && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    if (!hasBody && (method === 'GET' || method === 'HEAD') && headers.get('Content-Type') === 'application/json') {
        headers.delete('Content-Type');
    }

    try {
        const response = await fetch(url, {
            headers,
            signal: requestSignal,
            ...fetchOptions,
            body: requestBody,
        });

        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', abortFromCaller);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({
                detail: response.statusText || 'Unknown error'
            }));

            const detailSource = errorData.detail ?? errorData.details ?? null;
            const normalizedDetail = Array.isArray(detailSource)
                ? detailSource
                    .map((item: any) => {
                        const location = Array.isArray(item?.loc) ? item.loc.join('.') : null
                        return location ? `${location}: ${item?.msg || 'invalid'}` : item?.msg || 'invalid'
                    })
                    .join('; ')
                : typeof detailSource === 'string'
                    ? detailSource
                    : detailSource
                        ? JSON.stringify(detailSource)
                        : null;

            // Generate user-friendly error message based on status
            let errorMessage = normalizedDetail || `API Error: ${response.status}`;

            // Add specific messages for common status codes
            if (response.status === 429) {
                const retryAfterHeader = response.headers.get('Retry-After');
                const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
                errorMessage = `Too many requests. Please try again in ${retryAfter} seconds.`;
                throw new RateLimitError(errorMessage, retryAfter);
            } else if (response.status >= 500) {

                errorMessage = `Server error (${response.status}). ${errorData.detail || 'Please try again later.'}`;
            } else if (response.status === 404) {
                errorMessage = 'The requested data could not be found.';
            } else if (response.status === 401) {
                errorMessage = 'Authentication required. Please log in.';
            } else if (response.status === 403) {
                errorMessage = 'You don\'t have permission to access this data.';
            }

            throw new APIError(errorMessage, response.status, response.statusText);
        }

        return response.json();
    } catch (error: any) {
        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', abortFromCaller);

        // Handle timeout
        if (error.name === 'AbortError') {
            if (!timedOut) {
                throw error;
            }
            const timeoutSec = Math.round(timeout / 1000);
            throw new APIError(
                `Request timed out after ${timeoutSec} seconds. The server is slow or unavailable.`,
                408,
                'Timeout'
            );
        }

        // Handle network errors
        if (error instanceof TypeError && error.message.includes('fetch')) {
            throw new APIError('Network error. Unable to connect to the server.', 0, 'NetworkError');
        }

        // Re-throw API errors
        if (error instanceof APIError) {
            throw error;
        }

        // Generic fallback
        throw new APIError(error.message || 'An unexpected error occurred', 0, 'UnknownError');
    }
}

// ============ Equity API ============

import type { EquityHistoricalResponse, EquityProfileResponse, CompanyNewsResponse, CompanyEventsResponse, AnalystEstimatesResponse, ShareholdersResponse, OfficersResponse, IntradayResponse, FinancialRatiosResponse, RatioHistoryResponse, ForeignTradingResponse, TransactionFlowResponse, CorrelationMatrixResponse, SubsidiariesResponse, BalanceSheetResponse, IncomeStatementResponse, CashFlowResponse, MarketOverviewResponse } from '@/types/equity';
import type { ScreenerResponse } from '@/types/screener';
import type {
    Dashboard,
    DashboardCreate,
    DashboardUpdate,
    SystemDashboardTemplateBundleResponse,
    SystemDashboardTemplateListResponse,
    WidgetCreate,
} from '@/types/dashboard';
import type {
    FibonacciRetracementResponse,
    FullTechnicalAnalysis,
    IchimokuSeriesResponse,
    SignalSummary,
    TechnicalIndicators,
} from '@/types/technical';
import type {
    InsiderTrade,
    BlockTrade,
    InsiderAlert,
    AlertSettings,
    InsiderSentiment
} from '@/types/insider';

export async function getHistoricalPrices(
    symbol: string,
    options?: {
        startDate?: string;
        endDate?: string;
        interval?: string;
        source?: string;
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
        },
        signal: options?.signal,
    });
}

async function getAuthorizationToken(): Promise<string | null> {
    if (typeof window === 'undefined') {
        return null;
    }

    if (window.localStorage.getItem('vnibb_dev_user')) {
        return null;
    }

    if (authProvider === 'appwrite') {
        if (!isAppwriteConfigured) {
            return null;
        }

        try {
            return await appwriteCreateJWT();
        } catch (error) {
            if (isAppwriteUnauthorizedError(error)) {
                appwriteClearSessionHint();
                return null;
            }
            throw error;
        }
    }

    if (!supabase || !isSupabaseConfigured) {
        return null;
    }

    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
}

export async function getProfile(symbol: string, signal?: AbortSignal): Promise<EquityProfileResponse> {
    return fetchAPI<EquityProfileResponse>(`/equity/${symbol}/profile`, {
        timeout: 20000,
        signal,
    });
}


// Quote data for real-time price information
export interface QuoteData {
    symbol: string;
    price: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    prevClose: number | null;
    prev_close?: number | null;
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

export async function getQuote(symbol: string, signal?: AbortSignal): Promise<QuoteResponse> {
    // Quote data can be slow, use 20s timeout
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
    return fetchAPI<AnalystEstimatesResponse>(`/equity/${symbol}/estimates`);
}

export async function getShareholders(symbol: string): Promise<ShareholdersResponse> {
    return fetchAPI<ShareholdersResponse>(`/equity/${symbol}/shareholders`);
}

export async function getOfficers(symbol: string): Promise<OfficersResponse> {
    return fetchAPI<OfficersResponse>(`/equity/${symbol}/officers`);
}

export async function getIntraday(
    symbol: string,
    options?: { limit?: number }
): Promise<IntradayResponse> {
    return fetchAPI<IntradayResponse>(`/equity/${symbol}/intraday`, {
        params: { limit: options?.limit },
    });
}

export async function getFinancialRatios(
    symbol: string,
    options?: { period?: string },
    signal?: AbortSignal
): Promise<FinancialRatiosResponse> {
    return fetchAPI<FinancialRatiosResponse>(`/equity/${symbol}/ratios`, {
        params: { period: normalizeFinancialRatioPeriod(options?.period) },
        signal
    });
}

export async function getRatioHistory(
    symbol: string,
    options?: { ratios?: string[]; period?: 'year' | 'quarter'; limit?: number }
): Promise<RatioHistoryResponse> {
    return fetchAPI<RatioHistoryResponse>(`/equity/${symbol}/ratios/history`, {
        params: {
            ratios: options?.ratios?.join(','),
            period: options?.period,
            limit: options?.limit,
        },
    });
}

export interface MetricsHistoryResponse {
    symbol: string;
    roe: number[];
    roa: number[];
    pe_ratio: number[];
    pb_ratio: number[];
    periods: string[];
}


export async function getMetricsHistory(
    symbol: string,
    days: number = 30,
    metrics: string[] = ['roe', 'roa', 'pe_ratio']
): Promise<MetricsHistoryResponse> {
    const params: Record<string, any> = { days };
    // Note: our fetchAPI doesn't support array params directly yet, but we can join them or modify fetchAPI
    // The task suggests appending multiple times. Let's adjust params handling if needed.

    return fetchAPI<MetricsHistoryResponse>(`/equity/${symbol}/metrics/history`, {
        params: {
            days,
            metrics: metrics.join(',')
        },
    });
}


export async function getForeignTrading(
    symbol: string,
    options?: { limit?: number }
): Promise<ForeignTradingResponse> {
    return fetchAPI<ForeignTradingResponse>(`/equity/${symbol}/foreign-trading`, {
        params: { limit: options?.limit },
    });
}

export async function getTransactionFlow(
    symbol: string,
    options?: { days?: number }
): Promise<TransactionFlowResponse> {
    return fetchAPI<TransactionFlowResponse>(`/equity/${symbol}/transaction-flow`, {
        params: { days: options?.days },
    });
}

export async function getCorrelationMatrix(
    symbol: string,
    options?: { days?: number; top_n?: number }
): Promise<CorrelationMatrixResponse> {
    return fetchAPI<CorrelationMatrixResponse>(`/equity/${symbol}/correlation-matrix`, {
        params: { days: options?.days, top_n: options?.top_n },
    });
}

export async function getSubsidiaries(symbol: string): Promise<SubsidiariesResponse> {
    return fetchAPI<SubsidiariesResponse>(`/equity/${symbol}/subsidiaries`);
}

function normalizeFinancialStatementPeriod(period?: string): string | undefined {
    if (!period) return undefined;
    if (period === 'FY') return 'year';
    if (period === 'Q') return 'quarter';
    return period;
}

function normalizeFinancialRatioPeriod(period?: string): string | undefined {
    if (!period) return undefined;
    if (period === 'FY') return 'FY';
    if (period === 'Q') return 'quarter';
    return period;
}

export async function getBalanceSheet(
    symbol: string,
    options?: { period?: string; limit?: number }
): Promise<BalanceSheetResponse> {
    return fetchAPI<BalanceSheetResponse>(`/equity/${symbol}/balance-sheet`, {
        params: { period: normalizeFinancialStatementPeriod(options?.period), limit: options?.limit },
    });
}

export async function getIncomeStatement(
    symbol: string,
    options?: { period?: string; limit?: number }
): Promise<IncomeStatementResponse> {
    return fetchAPI<IncomeStatementResponse>(`/equity/${symbol}/income-statement`, {
        params: { period: normalizeFinancialStatementPeriod(options?.period), limit: options?.limit },
    });
}

export async function getCashFlow(
    symbol: string,
    options?: { period?: string; limit?: number }
): Promise<CashFlowResponse> {
    return fetchAPI<CashFlowResponse>(`/equity/${symbol}/cash-flow`, {
        params: { period: normalizeFinancialStatementPeriod(options?.period), limit: options?.limit },
    });
}


export async function getMarketOverview(signal?: AbortSignal): Promise<MarketOverviewResponse> {
    // Market overview is slow (4 indices), use 15s timeout
    return fetchAPI<MarketOverviewResponse>('/market/indices', {
        timeout: 15000,
        signal
    });
}

export interface WorldIndexData {
    symbol: string;
    name: string;
    value: number | null;
    change: number | null;
    change_pct: number | null;
    updated_at?: string | null;
}

export interface WorldIndicesResponse {
    count: number;
    data: WorldIndexData[];
    source: string;
    error?: string | null;
}

export interface ForexRateData {
    currency_code: string;
    currency_name?: string | null;
    buy_cash: number | null;
    buy_transfer: number | null;
    sell: number | null;
    date?: string | null;
}

export interface ForexRatesResponse {
    count: number;
    data: ForexRateData[];
    source: string;
    error?: string | null;
}

export interface CommodityData {
    source: string;
    name?: string | null;
    symbol?: string | null;
    buy_price: number | null;
    sell_price: number | null;
    reference_price?: number | null;
    time?: string | null;
}

export interface CommoditiesResponse {
    count: number;
    data: CommodityData[];
    source: string;
    error?: string | null;
}

export async function getWorldIndices(options?: { limit?: number }): Promise<WorldIndicesResponse> {
    return fetchAPI<WorldIndicesResponse>('/market/world-indices', {
        params: { limit: options?.limit },
        timeout: 20000,
    });
}

export async function getForexRates(options?: { limit?: number }): Promise<ForexRatesResponse> {
    return fetchAPI<ForexRatesResponse>('/market/forex-rates', {
        params: { limit: options?.limit },
        timeout: 20000,
    });
}

export async function getCommodities(options?: { limit?: number }): Promise<CommoditiesResponse> {
    return fetchAPI<CommoditiesResponse>('/market/commodities', {
        params: { limit: options?.limit },
        timeout: 20000,
    });
}

// ============ Screener API ============

export interface ScreenerFilterParams {
    symbol?: string;
    exchange?: string;
    industry?: string;
    limit?: number;
    source?: 'KBS' | 'VCI' | 'DNSE';

    // Dynamic Filters
    filters?: string; // JSON FilterGroup
    sort?: string;    // Multi-sort string (e.g. "field:order,field2:order")
    // Legacy filters (keep for compatibility)
    pe_min?: number;
    pe_max?: number;
    pb_min?: number;
    pb_max?: number;
    ps_min?: number;
    ps_max?: number;
    roe_min?: number;
    roa_min?: number;
    debt_to_equity_max?: number;
    market_cap_min?: number;
    market_cap_max?: number;
    volume_min?: number;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
}

export async function getScreenerData(options?: ScreenerFilterParams, signal?: AbortSignal): Promise<ScreenerResponse> {
    // Dynamically build params to include all options
    const params: Record<string, any> = {};
    if (options) {
        Object.entries(options).forEach(([key, value]) => {
            if (value !== undefined) {
                params[key] = value;
            }
        });
    }

    const response = await fetchAPI<ScreenerResponse>('/screener/', {
        params,
        timeout: 45000,
        signal,
    });

    return {
        ...response,
        data: Array.isArray(response.data)
            ? response.data.map((row: any) => {
                const resolvedSymbol = row?.symbol ?? row?.ticker ?? null;
                return {
                    ...row,
                    symbol: resolvedSymbol,
                    ticker: row?.ticker ?? resolvedSymbol,
                };
            })
            : [],
    };
}


// ============ Dashboard API ============

export async function getDashboards(userId = 'anonymous'): Promise<{ count: number; data: Dashboard[] }> {
    void userId;
    return fetchAPI('/dashboard/', {
        auth: 'required',
    });
}

export async function getDashboard(id: number): Promise<Dashboard> {
    return fetchAPI(`/dashboard/${id}`, {
        auth: 'required',
    });
}

export async function createDashboard(data: DashboardCreate): Promise<Dashboard> {
    return fetchAPI('/dashboard/', {
        method: 'POST',
        body: JSON.stringify(data),
        auth: 'required',
    });
}

export async function updateDashboard(
    id: number,
    data: DashboardUpdate
): Promise<Dashboard> {
    return fetchAPI(`/dashboard/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        auth: 'required',
    });
}

export async function deleteDashboard(id: number): Promise<void> {
    return fetchAPI(`/dashboard/${id}`, {
        method: 'DELETE',
        auth: 'required',
    });
}

export async function addWidget(dashboardId: number, data: WidgetCreate): Promise<Dashboard> {
    return fetchAPI(`/dashboard/${dashboardId}/widgets`, {
        method: 'POST',
        body: JSON.stringify(data),
        auth: 'required',
    });
}

export async function removeWidget(dashboardId: number, widgetId: number): Promise<void> {
    return fetchAPI(`/dashboard/${dashboardId}/widgets/${widgetId}`, {
        method: 'DELETE',
        auth: 'required',
    });
}

export async function getPublishedSystemDashboardTemplates(): Promise<SystemDashboardTemplateListResponse> {
    return fetchAPI<SystemDashboardTemplateListResponse>('/dashboard/system-layouts/published');
}

export async function getAdminSystemDashboardTemplateBundle(
    dashboardKey: string,
    adminKey: string,
): Promise<SystemDashboardTemplateBundleResponse> {
    return fetchAPI<SystemDashboardTemplateBundleResponse>(`/admin/system-layouts/${dashboardKey}`, {
        headers: { 'X-Admin-Key': adminKey },
    });
}

export async function saveAdminSystemDashboardTemplate(
    dashboardKey: string,
    payload: { dashboard: Dashboard; notes?: string; publish?: boolean },
    adminKey: string,
): Promise<SystemDashboardTemplateBundleResponse> {
    return fetchAPI<SystemDashboardTemplateBundleResponse>(`/admin/system-layouts/${dashboardKey}`, {
        method: 'PUT',
        headers: { 'X-Admin-Key': adminKey },
        body: payload as unknown as BodyInit,
    });
}

// ============ Listing API ============

export interface SymbolsResponse {
    count: number;
    data: Array<{ symbol: string; organ_name: string }>;
}

export interface IndustriesResponse {
    count: number;
    data: Array<{
        symbol: string;
        organ_name: string;
        icb_name2: string;
        icb_name3: string;
        icb_name4: string;
    }>;
}

export async function getSymbols(options?: { limit?: number }): Promise<SymbolsResponse> {
    return fetchAPI<SymbolsResponse>('/listing/symbols', {
        params: { limit: options?.limit },
    });
}

export async function getSymbolsByExchange(exchange: 'HOSE' | 'HNX' | 'UPCOM'): Promise<SymbolsResponse> {
    return fetchAPI<SymbolsResponse>('/listing/exchanges', {
        params: { exchange },
    });
}

export async function getSymbolsByGroup(group: string): Promise<SymbolsResponse> {
    return fetchAPI<SymbolsResponse>(`/listing/groups/${group}`);
}

export async function getIndustries(): Promise<IndustriesResponse> {
    return fetchAPI<IndustriesResponse>('/listing/industries');
}

// ============ Trading API ============

export interface PriceBoardResponse {
    count: number;
    data: Array<{
        symbol: string;
        price: number;
        change: number;
        change_pct: number;
        volume: number;
        ref_price: number;
        ceiling: number;
        floor: number;
    }>;
}

export async function getPriceBoard(symbols: string[]): Promise<PriceBoardResponse> {
    return fetchAPI<PriceBoardResponse>('/trading/price-board', {
        params: { symbols: symbols.join(',') },
    });
}

// ============ Derivatives API ============

export interface DerivativesContractsResponse {
    count: number;
    data: Array<{ symbol: string; name: string; expiry: string }>;
}

export interface DerivativesHistoryResponse {
    count: number;
    symbol: string;
    data: Array<{
        time: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
    }>;
}

export async function getDerivativesContracts(): Promise<DerivativesContractsResponse> {
    return fetchAPI<DerivativesContractsResponse>('/derivatives/contracts');
}

export async function getDerivativesHistory(
    symbol: string,
    options?: { startDate?: string; endDate?: string }
): Promise<DerivativesHistoryResponse> {
    return fetchAPI<DerivativesHistoryResponse>(`/derivatives/${symbol}/history`, {
        params: {
            start_date: options?.startDate,
            end_date: options?.endDate,
        },
    });
}

// ============ Additional Equity Endpoints ============

export interface PriceDepthResponse {
    data: {
        symbol: string;
        entries: Array<{
            level?: number;
            price?: number;
            bid_vol?: number;
            ask_vol?: number;
        }>;
        total_bid_volume?: number;
        total_ask_volume?: number;
        last_price?: number;
        last_volume?: number;
    };
    meta?: {
        count: number;
    };
    error?: string | null;
}

export interface InsiderDealsResponse {
    count: number;
    data: Array<{
        id: string;
        person_name: string;
        position: string;
        transaction_type: string;
        quantity: number;
        price: number;
        date: string;
    }>;
}

export interface DividendRecord {
    symbol?: string;
    ex_date?: string | null;
    record_date?: string | null;
    payment_date?: string | null;
    type?: string | null;
    dividend_type?: string | null;
    raw_dividend_type?: string | null;
    cash_dividend?: number | null;
    stock_dividend?: number | null;
    dividend_ratio?: number | string | null;
    value?: number | null;
    fiscal_year?: number | null;
    issue_year?: number | null;
    year?: number | null;
    annual_dps?: number | null;
    dividend_yield?: number | null;
    description?: string | null;
}

export interface DividendsResponse {
    count?: number;
    data: DividendRecord[];
    meta?: {
        count?: number;
    };
    error?: string | null;
}

export interface TradingStatsResponse {
    symbol: string;
    data: {
        high_52w: number;
        low_52w: number;
        avg_volume_10d: number;
        avg_volume_30d: number;
        beta: number;
    };
}

export async function getPriceDepth(symbol: string): Promise<PriceDepthResponse> {
    return fetchAPI<PriceDepthResponse>(`/equity/${symbol}/orderbook`);
}

export async function getInsiderDeals(
    symbol: string,
    options?: { limit?: number }
): Promise<InsiderTrade[]> {
    return fetchAPI<InsiderTrade[]>(`/insider/${symbol}/deals`, {
        params: { limit: options?.limit },
    });
}

export async function getRecentInsiderDeals(
    options?: { limit?: number }
): Promise<InsiderTrade[]> {
    return fetchAPI<InsiderTrade[]>('/insider/recent', {
        params: { limit: options?.limit },
    });
}

export async function getInsiderSentiment(
    symbol: string,
    days = 90
): Promise<InsiderSentiment> {
    return fetchAPI<InsiderSentiment>(`/insider/${symbol}/sentiment`, {
        params: { days },
    });
}

export async function getBlockTrades(
    options?: { symbol?: string; limit?: number }
): Promise<BlockTrade[]> {
    return fetchAPI<BlockTrade[]>('/insider/block-trades', {
        params: {
            symbol: options?.symbol,
            limit: options?.limit
        },
    });
}

export async function getInsiderAlerts(
    options?: { userId?: number; unreadOnly?: boolean; limit?: number }
): Promise<InsiderAlert[]> {
    return fetchAPI<InsiderAlert[]>('/alerts/insider', {
        params: {
            user_id: options?.userId,
            unread_only: options?.unreadOnly,
            limit: options?.limit,
        },
    });
}

export async function markAlertRead(alertId: number): Promise<InsiderAlert> {
    return fetchAPI<InsiderAlert>(`/alerts/${alertId}/read`, {
        method: 'PUT',
    });
}

export async function getAlertSettings(userId: number): Promise<AlertSettings> {
    return fetchAPI<AlertSettings>('/alerts/settings', {
        params: { user_id: userId },
    });
}

export async function updateAlertSettings(
    userId: number,
    settings: Partial<AlertSettings>
): Promise<AlertSettings> {
    return fetchAPI<AlertSettings>('/alerts/settings', {
        method: 'PUT',
        params: { user_id: userId },
        body: JSON.stringify(settings),
    });
}

export async function getDividends(symbol: string): Promise<DividendsResponse> {
    return fetchAPI<DividendsResponse>(`/equity/${symbol}/dividends`);
}

export async function getTradingStats(symbol: string): Promise<TradingStatsResponse> {
    return fetchAPI<TradingStatsResponse>(`/equity/${symbol}/trading-stats`);
}

// ============ Top Movers API ============

export interface TopMoverData {
    symbol: string;
    index: string;
    last_price?: number;
    price_change?: number;
    price_change_pct?: number;
    volume?: number;
    value?: number;
    avg_volume_20d?: number;
    volume_spike_pct?: number;
    updated_at?: string | null;
}

export interface TopMoversResponse {
    type: string;
    index: string;
    count: number;
    data: TopMoverData[];
    updated_at?: string | null;
}

export async function getTopGainers(options?: {
    index?: 'VNINDEX' | 'HNX' | 'VN30';
    limit?: number;
}): Promise<TopMoversResponse> {
    return fetchAPI<TopMoversResponse>('/trading/top-gainers', {
        params: { index: options?.index, limit: options?.limit },
    });
}

export async function getTopLosers(options?: {
    index?: 'VNINDEX' | 'HNX' | 'VN30';
    limit?: number;
}): Promise<TopMoversResponse> {
    return fetchAPI<TopMoversResponse>('/trading/top-losers', {
        params: { index: options?.index, limit: options?.limit },
    });
}

export async function getTopVolume(options?: {
    index?: 'VNINDEX' | 'HNX' | 'VN30';
    limit?: number;
}): Promise<TopMoversResponse> {
    return fetchAPI<TopMoversResponse>('/trading/top-volume', {
        params: { index: options?.index, limit: options?.limit },
    });
}

export async function getTopValue(options?: {
    index?: 'VNINDEX' | 'HNX' | 'VN30';
    limit?: number;
}): Promise<TopMoversResponse> {
    return fetchAPI<TopMoversResponse>('/trading/top-value', {
        params: { index: options?.index, limit: options?.limit },
    });
}

export async function getTopMovers(options?: {
    type?: 'gainer' | 'loser' | 'volume' | 'value';
    index?: 'VNINDEX' | 'HNX' | 'VN30';
    limit?: number;
}): Promise<TopMoversResponse> {
    return fetchAPI<TopMoversResponse>('/market/top-movers', {
        params: {
            type: options?.type,
            index: options?.index,
            limit: options?.limit
        },
    });
}

// Sector Top Movers
export interface SectorStockData {
    symbol: string;
    price?: number;
    change?: number;
    change_pct?: number;
    volume?: number;
}

export interface SectorTopMoversData {
    sector: string;
    sector_vi?: string;
    stocks: SectorStockData[];
}

export interface SectorTopMoversResponse {
    count: number;
    type: string;
    sectors?: SectorTopMoversData[];
    data?: SectorTopMoversData[];
    updated_at?: string;
}

export interface SectorCatalogEntry {
    name: string;
    name_en: string;
    symbols: string[];
    keywords?: string[];
    icb_codes?: string[];
}

export type SectorCatalogResponse = Record<string, SectorCatalogEntry>;

export async function getSectorsCatalog(options?: {
    symbolLimit?: number;
}): Promise<SectorCatalogResponse> {
    return fetchAPI<SectorCatalogResponse>('/sectors', {
        params: {
            symbol_limit: options?.symbolLimit,
        },
    });
}

export async function getSectorTopMovers(options?: {
    type?: 'gainers' | 'losers';
    limit?: number;
    source?: 'KBS' | 'VCI' | 'DNSE';

}): Promise<SectorTopMoversResponse> {
    const params = {
        type: options?.type,
        limit: options?.limit,
        source: options?.source,
    };

    try {
        return await fetchAPI<SectorTopMoversResponse>('/sectors/top-movers', { params });
    } catch {
        return fetchAPI<SectorTopMoversResponse>('/trading/sector-top-movers', { params });
    }
}

// ============ Sector Performance API ============

export interface StockBrief {
    symbol: string;
    price?: number | null;
    changePct?: number | null;
}

export interface SectorPerformanceData {
    sectorId: string;
    sectorName: string;
    sectorNameEn: string;
    changePct?: number | null;
    topGainer?: StockBrief | null;
    topLoser?: StockBrief | null;
    totalStocks: number;
    stocks: StockBrief[];
}

export interface SectorPerformanceResponse {
    count: number;
    data: SectorPerformanceData[];
}

export async function getSectorPerformance(_options?: {
    source?: 'KBS' | 'VCI' | 'DNSE';

}): Promise<SectorPerformanceResponse> {
    return fetchAPI<SectorPerformanceResponse>('/market/sector-performance');
}

export interface SectorBoardStock {
    symbol: string;
    price?: number | null;
    change_pct?: number | null;
    volume?: number | null;
    market_cap?: number | null;
    color: string;
}

export interface SectorBoardSector {
    name: string;
    change_pct: number;
    stocks: SectorBoardStock[];
}

export interface SectorBoardResponse {
    market_summary: Record<string, { value?: number | null; change_pct?: number | null; time?: string | null }>;
    sectors: SectorBoardSector[];
    sort_by: string;
    limit_per_sector: number;
    updated_at?: string | null;
}

export async function getSectorBoard(options?: {
    limit_per_sector?: number;
    sectors?: string;
    sort_by?: 'volume' | 'market_cap' | 'change_pct';
}): Promise<SectorBoardResponse> {
    return fetchAPI<SectorBoardResponse>('/market/sector-board', { params: options });
}

export interface MoneyFlowTrailPoint {
    date: string;
    s_trend?: number | null;
    s_strength?: number | null;
}

export interface MoneyFlowTrendStock {
    symbol: string;
    name?: string | null;
    sector?: string | null;
    price?: number | null;
    change_pct?: number | null;
    s_trend?: number | null;
    s_strength?: number | null;
    quadrant: string;
    color: string;
    trail: MoneyFlowTrailPoint[];
}

export interface MoneyFlowTrendResponse {
    timeframe: 'short' | 'medium' | 'long';
    benchmark: string;
    center: [number, number];
    reference_symbol?: string | null;
    sector?: string | null;
    stocks: MoneyFlowTrendStock[];
    updated_at?: string | null;
}

export async function getMoneyFlowTrend(options?: {
    symbol?: string;
    symbols?: string;
    sector?: string;
    timeframe?: 'short' | 'medium' | 'long';
    trail_length?: number;
}): Promise<MoneyFlowTrendResponse> {
    return fetchAPI<MoneyFlowTrendResponse>('/market/money-flow-trend', { params: options });
}

export type ResearchRssSource = 'cafef' | 'vietstock' | 'vnexpress'

export interface ResearchRssItem {
    title: string
    url: string
    published_at?: string | null
    description?: string | null
}

export interface ResearchRssFeedResponse {
    source: ResearchRssSource
    count: number
    data: ResearchRssItem[]
    fetched_at: string
    error?: string | null
}

export async function getResearchRssFeed(
    source: ResearchRssSource,
    limit = 10
): Promise<ResearchRssFeedResponse> {
    return fetchAPI<ResearchRssFeedResponse>('/market/research/rss-feed', {
        params: {
            source,
            limit,
        },
        timeout: 15000,
    })
}

// ============ Ownership & Rating API ============

export interface OwnershipData {
    symbol: string;
    owner_name?: string;
    owner_type?: string;
    shares?: number;
    ownership_pct?: number;
    change_shares?: number;
    change_pct?: number;
    report_date?: string;
}

export interface OwnershipResponse {
    symbol: string;
    count: number;
    data: OwnershipData[];
}

export interface GeneralRatingData {
    symbol: string;
    valuation_score?: number;
    financial_health_score?: number;
    business_model_score?: number;
    business_operation_score?: number;
    overall_score?: number;
    industry_rank?: number;
    industry_total?: number;
    recommendation?: string;
    target_price?: number;
    upside_pct?: number;
}

export interface GeneralRatingResponse {
    symbol: string;
    data: GeneralRatingData;
}

export async function getOwnership(symbol: string): Promise<OwnershipResponse> {
    return fetchAPI<OwnershipResponse>(`/equity/${symbol}/ownership`);
}

export async function getRating(symbol: string): Promise<GeneralRatingResponse> {
    return fetchAPI<GeneralRatingResponse>(`/equity/${symbol}/rating`);
}

// ============ Financials API ============

export interface FinancialStatementData {
    symbol: string;
    period: string;
    statement_type: string;
    revenue?: number;
    gross_profit?: number;
    operating_income?: number;
    net_income?: number;
    ebitda?: number;
    eps?: number;
    eps_diluted?: number;
    cost_of_revenue?: number;
    pre_tax_profit?: number;
    profit_before_tax?: number;
    tax_expense?: number;
    interest_expense?: number;
    depreciation?: number;
    selling_general_admin?: number;
    research_development?: number;
    other_income?: number;
    total_assets?: number;
    current_assets?: number;
    fixed_assets?: number;
    total_liabilities?: number;
    current_liabilities?: number;
    long_term_liabilities?: number;
    short_term_debt?: number;
    long_term_debt?: number;
    total_equity?: number;
    retained_earnings?: number;
    cash_and_equivalents?: number;
    cash?: number;
    inventory?: number;
    accounts_receivable?: number;
    accounts_payable?: number;
    customer_deposits?: number;
    goodwill?: number;
    intangible_assets?: number;
    operating_cash_flow?: number;
    investing_cash_flow?: number;
    financing_cash_flow?: number;
    free_cash_flow?: number;
    net_change_in_cash?: number;
    net_cash_flow?: number;
    capex?: number;
    capital_expenditure?: number;
    dividends_paid?: number;
    stock_repurchased?: number;
    debt_repayment?: number;
    raw_data?: Record<string, unknown>;
}

export interface FinancialsResponse {
    symbol: string;
    statement_type: string;
    period: string;
    count: number;
    data: FinancialStatementData[];
}

export async function getFinancials(
    symbol: string,
    options?: {
        type?: 'income' | 'balance' | 'cashflow';
        period?: 'year' | 'quarter' | 'FY' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'TTM';
        limit?: number;
    }
): Promise<FinancialsResponse> {
    return fetchAPI<FinancialsResponse>(`/equity/${symbol}/financials`, {
        params: {
            statement_type: options?.type,
            period: options?.period,
            limit: options?.limit,
        },
    });
}

// ============ Comparison Analysis API ============

export interface MetricDefinition {
    id?: string;
    key?: string;
    name?: string;
    label?: string;
    format?: string;
}

export interface StockMetrics {
    symbol: string;
    name?: string | null;
    price?: number | null;
    changePct?: number | null;
    marketCap?: number | null;
    peRatio?: number | null;
    pbRatio?: number | null;
    roe?: number | null;
    roa?: number | null;
    eps?: number | null;
    dividendYield?: number | null;
    volume?: number | null;
    high52w?: number | null;
    low52w?: number | null;
    beta?: number | null;
    debtEquity?: number | null;
    revenueGrowth?: number | null;
}

export interface StockComparison {
    symbol: string;
    company_name: string;
    metrics: Record<string, number | null>;
}

export interface ComparisonResponse {
    metrics: MetricDefinition[];
    stocks: StockComparison[];
    period: string;
    generated_at?: string;
}

export type ComparisonPerformancePeriod = '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y' | 'YTD' | 'ALL'

export interface ComparisonPerformancePoint {
    date: string
    [symbol: string]: string | number
}

export async function getComparisonPerformance(
    symbols: string[],
    period: ComparisonPerformancePeriod = '1M'
): Promise<ComparisonPerformancePoint[]> {
    return fetchAPI<ComparisonPerformancePoint[]>('/comparison/performance', {
        params: {
            symbols: symbols.join(','),
            period,
        },
    })
}


export async function compareStocks(symbols: string[], period: string = "FY"): Promise<ComparisonResponse> {
    return fetchAPI<ComparisonResponse>('/comparison', {
        params: {
            symbols: symbols.join(','),
            period
        },
    });
}


// Peer Companies API
export interface PeerCompany {
    symbol: string;
    name?: string | null;
    market_cap?: number | null;
    pe_ratio?: number | null;
    sector?: string | null;
    industry?: string | null;
}

export interface PeersResponse {
    symbol: string;
    sector?: string | null;
    industry?: string | null;
    count: number;
    peers: PeerCompany[];
}

export interface SearchTickerResult {
    symbol: string;
    name: string;
    type: 'vn_stock' | 'crypto' | 'index' | 'us_stock';
    exchange?: string | null;
    tv_symbol?: string | null;
}

export interface SearchTickersResponse {
    count: number;
    results: SearchTickerResult[];
}

export async function searchTickers(query: string, options?: { limit?: number }): Promise<SearchTickersResponse> {
    return fetchAPI<SearchTickersResponse>('/search/tickers', {
        params: { q: query, limit: options?.limit },
    });
}

export async function getPeerCompanies(symbol: string, limit = 5): Promise<PeersResponse> {
    return fetchAPI<PeersResponse>(`/equity/${symbol}/peers`, {
        params: { limit },
    });
}

// ============ Quant API ============

export type QuantPeriod = '1M' | '6M' | '1Y' | '3Y' | '5Y' | 'ALL'

export type QuantMetric =
    | 'seasonality'
    | 'volume_delta'
    | 'rsi_seasonal'
    | 'gap_stats'
    | 'bollinger'
    | 'atr'
    | 'sortino'
    | 'calmar'
    | 'macd_crossovers'
    | 'parkinson_volatility'
    | 'ema_respect'
    | 'drawdown_recovery'

export interface QuantResponse {
    data: {
        symbol: string
        period: QuantPeriod
        computed_at: string
        last_data_date?: string | null
        metrics: Record<string, any>
        warning?: string | null
    }
    meta?: {
        count?: number
    }
    error?: string | null
}

export async function getQuantMetrics(
    symbol: string,
    options?: {
        period?: QuantPeriod
        metrics?: QuantMetric[]
        source?: 'KBS' | 'VCI' | 'DNSE'
    }
): Promise<QuantResponse> {
    return fetchAPI<QuantResponse>(`/quant/${symbol}`, {
        params: {
            period: options?.period ?? '5Y',
            metrics: options?.metrics?.join(','),
            source: options?.source,
        },
        timeout: 30000,
    })
}

export interface GammaExposureBand {
    strike: number | null;
    offset_pct: number | null;
    net_gamma: number | null;
}

export interface GammaExposurePayload {
    symbol: string;
    period: QuantPeriod;
    computed_at: string;
    last_data_date?: string | null;
    current_close: number | null;
    current_realized_vol_30d_pct: number | null;
    regime_z_score: number | null;
    net_gamma_proxy: number | null;
    dealer_position_proxy: 'long_gamma' | 'short_gamma' | 'neutral' | 'unknown';
    regime_label: string;
    bands: GammaExposureBand[];
    data_quality_note?: string;
}

export interface GammaExposureResponse {
    data: GammaExposurePayload;
    meta?: { count?: number };
    error?: string | null;
}

export interface MomentumPeerPoint {
    symbol: string;
    momentum_12_1_pct: number | null;
}

export interface MomentumProfilePayload {
    symbol: string;
    period: QuantPeriod;
    computed_at: string;
    last_data_date?: string | null;
    data_quality_note?: string;
    returns_pct: {
        r1m?: number | null;
        r3m?: number | null;
        r6m?: number | null;
        r12m?: number | null;
        momentum_12_1?: number | null;
    };
    momentum_score: number;
    trend_label: string;
    sector?: string | null;
    sector_rank?: number | null;
    sector_total?: number | null;
    sector_percentile?: number | null;
    peer_distribution: MomentumPeerPoint[];
}

export interface MomentumProfileResponse {
    data: MomentumProfilePayload;
    meta?: { count?: number };
    error?: string | null;
}

export interface EarningsQualitySeriesPoint {
    period: string;
    accruals_ratio_pct?: number | null;
    revenue_quality_pct?: number | null;
    eps?: number | null;
    net_income?: number | null;
    operating_cash_flow?: number | null;
}

export interface EarningsQualityPayload {
    symbol: string;
    computed_at: string;
    grade: string;
    quality_score: number | null;
    trend: 'Improving' | 'Stable' | 'Declining' | string;
    accruals_ratio_pct: number | null;
    revenue_quality_pct: number | null;
    earnings_persistence: number | null;
    component_scores: {
        accrual?: number | null;
        revenue_quality?: number | null;
        persistence?: number | null;
    };
    checks: string[];
    series: EarningsQualitySeriesPoint[];
}

export interface EarningsQualityResponse {
    data: EarningsQualityPayload;
    meta?: { count?: number };
    error?: string | null;
}

export interface SmartMoneyEvent {
    date: string;
    volume?: number | null;
    value?: number | null;
    type: 'accumulation' | 'distribution' | string;
    source?: string;
}

export interface SmartMoneyPayload {
    symbol: string;
    computed_at: string;
    net_institutional: 'buying' | 'selling' | 'neutral' | string;
    flow_score: number;
    net_foreign_20d_value?: number | null;
    block_buy_20d_value?: number | null;
    block_sell_20d_value?: number | null;
    synthetic_block_bias?: number | null;
    block_trades: SmartMoneyEvent[];
}

export interface SmartMoneyResponse {
    data: SmartMoneyPayload;
    meta?: { count?: number };
    error?: string | null;
}

export interface RelativeRotationPoint {
    symbol: string;
    rs_ratio: number | null;
    rs_momentum: number | null;
    quadrant: 'Leading' | 'Weakening' | 'Lagging' | 'Improving' | 'Unknown' | string;
    trail: Array<{
        rs_ratio: number | null;
        rs_momentum: number | null;
    }>;
}

export interface RelativeRotationPayload {
    symbol: string;
    benchmark: string;
    computed_at: string;
    selected: RelativeRotationPoint | null;
    universe: RelativeRotationPoint[];
}

export interface RelativeRotationResponse {
    data: RelativeRotationPayload;
    meta?: { count?: number };
    error?: string | null;
}

export async function getGammaExposure(
    symbol: string,
    options?: {
        period?: QuantPeriod;
        source?: 'KBS' | 'VCI' | 'DNSE';
    }
): Promise<GammaExposureResponse> {
    return fetchAPI<GammaExposureResponse>(`/quant/${symbol}/gamma-exposure`, {
        params: {
            period: options?.period ?? '3Y',
            source: options?.source,
        },
        timeout: 30000,
    });
}

export async function getMomentumProfile(
    symbol: string,
    options?: {
        period?: QuantPeriod;
        source?: 'KBS' | 'VCI' | 'DNSE';
    }
): Promise<MomentumProfileResponse> {
    return fetchAPI<MomentumProfileResponse>(`/quant/${symbol}/momentum`, {
        params: {
            period: options?.period ?? '3Y',
            source: options?.source,
        },
        timeout: 30000,
    });
}

export async function getEarningsQuality(symbol: string): Promise<EarningsQualityResponse> {
    return fetchAPI<EarningsQualityResponse>(`/quant/${symbol}/earnings-quality`, {
        timeout: 30000,
    });
}

export async function getSmartMoneyFlow(symbol: string): Promise<SmartMoneyResponse> {
    return fetchAPI<SmartMoneyResponse>(`/quant/${symbol}/smart-money`, {
        timeout: 30000,
    });
}

export async function getRelativeRotation(
    symbol: string,
    options?: {
        lookbackDays?: number;
    }
): Promise<RelativeRotationResponse> {
    return fetchAPI<RelativeRotationResponse>(`/quant/${symbol}/relative-rotation`, {
        params: {
            lookback_days: options?.lookbackDays,
        },
        timeout: 30000,
    });
}

// ============ AI Copilot API ============

export interface WidgetContext {
    widgetType: string;
    symbol: string;
    activeTab?: string | null;
    dataSnapshot?: Record<string, unknown>;
    widgetPayload?: Record<string, unknown> | null;
}

export interface CopilotQuery {
    query: string;
    context?: WidgetContext;
}

export interface CopilotResponse {
    answer: string;
    data?: Record<string, unknown> | null;
    suggested_actions: string[];
    intent?: string | null;
}

export interface PromptTemplate {
    id: string;
    label: string;
    template: string;
}

export interface CopilotHistoryMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface CopilotStreamRequest {
    message: string;
    context?: WidgetContext | null;
    history: CopilotHistoryMessage[];
    settings?: AISettings;
}

export interface CopilotSourceRef {
    id: string;
    scope?: string;
    kind?: string;
    label?: string;
    source?: string;
    symbol?: string;
    asOf?: string;
    priority?: number;
}

export interface CopilotReasoningStep {
    eventType: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
    message: string;
    details?: Record<string, unknown>;
}

export interface CopilotStreamEvent {
    chunk?: string;
    done?: boolean;
    error?: string;
    usedSourceIds?: string[];
    sources?: CopilotSourceRef[];
    reasoning?: CopilotReasoningStep;
}

interface RawCopilotSourceRef {
    id?: string;
    scope?: string;
    kind?: string;
    label?: string;
    source?: string;
    symbol?: string;
    as_of?: string;
    priority?: number;
}

interface RawCopilotReasoningStep {
    eventType?: string;
    event_type?: string;
    message?: string;
    details?: Record<string, unknown>;
}

function normalizeCopilotStreamEvent(rawEvent: unknown): CopilotStreamEvent {
    const event = (rawEvent && typeof rawEvent === 'object' ? rawEvent : {}) as Record<string, unknown>;
    const rawSources = Array.isArray(event.sources) ? event.sources as RawCopilotSourceRef[] : [];
    const rawReasoning = (event.reasoning && typeof event.reasoning === 'object'
        ? event.reasoning
        : null) as RawCopilotReasoningStep | null;

    return {
        chunk: typeof event.chunk === 'string' ? event.chunk : undefined,
        done: event.done === true,
        error: typeof event.error === 'string' ? event.error : undefined,
        usedSourceIds: Array.isArray(event.usedSourceIds)
            ? event.usedSourceIds.filter((item): item is string => typeof item === 'string')
            : Array.isArray(event.used_source_ids)
                ? event.used_source_ids.filter((item): item is string => typeof item === 'string')
                : undefined,
        sources: rawSources.map((source) => ({
            id: String(source.id || ''),
            scope: typeof source.scope === 'string' ? source.scope : undefined,
            kind: typeof source.kind === 'string' ? source.kind : undefined,
            label: typeof source.label === 'string' ? source.label : undefined,
            source: typeof source.source === 'string' ? source.source : undefined,
            symbol: typeof source.symbol === 'string' ? source.symbol : undefined,
            asOf: typeof source.as_of === 'string' ? source.as_of : undefined,
            priority: typeof source.priority === 'number' ? source.priority : undefined,
        })).filter((source) => Boolean(source.id)),
        reasoning: rawReasoning && typeof rawReasoning.message === 'string'
            ? {
                eventType: ((rawReasoning.eventType || rawReasoning.event_type || 'INFO').toUpperCase() as CopilotReasoningStep['eventType']),
                message: rawReasoning.message,
                details: rawReasoning.details,
            }
            : undefined,
    };
}

export async function askCopilot(query: CopilotQuery): Promise<CopilotResponse> {
    return fetchAPI<CopilotResponse>('/copilot/ask', {
        method: 'POST',
        body: JSON.stringify(query),
    });
}

export async function openCopilotChatStream(
    request: CopilotStreamRequest,
    signal?: AbortSignal,
): Promise<Response> {
    const isBrowser = typeof window !== 'undefined';
    if (isBrowser && window.location.protocol === 'https:' && API_BASE_URL.startsWith('http://')) {
        throw new APIError(
            'Mixed content blocked. API URL must use HTTPS for secure pages.',
            0,
            'MixedContent'
        );
    }
    if (isBrowser && !navigator.onLine) {
        throw new APIError('You are offline. Please check your internet connection.', 0, 'Offline');
    }

    const headers = new Headers({
        'Content-Type': 'application/json',
    });

    const token = await getAuthorizationToken();
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    return fetch(`${API_BASE_URL}/copilot/chat/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal,
    });
}

export async function consumeCopilotStream(
    response: Response,
    handlers: {
        onChunk?: (chunk: string) => void;
        onReasoning?: (reasoning: CopilotReasoningStep) => void;
        onDone?: (event: CopilotStreamEvent) => void;
    } = {},
): Promise<void> {
    if (!response.ok) {
        const errorText = await response.text();
        throw new APIError(errorText || `API Error: ${response.status}`, response.status, response.statusText);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new APIError('No response body', response.status, response.statusText);
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const eventBlock of events) {
            const dataLine = eventBlock
                .split('\n')
                .find((line) => line.startsWith('data: '));

            if (!dataLine) {
                continue;
            }

            let event: CopilotStreamEvent;
            try {
                event = normalizeCopilotStreamEvent(JSON.parse(dataLine.slice(6)));
            } catch {
                continue;
            }

            if (event.error) {
                throw new APIError(event.error, response.status, response.statusText);
            }

            if (event.chunk) {
                handlers.onChunk?.(event.chunk);
            }

            if (event.reasoning) {
                handlers.onReasoning?.(event.reasoning);
            }

            if (event.done) {
                handlers.onDone?.(event);
            }
        }
    }

    if (buffer.trim().startsWith('data: ')) {
        const trailing = buffer.trim().slice(6);
        let event: CopilotStreamEvent;
        try {
            event = normalizeCopilotStreamEvent(JSON.parse(trailing));
        } catch {
            // Ignore incomplete trailing chunks.
            return;
        }

        if (event.error) {
            throw new APIError(event.error, response.status, response.statusText);
        }
        if (event.chunk) {
            handlers.onChunk?.(event.chunk);
        }
        if (event.reasoning) {
            handlers.onReasoning?.(event.reasoning);
        }
        if (event.done) {
            handlers.onDone?.(event);
        }
    }
}


export async function getCopilotSuggestions(): Promise<{ suggestions: string[] }> {
    return fetchAPI<{ suggestions: string[] }>('/copilot/suggestions');
}

export async function getCopilotPrompts(): Promise<{ prompts: PromptTemplate[] }> {
    return fetchAPI<{ prompts: PromptTemplate[] }>('/copilot/prompts');
}

// ============ Data Export API ============

export function getExportUrl(endpoint: string, params: Record<string, string | number>): string {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
            searchParams.append(key, String(value));
        }
    });
    return `${API_BASE_URL}${endpoint}?${searchParams.toString()}`;
}

export async function exportFinancials(
    symbol: string,
    options: {
        type: 'income' | 'balance' | 'cashflow';
        period?: 'year' | 'quarter';
        limit?: number;
        format?: 'csv' | 'excel';
    }
): Promise<void> {
    const url = getExportUrl(`/export/financials/${symbol}`, {
        statement_type: options.type,
        period: options.period || 'year',
        limit: options.limit || 5,
        format: options.format || 'excel'
    });

    // Trigger download by opening in new window/tab or creating a link
    window.open(url, '_blank');
}

export async function exportHistorical(
    symbol: string,
    options: {
        startDate?: string;
        endDate?: string;
        interval?: string;
        format?: 'csv' | 'excel';
    }
): Promise<void> {
    const params: Record<string, string | number> = {
        format: options.format || 'csv'
    };
    if (options.startDate) params.start_date = options.startDate;
    if (options.endDate) params.end_date = options.endDate;
    if (options.interval) params.interval = options.interval;

    const url = getExportUrl(`/export/historical/${symbol}`, params);
    window.open(url, '_blank');
}

export async function exportPeers(
    symbols: string[],
    options: { format?: 'csv' | 'excel' } = {}
): Promise<void> {
    const url = getExportUrl('/export/peers', {
        symbols: symbols.join(','),
        format: options.format || 'excel'
    });
    window.open(url, '_blank');
}


// ============ Analysis / Technical API ============

export async function getTechnicalIndicators(
    symbol: string,
    options?: { lookbackDays?: number }
): Promise<any> {
    return fetchAPI(`/analysis/ta/${symbol}`, { params: options });
}

export async function getFullTechnicalAnalysis(
    symbol: string,
    options?: { timeframe?: string; lookbackDays?: number }
): Promise<FullTechnicalAnalysis> {
    return fetchAPI<FullTechnicalAnalysis>(`/analysis/ta/${symbol}/full`, { params: options });
}

export async function getTechnicalHistory(
    symbol: string,
    options?: { days?: number }
): Promise<{ symbol: string; indicators: any[] }> {
    return fetchAPI<{ symbol: string; indicators: any[] }>(`/analysis/ta/${symbol}/history`, { params: options });
}

export async function getIchimokuSeries(
    symbol: string,
    options?: { period?: '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y' }
): Promise<IchimokuSeriesResponse> {
    return fetchAPI<IchimokuSeriesResponse>(`/analysis/ta/${symbol}/ichimoku`, {
        params: { period: options?.period || '1Y' },
    });
}

export async function getFibonacciRetracement(
    symbol: string,
    options?: { lookbackDays?: number; direction?: 'auto' | 'up' | 'down' }
): Promise<FibonacciRetracementResponse> {
    return fetchAPI<FibonacciRetracementResponse>(`/analysis/ta/${symbol}/fibonacci`, {
        params: {
            lookback_days: options?.lookbackDays,
            direction: options?.direction || 'auto',
        },
    });
}

// ============ Market Heatmap API ============

export interface HeatmapStock {
    symbol: string;
    name: string;
    sector: string;
    industry?: string | null;
    market_cap: number;
    price: number;
    change: number;
    change_pct: number;
    volume?: number | null;
}

export interface SectorGroup {
    sector: string;
    stocks: HeatmapStock[];
    total_market_cap: number;
    avg_change_pct: number;
    stock_count: number;
}

export interface HeatmapResponse {
    count: number;
    group_by: string;
    color_metric: string;
    size_metric: string;
    sectors: SectorGroup[];
    cached: boolean;
    updated_at?: string | null;
}

export interface MarketBreadthExchangeRow {
    exchange: 'HOSE' | 'HNX' | 'UPCOM';
    total: number;
    advancers: number;
    decliners: number;
    unchanged: number;
    ad_ratio?: number | null;
    pct_above_sma20?: number | null;
    pct_above_sma50?: number | null;
    new_highs_52w: number;
    new_lows_52w: number;
}

export interface MarketBreadthResponse {
    count: number;
    data: MarketBreadthExchangeRow[];
    updated_at?: string | null;
    error?: string | null;
}

export interface EarningsSeasonItem {
    symbol: string;
    name: string;
    exchange?: string | null;
    period: string;
    updated_at?: string | null;
    revenue?: number | null;
    net_income?: number | null;
    eps?: number | null;
    gross_margin?: number | null;
    revenue_yoy?: number | null;
    earnings_yoy?: number | null;
    gross_margin_delta?: number | null;
    score?: number | null;
    signal: string;
}

export interface EarningsSeasonResponse {
    count: number;
    season?: string | null;
    data: EarningsSeasonItem[];
    updated_at?: string | null;
    error?: string | null;
}

export async function getMarketBreadth(): Promise<MarketBreadthResponse> {
    return fetchAPI<MarketBreadthResponse>('/market/breadth');
}

export async function getEarningsSeason(options?: {
    limit?: number;
    exchange?: string;
}): Promise<EarningsSeasonResponse> {
    return fetchAPI<EarningsSeasonResponse>('/market/earnings-season', {
        params: { limit: options?.limit, exchange: options?.exchange },
    });
}

export async function getMarketHeatmap(options?: {
    group_by?: 'sector' | 'industry' | 'vn30' | 'hnx30';
    color_metric?: 'change_pct' | 'weekly_pct' | 'monthly_pct' | 'ytd_pct';
    size_metric?: 'market_cap' | 'volume' | 'value_traded';
    exchange?: 'HOSE' | 'HNX' | 'UPCOM' | 'ALL';
    limit?: number;
    use_cache?: boolean;
}): Promise<HeatmapResponse> {
    return fetchAPI<HeatmapResponse>('/market/heatmap', { params: options });
}

export interface IndustryBubblePoint {
    symbol: string;
    name: string;
    sector: string;
    industry?: string | null;
    x: number;
    y: number;
    size: number;
    price?: number | null;
    change_pct?: number | null;
    color: string;
    is_reference: boolean;
}

export interface IndustryBubbleResponse {
    sector: string;
    reference_symbol: string;
    x_metric: string;
    y_metric: string;
    size_metric: string;
    top_n: number;
    sector_average: {
        x?: number | null;
        y?: number | null;
    };
    data: IndustryBubblePoint[];
    updated_at?: string | null;
}

export async function getIndustryBubble(options: {
    symbol: string;
    x_metric?: string;
    y_metric?: string;
    size_metric?: string;
    top_n?: number;
}): Promise<IndustryBubbleResponse> {
    return fetchAPI<IndustryBubbleResponse>('/market/industry-bubble', { params: options });
}

// ============ RS Rating API ============

export interface RSStockItem {
    symbol: string;
    company_name?: string | null;
    rs_rating: number;
    rs_rank?: number | null;
    price?: number | null;
    industry?: string | null;
}

export interface RSGainerItem extends RSStockItem {
    rs_rating_prev: number;
    rs_rating_change: number;
}

export interface RSLeadersResponse {
    leaders: RSStockItem[];
    total: number;
    sector?: string | null;
}

export interface RSLaggardsResponse {
    laggards: RSStockItem[];
    total: number;
    sector?: string | null;
}

export interface RSGainersResponse {
    gainers: RSGainerItem[];
    total: number;
    lookback_days: number;
}

export interface RSRatingResponse {
    symbol: string;
    rs_rating: number;
    rs_rank?: number | null;
    snapshot_date: string;
}

export async function getRSLeaders(options?: {
    limit?: number;
    sector?: string;
}): Promise<RSLeadersResponse> {
    return fetchAPI<RSLeadersResponse>('/rs/leaders', {
        params: {
            limit: options?.limit,
            sector: options?.sector,
        },
    });
}

export async function getRSLaggards(options?: {
    limit?: number;
    sector?: string;
}): Promise<RSLaggardsResponse> {
    return fetchAPI<RSLaggardsResponse>('/rs/laggards', {
        params: {
            limit: options?.limit,
            sector: options?.sector,
        },
    });
}

export async function getRSGainers(options?: {
    limit?: number;
    lookbackDays?: number;
}): Promise<RSGainersResponse> {
    return fetchAPI<RSGainersResponse>('/rs/gainers', {
        params: {
            limit: options?.limit,
            lookback_days: options?.lookbackDays,
        },
    });
}

export async function getRSRating(symbol: string): Promise<RSRatingResponse> {
    return fetchAPI<RSRatingResponse>(`/rs/${symbol}`);
}

export async function getRSHistory(symbol: string, limit: number = 250): Promise<Array<{ time: string; value: number }>> {
    return fetchAPI<Array<{ time: string; value: number }>>(`/rs/${symbol}/history`, {
        params: { limit }
    });
}

// ============ Chart Data API ============

export interface ChartDataPoint {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface ChartDataResponse {
    symbol: string;
    period: string;
    count: number;
    data: ChartDataPoint[];
}

export async function getChartData(
    symbol: string,
    period: string = '5Y',
    signal?: AbortSignal
): Promise<ChartDataResponse> {
    return fetchAPI<ChartDataResponse>(`/chart-data/${symbol}`, {
        params: { period },
        timeout: 30000,
        signal,
    });
}

// ============ Admin Data Health API ============

export interface DataHealthTableEntry {
    count: number
    latest: string | null
    freshness: 'fresh' | 'recent' | 'stale' | 'critical' | 'unknown'
    age_seconds: number | null
    age_days: number | null
}

export interface DataHealthAlert {
    table: string
    freshness: 'stale' | 'critical' | 'unknown'
    days_stale: number | null
    severity: 'warning' | 'critical'
}

export interface AdminDataHealthResponse {
    timestamp: string
    tables: Record<string, DataHealthTableEntry>
    staleness_alerts: DataHealthAlert[]
    summary: {
        fresh?: number
        recent?: number
        stale?: number
        critical?: number
        unknown?: number
    }
}

export interface AdminAutoBackfillJob {
    job: string
    reason: string
    args: Record<string, unknown>
}

export interface AdminAutoBackfillResponse {
    timestamp: string
    dry_run: boolean
    threshold_days: number
    stale_tables: string[]
    selected_symbol_count: number
    selected_symbols_preview: string[]
    jobs: AdminAutoBackfillJob[]
    jobs_scheduled: number
}

export async function getAdminDataHealth(): Promise<AdminDataHealthResponse> {
    return fetchAPI<AdminDataHealthResponse>('/admin/data-health', {
        timeout: 20000,
    })
}

export async function triggerAdminDataHealthAutoBackfill(options?: {
    daysStale?: number
    limitSymbols?: number
    dryRun?: boolean
}): Promise<AdminAutoBackfillResponse> {
    return fetchAPI<AdminAutoBackfillResponse>('/admin/data-health/auto-backfill', {
        method: 'POST',
        params: {
            days_stale: options?.daysStale,
            limit_symbols: options?.limitSymbols,
            dry_run: options?.dryRun ?? true,
        },
        timeout: 30000,
    })
}
