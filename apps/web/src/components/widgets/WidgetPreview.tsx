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
        tradingview_chart: <TradingViewPreview />,
        tradingview_symbol_overview: <TradingViewPreview />,
        tradingview_mini_chart: <TradingViewPreview />,
        tradingview_market_summary: <IndexCardsPreview />,
        tradingview_market_overview: <IndexCardsPreview />,
        tradingview_stock_market: <TopMoversPreview />,
        tradingview_market_data: <TablePreview rows={4} />,
        tradingview_ticker_tape: <TickerTapePreview />,
        tradingview_ticker_tag: <TickerInfoPreview />,
        tradingview_single_ticker: <TickerInfoPreview />,
        tradingview_ticker: <TickerTapePreview />,
        tradingview_stock_heatmap: <SectorPreview />,
        tradingview_crypto_heatmap: <SectorPreview />,
        tradingview_forex_cross_rates: <TablePreview rows={4} />,
        tradingview_etf_heatmap: <SectorPreview />,
        tradingview_forex_heatmap: <TablePreview rows={4} />,
        tradingview_screener: <TablePreview rows={4} />,
        tradingview_crypto_market: <TablePreview rows={4} />,
        tradingview_symbol_info: <TickerInfoPreview />,
        tradingview_technical_analysis: <TechnicalGaugePreview />,
        tradingview_fundamental_data: <MetricsPreview />,
        tradingview_company_profile: <TickerInfoPreview />,
        tradingview_top_stories: <NewsPreview />,
        tradingview_economic_calendar: <NewsPreview />,
        tradingview_economic_map: <SectorPreview />,
        valuation_multiples_chart: <ChartPreview />,
        screener: <TablePreview rows={4} />,
        market_overview: <IndexCardsPreview />,
        watchlist: <ListPreview items={5} />,
        news_feed: <NewsPreview />,
        ticker_info: <TickerInfoPreview />,
        key_metrics: <MetricsPreview />,
        earnings_season_monitor: <TablePreview rows={5} />,
        earnings_release_recap: <NewsPreview />,
        balance_sheet: <TablePreview rows={5} />,
        income_statement: <TablePreview rows={5} />,
        income_sankey: <SankeyPreview />,
        cash_flow: <TablePreview rows={5} />,
        cashflow_waterfall: <WaterfallPreview />,
        financial_snapshot: <TablePreview rows={6} />,
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
        financials: 'balance_sheet',
        share_statistics: 'key_metrics',
        key_statistics: 'key_metrics',
        earnings_history: 'news_feed',
        earnings_release_recap: 'news_feed',
        company_filings: 'news_feed',
        dividend_payment: 'news_feed',
        stock_splits: 'news_feed',
        news_flow: 'news_feed',
        institutional_ownership: 'ticker_info',
        unified_financials: 'balance_sheet',
        financial_snapshot: 'balance_sheet',
        database_browser: 'ticker_info',
        balance_sheet_statement: 'balance_sheet',
        income_statement_quarterly: 'income_statement',
        income_statement_yearly: 'income_statement',
        cash_flow_statement: 'cash_flow',
        sector_heatmap: 'sector_performance',
    };

    return map[type] || type;
}

// Mini chart preview with bars
function TradingViewPreview() {
    return (
        <div
            className="h-full rounded-lg p-2"
            style={{
                background:
                    'radial-gradient(circle at top left, rgba(59,130,246,0.22), transparent 55%), linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.72))',
            }}
        >
            <div className="flex h-full flex-col justify-between rounded-md border border-white/10 bg-black/20 p-2">
                <div className="flex items-center justify-between text-[7px] font-bold uppercase tracking-[0.18em] text-sky-200/80">
                    <span>TradingView</span>
                    <span>TV</span>
                </div>
                <div className="flex items-end gap-1">
                    {[26, 38, 32, 49, 44, 63, 59, 74].map((height, index) => (
                        <div
                            key={index}
                            className="flex-1 rounded-t"
                            style={{
                                height: `${height}%`,
                                background: 'linear-gradient(to top, rgba(56,189,248,0.85), rgba(99,102,241,0.25))',
                            }}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function TickerTapePreview() {
    const items = ['VCI', 'VNM', 'SPX', 'BTC'];
    return (
        <div className="h-full flex items-center gap-1 overflow-hidden px-1.5 py-2">
            {items.map((item, index) => (
                <div key={item} className="flex min-w-[42px] flex-col rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-1.5 py-1">
                    <span className="text-[7px] font-bold text-[var(--text-primary)]">{item}</span>
                    <span className={`text-[7px] font-semibold ${index % 2 === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {index % 2 === 0 ? '+0.8%' : '-0.4%'}
                    </span>
                </div>
            ))}
        </div>
    );
}

function TechnicalGaugePreview() {
    return (
        <div className="flex h-full flex-col justify-between gap-2 px-2 py-2">
            <div className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-center text-[8px] font-black uppercase tracking-[0.16em] text-emerald-300">
                Strong Buy
            </div>
            <div className="grid grid-cols-3 gap-1">
                {['Osc', 'MA', 'Mom'].map((label, index) => (
                    <div key={label} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-2 text-center">
                        <div className="text-[7px] uppercase text-[var(--text-muted)]">{label}</div>
                        <div className={`mt-1 text-[9px] font-bold ${index === 1 ? 'text-emerald-300' : 'text-blue-300'}`}>
                            {index === 1 ? 'Buy' : 'Neutral'}
                        </div>
                    </div>
                ))}
            </div>
            <div className="h-1.5 rounded-full bg-[var(--bg-tertiary)]">
                <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-amber-400 via-sky-400 to-emerald-400" />
            </div>
        </div>
    );
}

function SankeyPreview() {
    return (
        <div className="h-full px-2 py-1.5">
            <svg viewBox="0 0 100 48" className="h-full w-full">
                <rect x="4" y="10" width="10" height="28" rx="3" fill="rgba(59,130,246,0.75)" />
                <rect x="44" y="6" width="10" height="16" rx="3" fill="rgba(249,115,22,0.8)" />
                <rect x="44" y="26" width="10" height="12" rx="3" fill="rgba(16,185,129,0.8)" />
                <rect x="84" y="18" width="10" height="14" rx="3" fill="rgba(20,184,166,0.8)" />
                <path d="M14 18 C26 18, 30 14, 44 14" fill="none" stroke="rgba(125,211,252,0.8)" strokeWidth="6" strokeLinecap="round" />
                <path d="M14 30 C26 30, 30 32, 44 32" fill="none" stroke="rgba(134,239,172,0.75)" strokeWidth="8" strokeLinecap="round" />
                <path d="M54 30 C68 30, 72 25, 84 25" fill="none" stroke="rgba(94,234,212,0.75)" strokeWidth="7" strokeLinecap="round" />
            </svg>
        </div>
    );
}

function WaterfallPreview() {
    const bars = [18, -10, 0, -8, 12, 0];
    return (
        <div className="h-full px-2 py-1.5">
            <div className="flex h-full items-end gap-1">
                {bars.map((value, index) => {
                    const isTotal = index === 2 || index === bars.length - 1;
                    const height = 10 + Math.abs(value) * 2;
                    return (
                        <div key={index} className="flex flex-1 flex-col items-center justify-end gap-1">
                            <div
                                className={`w-full rounded-t ${isTotal ? 'bg-blue-500/80' : value >= 0 ? 'bg-emerald-500/75' : 'bg-rose-500/75'}`}
                                style={{ height }}
                            />
                            <div className="h-1 w-5 rounded bg-[var(--bg-tertiary)]" />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

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
