// Income Statement Widget - Revenue, Profit, Margins with Chart View
'use client';

import { useState, useMemo, memo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, RefreshCw, Table, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIncomeStatement } from '@/lib/queries';
import {
    ComposedChart,
    Bar,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Legend,
    CartesianGrid,
} from 'recharts';
import {
    formatFinancialValue,
    formatAxisValue,
    chartColors,
} from '@/lib/financialCharts';
import { PeriodToggle, type Period } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import { WidgetContainer } from '@/components/ui/WidgetContainer';

interface IncomeStatementWidgetProps {
    id: string;
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

type ViewMode = 'table' | 'chart';

function formatBillions(value: number | null | undefined): string {
    if (value === null || value === undefined) return '-';
    return `${(value / 1e9).toFixed(1)}B`;
}

const labels: Record<string, string> = {
    revenue: 'Revenue',
    gross_profit: 'Gross Profit',
    operating_income: 'Operating Income',
    profit_before_tax: 'Pre-tax Profit',
    net_income: 'Net Income',
    eps: 'EPS',
};

function IncomeStatementWidgetComponent({ id, symbol, isEditing, onRemove }: IncomeStatementWidgetProps) {
    const { period, setPeriod } = usePeriodState({
        widgetId: id || 'income_statement',
        defaultPeriod: 'FY',
    });
    const [viewMode, setViewMode] = useState<ViewMode>('table');
    
    // Map period to API period
    const apiPeriod = useMemo(() => {
        if (period === 'FY') return 'year';
        return period;
    }, [period]);

    const { data, isLoading, refetch, isRefetching } = useIncomeStatement(symbol, { period: apiPeriod });

    const items = data?.data || [];

    const chartData = useMemo(() => {
        if (!items.length) return [];
        return [...items].slice(0, 5).reverse().map((d) => ({
            period: d.period || '-',
            revenue: d.revenue || 0,
            grossProfit: d.gross_profit || 0,
            operatingIncome: d.operating_income || 0,
            netIncome: d.net_income || 0,
            grossMargin: d.revenue && d.gross_profit ? (d.gross_profit / d.revenue) * 100 : 0,
            operatingMargin: d.revenue && d.operating_income ? (d.operating_income / d.revenue) * 100 : 0,
            netMargin: d.revenue && d.net_income ? (d.net_income / d.revenue) * 100 : 0,
        }));
    }, [items]);

    const renderTable = () => (
        <table className="w-full text-[11px] text-left">
            <thead className="text-gray-500 sticky top-0 bg-[#0a0a0a] z-10">
                <tr className="border-b border-gray-800">
                    <th className="py-2 px-1 font-bold uppercase tracking-tighter">Item</th>
                    {items.slice(0, 4).map((d, i) => (
                        <th key={i} className="text-right py-2 px-1 font-bold">{d.period || '-'}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {['revenue', 'gross_profit', 'operating_income', 'net_income', 'eps'].map((key) => (
                    <tr key={key} className="border-b border-gray-800/30 hover:bg-white/5 transition-colors">
                        <td className="py-2 px-1 text-gray-400 font-medium">{labels[key] || key}</td>
                        {items.slice(0, 4).map((d, i) => (
                            <td key={i} className="text-right py-2 px-1 text-white font-mono">
                                {key === 'eps'
                                    ? (d.eps?.toLocaleString() || '-')
                                    : formatBillions(d[key as keyof typeof d] as number)}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );

    const [chartType, setChartType] = useState<'overview' | 'margins'>('overview');

    const renderChart = () => {
        if (!chartData.length) {
            return (
                <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-2">
                    <BarChart3 size={32} className="opacity-20" />
                    <p className="text-[10px] font-bold uppercase tracking-widest">No visualization available</p>
                </div>
            );
        }

        return (
            <div className="h-full flex flex-col gap-2">
                <div className="flex justify-end px-2 pt-1">
                    <select
                        value={chartType}
                        onChange={(e) => setChartType(e.target.value as any)}
                        className="bg-gray-900 text-[10px] font-bold text-gray-400 border border-gray-800 rounded px-2 py-1 focus:outline-none focus:border-blue-500 uppercase tracking-tighter cursor-pointer hover:text-white transition-colors"
                    >
                        <option value="overview">Revenue & Profit</option>
                        <option value="margins">Margins %</option>
                    </select>
                </div>

                <div className="flex-1 min-h-[150px]">
                    <ResponsiveContainer width="100%" height="100%">
                        {chartType === 'overview' ? (
                            <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
                                <XAxis dataKey="period" tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} />
                                <YAxis tickFormatter={formatAxisValue} tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
                                    itemStyle={{ padding: '0px' }}
                                />
                                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                                <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                                <Line type="monotone" dataKey="netIncome" name="Net Income" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                            </ComposedChart>
                        ) : (
                            <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
                                <XAxis dataKey="period" tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} />
                                <YAxis tickFormatter={(val) => `${val}%`} tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
                                />
                                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                                <Line type="monotone" dataKey="grossMargin" name="Gross %" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                                <Line type="monotone" dataKey="netMargin" name="Net %" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                            </ComposedChart>
                        )}
                    </ResponsiveContainer>
                </div>
            </div>
        );
    };

    const headerActions = (
        <div className="flex items-center gap-2 mr-2">
            <div className="flex bg-gray-900 rounded p-0.5 border border-gray-800">
                <button
                    onClick={() => setViewMode('table')}
                    className={cn(
                        "p-1 rounded transition-all",
                        viewMode === 'table' ? "bg-gray-800 text-blue-400 shadow-sm" : "text-gray-500 hover:text-gray-300"
                    )}
                    title="Table View"
                >
                    <Table size={12} />
                </button>
                <button
                    onClick={() => setViewMode('chart')}
                    className={cn(
                        "p-1 rounded transition-all",
                        viewMode === 'chart' ? "bg-gray-800 text-blue-400 shadow-sm" : "text-gray-500 hover:text-gray-300"
                    )}
                    title="Chart View"
                >
                    <BarChart3 size={12} />
                </button>
            </div>
            <PeriodToggle value={period} onChange={setPeriod} compact />
        </div>
    );

    return (
        <WidgetContainer
            title="Income Statement"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading || isRefetching}
            headerActions={headerActions}
            noPadding
            widgetId={id}
            showLinkToggle
            exportData={items}
        >
            <div className="h-full flex flex-col p-2">
                <div className="flex-1 overflow-auto scrollbar-hide">
                    {items.length === 0 && !isLoading ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2 opacity-50 uppercase font-black text-[10px] tracking-widest">
                            <TrendingUp size={32} strokeWidth={1} />
                            No Statement Found
                        </div>
                    ) : viewMode === 'table' ? renderTable() : renderChart()}
                </div>
            </div>
        </WidgetContainer>
    );
}

export const IncomeStatementWidget = memo(IncomeStatementWidgetComponent);
export default IncomeStatementWidget;
