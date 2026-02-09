'use client';

import { memo, useState, useMemo } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { CompanyLogo } from '@/components/ui/CompanyLogo';
import { TickerChip } from '@/components/ui/TickerChip';
import { PeriodToggle, type Period } from '@/components/ui/PeriodToggle';
import { useQuery } from '@tanstack/react-query';
import { compareStocks } from '@/lib/api';
import { Plus, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const CATEGORY_DEFINITIONS = [
  { id: 'valuation', name: 'Valuation Multiples', metricIds: ['pe_ratio', 'pb_ratio', 'ps_ratio', 'ev_ebitda', 'market_cap'] },
  { id: 'liquidity', name: 'Liquidity', metricIds: ['current_ratio', 'quick_ratio'] },
  { id: 'efficiency', name: 'Efficiency', metricIds: ['asset_turnover', 'inventory_turnover'] },
  { id: 'profitability', name: 'Profitability', metricIds: ['roe', 'roa', 'gross_margin', 'net_margin', 'operating_margin'] },
  { id: 'leverage', name: 'Leverage', metricIds: ['debt_equity', 'debt_assets'] },
  { id: 'coverage', name: 'Coverage', metricIds: ['interest_coverage', 'debt_service_coverage'] },
  { id: 'ocf', name: 'Operating Cash Flow', metricIds: ['ocf_debt', 'fcf_yield', 'ocf_sales'] },
];

interface ComparisonAnalysisWidgetProps {
  id: string;
  symbol?: string;
  initialSymbols?: string[];
  onRemove?: () => void;
}

function ComparisonAnalysisWidgetComponent({
  id,
  symbol,
  initialSymbols = ['VNM', 'FPT'],
  onRemove,
}: ComparisonAnalysisWidgetProps) {
  const [symbols, setSymbols] = useState<string[]>(() => Array.from(
    new Set(initialSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean))
  ));
  const [period, setPeriod] = useState<Period>('FY');
  const [activeCategory, setActiveCategory] = useState('valuation');
  const [newSymbol, setNewSymbol] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);

  const { data, isLoading, error, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['comparison', symbols.join(','), period],
    queryFn: () => compareStocks(symbols, period),
    enabled: symbols.length >= 2,
  });

  const hasData = Boolean(data?.stocks?.length);
  const isFallback = Boolean(error && hasData);

  const addSymbol = () => {
    const cleaned = newSymbol.trim().toUpperCase();
    if (cleaned && symbols.length < 5 && !symbols.includes(cleaned)) {
      setSymbols([...symbols, cleaned]);
      setNewSymbol('');
      setShowAddInput(false);
    }
  };

  const removeSymbol = (symbolToRemove: string) => {
    if (symbols.length > 2) {
      setSymbols(symbols.filter(s => s !== symbolToRemove));
    }
  };

  const metricId = (metric: any) => metric?.id ?? metric?.key;
  const metricName = (metric: any) => metric?.name ?? metric?.label ?? metricId(metric);
  const metricFormat = (metric: any) => metric?.format ?? 'number';
  const higherBetterOverrides = new Set(['ocf_debt', 'interest_coverage', 'debt_service_coverage']);

  const filteredMetrics = useMemo(() => {
    const config = CATEGORY_DEFINITIONS.find((c) => c.id === activeCategory);
    if (!config) return [];
    return data?.metrics?.filter((metric: any) => config.metricIds.includes(metricId(metric))) || [];
  }, [data, activeCategory]);

  const getBestWorst = (metricId: string) => {
    if (!data?.stocks) return { best: null, worst: null };
    const values = data.stocks
        .map((s: any) => s.metrics[metricId])
        .filter((v: any) => v !== null && v !== undefined);
    if (values.length === 0) return { best: null, worst: null };
    return { best: Math.max(...values), worst: Math.min(...values) };
  };

  return (
    <WidgetContainer 
      title="Comparison Analysis"
      widgetId={id}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      exportData={data}
      exportFilename="comparison_analysis"
    >
      <div className="h-full flex flex-col bg-black">
        {/* Ticker Selector */}
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-gray-800">
          {symbols.map((s) => (
            <TickerChip
              key={s}
              symbol={s}
              onRemove={symbols.length > 2 ? () => removeSymbol(s) : undefined}
            />
          ))}

          {symbols.length < 5 && (
            <div className="flex items-center gap-1 ml-1">
              {showAddInput ? (
                <>
                  <input
                    value={newSymbol}
                    onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && addSymbol()}
                    placeholder="Ticker"
                    className="w-20 px-2 py-1 bg-gray-900 border border-gray-800 rounded text-[10px] text-white focus:border-blue-500 outline-none transition-all"
                    autoFocus
                  />
                  <button
                    onClick={addSymbol}
                    className="p-1 text-gray-500 hover:text-blue-400 transition-colors"
                    aria-label="Confirm add symbol"
                  >
                    <Plus size={14} />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowAddInput(true)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide rounded border border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 transition-colors"
                >
                  <Plus size={12} /> Add Additional Ticker
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            {/* Period Toggle */}
            <PeriodToggle value={period} onChange={setPeriod} compact />
            <WidgetMeta
              updatedAt={dataUpdatedAt}
              isFetching={isFetching && hasData}
              isCached={isFallback}
              note={period}
              align="right"
              className="ml-2"
            />
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-1 p-2 border-b border-gray-800 overflow-x-auto scrollbar-hide">
          {CATEGORY_DEFINITIONS.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                "px-3 py-1 text-[10px] font-bold uppercase whitespace-nowrap rounded-md transition-all",
                activeCategory === cat.id
                  ? "bg-blue-600/10 text-blue-400 border border-blue-500/20"
                  : "text-gray-500 hover:text-gray-300"
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Comparison Table */}
        <div className="flex-1 overflow-auto scrollbar-hide">
          {symbols.length < 2 ? (
            <WidgetEmpty
              message="Comparison needs at least two tickers."
              action={{ label: 'Add VCI', onClick: () => setSymbols([...symbols, 'VCI']) }}
            />
          ) : isLoading && !hasData ? (
            <WidgetSkeleton variant="table" lines={6} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="No comparison data available." />
          ) : (
            <table className="data-table w-full text-[11px] text-left border-collapse">
              <thead className="sticky top-0 bg-[#0a0a0a] z-10">
                <tr className="border-b border-gray-800">
                  <th className="p-3 text-gray-500 font-bold uppercase tracking-tighter">Metric</th>
                  {data?.stocks?.map((stock: any, index: number) => (
                    <th key={`${stock.symbol}-${index}`} className="text-right p-3 text-white font-black uppercase">
                      <div className="flex items-center justify-end gap-2">
                         <CompanyLogo symbol={stock.symbol} name={stock.company_name || stock.name || stock.symbol} size={18} />
                        <span>{stock.symbol}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMetrics.map((metric: any) => {
                  const id = metricId(metric);
                  const { best, worst } = getBestWorst(id);
                  return (
                    <tr key={id} className="border-b border-gray-800/30 hover:bg-white/5 transition-colors group">
                      <td className="p-3 text-gray-400 font-medium group-hover:text-gray-200">{metricName(metric)}</td>
                      {data?.stocks?.map((stock: any, index: number) => {
                        const value = stock.metrics[id];
                        const isBest = value !== null && value === best && data.stocks.length > 1;
                        const isWorst = value !== null && value === worst && data.stocks.length > 1;

                        const isLowerBetter = (id.includes('ratio') || id.includes('debt'))
                          && !higherBetterOverrides.has(id);
                        const highlightColor = isLowerBetter
                          ? (isWorst ? 'text-green-400' : isBest ? 'text-red-400' : 'text-white')
                          : (isBest ? 'text-green-400' : isWorst ? 'text-red-400' : 'text-white');

                        return (
                          <td
                            key={`${stock.symbol}-${index}`}
                            className={cn(
                              "text-right p-3 font-mono",
                              highlightColor
                            )}
                          >
                            <div className="flex items-center justify-end gap-1">
                              {value !== null && value !== undefined ? formatValue(value, metricFormat(metric)) : '—'}
                              {isBest && !isLowerBetter && <TrendingUp size={10} className="opacity-50" />}
                              {isWorst && isLowerBetter && <TrendingDown size={10} className="opacity-50 text-green-400" />}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {filteredMetrics.length === 0 && (
                  <tr>
                    <td colSpan={(data?.stocks?.length || 0) + 1} className="p-4">
                      <WidgetEmpty message="No metrics available in this category for selected symbols." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

function formatValue(value: number, format: string): string {
  switch (format) {
    case 'percent': return `${(value * 100).toFixed(2)}%`;
    case 'currency': 
        if (Math.abs(value) >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
        if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
        if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
        return value.toLocaleString();
    default: return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

export const ComparisonAnalysisWidget = memo(ComparisonAnalysisWidgetComponent);
export default ComparisonAnalysisWidget;
