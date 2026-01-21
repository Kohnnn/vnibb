// Cash Flow Widget - Operating, Investing, Financing with Chart View
'use client';

import { useState, useMemo, memo } from 'react';
import { Banknote, RefreshCw, Table, BarChart3 } from 'lucide-react';
import { useCashFlow } from '@/lib/queries';
import {
    ComposedChart,
    Bar,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    Area,
    ResponsiveContainer,
    Legend,
    CartesianGrid,
    ReferenceLine,
} from 'recharts';
import {
    formatFinancialValue,
    formatAxisValue,
    chartColors,
} from '@/lib/financialCharts';
import { PeriodToggle, type Period } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { cn } from '@/lib/utils';

interface CashFlowWidgetProps {
    id: string;
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

type ViewMode = 'table' | 'chart';

function formatBillions(value: number | null | undefined): string {
    if (value === null || value === undefined) return '-';
    const prefix = value >= 0 ? '' : '-';
    return `${prefix}${(Math.abs(value) / 1e9).toFixed(1)}B`;
}

const labels: Record<string, string> = {
    operating_cash_flow: 'Operating CF',
    investing_cash_flow: 'Investing CF',
    financing_cash_flow: 'Financing CF',
    net_cash_flow: 'Net Cash Flow',
    free_cash_flow: 'Free Cash Flow',
    capital_expenditure: 'CapEx',
};

function CashFlowWidgetComponent({ id, symbol, isEditing, onRemove }: CashFlowWidgetProps) {
    const { period, setPeriod } = usePeriodState({
        widgetId: id || 'cash_flow',
        defaultPeriod: 'FY',
    });
    const [viewMode, setViewMode] = useState<ViewMode>('table');
    
    // Map period to API period
    const apiPeriod = useMemo(() => {
        if (period === 'FY') return 'year';
        return period;
    }, [period]);

    const { data, isLoading, refetch, isRefetching } = useCashFlow(symbol, { period: apiPeriod });

    const items = data?.data || [];

    const chartData = useMemo(() => {
        if (!items.length) return [];
        return [...items].slice(0, 5).reverse().map((d) => ({
            period: d.period || '-',
            operatingCF: d.operating_cash_flow || 0,
            investingCF: d.investing_cash_flow || 0,
            financingCF: d.financing_cash_flow || 0,
            freeCashFlow: d.free_cash_flow || 0,
            netCashFlow: d.net_cash_flow || 0,
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
                {['operating_cash_flow', 'investing_cash_flow', 'financing_cash_flow', 'free_cash_flow'].map((key) => (
                    <tr key={key} className="border-b border-gray-800/30 hover:bg-white/5 transition-colors">
                        <td className="py-2 px-1 text-gray-400 font-medium">{labels[key] || key}</td>
                        {items.slice(0, 4).map((d, i) => {
                            const value = d[key as keyof typeof d] as number;
                            return (
                                <td key={i} className={`text-right py-2 px-1 font-mono ${value && value >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {formatBillions(value)}
                                </td>
                            );
                        })}
                    </tr>
                ))}
            </tbody>
        </table>
    );

    const [chartType, setChartType] = useState<'overview' | 'fcf'>('overview');

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
                        <option value="overview">Cash Flows</option>
                        <option value="fcf">Free Cash Flow</option>
                    </select>
                </div>

                <div className="flex-1 min-h-[150px]">
                    <ResponsiveContainer width="100%" height="100%">
                        {chartType === 'overview' ? (
                            <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
                                <XAxis dataKey="period" tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} />
                                <YAxis tickFormatter={formatAxisValue} tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} />
                                <ReferenceLine y={0} stroke="#333" />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
                                />
                                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                                <Bar dataKey="operatingCF" name="Operating" fill="#3b82f6" radius={[2, 2, 2, 2]} />
                                <Bar dataKey="investingCF" name="Investing" fill="#f59e0b" radius={[2, 2, 2, 2]} />
                                <Bar dataKey="financingCF" name="Financing" fill="#ef4444" radius={[2, 2, 2, 2]} />
                            </ComposedChart>
                        ) : (
                            <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
                                <XAxis dataKey="period" tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} />
                                <YAxis tickFormatter={formatAxisValue} tick={{ fill: '#666', fontSize: 9 }} axisLine={false} tickLine={false} />
                                <ReferenceLine y={0} stroke="#333" />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
                                />
                                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                                <Area type="monotone" dataKey="freeCashFlow" name="Free Cash Flow" fill="#10b981" stroke="#10b981" fillOpacity={0.1} />
                                <Line type="monotone" dataKey="netCashFlow" name="Net Cash Change" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
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
            title="Cash Flow Statement"
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
                            <Banknote size={32} strokeWidth={1} />
                            No Statement Found
                        </div>
                    ) : viewMode === 'table' ? renderTable() : renderChart()}
                </div>
            </div>
        </WidgetContainer>
    );
}

export const CashFlowWidget = memo(CashFlowWidgetComponent);
export default CashFlowWidget;
