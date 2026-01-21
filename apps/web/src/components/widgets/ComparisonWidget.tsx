'use client';

import { useState, useMemo, useEffect } from 'react';
import { useComparison, usePeerCompanies } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { 
    X, Plus, RefreshCw, AlertCircle, TrendingUp, 
    TrendingDown, Users, Search, BarChart3, LineChart
} from 'lucide-react';
import { MetricCategoryTabs, type MetricCategory } from './comparison/MetricCategoryTabs';
import { CompanyLogo } from '@/components/ui/CompanyLogo';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { 
    ResponsiveContainer, LineChart as ReLineChart, Line, 
    XAxis, YAxis, Tooltip, Legend, CartesianGrid 
} from 'recharts';

interface ComparisonWidgetProps {
    id: string;
    initialSymbols?: string[];
    hideHeader?: boolean;
    onRemove?: () => void;
}

const CHART_COLORS = ['#3b82f6', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6'];

export function ComparisonWidget({ id, initialSymbols = ['VNM', 'FPT'], hideHeader, onRemove }: ComparisonWidgetProps) {
    const [symbols, setSymbols] = useState<string[]>(initialSymbols);
    const [inputValue, setInputValue] = useState('');
    const [activeCategory, setActiveCategory] = useState<MetricCategory>('valuation');
    const [showChart, setShowChart] = useState(true);

    const { data, isLoading, refetch } = useComparison(symbols);
    
    // Performance data fetch
    const [perfData, setPerfData] = useState<any[]>([]);
    const [perfLoading, setPerfLoading] = useState(false);

    useEffect(() => {
        if (symbols.length < 1) return;
        
        const fetchPerf = async () => {
            setPerfLoading(true);
            try {
                const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/comparison/performance?symbols=${symbols.join(',')}&days=30`);
                if (res.ok) {
                    const json = await res.json();
                    setPerfData(json);
                }
            } catch (e) {
                console.error("Failed to fetch multi-performance", e);
            } finally {
                setPerfLoading(false);
            }
        };
        
        fetchPerf();
    }, [symbols]);

    const addSymbol = () => {
        const s = inputValue.trim().toUpperCase();
        if (s && !symbols.includes(s) && symbols.length < 5) {
            setSymbols([...symbols, s]);
            setInputValue('');
        }
    };

    const removeSymbol = (s: string) => {
        setSymbols(symbols.filter(sym => sym !== s));
    };

    const categoryMetrics = useMemo(() => {
        if (!data?.metrics) return [];
        const mapping: Record<string, string[]> = {
            valuation: ['pe_ratio', 'pb_ratio', 'ps_ratio', 'ev_ebitda', 'market_cap'],
            profitability: ['roe', 'roa', 'net_margin', 'gross_margin', 'operating_margin'],
            liquidity: ['current_ratio', 'quick_ratio', 'debt_equity'],
            efficiency: ['asset_turnover', 'inventory_turnover'],
            growth: ['revenue_growth', 'net_profit_growth', 'eps_growth']
        };
        const keys = mapping[activeCategory] || [];
        return data.metrics.filter((m: any) => keys.includes(m.key));
    }, [data, activeCategory]);

    return (
        <WidgetContainer
            title="Comparison Analysis"
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading}
            noPadding
            widgetId={id}
            hideHeader={hideHeader}
        >
            <div className="h-full flex flex-col bg-secondary overflow-hidden">
                {/* Search & Ticker Bar */}
                <div className="flex items-center gap-2 p-2 border-b border-white/5 bg-black/10">
                    <div className="flex gap-1 overflow-x-auto scrollbar-hide flex-1">
                        {symbols.map(s => (
                            <div key={s} className="flex items-center gap-1.5 px-2 py-1 bg-gray-800/50 rounded border border-white/5 shrink-0 group">
                                <CompanyLogo symbol={s} size={14} />
                                <span className="text-[10px] font-bold text-blue-400">{s}</span>
                                <button onClick={() => removeSymbol(s)} className="text-muted-foreground hover:text-red-400">
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                        {symbols.length < 5 && (
                            <div className="relative flex items-center">
                                <Search size={10} className="absolute left-2 text-muted-foreground" />
                                <input 
                                    className="w-20 pl-6 pr-2 py-1 bg-black/30 border border-white/5 rounded text-[10px] font-bold outline-none focus:border-blue-500"
                                    placeholder="Add..."
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value.toUpperCase())}
                                    onKeyDown={(e) => e.key === 'Enter' && addSymbol()}
                                />
                            </div>
                        )}
                    </div>
                    <button 
                        onClick={() => setShowChart(!showChart)}
                        className={cn(
                            "p-1.5 rounded hover:bg-white/5 transition-colors",
                            showChart ? "text-blue-400" : "text-muted-foreground"
                        )}
                    >
                        <LineChart size={14} />
                    </button>
                </div>

                {/* Performance Chart Section */}
                {showChart && symbols.length > 0 && (
                    <div className="h-[180px] w-full p-2 border-b border-white/5 bg-black/5">
                        {perfLoading ? (
                            <div className="h-full flex items-center justify-center opacity-20 animate-pulse">
                                <LineChart size={24} />
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <ReLineChart data={perfData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                                    <XAxis 
                                        dataKey="date" 
                                        hide 
                                    />
                                    <YAxis 
                                        domain={['auto', 'auto']} 
                                        tick={{fontSize: 9, fill: '#666'}} 
                                        axisLine={false}
                                        tickLine={false}
                                        tickFormatter={(v) => `${(v - 100).toFixed(0)}%`}
                                    />
                                    <Tooltip 
                                        contentStyle={{backgroundColor: '#111', border: '1px solid #333', fontSize: '10px'}}
                                        labelStyle={{color: '#666'}}
                                        formatter={(v: any) => [`${(v - 100).toFixed(2)}%`, '']}
                                    />
                                    <Legend iconType="circle" wrapperStyle={{fontSize: '9px', fontWeight: 'bold'}} />
                                    {symbols.map((s, i) => (
                                        <Line 
                                            key={s} 
                                            type="monotone" 
                                            dataKey={s} 
                                            stroke={CHART_COLORS[i % CHART_COLORS.length]} 
                                            dot={false} 
                                            strokeWidth={2}
                                            animationDuration={300}
                                        />
                                    ))}
                                </ReLineChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                )}

                {/* Categories & Table */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="px-2 py-2 shrink-0 flex items-center justify-between">
                        <MetricCategoryTabs activeCategory={activeCategory} onChange={setActiveCategory} />
                        <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest px-2">30D Performance Normalized to 0%</span>
                    </div>

                    <div className="flex-1 overflow-auto scrollbar-hide">
                        <table className="w-full text-[11px] border-collapse">
                            <thead>
                                <tr className="sticky top-0 bg-secondary border-b border-white/10 shadow-sm z-10">
                                    <th className="text-left p-3 text-muted-foreground font-black uppercase tracking-widest w-1/3">Metric</th>
                                    {symbols.map(s => (
                                        <th key={s} className="text-right p-3 text-muted-foreground font-black">{s}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {categoryMetrics.map((m: any) => (
                                    <tr key={m.key} className="group hover:bg-white/[0.02]">
                                        <td className="p-3 text-muted-foreground font-bold group-hover:text-primary transition-colors border-r border-white/5">
                                            {m.label}
                                        </td>
                                        {symbols.map(s => {
                                            const stock = data?.stocks.find((st: any) => st.symbol === s);
                                            const val = stock?.metrics[m.key];
                                            return (
                                                <td key={s} className="p-3 text-right font-mono text-primary group-hover:bg-white/[0.01]">
                                                    {formatMetric(val, m.format)}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </WidgetContainer>
    );
}

function formatMetric(value: number | null | undefined, format: string): string {
    if (value === null || value === undefined) return '-';
    switch (format) {
        case 'currency': return value.toLocaleString();
        case 'percent': return `${value.toFixed(2)}%`;
        case 'ratio': return value.toFixed(2);
        case 'large_number':
            if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
            if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
            if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
            return value.toLocaleString();
        default: return value.toLocaleString();
    }
}

export default ComparisonWidget;
