'use client';

import { memo, useState, useMemo } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { useQuery } from '@tanstack/react-query';
import { compareStocks } from '@/lib/api';
import { Plus, X, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

const CATEGORIES = [
  { id: 'valuation', name: 'Valuation Multiples' },
  { id: 'profitability', name: 'Profitability' },
  { id: 'liquidity', name: 'Liquidity' },
  { id: 'efficiency', name: 'Efficiency' },
  { id: 'leverage', name: 'Leverage' },
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
  const [symbols, setSymbols] = useState<string[]>(initialSymbols);
  const [period, setPeriod] = useState('FY');
  const [activeCategory, setActiveCategory] = useState('valuation');
  const [newSymbol, setNewSymbol] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['comparison', symbols.join(','), period],
    queryFn: () => compareStocks(symbols, period),
    enabled: symbols.length >= 2,
  });

  const addSymbol = () => {
    if (newSymbol && symbols.length < 5 && !symbols.includes(newSymbol.toUpperCase())) {
      setSymbols([...symbols, newSymbol.toUpperCase()]);
      setNewSymbol('');
    }
  };

  const removeSymbol = (symbolToRemove: string) => {
    if (symbols.length > 2) {
      setSymbols(symbols.filter(s => s !== symbolToRemove));
    }
  };

  const filteredMetrics = useMemo(() => {
    return data?.metrics?.filter((m: any) => m.category === activeCategory) || [];
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
      isLoading={isLoading}
      exportData={data}
      exportFilename="comparison_analysis"
    >
      <div className="h-full flex flex-col bg-black">
        {/* Ticker Selector */}
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-gray-800">
          {symbols.map(s => (
            <div 
              key={s}
              className="flex items-center gap-1 px-2 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded text-xs font-bold"
            >
              {s}
              {symbols.length > 2 && (
                <button onClick={() => removeSymbol(s)} className="hover:text-red-400 transition-colors">
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          
          {symbols.length < 5 && (
            <div className="flex items-center gap-1 ml-1">
              <input
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && addSymbol()}
                placeholder="Add ticker..."
                className="w-20 px-2 py-1 bg-gray-900 border border-gray-800 rounded text-[10px] text-white focus:border-blue-500 outline-none transition-all"
              />
              <button onClick={addSymbol} className="p-1 text-gray-500 hover:text-blue-400 transition-colors">
                <Plus size={14} />
              </button>
            </div>
          )}
          
          {/* Period Toggle */}
          <div className="ml-auto flex bg-gray-900 rounded p-0.5 border border-gray-800">
            {['FY', 'Q1', 'Q2', 'Q3', 'Q4', 'TTM'].map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                    "px-2 py-0.5 text-[9px] font-bold rounded transition-all",
                    period === p ? "bg-blue-600 text-white" : "text-gray-500 hover:text-gray-300"
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-1 p-2 border-b border-gray-800 overflow-x-auto scrollbar-hide">
          {CATEGORIES.map(cat => (
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
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
                <RefreshCw size={24} className="animate-spin" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Comparing Data...</span>
            </div>
          ) : isError ? (
            <div className="flex items-center justify-center h-full text-red-500/50 text-xs font-bold uppercase">
                Error Loading Comparison
            </div>
          ) : (
            <table className="w-full text-[11px] text-left border-collapse">
              <thead className="sticky top-0 bg-[#0a0a0a] z-10">
                <tr className="border-b border-gray-800">
                  <th className="p-3 text-gray-500 font-bold uppercase tracking-tighter">Metric</th>
                  {data?.stocks?.map((stock: any) => (
                    <th key={stock.symbol} className="text-right p-3 text-white font-black uppercase">
                      {stock.symbol}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMetrics.map((metric: any) => {
                  const { best, worst } = getBestWorst(metric.id);
                  return (
                    <tr key={metric.id} className="border-b border-gray-800/30 hover:bg-white/5 transition-colors group">
                      <td className="p-3 text-gray-400 font-medium group-hover:text-gray-200">{metric.name}</td>
                      {data?.stocks?.map((stock: any) => {
                        const value = stock.metrics[metric.id];
                        const isBest = value !== null && value === best && data.stocks.length > 1;
                        const isWorst = value !== null && value === worst && data.stocks.length > 1;
                        
                        // Inverse logic for some metrics (P/E, Debt/Equity, etc.)
                        const isLowerBetter = metric.id.includes('ratio') || metric.id.includes('debt');
                        const highlightColor = isLowerBetter 
                            ? (isWorst ? 'text-green-400' : isBest ? 'text-red-400' : 'text-white')
                            : (isBest ? 'text-green-400' : isWorst ? 'text-red-400' : 'text-white');

                        return (
                          <td 
                            key={stock.symbol} 
                            className={cn(
                                "text-right p-3 font-mono",
                                highlightColor
                            )}
                          >
                            <div className="flex items-center justify-end gap-1">
                                {value !== null && value !== undefined ? formatValue(value, metric.format) : '—'}
                                {isBest && !isLowerBetter && <TrendingUp size={10} className="opacity-50" />}
                                {isWorst && isLowerBetter && <TrendingDown size={10} className="opacity-50 text-green-400" />}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
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
