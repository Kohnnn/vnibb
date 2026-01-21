// Key Metrics Widget - PE, PB, ROE, margins

'use client';

import { useScreenerData, useMetricsHistory } from '@/lib/queries';
import { formatRatio, formatPercent, formatVND } from '@/lib/formatters';
import { TableSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { RateLimitAlert } from '@/components/ui/RateLimitAlert';
import { RateLimitError } from '@/lib/api';
import { Sparkline } from '@/components/ui/Sparkline';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { useState } from 'react';

interface KeyMetricsWidgetProps {
    id: string;
    symbol: string;
    isEditing?: boolean;
    hideHeader?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: any) => void;
}

interface MetricRowProps {
    label: string;
    value: string | number | null;
    sparklineData?: number[];
}

function MetricRow({ label, value, sparklineData }: MetricRowProps) {
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
            <span className="text-gray-400 text-xs">{label}</span>
            <div className="flex items-center gap-2">
                {sparklineData && sparklineData.length > 0 && (
                    <Sparkline data={sparklineData} width={40} height={16} />
                )}
                <span className="text-white font-mono text-xs">{value ?? '-'}</span>
            </div>
        </div>
    );
}

export function KeyMetricsWidget({ id, symbol: initialSymbol, isEditing, hideHeader, onRemove, onDataChange }: KeyMetricsWidgetProps) {
    const [symbol, setSymbol] = useState(initialSymbol);
    const { data: screenData, isLoading, error, refetch } = useScreenerData({ limit: 100 });
    const { data: history } = useMetricsHistory(symbol);

    const stock = screenData?.data?.find((s: any) => s.ticker === symbol);

    return (
        <WidgetContainer
            title="Key Metrics"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading}
            exportData={stock ? { ...stock, history } : undefined}
            exportFilename={`metrics_${symbol}`}
            widgetId={id}
            showLinkToggle={true}
            hideHeader={hideHeader}
        >

            {error ? (
                <div className="p-2">
                    {error instanceof RateLimitError ? (
                        <RateLimitAlert
                            retryAfter={error.retryAfter}
                            onRetry={() => refetch()}
                        />
                    ) : (
                        <div className="text-red-400 text-sm">Failed to load metrics</div>
                    )}
                </div>
            ) : !stock && !isLoading ? (
                <WidgetEmpty message={`No data available for ${symbol}`} />
            ) : (
                <div className="space-y-1">
                    {/* Valuation Metrics */}
                    <div className="text-xs text-gray-500 uppercase tracking-wider pt-2 pb-1 text-left">
                        Valuation
                    </div>
                    <MetricRow label="P/E Ratio" value={formatRatio(stock?.pe)} sparklineData={history?.pe_ratio} />
                    <MetricRow label="P/B Ratio" value={formatRatio(stock?.pb)} sparklineData={history?.pb_ratio} />
                    <MetricRow label="P/S Ratio" value={formatRatio(stock?.ps)} />
                    <MetricRow label="EV/EBITDA" value={formatRatio(stock?.ev_ebitda)} />

                    {/* Profitability Metrics */}
                    <div className="text-xs text-gray-500 uppercase tracking-wider pt-4 pb-1 text-left">
                        Profitability
                    </div>
                    <MetricRow label="ROE" value={formatPercent(stock?.roe)} sparklineData={history?.roe} />
                    <MetricRow label="ROA" value={formatPercent(stock?.roa)} sparklineData={history?.roa} />
                    <MetricRow label="ROIC" value={formatPercent(stock?.roic)} />
                    <MetricRow label="Net Margin" value={formatPercent(stock?.net_margin)} />
                    <MetricRow label="Gross Margin" value={formatPercent(stock?.gross_margin)} />


                    {/* Financial Health */}
                    <div className="text-xs text-gray-500 uppercase tracking-wider pt-4 pb-1">
                        Financial Health
                    </div>
                    <MetricRow label="Debt/Equity" value={formatRatio(stock?.debt_to_equity)} />
                    <MetricRow label="Current Ratio" value={formatRatio(stock?.current_ratio)} />

                    {/* Market Data */}
                    <div className="text-xs text-gray-500 uppercase tracking-wider pt-4 pb-1">
                        Market Data
                    </div>
                    <MetricRow
                        label="Market Cap"
                        value={formatVND(stock?.market_cap)}
                    />
                    <MetricRow
                        label="Dividend Yield"
                        value={formatPercent(stock?.dividend_yield)}
                    />
                    <MetricRow label="Beta" value={formatRatio(stock?.beta)} />
                </div>
            )}
        </WidgetContainer>
    );
}

