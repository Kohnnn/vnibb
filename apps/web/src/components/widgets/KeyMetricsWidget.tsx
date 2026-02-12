'use client';

import { useState } from 'react';
import { useScreenerData, useMetricsHistory, useFinancialRatios } from '@/lib/queries';
import { formatRatio, formatPercent } from '@/lib/formatters';
import { formatUnitValue } from '@/lib/units';
import { useUnit } from '@/contexts/UnitContext';
import { TableSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { RateLimitAlert } from '@/components/ui/RateLimitAlert';
import { RateLimitError } from '@/lib/api';
import { Sparkline } from '@/components/ui/Sparkline';
import { WidgetContainer } from '@/components/ui/WidgetContainer';

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

type MetricsCategory = 'valuation' | 'profitability' | 'health' | 'market';

const METRIC_TABS: Array<{ id: MetricsCategory; label: string }> = [
    { id: 'valuation', label: 'Valuation' },
    { id: 'profitability', label: 'Profitability' },
    { id: 'health', label: 'Health' },
    { id: 'market', label: 'Market' },
];

function MetricRow({ label, value, sparklineData }: MetricRowProps) {
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
            <span className="text-gray-400 text-xs leading-tight pr-2 flex-1">{label}</span>
            <div className="flex items-center gap-2 shrink-0">
                {sparklineData && sparklineData.length > 0 && (
                    <Sparkline data={sparklineData} width={40} height={16} />
                )}
                <span className="text-white font-mono text-xs">{value ?? '-'}</span>
            </div>
        </div>
    );
}

export function KeyMetricsWidget({ id, symbol, hideHeader, onRemove, onDataChange }: KeyMetricsWidgetProps) {
    const [activeCategory, setActiveCategory] = useState<MetricsCategory>('valuation');
    const {
        data: screenData,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useScreenerData({ symbol, limit: 1, enabled: !!symbol });
    const { config: unitConfig } = useUnit();

    const { data: history, isFetching: historyFetching } = useMetricsHistory(symbol, { enabled: !!symbol });
    const { data: ratiosData } = useFinancialRatios(symbol, { period: 'FY', enabled: !!symbol });

    const stock = screenData?.data?.[0];
    const latestRatio = ratiosData?.data?.[0];
    const mergedStock: any = stock || {
        pe: latestRatio?.pe,
        pb: latestRatio?.pb,
        ps: latestRatio?.ps,
        roe: latestRatio?.roe,
        roa: latestRatio?.roa,
        current_ratio: latestRatio?.current_ratio,
        debt_to_equity: latestRatio?.debt_equity,
        gross_margin: latestRatio?.gross_margin,
        net_margin: latestRatio?.net_margin,
    };
    const hasData = Boolean(mergedStock && Object.values(mergedStock).some((v) => v !== null && v !== undefined));
    const isFallback = Boolean(error && hasData);
    const hasHistory = Boolean(
        history && (history.roe?.length || history.roa?.length || history.pe_ratio?.length || history.pb_ratio?.length)
    );

    return (
        <WidgetContainer
            title="Key Metrics"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading && !hasData}
            exportData={mergedStock ? { ...mergedStock, history } : undefined}
            exportFilename={`metrics_${symbol}`}
            widgetId={id}
            showLinkToggle={true}
            hideHeader={hideHeader}
        >
            <div className="space-y-2">
                <WidgetMeta
                    updatedAt={dataUpdatedAt}
                    isFetching={(isFetching || historyFetching) && hasData}
                    isCached={isFallback}
                    note="Ratios & health"
                    align="right"
                />

                {!historyFetching && hasData && !hasHistory && (
                    <div className="text-[10px] text-gray-500 uppercase tracking-widest">
                        Trend data not available yet.
                    </div>
                )}

                {isLoading && !hasData ? (
                    <TableSkeleton rows={8} />
                ) : error && !hasData ? (
                    <div className="p-2">
                        {error instanceof RateLimitError ? (
                            <RateLimitAlert retryAfter={error.retryAfter} onRetry={() => refetch()} />
                        ) : (
                            <WidgetError error={error as Error} onRetry={() => refetch()} />
                        )}
                    </div>
                ) : !hasData ? (
                    <WidgetEmpty
                        message={`No key metrics available for ${symbol}. Try refreshing or check back later.`}
                        action={{ label: 'Refresh', onClick: () => refetch() }}
                    />
                ) : (
                    <div className="space-y-1">
                        <div className="flex flex-wrap gap-1 pb-2 border-b border-gray-800/50">
                            {METRIC_TABS.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveCategory(tab.id)}
                                    className={`px-2 py-1 text-[10px] font-bold uppercase rounded-md transition-colors ${
                                        activeCategory === tab.id
                                            ? 'bg-blue-600/15 text-blue-300 border border-blue-500/30'
                                            : 'text-gray-500 border border-gray-800 hover:text-gray-300 hover:border-gray-700'
                                    }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {activeCategory === 'valuation' && (
                            <>
                                <MetricRow label="P/E Ratio" value={formatRatio(mergedStock?.pe)} sparklineData={history?.pe_ratio} />
                                <MetricRow label="P/B Ratio" value={formatRatio(mergedStock?.pb)} sparklineData={history?.pb_ratio} />
                                <MetricRow label="P/S Ratio" value={formatRatio(mergedStock?.ps)} />
                                <MetricRow label="EV/EBITDA" value={formatRatio(mergedStock?.ev_ebitda)} />
                            </>
                        )}

                        {activeCategory === 'profitability' && (
                            <>
                                <MetricRow label="ROE" value={formatPercent(mergedStock?.roe)} sparklineData={history?.roe} />
                                <MetricRow label="ROA" value={formatPercent(mergedStock?.roa)} sparklineData={history?.roa} />
                                <MetricRow label="ROIC" value={formatPercent(mergedStock?.roic)} />
                                <MetricRow label="Net Margin" value={formatPercent(mergedStock?.net_margin)} />
                                <MetricRow label="Gross Margin" value={formatPercent(mergedStock?.gross_margin)} />
                            </>
                        )}

                        {activeCategory === 'health' && (
                            <>
                                <MetricRow label="Debt/Equity" value={formatRatio(mergedStock?.debt_to_equity)} />
                                <MetricRow label="Current Ratio" value={formatRatio(mergedStock?.current_ratio)} />
                            </>
                        )}

                        {activeCategory === 'market' && (
                            <>
                                <MetricRow label="Market Cap" value={formatUnitValue(mergedStock?.market_cap, unitConfig)} />
                                <MetricRow label="Dividend Yield" value={formatPercent(mergedStock?.dividend_yield)} />
                                <MetricRow label="Beta" value={formatRatio(mergedStock?.beta)} />
                            </>
                        )}
                    </div>
                )}
            </div>
        </WidgetContainer>
    );
}
