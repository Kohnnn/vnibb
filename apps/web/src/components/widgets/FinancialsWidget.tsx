'use client';

import { useState, useMemo, memo } from 'react';
import { useIncomeStatement, useBalanceSheet, useCashFlow, useFinancialRatios } from '@/lib/queries';
import { cn } from '@/lib/utils';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
    TrendingUp, TrendingDown, Minus, Info,
    ArrowUpRight, BarChart3, LayoutGrid
} from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';

type FinancialTab = 'balance_sheet' | 'income_statement' | 'cash_flow' | 'ratios';

interface FinancialsWidgetProps {
    id: string;
    symbol: string;
    hideHeader?: boolean;
    onRemove?: () => void;
}

function FinancialsWidgetComponent({ id, symbol, hideHeader, onRemove }: FinancialsWidgetProps) {
    const [activeTab, setActiveTab] = useState<FinancialTab>('income_statement');
    const [period, setPeriod] = useState('FY');

    const tabs = [
        { id: 'income_statement', label: 'Income', icon: ArrowUpRight },
        { id: 'balance_sheet', label: 'Balance', icon: LayoutGrid },
        { id: 'cash_flow', label: 'Cash Flow', icon: BarChart3 },
        { id: 'ratios', label: 'Ratios', icon: Info },
    ];

    const apiPeriod = period === 'FY' ? 'year' : 'quarter';

    const incomeQuery = useIncomeStatement(symbol, { period: apiPeriod, enabled: activeTab === 'income_statement' });
    const balanceQuery = useBalanceSheet(symbol, { period: apiPeriod, enabled: activeTab === 'balance_sheet' });
    const cashFlowQuery = useCashFlow(symbol, { period: apiPeriod, enabled: activeTab === 'cash_flow' });
    const ratiosQuery = useFinancialRatios(symbol, { period: apiPeriod, enabled: activeTab === 'ratios' });

    const activeQuery = useMemo(() => {
        switch (activeTab) {
            case 'income_statement': return incomeQuery;
            case 'balance_sheet': return balanceQuery;
            case 'cash_flow': return cashFlowQuery;
            case 'ratios': return ratiosQuery;
        }
    }, [activeTab, incomeQuery, balanceQuery, cashFlowQuery, ratiosQuery]);

    const tableData = useMemo(() => {
        if (!activeQuery?.data) return null;
        const rawData = activeQuery.data.data || [];

        // Sort chronological for growth calculation
        const sortedData = [...rawData].sort((a: any, b: any) => {
            if (a.fiscal_year !== b.fiscal_year) return a.fiscal_year - b.fiscal_year;
            return (a.fiscal_quarter || 0) - (b.fiscal_quarter || 0);
        });

        const columns = rawData.map((d: any) => d.period).reverse(); // Latest first for display

        let metrics: any[] = [];
        if (activeTab === 'ratios') {
            metrics = [
                { key: 'pe_ratio', label: 'P/E' },
                { key: 'pb_ratio', label: 'P/B' },
                { key: 'roe', label: 'ROE', isPct: true },
                { key: 'roa', label: 'ROA', isPct: true },
                { key: 'gross_margin', label: 'Gross Margin', isPct: true },
                { key: 'net_margin', label: 'Net Margin', isPct: true },
                { key: 'debt_to_equity', label: 'D/E' },
            ];
        } else {
            const keys = {
                income_statement: ['revenue', 'gross_profit', 'operating_income', 'net_income', 'ebitda'],
                balance_sheet: ['total_assets', 'total_liabilities', 'total_equity', 'cash_and_equivalents'],
                cash_flow: ['operating_cash_flow', 'investing_cash_flow', 'financing_cash_flow', 'free_cash_flow']
            }[activeTab];

            const labels = {
                income_statement: ['Revenue', 'Gross Profit', 'Operating Inc.', 'Net Income', 'EBITDA'],
                balance_sheet: ['Total Assets', 'Total Liab.', 'Total Equity', 'Cash & Eq.'],
                cash_flow: ['Operating CF', 'Investing CF', 'Financing CF', 'Free CF']
            }[activeTab];

            metrics = keys.map((key, i) => ({ key, label: labels[i] }));
        }

        return {
            periods: columns,
            rows: metrics.map(m => {
                const values: Record<string, any> = {};
                rawData.forEach((d: any) => {
                    const currentVal = d[m.key];
                    // Find previous period for growth
                    const prevIndex = sortedData.findIndex((sd: any) => sd.period === d.period) - 1;
                    const prevVal = prevIndex >= 0 ? (sortedData[prevIndex] as any)[m.key] : null;

                    let growth = null;
                    if (prevVal && prevVal !== 0 && currentVal !== null) {
                        growth = ((currentVal - prevVal) / Math.abs(prevVal)) * 100;
                    }

                    values[d.period] = { val: currentVal, growth };
                });
                return { label: m.label, isPct: m.isPct, values };
            })
        };
    }, [activeQuery?.data, activeTab]);

    return (
        <WidgetContainer
            title="Financials"
            symbol={symbol}
            onRefresh={() => activeQuery.refetch()}
            onClose={onRemove}
            isLoading={activeQuery.isLoading}
            noPadding
            widgetId={id}
            hideHeader={hideHeader}
        >
            <div className="h-full flex flex-col bg-secondary text-primary font-sans select-none overflow-hidden">
                {/* Tab Switcher */}
                <div className="flex items-center justify-between border-b border-white/5 bg-black/20 px-2 h-10 shrink-0">
                    <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as FinancialTab)}
                                    className={cn(
                                        "flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold uppercase tracking-tight rounded-md transition-all whitespace-nowrap",
                                        activeTab === tab.id
                                            ? "bg-blue-600/10 text-blue-400"
                                            : "text-muted-foreground hover:text-primary hover:bg-white/5"
                                    )}
                                >
                                    <Icon size={12} />
                                    <span className="hidden sm:inline">{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="text-[10px] font-black text-muted-foreground uppercase hidden md:inline">VND</span>
                        <div className="flex bg-muted/30 rounded p-0.5 gap-0.5">
                            {['FY', 'QTR', 'TTM'].map((opt) => (
                                <button
                                    key={opt}
                                    onClick={() => setPeriod(opt)}
                                    className={cn(
                                        "px-2 py-0.5 text-[9px] font-black rounded transition-colors",
                                        period === opt ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-primary"
                                    )}
                                >
                                    {opt}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Table Area with Horizontal Scroll */}
                <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-gray-800 p-1">
                    {activeQuery?.isLoading ? (
                        <div className="space-y-3 p-2 animate-pulse opacity-50">
                            {[1, 2, 3, 4, 5, 6].map(i => (
                                <div key={i} className="flex gap-4">
                                    <div className="h-4 bg-gray-800 rounded w-1/3" />
                                    <div className="h-4 bg-gray-800 rounded w-1/6" />
                                    <div className="h-4 bg-gray-800 rounded w-1/6" />
                                    <div className="h-4 bg-gray-800 rounded w-1/6" />
                                </div>
                            ))}
                        </div>
                    ) : !tableData || tableData.periods.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 opacity-60">
                            <div className="h-12 w-12 rounded-xl bg-gray-800/50 flex items-center justify-center border border-white/5 shadow-inner">
                                <Minus size={20} className="text-gray-500" />
                            </div>
                            <div className="text-center">
                                <span className="block text-[10px] uppercase font-black tracking-widest mb-1 text-gray-400">No Statements Found</span>
                                <span className="text-[9px] text-gray-600 block">Try switching period or source</span>
                            </div>
                        </div>
                    ) : (
                        <div className="min-w-max">
                            <table className="w-full text-[11px] border-collapse table-fixed">
                                <thead className="sticky top-0 bg-secondary/95 backdrop-blur-sm z-20">
                                    <tr className="border-b border-white/10 shadow-sm">
                                        <th className="text-left p-2.5 pl-3 text-muted-foreground font-black uppercase tracking-widest w-[160px] bg-secondary/95 backdrop-blur-sm sticky left-0 z-30 shadow-[2px_0_5px_rgba(0,0,0,0.3)]">Metric</th>
                                        {tableData.periods.map(p => (
                                            <th key={p} className="text-right p-2.5 text-muted-foreground font-black min-w-[100px]">{p}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.03]">
                                    {tableData.rows.map((row, i) => (
                                        <tr key={i} className="group hover:bg-white/[0.02] transition-colors">
                                            <td className="p-2.5 pl-3 font-medium text-gray-400 group-hover:text-blue-300 transition-colors border-r border-white/5 bg-secondary/95 backdrop-blur-sm sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.2)]">
                                                {row.label}
                                            </td>
                                            {tableData.periods.map(p => {
                                                const data = row.values[p];
                                                const val = data?.val;
                                                const growth = data?.growth;

                                                return (
                                                    <td key={p} className="p-2.5 text-right font-mono group-hover:bg-white/[0.01]">
                                                        <div className="flex flex-col items-end">
                                                            <span className={cn(
                                                                "font-medium",
                                                                val < 0 ? "text-red-400" : "text-gray-200"
                                                            )}>
                                                                {row.isPct ? formatPct(val) : formatValue(val)}
                                                            </span>
                                                            {growth !== null && Math.abs(growth) > 1 && (
                                                                <span className={cn(
                                                                    "text-[9px] font-bold flex items-center gap-0.5 mt-0.5 opacity-60 group-hover:opacity-100 transition-opacity",
                                                                    growth > 0 ? "text-green-500" : "text-red-500"
                                                                )}>
                                                                    {growth > 0 ? '+' : ''}{growth.toFixed(0)}%
                                                                    {growth > 0 ? <TrendingUp size={8} /> : <TrendingDown size={8} />}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

function formatValue(value: number | null | undefined): string {
    if (value === null || value === undefined) return '-';
    const absVal = Math.abs(value);
    if (absVal >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
    if (absVal >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
    if (absVal >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    return value.toLocaleString();
}

function formatPct(value: number | null | undefined): string {
    if (value === null || value === undefined) return '-';
    return `${value.toFixed(2)}%`;
}

export const FinancialsWidget = memo(FinancialsWidgetComponent);
export default FinancialsWidget;
