'use client';

import React from 'react';
import {
    BarChart3, TrendingUp, TrendingDown,
    FileText, Users, DollarSign, Activity,
    Globe, Bell, Search, Newspaper, Calendar
} from 'lucide-react';

interface WidgetPreviewProps {
    type: string;
}

/**
 * Mini preview components for widget library
 * Shows a visual representation of what each widget looks like
 */
export function WidgetPreview({ type }: WidgetPreviewProps) {
    const normalizedType = normalizeWidgetType(type);
    const previews: Record<string, React.ReactNode> = {
        price_chart: <ChartPreview />,
        tradingview_chart: <ChartPreview />,
        valuation_multiples_chart: <ChartPreview />,
        screener: <TablePreview rows={4} />,
        market_overview: <IndexCardsPreview />,
        watchlist: <ListPreview items={5} />,
        news_feed: <NewsPreview />,
        ticker_info: <TickerInfoPreview />,
        key_metrics: <MetricsPreview />,
        balance_sheet: <TablePreview rows={5} />,
        income_statement: <TablePreview rows={5} />,
        income_sankey: <ChartPreview />,
        cash_flow: <TablePreview rows={5} />,
        cashflow_waterfall: <ChartPreview />,
        portfolio_tracker: <PortfolioPreview />,
        top_movers: <TopMoversPreview />,
        sector_performance: <SectorPreview />,
        market_movers_sectors: <TopMoversPreview />,
        sector_rotation_radar: <SectorPreview />,
        sector_top_movers: <SectorPreview />,
        market_breadth: <IndexCardsPreview />,
        world_indices: <IndexCardsPreview />,
        technical_summary: <TechnicalPreview />,
        technical_snapshot: <TechnicalPreview />,
        signal_summary: <TechnicalPreview />,
        ichimoku: <TechnicalPreview />,
        fibonacci: <TechnicalPreview />,
        volume_profile: <TechnicalPreview />,
        obv_divergence: <TechnicalPreview />,
        atr_regime: <TechnicalPreview />,
        gap_fill_stats: <TechnicalPreview />,
        volume_delta: <TechnicalPreview />,
        amihud_illiquidity: <TechnicalPreview />,
        seasonality_heatmap: <TechnicalPreview />,
        volume_flow: <TechnicalPreview />,
        rsi_seasonal: <TechnicalPreview />,
        bollinger_squeeze: <TechnicalPreview />,
        sortino_monthly: <TechnicalPreview />,
        gap_analysis: <TechnicalPreview />,
        macd_crossovers: <TechnicalPreview />,
        parkinson_volatility: <TechnicalPreview />,
        ema_respect: <TechnicalPreview />,
        drawdown_recovery: <TechnicalPreview />,
        ai_analysis: <AIPreview />,
        peer_comparison: <ComparisonPreview />,
        news_corporate_actions: <NewsPreview />,
        dividend_ladder: <NewsPreview />,
        insider_deal_timeline: <TablePreview rows={4} />,
        ownership_changes: <TablePreview rows={4} />,
        research_browser: <DefaultPreview />,
    };

    return previews[normalizedType] || <DefaultPreview />;
}

function normalizeWidgetType(type: string) {
    const map: Record<string, string> = {
        ticker_profile: 'ticker_info',
        ticker_details: 'ticker_info',
        company_profile: 'ticker_info',
        share_statistics: 'key_metrics',
        key_statistics: 'key_metrics',
        earnings_history: 'news_feed',
        company_filings: 'news_feed',
        dividend_payment: 'news_feed',
        stock_splits: 'news_feed',
        news_flow: 'news_feed',
        unified_financials: 'balance_sheet',
        balance_sheet_statement: 'balance_sheet',
        income_statement_quarterly: 'income_statement',
        income_statement_yearly: 'income_statement',
        cash_flow_statement: 'cash_flow',
        sector_heatmap: 'sector_performance',
    };

    return map[type] || type;
}

// Mini chart preview with bars
function ChartPreview() {
    const bars = [40, 55, 45, 60, 50, 70, 65, 80, 75, 90, 85, 95];
    return (
        <div className="h-full flex items-end gap-0.5 px-1 pt-2">
            {bars.map((h, i) => (
                <div
                    key={i}
                    className="flex-1 rounded-t transition-all"
                    style={{
                        height: `${h}%`,
                        background: `linear-gradient(to top, rgba(59, 130, 246, 0.7), rgba(59, 130, 246, 0.2))`
                    }}
                />
            ))}
        </div>
    );
}

// Mini table preview
function TablePreview({ rows }: { rows: number }) {
    return (
        <div className="h-full flex flex-col gap-1 p-1.5">
            {/* Header row */}
            <div className="flex gap-1">
                <div className="h-2 bg-[var(--bg-tertiary)] rounded flex-[2]" />
                <div className="h-2 bg-[var(--bg-tertiary)] rounded flex-1" />
                <div className="h-2 bg-[var(--bg-tertiary)] rounded flex-1" />
            </div>
            {/* Data rows */}
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex gap-1">
                    <div className="h-2 bg-[var(--bg-tertiary)]/80 rounded flex-[2]" />
                    <div className="h-2 bg-[var(--bg-tertiary)]/80 rounded flex-1" />
                    <div className={`h-2 rounded flex-1 ${i % 2 === 0 ? 'bg-green-900/40' : 'bg-red-900/40'}`} />
                </div>
            ))}
        </div>
    );
}

// Mini index cards preview
function IndexCardsPreview() {
    const indices = [
        { name: 'VN-I', change: '+1.2%', up: true },
        { name: 'VN30', change: '-0.8%', up: false },
        { name: 'HNX', change: '+0.5%', up: true },
        { name: 'UPC', change: '-0.3%', up: false },
    ];
    return (
        <div className="h-full grid grid-cols-2 gap-1 p-1">
            {indices.map((idx) => (
                <div
                    key={idx.name}
                    className={`rounded p-1.5 border ${idx.up
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-red-500/10 border-red-500/30'
                        }`}
                >
                    <div className="text-[6px] text-[var(--text-muted)] font-bold">{idx.name}</div>
                    <div className={`text-[8px] font-bold ${idx.up ? 'text-green-500' : 'text-red-500'}`}>
                        {idx.change}
                    </div>
                </div>
            ))}
        </div>
    );
}

// List preview (for watchlist, etc.)
function ListPreview({ items }: { items: number }) {
    return (
        <div className="h-full flex flex-col gap-0.5 p-1">
            {Array.from({ length: items }).map((_, i) => (
                <div key={i} className="flex items-center justify-between px-1 py-0.5 bg-[var(--bg-tertiary)]/65 rounded">
                    <div className="h-1.5 bg-[var(--bg-tertiary)] rounded w-8" />
                    <div className={`h-1.5 rounded w-6 ${i % 2 === 0 ? 'bg-green-800/50' : 'bg-red-800/50'}`} />
                </div>
            ))}
        </div>
    );
}

// News preview
function NewsPreview() {
    return (
        <div className="h-full flex flex-col gap-1 p-1.5">
            {[1, 2, 3].map((_, i) => (
                <div key={i} className="space-y-0.5">
                    <div className="h-2 bg-[var(--bg-tertiary)] rounded w-full" />
                    <div className="h-1.5 bg-[var(--bg-tertiary)]/70 rounded w-3/4" />
                </div>
            ))}
        </div>
    );
}

// Ticker info preview
function TickerInfoPreview() {
    return (
        <div className="h-full flex flex-col items-center justify-center p-2">
            <div className="text-[10px] font-bold text-blue-400">VNM</div>
            <div className="text-[14px] font-black text-[var(--text-primary)]">85,200</div>
            <div className="text-[8px] font-bold text-green-500">+2.4%</div>
        </div>
    );
}

// Metrics preview
function MetricsPreview() {
    return (
        <div className="h-full grid grid-cols-2 gap-1 p-1">
            {['P/E', 'P/B', 'ROE', 'ROA'].map((metric) => (
                <div key={metric} className="bg-[var(--bg-tertiary)]/70 rounded p-1">
                    <div className="text-[5px] text-[var(--text-muted)]">{metric}</div>
                    <div className="text-[7px] text-[var(--text-secondary)] font-bold">12.5</div>
                </div>
            ))}
        </div>
    );
}

// Portfolio preview
function PortfolioPreview() {
    return (
        <div className="h-full flex flex-col p-1.5">
            <div className="flex items-center justify-between mb-1">
                <div className="text-[6px] text-[var(--text-muted)]">Total Value</div>
                <div className="text-[8px] text-green-500 font-bold">+5.2%</div>
            </div>
            <div className="flex-1 flex items-end gap-0.5">
                {[30, 50, 40, 60, 55, 70].map((h, i) => (
                    <div
                        key={i}
                        className="flex-1 bg-gradient-to-t from-green-600/50 to-green-400/20 rounded-t"
                        style={{ height: `${h}%` }}
                    />
                ))}
            </div>
        </div>
    );
}

// Top movers preview
function TopMoversPreview() {
    return (
        <div className="h-full flex gap-1 p-1">
            {/* Gainers */}
            <div className="flex-1 space-y-0.5">
                <div className="text-[5px] text-green-500 font-bold">TOP ▲</div>
                {[1, 2, 3].map((_, i) => (
                    <div key={i} className="h-2 bg-green-500/20 rounded" />
                ))}
            </div>
            {/* Losers */}
            <div className="flex-1 space-y-0.5">
                <div className="text-[5px] text-red-500 font-bold">TOP ▼</div>
                {[1, 2, 3].map((_, i) => (
                    <div key={i} className="h-2 bg-red-500/20 rounded" />
                ))}
            </div>
        </div>
    );
}

// Sector preview
function SectorPreview() {
    const sectors = [
        { pct: 80, color: 'bg-green-600/60' },
        { pct: 60, color: 'bg-green-500/40' },
        { pct: 40, color: 'bg-red-500/40' },
        { pct: 30, color: 'bg-red-600/60' },
    ];
    return (
        <div className="h-full flex flex-col gap-0.5 p-1.5">
            {sectors.map((s, i) => (
                <div key={i} className="flex items-center gap-1">
                    <div className="text-[5px] text-[var(--text-muted)] w-6">SEC{i + 1}</div>
                    <div className="flex-1 h-2 bg-[var(--bg-tertiary)]/70 rounded overflow-hidden">
                        <div className={`h-full ${s.color} rounded`} style={{ width: `${s.pct}%` }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

// Technical preview
function TechnicalPreview() {
    return (
        <div className="h-full flex flex-col items-center justify-center p-2 text-center">
            <div className="text-[8px] font-bold text-green-500 mb-0.5">BUY</div>
            <div className="flex gap-1">
                {['RSI', 'MACD', 'MA'].map((ind) => (
                    <div key={ind} className="text-[5px] text-[var(--text-muted)] bg-[var(--bg-tertiary)]/70 px-1 rounded">{ind}</div>
                ))}
            </div>
        </div>
    );
}

// AI preview
function AIPreview() {
    return (
        <div className="h-full flex flex-col items-center justify-center p-2">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500/30 to-cyan-500/30 flex items-center justify-center mb-1">
                <Activity size={10} className="text-blue-400" />
            </div>
            <div className="text-[6px] text-[var(--text-muted)]">AI Analysis</div>
        </div>
    );
}

// Comparison preview
function ComparisonPreview() {
    return (
        <div className="h-full flex items-end gap-0.5 p-1">
            {[
                { h1: 70, h2: 50, label: 'A' },
                { h1: 60, h2: 80, label: 'B' },
                { h1: 40, h2: 55, label: 'C' },
            ].map((item, i) => (
                <div key={i} className="flex-1 flex gap-px items-end">
                    <div className="flex-1 bg-blue-600/50 rounded-t" style={{ height: `${item.h1}%` }} />
                    <div className="flex-1 bg-cyan-600/50 rounded-t" style={{ height: `${item.h2}%` }} />
                </div>
            ))}
        </div>
    );
}

// Default preview
function DefaultPreview() {
    return (
        <div className="h-full flex items-center justify-center">
            <BarChart3 size={16} className="text-[var(--text-muted)]" />
        </div>
    );
}
