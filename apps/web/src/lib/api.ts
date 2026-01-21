// API client for VNIBB backend

import { env } from './env';

export const API_BASE_URL = `${env.apiUrl.replace(/\/$/, '')}/api/v1`;


interface FetchOptions extends RequestInit {
    params?: Record<string, string | number | boolean | undefined>;
    timeout?: number; // Custom timeout in milliseconds
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
    const { params, timeout = 30000, signal, ...fetchOptions } = options;

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

    // Network connectivity check
    if (typeof window !== 'undefined' && !navigator.onLine) {
        throw new APIError('You are offline. Please check your internet connection.', 0, 'Offline');
    }

    // Set timeout for requests (configurable, default 30s)
    // Use provided signal if available, otherwise create new controller
    const controller = signal ? null : new AbortController();
    const timeoutId = setTimeout(
        () => controller?.abort(),
        timeout
    );
    const requestSignal = signal || controller!.signal;

    try {
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...fetchOptions.headers,
            },
            signal: requestSignal,
            ...fetchOptions,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({
                detail: response.statusText || 'Unknown error'
            }));

            // Generate user-friendly error message based on status
            let errorMessage = errorData.detail || `API Error: ${response.status}`;

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

        // Handle timeout
        if (error.name === 'AbortError') {
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

import type { EquityHistoricalResponse, EquityProfileResponse, CompanyNewsResponse, CompanyEventsResponse, ShareholdersResponse, OfficersResponse, IntradayResponse, FinancialRatiosResponse, ForeignTradingResponse, SubsidiariesResponse, BalanceSheetResponse, IncomeStatementResponse, CashFlowResponse, MarketOverviewResponse } from '@/types/equity';
import type { ScreenerResponse } from '@/types/screener';
import type { Dashboard, DashboardCreate, DashboardUpdate, WidgetCreate } from '@/types/dashboard';
import type { FullTechnicalAnalysis, SignalSummary, TechnicalIndicators } from '@/types/technical';
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
    });
}

export async function getProfile(symbol: string, signal?: AbortSignal): Promise<EquityProfileResponse> {
    return fetchAPI<EquityProfileResponse>(`/equity/${symbol}/profile`, { signal });
}


// Quote data for real-time price information
export interface QuoteData {
    symbol: string;
    price: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    prevClose: number | null;
    change: number | null;
    changePct: number | null;
    volume: number | null;
    value: number | null;
    updatedAt: string | null;
}

export interface QuoteResponse {
    symbol: string;
    data: QuoteData;
    cached: boolean;
}

export async function getQuote(symbol: string, signal?: AbortSignal): Promise<QuoteResponse> {
    // Quote data can be slow, use 10s timeout
    return fetchAPI<QuoteResponse>(`/equity/${symbol}/quote`, {
        timeout: 10000,
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
        params: { period: options?.period },
        signal
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

export async function getSubsidiaries(symbol: string): Promise<SubsidiariesResponse> {
    return fetchAPI<SubsidiariesResponse>(`/equity/${symbol}/subsidiaries`);
}

export async function getBalanceSheet(
    symbol: string,
    options?: { period?: string }
): Promise<BalanceSheetResponse> {
    return fetchAPI<BalanceSheetResponse>(`/equity/${symbol}/balance-sheet`, {
        params: { period: options?.period },
    });
}

export async function getIncomeStatement(
    symbol: string,
    options?: { period?: string }
): Promise<IncomeStatementResponse> {
    return fetchAPI<IncomeStatementResponse>(`/equity/${symbol}/income-statement`, {
        params: { period: options?.period },
    });
}

export async function getCashFlow(
    symbol: string,
    options?: { period?: string }
): Promise<CashFlowResponse> {
    return fetchAPI<CashFlowResponse>(`/equity/${symbol}/cash-flow`, {
        params: { period: options?.period },
    });
}


export async function getMarketOverview(signal?: AbortSignal): Promise<MarketOverviewResponse> {
    // Market overview is slow (4 indices), use 15s timeout
    return fetchAPI<MarketOverviewResponse>('/dashboard/market-overview', {
        timeout: 15000,
        signal
    });
}

// ============ Screener API ============

export interface ScreenerFilterParams {
    symbol?: string;
    exchange?: string;
    industry?: string;
    limit?: number;
    source?: 'KBS' | 'VCI' | 'TCBS' | 'DNSE';

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

    return fetchAPI<ScreenerResponse>('/screener/', { params, signal });
}


// ============ Dashboard API ============

export async function getDashboards(userId = 'anonymous'): Promise<{ count: number; data: Dashboard[] }> {
    return fetchAPI('/dashboards/', {
        params: { user_id: userId },
    });
}

export async function getDashboard(id: number): Promise<Dashboard> {
    return fetchAPI(`/dashboards/${id}`);
}

export async function createDashboard(data: DashboardCreate): Promise<Dashboard> {
    return fetchAPI('/dashboards/', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export async function updateDashboard(
    id: number,
    data: DashboardUpdate
): Promise<Dashboard> {
    return fetchAPI(`/dashboards/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
    });
}

export async function deleteDashboard(id: number): Promise<void> {
    return fetchAPI(`/dashboards/${id}`, {
        method: 'DELETE',
    });
}

export async function addWidget(dashboardId: number, data: WidgetCreate): Promise<Dashboard> {
    return fetchAPI(`/dashboards/${dashboardId}/widgets`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export async function removeWidget(dashboardId: number, widgetId: number): Promise<void> {
    return fetchAPI(`/dashboards/${dashboardId}/widgets/${widgetId}`, {
        method: 'DELETE',
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
    symbol: string;
    data: Array<{
        price: number;
        volume: number;
        buy_volume: number;
        sell_volume: number;
    }>;
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

export interface DividendsResponse {
    count: number;
    data: Array<{
        ex_date: string;
        record_date: string;
        payment_date: string;
        dividend_type: string;
        value: number;
    }>;
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
    return fetchAPI<PriceDepthResponse>(`/equity/${symbol}/price-depth`);
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
}

export interface TopMoversResponse {
    type: string;
    index: string;
    count: number;
    data: TopMoverData[];
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
    return fetchAPI<TopMoversResponse>('/trading/top-movers', {
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
    data: SectorTopMoversData[];
}

export async function getSectorTopMovers(options?: {
    type?: 'gainers' | 'losers';
    limit?: number;
    source?: 'KBS' | 'VCI' | 'TCBS' | 'DNSE';

}): Promise<SectorTopMoversResponse> {
    return fetchAPI<SectorTopMoversResponse>('/trading/sector-top-movers', {
        params: {
            type: options?.type,
            limit: options?.limit,
            source: options?.source,
        },
    });
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

export async function getSectorPerformance(options?: {
    source?: 'KBS' | 'VCI' | 'TCBS' | 'DNSE';

}): Promise<SectorPerformanceResponse> {
    return fetchAPI<SectorPerformanceResponse>('/trading/sector-performance', {
        params: {
            source: options?.source,
        },
    });
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
    total_assets?: number;
    total_liabilities?: number;
    total_equity?: number;
    cash_and_equivalents?: number;
    operating_cash_flow?: number;
    investing_cash_flow?: number;
    financing_cash_flow?: number;
    free_cash_flow?: number;
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
        period?: 'year' | 'quarter';
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
    key: string;
    label: string;
    format: string;
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

export async function getPeerCompanies(symbol: string, limit = 5): Promise<PeersResponse> {
    return fetchAPI<PeersResponse>(`/compare/peers/${symbol}`, {
        params: { limit },
    });
}

// ============ AI Copilot API ============

export interface WidgetContext {
    widgetType: string;
    symbol: string;
    dataSnapshot?: Record<string, unknown>;
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

export async function askCopilot(query: CopilotQuery): Promise<CopilotResponse> {
    return fetchAPI<CopilotResponse>('/copilot/ask', {
        method: 'POST',
        body: JSON.stringify(query),
    });
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


