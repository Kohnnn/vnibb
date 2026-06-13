'use client';

import { useState, useMemo, useEffect, memo } from 'react';
import { useIncomeStatement, useBalanceSheet, useCashFlow, useFinancialRatios } from '@/lib/queries';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { cn } from '@/lib/utils';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { DenseFinancialTable, type DenseTableColumn, type DenseTableRow } from '@/components/ui/DenseFinancialTable';
import {
    TrendingUp, TrendingDown, Info,
    ArrowUpRight, BarChart3, LayoutGrid
} from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { Sparkline } from '@/components/ui/Sparkline';
import { useUnit } from '@/contexts/UnitContext';
import {
    formatFinancialPeriodLabel,
    matchesFinancialQuarterSelection,
    normalizeFinancialPeriod,
    periodSortKey,
} from '@/lib/financialPeriods';
import {
    formatNumber,
    formatPercent,
    formatUnitValuePlain,
    getUnitLegend,
    resolveUnitScale,
    convertFinancialValueForUnit,
} from '@/lib/units';

type FinancialTab = 'balance_sheet' | 'income_statement' | 'cash_flow' | 'ratios';

interface FinancialsWidgetProps {
    id: string;
    symbol: string;
    hideHeader?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: unknown) => void;
}

// Per-share metrics (EPS/BVPS/DPS) are absolute VND-per-share values and must NOT be
// divided by the table-wide billions scale. Without this, e.g. EPS ~2000 VND / 1e9 -> 0.00.
const PER_SHARE_METRIC_KEYS = new Set<string>(['eps', 'bvps', 'dps', 'book_value_per_share']);

const STATEMENT_METRIC_KEYS: Record<'income_statement' | 'balance_sheet' | 'cash_flow', string[]> = {
    income_statement: [
        'revenue',
        'cost_of_revenue',
        'gross_profit',
        'operating_expenses',
        'operating_income',
        'interest_expense',
        'pre_tax_income',
        'income_tax',
        'net_income',
        'ebitda',
        'eps',
    ],
    balance_sheet: [
        'cash_and_equivalents',
        'short_term_investments',
        'receivables',
        'inventory',
        'current_assets',
        'long_term_investments',
        'fixed_assets',
        'total_assets',
        'short_term_debt',
        'current_liabilities',
        'long_term_debt',
        'total_liabilities',
        'retained_earnings',
        'total_equity',
    ],
    cash_flow: [
        'operating_cash_flow',
        'capital_expenditures',
        'investing_cash_flow',
        'debt_issued',
        'debt_repaid',
        'dividends_paid',
        'financing_cash_flow',
        'net_change_in_cash',
        'free_cash_flow',
    ],
};

const STATEMENT_METRIC_ALIASES: Record<string, string[]> = {
    revenue: ['revenue', 'net_revenue', 'sales_revenue', 'total_revenue', 'doanh_thu_thuan', 'doanh_thu'],
    cost_of_revenue: ['cost_of_revenue', 'costOfRevenue', 'cogs', 'cost_of_goods_sold', 'gia_von_hang_ban'],
    gross_profit: ['gross_profit', 'grossProfit', 'loi_nhuan_gop'],
    operating_expenses: ['operating_expenses', 'operatingExpenses', 'opex', 'sga', 'selling_general_admin', 'sellingGeneralAdmin', 'chi_phi_quan_ly_doanh_nghiep', 'chi_phi_ban_hang'],
    operating_income: ['operating_income', 'operatingIncome', 'operating_profit', 'loi_nhuan_thuan_tu_hoat_dong_kinh_doanh'],
    interest_expense: ['interest_expense', 'interestExpense', 'chi_phi_lai_vay'],
    pre_tax_income: ['pre_tax_income', 'preTaxIncome', 'pre_tax_profit', 'preTaxProfit', 'income_before_tax', 'profit_before_tax', 'tong_loi_nhuan_truoc_thue'],
    income_tax: ['income_tax', 'incomeTax', 'tax_expense', 'taxExpense', 'thue_tncn', 'chi_phi_thue_thu_nhap_doanh_nghiep'],
    net_income: ['net_income', 'netIncome', 'post_tax_profit', 'profit_after_tax', 'loi_nhuan_sau_thue'],
    ebitda: ['ebitda', 'EBITDA'],
    eps: ['eps', 'earnings_per_share', 'basic_eps', 'lai_co_ban_tren_co_phieu'],

    cash_and_equivalents: ['cash_and_equivalents', 'cashAndCashEquivalents', 'cash', 'cash_equivalents', 'tien_va_tuong_duong_tien'],
    short_term_investments: ['short_term_investments', 'shortTermInvestments', 'dau_tu_tai_chinh_ngan_han'],
    receivables: ['receivables', 'accounts_receivable', 'cac_khoan_phai_thu_ngan_han', 'short_term_receivables', 'shortTermReceivables'],
    inventory: ['inventory', 'inventories', 'hang_ton_kho'],
    current_assets: ['current_assets', 'currentAssets', 'tai_san_ngan_han'],
    long_term_investments: ['long_term_investments', 'longTermInvestments', 'dau_tu_tai_chinh_dai_han'],
    fixed_assets: ['fixed_assets', 'fixedAssets', 'tai_san_co_dinh'],
    total_assets: ['total_assets', 'totalAssets', 'asset', 'assets', 'tong_tai_san'],
    short_term_debt: ['short_term_debt', 'shortTermDebt', 'short_term_borrowings', 'vay_va_no_ngan_han'],
    current_liabilities: ['current_liabilities', 'currentLiabilities', 'no_ngan_han'],
    long_term_debt: ['long_term_debt', 'longTermDebt', 'long_term_liabilities', 'longTermLiabilities', 'long_term_borrowings', 'vay_va_no_dai_han'],
    total_liabilities: ['total_liabilities', 'totalLiabilities', 'liabilities', 'debt', 'tong_no_phai_tra'],
    retained_earnings: ['retained_earnings', 'retainedEarnings', 'loi_nhuan_chua_phan_phoi', 'loi_nhuan_sau_thue_chua_phan_phoi'],
    total_equity: ['total_equity', 'totalEquity', 'equity', 'owner_equity', 'owners_equity', 'von_chu_so_huu'],

    operating_cash_flow: ['operating_cash_flow', 'operatingCashFlow', 'fromOperating', 'cash_from_operations', 'luu_chuyen_tien_thuan_tu_hoat_dong_kinh_doanh'],
    capital_expenditures: ['capital_expenditures', 'capitalExpenditures', 'capex', 'mua_sam_tai_san_co_dinh'],
    investing_cash_flow: ['investing_cash_flow', 'investingCashFlow', 'fromInvesting', 'cash_from_investments', 'luu_chuyen_tien_thuan_tu_hoat_dong_dau_tu'],
    debt_issued: ['debt_issued', 'debtIssued', 'proceeds_from_borrowings', 'proceedsFromBorrowings', 'tien_vay_ngan_han_dai_han_nhan_duoc'],
    debt_repaid: ['debt_repaid', 'debtRepaid', 'repayment_of_borrowings', 'repaymentOfBorrowings', 'tien_chi_tra_no_goc_vay'],
    dividends_paid: ['dividends_paid', 'dividendsPaid', 'co_tuc_loi_nhuan_da_tra_cho_chu_so_huu'],
    financing_cash_flow: ['financing_cash_flow', 'financingCashFlow', 'fromFinancing', 'cash_from_financing', 'luu_chuyen_tien_thuan_tu_hoat_dong_tai_chinh'],
    net_change_in_cash: ['net_change_in_cash', 'netChangeInCash', 'luu_chuyen_tien_thuan_trong_ky'],
    free_cash_flow: ['free_cash_flow', 'freeCashFlow', 'fcf', 'dong_tien_tu_do'],
};

function normalizeMetricKey(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function buildMetricLookup(source: unknown): Map<string, unknown> {
    const lookup = new Map<string, unknown>();
    if (!source || typeof source !== 'object') return lookup;
    Object.entries(source as Record<string, unknown>).forEach(([key, value]) => {
        lookup.set(key, value);
        lookup.set(normalizeMetricKey(key), value);
    });
    return lookup;
}

function readMetricValue(row: Record<string, any>, key: string): any {
    const aliases = STATEMENT_METRIC_ALIASES[key] || [key];
    const rowLookup = buildMetricLookup(row);
    for (const alias of aliases) {
        const value = rowLookup.get(alias) ?? rowLookup.get(normalizeMetricKey(alias));
        if (value !== null && value !== undefined && value !== '') return value;
    }
    const rawData = row.raw_data || row.rawData || row.raw;
    const rawLookup = buildMetricLookup(rawData);
    if (rawLookup.size > 0) {
        for (const alias of aliases) {
            const value = rawLookup.get(alias) ?? rawLookup.get(normalizeMetricKey(alias));
            if (value !== null && value !== undefined && value !== '') return value;
        }
    }
    return null;
}

const STATEMENT_LABELS: Record<'income_statement' | 'balance_sheet' | 'cash_flow', string[]> = {
    income_statement: [
        'Revenue',
        'Cost of Revenue',
        'Gross Profit',
        'Operating Expenses',
        'Operating Income',
        'Interest Expense',
        'Pre-Tax Income',
        'Income Tax',
        'Net Income',
        'EBITDA',
        'EPS',
    ],
    balance_sheet: [
        'Cash & Eq.',
        'ST Investments',
        'Receivables',
        'Inventory',
        'Current Assets',
        'LT Investments',
        'Fixed Assets',
        'Total Assets',
        'ST Debt',
        'Current Liab.',
        'LT Debt',
        'Total Liab.',
        'Retained Earnings',
        'Total Equity',
    ],
    cash_flow: [
        'Operating CF',
        'CapEx',
        'Investing CF',
        'Debt Issued',
        'Debt Repaid',
        'Dividends Paid',
        'Financing CF',
        'Net Change in Cash',
        'Free CF',
    ],
};

const RATIO_METRIC_KEYS = [
    'pe',
    'pb',
    'roe',
    'roa',
    'eps',
    'bvps',
    'debt_equity',
    'current_ratio',
    'quick_ratio',
    'gross_margin',
    'operating_margin',
    'net_margin',
    'asset_turnover',
    'inventory_turnover',
    'dividend_yield',
    'payout_ratio',
];

const RATIO_METRIC_ALIASES: Record<string, string[]> = {
    pe: ['pe', 'pe_ratio', 'priceToEarning'],
    pb: ['pb', 'pb_ratio', 'priceToBook'],
    ps: ['ps', 'ps_ratio', 'priceToSales'],
};

function readRatioValue(row: Record<string, any>, key: string): any {
    const aliases = RATIO_METRIC_ALIASES[key] || [key];
    const rowLookup = buildMetricLookup(row);
    for (const alias of aliases) {
        const value = rowLookup.get(alias) ?? rowLookup.get(normalizeMetricKey(alias));
        if (value !== null && value !== undefined && value !== '') return value;
    }
    const rawData = row.raw_data || row.rawData || row.raw;
    const rawLookup = buildMetricLookup(rawData);
    if (rawLookup.size > 0) {
        for (const alias of aliases) {
            const value = rawLookup.get(alias) ?? rawLookup.get(normalizeMetricKey(alias));
            if (value !== null && value !== undefined && value !== '') return value;
        }
    }
    return null;
}

function FinancialsWidgetComponent({ id, symbol, hideHeader, onRemove, onDataChange }: FinancialsWidgetProps) {
    const [activeTab, setActiveTab] = useState<FinancialTab>('income_statement');
    const [period, setPeriod] = useState('FY');
    const { config: unitConfig } = useUnit();

    const tabs = [
        { id: 'income_statement', label: 'Income Statement', icon: ArrowUpRight },
        { id: 'balance_sheet', label: 'Balance Sheet', icon: LayoutGrid },
        { id: 'cash_flow', label: 'Cash Flow Statement', icon: BarChart3 },
        { id: 'ratios', label: 'Ratios', icon: Info },
    ];

    const requestPeriod = period;
    const periodMode = period === 'FY'
        ? 'year'
        : period === 'TTM'
            ? 'ttm'
            : 'quarter';
    const periodLabel = period === 'FY' ? 'Annual' : period === 'TTM' ? 'TTM' : period === 'Q' ? 'Quarterly' : `${period} Quarterly`;

    // Backend `limit` caps at 80. We always request the maximum so the
    // table can render the full multi-year history that the user
    // expects to see when they scroll. Per-quarter selectors filter
    // client-side so the same payload covers Q1..Q4/TTM views.
    const requestLimit = 80;
    const incomeQuery = useIncomeStatement(symbol, { period: requestPeriod, limit: requestLimit, enabled: activeTab === 'income_statement' });
    const balanceQuery = useBalanceSheet(symbol, { period: requestPeriod, limit: requestLimit, enabled: activeTab === 'balance_sheet' });
    const cashFlowQuery = useCashFlow(symbol, { period: requestPeriod, limit: requestLimit, enabled: activeTab === 'cash_flow' });
    const ratiosQuery = useFinancialRatios(symbol, { period: requestPeriod, enabled: activeTab === 'ratios' });

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

        const selectedMetricKeys = activeTab === 'ratios'
            ? RATIO_METRIC_KEYS
            : STATEMENT_METRIC_KEYS[activeTab as 'income_statement' | 'balance_sheet' | 'cash_flow'];

        const normalizedRows = rawData
            .map((row: any) => ({
                ...row,
                __period: normalizeFinancialPeriod(
                    row?.period ?? row?.fiscal_year ?? row?.fiscalYear ?? row?.year ?? row?.yearReport
                ),
            }))
            .filter((row: any) => Boolean(row.__period));

        const sortedData = [...normalizedRows].sort((a: any, b: any) => {
            return periodSortKey(a?.__period) - periodSortKey(b?.__period);
        });
        const quarterOnlyRows = sortedData.filter((row: any) => String(row.__period).startsWith('Q'));
        const comparisonRows = periodMode === 'quarter'
            ? quarterOnlyRows
            : periodMode === 'ttm'
                ? sortedData.filter((row: any) => String(row.__period).toUpperCase().includes('TTM'))
                : sortedData;
        const sortedPeriods = comparisonRows
            .map((row: any) => row.__period)
            .filter((periodValue: string | null | undefined): periodValue is string => Boolean(periodValue));
        const sortedPeriodIndex = new Map(sortedPeriods.map((periodValue, index) => [periodValue, index]));

        let displayRows = normalizedRows;
        if (periodMode === 'quarter') {
            const quarterRows = quarterOnlyRows;

            if (period === 'TTM') {
                const ttmRows: any[] = [];
                for (let i = 3; i < quarterRows.length; i += 1) {
                    const windowRows = quarterRows.slice(i - 3, i + 1);
                    const aggregated: any = { __period: `TTM-${quarterRows[i].__period}` };
                    selectedMetricKeys.forEach((key) => {
                        const values = windowRows
                            .map((row: any) => Number(row[key]))
                            .filter((value: number) => !Number.isNaN(value) && Number.isFinite(value));
                        aggregated[key] = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
                    });
                    ttmRows.push(aggregated);
                }
                displayRows = ttmRows;
            } else if (period === 'Q') {
                displayRows = quarterRows;
            } else {
                displayRows = quarterRows.filter((row: any) =>
                    matchesFinancialQuarterSelection(row.__period, period as 'Q1' | 'Q2' | 'Q3' | 'Q4')
                );
            }
        } else if (periodMode === 'ttm') {
            displayRows = normalizedRows.filter((row: any) => String(row.__period).toUpperCase().includes('TTM'));
        }

        const columns = Array.from(
            new Set(displayRows.map((row: any) => row.__period).filter((p: any): p is string => Boolean(p)))
        ).sort((a: string, b: string) => periodSortKey(a) - periodSortKey(b));

        let metrics: any[] = [];
        if (activeTab === 'ratios') {
            metrics = [
                { key: 'pe', label: 'P/E' },
                { key: 'pb', label: 'P/B' },
                { key: 'eps', label: 'EPS' },
                { key: 'bvps', label: 'BVPS' },
                { key: 'roe', label: 'ROE', isPct: true },
                { key: 'roa', label: 'ROA', isPct: true },
                { key: 'gross_margin', label: 'Gross Margin', isPct: true },
                { key: 'operating_margin', label: 'Operating Margin', isPct: true },
                { key: 'net_margin', label: 'Net Margin', isPct: true },
                { key: 'debt_equity', label: 'D/E' },
                { key: 'current_ratio', label: 'Current Ratio' },
                { key: 'quick_ratio', label: 'Quick Ratio' },
                { key: 'asset_turnover', label: 'Asset Turnover' },
                { key: 'inventory_turnover', label: 'Inventory Turnover' },
                { key: 'dividend_yield', label: 'Dividend Yield', isPct: true },
                { key: 'payout_ratio', label: 'Payout Ratio', isPct: true },
            ];
        } else {
            const keys = STATEMENT_METRIC_KEYS[activeTab as 'income_statement' | 'balance_sheet' | 'cash_flow'];
            const labels = STATEMENT_LABELS[activeTab as 'income_statement' | 'balance_sheet' | 'cash_flow'];

            metrics = keys.map((key, i) => ({ key, label: labels[i] }));
        }

        return {
            periods: columns,
            rows: metrics.map(m => {
                const values: Record<string, any> = {};
                    displayRows.forEach((d: any) => {
                        const periodLabel = d.__period;
                        if (!periodLabel) {
                            return;
                        }
                        const currentVal = activeTab === 'ratios'
                            ? readRatioValue(d, m.key)
                            : convertFinancialValueForUnit(readMetricValue(d, m.key), unitConfig, periodLabel);
                        const periodIndex = sortedPeriodIndex.get(periodLabel) ?? -1;
                        const prevRow = periodIndex > 0 ? (comparisonRows[periodIndex - 1] as any) : null;
                        const prevValRaw = prevRow
                            ? activeTab === 'ratios'
                                ? readRatioValue(prevRow, m.key)
                                : readMetricValue(prevRow, m.key)
                            : null;
                        const prevVal = activeTab === 'ratios'
                            ? prevValRaw
                            : convertFinancialValueForUnit(prevValRaw, unitConfig, comparisonRows[periodIndex - 1]?.__period);

                    let growth = null;
                    if (prevVal && prevVal !== 0 && currentVal !== null) {
                        growth = ((currentVal - prevVal) / Math.abs(prevVal)) * 100;
                    }

                    values[periodLabel] = { val: currentVal, growth };
                });
                return { label: m.label, isPct: m.isPct, metricKey: m.key, values };
            })
        };
    }, [activeQuery?.data, activeTab, periodMode, period, unitConfig]);

    const hasData = Boolean(tableData && tableData.periods.length > 0);
    const isFallback = Boolean(activeQuery?.error && hasData);
    const populatedCells = useMemo(() => {
        if (!tableData) return 0
        return tableData.rows.reduce((acc, row) => {
            const rowCount = tableData.periods.filter((period) => {
                const value = row.values[period]?.val
                return value !== null && value !== undefined && Number.isFinite(Number(value))
            }).length
            return acc + rowCount
        }, 0)
    }, [tableData])
    const isSparseData = hasData && populatedCells > 0 && populatedCells < 8
    const hasRenderableData = hasData && populatedCells > 0

    const sourceLabel =
        activeTab === 'ratios'
            ? 'Ratios dataset'
            : activeTab === 'income_statement'
                ? 'Income statement'
                : activeTab === 'balance_sheet'
                    ? 'Balance sheet'
                    : 'Cash flow statement'

    useEffect(() => {
        const endpointPath =
            activeTab === 'ratios'
                ? `/equity/${symbol}/ratios?period=${period}`
                : activeTab === 'income_statement'
                    ? `/equity/${symbol}/income-statement?period=${period}`
                    : activeTab === 'balance_sheet'
                        ? `/equity/${symbol}/balance-sheet?period=${period}`
                        : `/equity/${symbol}/cash-flow?period=${period}`
        onDataChange?.(
            buildWidgetRuntime({
                empty: !hasData,
                apiGroup: '/equity',
                endpoint: endpointPath,
                sourceLabel,
                lastDataDate: activeQuery?.dataUpdatedAt,
                stale: isFallback,
                extra: hasData ? { tab: activeTab, periods: tableData?.periods.length ?? 0 } : undefined,
            }),
        );
    }, [onDataChange, hasData, isFallback, activeQuery?.dataUpdatedAt, symbol, period, activeTab, sourceLabel, tableData?.periods.length]);

    const tableScale = useMemo(() => {
        if (!tableData || activeTab === 'ratios') return resolveUnitScale([], unitConfig);
        // Exclude per-share rows (EPS/BVPS/DPS) from scale resolution: their tiny
        // VND-per-share magnitudes must not influence the billions/millions scale, and
        // they are formatted independently (see valueFormatter).
        const values = tableData.rows
            .filter((row) => !PER_SHARE_METRIC_KEYS.has(String(row.metricKey || '')))
            .flatMap((row) => tableData.periods.map((period) => row.values[period]?.val));
        return resolveUnitScale(values, unitConfig);
    }, [tableData, activeTab, unitConfig]);

    const unitLegend = useMemo(() => getUnitLegend(tableScale, unitConfig), [tableScale, unitConfig]);
    const denseColumns = useMemo<DenseTableColumn[]>(() => {
        if (!tableData) return []
        return tableData.periods.map((periodLabel, index) => ({
            key: periodLabel,
            label: formatFinancialPeriodLabel(periodLabel, {
                mode: periodMode,
                index,
                total: tableData.periods.length,
            }),
            align: 'right',
        }))
    }, [periodMode, tableData])

    const denseRows = useMemo<DenseTableRow[]>(() => {
        if (!tableData) return []
        return tableData.rows.map((row, index) => ({
            id: `${activeTab}-${index}`,
            label: row.label,
            values: tableData.periods.reduce<Record<string, number | null>>((acc, periodLabel) => {
                acc[periodLabel] = row.values[periodLabel]?.val ?? null
                return acc
            }, {}),
        }))
    }, [activeTab, tableData])

    const denseRowMeta = useMemo(() => {
        if (!tableData) return new Map<string, { isPct?: boolean; isPerShare?: boolean }>()
        return new Map(
            tableData.rows.map((row, index) => [
                `${activeTab}-${index}`,
                { isPct: row.isPct, isPerShare: PER_SHARE_METRIC_KEYS.has(String(row.metricKey || '')) },
            ])
        )
    }, [activeTab, tableData])

    return (
        <WidgetContainer
            title="Financials"
            symbol={symbol}
            onRefresh={() => activeQuery.refetch()}
            onClose={onRemove}
            isLoading={activeQuery.isLoading && !hasData}
            noPadding
            widgetId={id}
            hideHeader={hideHeader}
            exportData={activeQuery.data?.data || []}
            exportFilename={`financials_${symbol}_${activeTab}_${period}`}
        >
            <div className="h-full flex flex-col bg-secondary text-primary font-sans select-none overflow-hidden">
                {/* Controls */}
                <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/70 px-2 py-1 shrink-0">
                    <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as FinancialTab)}
                                    className={cn(
                                         "flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold uppercase tracking-tight rounded-md transition-all whitespace-nowrap",
                                        activeTab === tab.id
                                            ? "bg-blue-600/10 text-blue-400"
                                            : "text-muted-foreground hover:text-primary hover:bg-[var(--bg-tertiary)]"
                                    )}
                                >
                                    <Icon size={12} />
                                    <span className="hidden sm:inline">{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-2 ml-auto">
                        <div className="flex bg-muted/30 rounded p-0.5 gap-0.5">
                            {['FY', 'Q', 'Q1', 'Q2', 'Q3', 'Q4', 'TTM'].map((opt) => (
                                <button
                                    key={opt}
                                    onClick={() => setPeriod(opt)}
                                    className={cn(
                                        "px-1.5 py-0.5 text-[9px] font-black rounded transition-colors",
                                        period === opt ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-primary"
                                    )}
                                >
                                    {opt}
                                </button>
                            ))}
                        </div>
                        <WidgetMeta
                            updatedAt={activeQuery.dataUpdatedAt}
                            isFetching={activeQuery.isFetching && hasData}
                            isCached={isFallback}
                            note={`${periodLabel} · newest on right`}
                            sourceLabel={sourceLabel}
                            align="right"
                            className="ml-2"
                        />
                    </div>
                </div>

                {/* Table Area with Horizontal Scroll */}
                <div className="flex-1 overflow-auto p-0.5 scrollbar-thin scrollbar-thumb-[var(--border-color)]">
                    {activeQuery.isLoading && !hasData ? (
                        <WidgetSkeleton variant="table" lines={6} />
                    ) : activeQuery.error && !hasData ? (
                        <WidgetError error={activeQuery.error as Error} onRetry={() => activeQuery.refetch()} />
                    ) : !hasData ? (
                        <WidgetEmpty
                            message={`No ${tabs.find((tab) => tab.id === activeTab)?.label?.toLowerCase() || 'financial'} data for ${symbol} (${periodLabel}).`}
                            action={{ label: 'Refresh data', onClick: () => activeQuery.refetch() }}
                        />
                    ) : !hasRenderableData ? (
                        <WidgetEmpty
                            message={`${tabs.find((tab) => tab.id === activeTab)?.label || 'Financial'} periods loaded, but tracked metrics are empty for ${symbol} (${periodLabel}).`}
                            action={{ label: 'Refresh data', onClick: () => activeQuery.refetch() }}
                        />
                    ) : (
                        <div className="min-w-max">
                            {isSparseData && (
                                <div className="px-2 pb-1 text-[10px] text-amber-400">
                                    Partial dataset: some provider fields are still missing for this symbol.
                                </div>
                            )}
                            <DenseFinancialTable
                                key={`financials:${symbol}:${activeTab}:${period}:${denseColumns.length}`}
                                columns={denseColumns}
                                rows={denseRows}
                                maxYears={denseColumns.length || 1}
                                showTrend={false}
                                initialScrollPosition="end"
                                storageKey={`financials:${symbol}:${activeTab}:${period}`}
                                footerNote={activeTab !== 'ratios' ? `Note: ${unitLegend} except Per Share Values • Reporting Standard: VAS` : undefined}
                                valueFormatter={(value, row) => {
                                    const meta = denseRowMeta.get(row.id)
                                    const numericValue = typeof value === 'number' ? value : Number(value)
                                    if (meta?.isPct) {
                                        return formatPct(Number.isFinite(numericValue) ? numericValue : null)
                                    }
                                    if (activeTab === 'ratios') {
                                        return formatRatio(Number.isFinite(numericValue) ? numericValue : null)
                                    }
                                    if (meta?.isPerShare) {
                                        // Per-share values (EPS/BVPS/DPS) are absolute VND-per-share;
                                        // format with plain 2-decimal numbers, NOT the billions scale.
                                        return formatNumber(Number.isFinite(numericValue) ? numericValue : null, { decimals: 2 })
                                    }
                                    return formatUnitValuePlain(Number.isFinite(numericValue) ? numericValue : null, tableScale, unitConfig)
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

function formatRatio(value: number | null | undefined): string {
    return formatNumber(value, { decimals: 2 });
}

function formatPct(value: number | null | undefined): string {
    return formatPercent(value, { decimals: 2, input: 'auto', clamp: 'margin' });
}

export const FinancialsWidget = memo(FinancialsWidgetComponent);
export default FinancialsWidget;
