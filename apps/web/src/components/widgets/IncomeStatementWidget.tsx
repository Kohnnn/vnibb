// Income Statement Widget - Revenue, Profit, Margins with Chart View
'use client';

import { useState, useMemo, memo } from 'react';
import { TrendingUp, Table, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIncomeStatement } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
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
import { formatAxisValue, formatUnitValuePlain, getUnitCaption, getUnitLegend, resolveUnitScale } from '@/lib/units';
import { useUnit } from '@/contexts/UnitContext';
import { PeriodToggle, type Period } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { Sparkline } from '@/components/ui/Sparkline';

interface IncomeStatementWidgetProps {
    id: string;
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

type ViewMode = 'table' | 'chart';

function formatPeriodLabel(value: string | null | undefined): string {
    if (!value) return '-';
    const cleaned = value.trim();
    if (!cleaned || cleaned.toLowerCase() === 'unknown' || cleaned.toLowerCase() === 'nan') return '-';
    return cleaned;
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
    const { config: unitConfig } = useUnit();
    
    const apiPeriod = period;

    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useIncomeStatement(symbol, { period: apiPeriod });

    const items = data?.data || [];
    const hasData = items.length > 0;
    const isFallback = Boolean(error && hasData);

    const chartData = useMemo(() => {
        if (!items.length) return [];
        return [...items].slice(0, 5).reverse().map((d) => ({
            period: formatPeriodLabel(d.period),
            revenue: d.revenue || 0,
            grossProfit: d.gross_profit || 0,
            operatingIncome: d.operating_income || 0,
            netIncome: d.net_income || 0,
            grossMargin: d.revenue && d.gross_profit ? (d.gross_profit / d.revenue) * 100 : 0,
            operatingMargin: d.revenue && d.operating_income ? (d.operating_income / d.revenue) * 100 : 0,
            netMargin: d.revenue && d.net_income ? (d.net_income / d.revenue) * 100 : 0,
        }));
    }, [items]);

    const tableScale = useMemo(() => {
        const values = items.flatMap((item) => [
            item.revenue,
            item.gross_profit,
            item.operating_income,
            item.net_income,
        ]);
        return resolveUnitScale(values, unitConfig);
    }, [items, unitConfig]);

    const unitLegend = useMemo(() => getUnitLegend(tableScale, unitConfig), [tableScale, unitConfig]);

    const renderTable = () => (
        <div className="space-y-1">
            <div className="px-1 text-[10px] text-gray-500 italic">{unitLegend}</div>
            <table className="data-table w-full text-[11px] text-left">
                <thead className="text-gray-500 sticky top-0 bg-[#0a0a0a] z-10">
                    <tr className="border-b border-gray-800">
                        <th className="py-2 px-1 font-bold uppercase tracking-tighter">Item</th>
                        {items.slice(0, 4).map((d, i) => (
                            <th key={i} className="text-right py-2 px-1 font-bold">{formatPeriodLabel(d.period)}</th>
                        ))}
                        <th className="py-2 px-1 font-bold uppercase tracking-tighter text-center">Trend</th>
                    </tr>
                </thead>
                <tbody>
                    {['revenue', 'gross_profit', 'operating_income', 'net_income', 'eps'].map((key) => {
                        const points = items
                            .slice(0, 4)
                            .slice()
                            .reverse()
                            .map((d) => Number(d[key as keyof typeof d]))
                            .filter((value) => Number.isFinite(value));

                        return (
                            <tr key={key} className="border-b border-gray-800/30 hover:bg-white/5 transition-colors">
                                <td className="py-2 px-1 text-gray-400 font-medium">{labels[key] || key}</td>
                                {items.slice(0, 4).map((d, i) => (
                                    <td key={i} data-type="number" className="text-right py-2 px-1 text-white font-mono">
                                        {key === 'eps'
                                            ? (d.eps?.toLocaleString() || '-')
                                            : formatUnitValuePlain(d[key as keyof typeof d] as number, tableScale, unitConfig)}
                                    </td>
                                ))}
                                <td className="py-2 px-1 text-center">
                                    {points.length < 2 ? (
                                        <span className="text-[10px] text-muted-foreground">-</span>
                                    ) : (
                                        <Sparkline data={points} width={70} height={18} />
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
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
                <div className="h-full flex flex-col gap-1">
                <div className="flex justify-end px-1 pt-0.5">
                    <select
                        value={chartType}
                        onChange={(e) => setChartType(e.target.value as any)}
                        className="bg-gray-900 text-[10px] font-bold text-gray-400 border border-gray-800 rounded px-2 py-1 focus:outline-none focus:border-blue-500 uppercase tracking-tighter cursor-pointer hover:text-white transition-colors"
                    >
                        <option value="overview">Revenue & Profit</option>
                        <option value="margins">Margins %</option>
                    </select>
                </div>

                <div className="flex-1 min-h-[132px]">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={120}>
                        {chartType === 'overview' ? (
                            <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
                                <XAxis dataKey="period" tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} />
                                <YAxis
                                    tickFormatter={(value) => formatAxisValue(value, unitConfig)}
                                    tick={{ fill: '#666', fontSize: 9 }}
                                    axisLine={false}
                                    tickLine={false}
                                    label={{ value: getUnitCaption(unitConfig), angle: -90, position: 'insideLeft', fill: '#666', fontSize: 9 }}
                                />
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
                                <YAxis
                                    tickFormatter={(val) => `${val}%`}
                                    tick={{ fill: '#666', fontSize: 9 }}
                                    axisLine={false}
                                    tickLine={false}
                                    label={{ value: '%', angle: -90, position: 'insideLeft', fill: '#666', fontSize: 9 }}
                                />
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
        <div className="flex items-center gap-1.5 mr-1">
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
            isLoading={isLoading && !hasData}
            headerActions={headerActions}
            noPadding
            widgetId={id}
            showLinkToggle
            exportData={items}
        >
            <div className="h-full flex flex-col px-2 py-1.5">
                <div className="pb-1 border-b border-gray-800/50">
                    <WidgetMeta
                        updatedAt={dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={isFallback}
                        note={`${period === 'FY' ? 'Annual' : period === 'TTM' ? 'TTM' : period}`}
                        align="right"
                    />
                </div>
                <div className="flex-1 overflow-auto scrollbar-hide pt-1">
                    {isLoading && !hasData ? (
                        <WidgetSkeleton variant="table" lines={6} />
                    ) : error && !hasData ? (
                        <WidgetError error={error as Error} onRetry={() => refetch()} />
                    ) : !hasData ? (
                        <WidgetEmpty message={`No income statement data for ${symbol}`} icon={<TrendingUp size={18} />} />
                    ) : viewMode === 'table' ? (
                        renderTable()
                    ) : (
                        renderChart()
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

export const IncomeStatementWidget = memo(IncomeStatementWidgetComponent);
export default IncomeStatementWidget;
