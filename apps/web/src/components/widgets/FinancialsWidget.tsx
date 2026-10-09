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
    canonicalPeriodRows,
    describeUnavailableStatementRows,
    formatFinancialPeriodLabel,
    FUNDAMENTAL_PERIOD_OPTIONS,
    FUNDAMENTAL_PERIOD_SYNC_GROUP,
    isCanonicalQuarterPeriod,
    matchesFinancialQuarterSelection,
    normalizeFinancialPeriod,
    periodSortKey,
} from '@/lib/financialPeriods';
import { usePeriodState } from '@/hooks/usePeriodState';
import {
    EMPTY_VALUE,
    formatNumber,
    formatPercent,
    formatUnitValuePlain,
    getUnitLegend,
    percentChangeDetail,
    resolveUnitScale,
    convertFinancialValueForUnit,
} from '@/lib/units';
import type { ExtendedPeriod } from '@/components/ui/PeriodToggle';

// Ratio columns follow the adjacent statements' fiscal-period window. Ratio-only
// years are excluded; statement-only periods remain with empty ratio cells.
// If the statement reference is unavailable, keep the ratio feed's periods.
function buildStatementAlignedPeriods(
    ratioPeriods: string[],
    statementPeriods: string[]
): string[] {
    if (statementPeriods.length === 0) return ratioPeriods;

    return Array.from(new Set(statementPeriods)).sort((a, b) => periodSortKey(a) - periodSortKey(b));
}

/** Narrow an unvalidated provider cell to a finite number, else null. */
function toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

type FinancialTab = 'balance_sheet' | 'income_statement' | 'cash_flow' | 'ratios';

interface FinancialsWidgetProps {
    id: string;
    symbol: string;
    config?: Record<string, unknown>;
    hideHeader?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: WidgetDataPayload) => void;
}

// Per-share metrics (EPS/BVPS/DPS) are absolute VND-per-share values and must NOT be
// divided by the table-wide billions scale. Without this, e.g. EPS ~2000 VND / 1e9 -> 0.00.
const PER_SHARE_METRIC_KEYS = new Set<string>(['eps', 'bvps', 'dps', 'book_value_per_share']);

// The statement tabs beside this widget in "Financial Period View" render the newest
// TABLE_YEAR_LIMIT periods they hold (see IncomeStatementWidget). The ratio window is
// capped at the same number so the two panels cannot disagree on the span's length.
const TABLE_YEAR_LIMIT = 20;

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


const RATIO_METRIC_ALIASES: Record<string, string[]> = {
    pe: ['pe', 'pe_ratio', 'priceToEarning'],
    pb: ['pb', 'pb_ratio', 'priceToBook'],
    ps: ['ps', 'ps_ratio', 'priceToSales'],
};

// A valuation multiple of zero is never a real observation: it means the provider could
// not compute the ratio because a denominator (price, EPS, book value) was missing. The
// API reports those periods as literal 0.0, so they must be treated as absent here or
// every unsupported year renders as a genuine-looking 0.00.
const ZERO_IS_ABSENT_RATIO_KEYS: Record<string, true> = {
    pe: true,
    pb: true,
    ps: true,
    peg_ratio: true,
    ev_sales: true,
    ev_ebitda: true,
};

function readRatioValue(row: Record<string, any>, key: string): any {
    const aliases = RATIO_METRIC_ALIASES[key] || [key];
    const zeroIsAbsent = ZERO_IS_ABSENT_RATIO_KEYS[key] === true;
    const usable = (value: unknown) => {
        if (value === null || value === undefined || value === '') return false;
        if (!zeroIsAbsent) return true;
        const numeric = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(numeric) ? numeric !== 0 : true;
    };
    const rowLookup = buildMetricLookup(row);
    for (const alias of aliases) {
        const value = rowLookup.get(alias) ?? rowLookup.get(normalizeMetricKey(alias));
        if (usable(value)) return value;
    }
    const rawData = row.raw_data || row.rawData || row.raw;
    const rawLookup = buildMetricLookup(rawData);
    if (rawLookup.size > 0) {
        for (const alias of aliases) {
            const value = rawLookup.get(alias) ?? rawLookup.get(normalizeMetricKey(alias));
            if (usable(value)) return value;
        }
    }
    return null;
}

function FinancialsWidgetComponent({ id, symbol, config, hideHeader, onRemove, onDataChange }: FinancialsWidgetProps) {
    const [activeTab, setActiveTab] = useState<FinancialTab>('income_statement');
    // "Financial Period View" and every widget it advertises share one localStorage
    // key, so this widget follows the banner instead of holding a private 'FY'
    // (issue #101). A widget-level `periodSyncGroup` overrides the shared group; an
    // explicit `null` opts out and keeps the period widget-local.
    const configuredSyncGroup = config?.periodSyncGroup;
    const periodSyncGroup = configuredSyncGroup === null
        ? undefined
        : typeof configuredSyncGroup === 'string' && configuredSyncGroup.trim()
            ? configuredSyncGroup
            : FUNDAMENTAL_PERIOD_SYNC_GROUP;
    const periodOptions: ExtendedPeriod[] = useMemo(
        () => (periodSyncGroup ? [...FUNDAMENTAL_PERIOD_OPTIONS] : ['FY', 'Q', 'Q1', 'Q2', 'Q3', 'Q4', 'TTM']),
        [periodSyncGroup],
    );
    const defaultPeriod: ExtendedPeriod =
        config?.defaultPeriod === 'Q' || config?.defaultPeriod === 'TTM'
            ? config.defaultPeriod
            : 'FY';
    const { period, setPeriod } = usePeriodState({
        widgetId: id || 'unified_financials',
        defaultPeriod,
        validPeriods: periodOptions,
        sharedKey: periodSyncGroup ? `${periodSyncGroup}:${symbol.toUpperCase()}` : undefined,
    });
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

    // The provider caps `limit` at 40 (FinancialsQueryParams.limit le=40). A larger
    // value fails provider validation, the fetch aborts, and the endpoint silently
    // serves stale DB rows — so the newest quarter vanishes. Request the 40 max;
    // per-quarter selectors filter client-side over the same payload.
    const requestLimit = 40;
    const incomeQuery = useIncomeStatement(symbol, { period: requestPeriod, limit: requestLimit, enabled: activeTab === 'income_statement' });
    const balanceQuery = useBalanceSheet(symbol, { period: requestPeriod, limit: requestLimit, enabled: activeTab === 'balance_sheet' });
    // The statement panels beside this widget request 20 fiscal periods. The provider
    // returns a different history for limit=80, so use their exact query for the FY
    // Ratios reference rather than the longer request used by this widget's own tabs.
    const ratiosReferenceQuery = useIncomeStatement(symbol, {
        period: requestPeriod,
        limit: TABLE_YEAR_LIMIT,
        enabled: activeTab === 'ratios' && periodMode === 'year',
    });

    const cashFlowQuery = useCashFlow(symbol, { period: requestPeriod, limit: requestLimit, enabled: activeTab === 'cash_flow' });
    const ratiosQuery = useFinancialRatios(symbol, { period: requestPeriod, enabled: activeTab === 'ratios' && period !== 'TTM' });

    const activeQuery = useMemo(() => {
        switch (activeTab) {
            case 'income_statement': return incomeQuery;
            case 'balance_sheet': return balanceQuery;
            case 'cash_flow': return cashFlowQuery;
            case 'ratios': return ratiosQuery;
        }
    }, [activeTab, incomeQuery, balanceQuery, cashFlowQuery, ratiosQuery]);

    const tableData = useMemo(() => {
        if (!activeQuery?.data || (activeTab === 'ratios' && period === 'TTM')) return null;
        const rawData = activeQuery.data.data || [];


        const periodResolution = canonicalPeriodRows(rawData.map((row) => {
            // Typed API rows are objects; legacy fiscal keys are not declared on their interfaces.
            const record = row as unknown as Record<string, unknown>;
            const rawPeriod = record.period ?? record.fiscal_year ?? record.fiscalYear ?? record.year ?? record.yearReport;
            return { ...record, period: normalizeFinancialPeriod(typeof rawPeriod === 'string' || typeof rawPeriod === 'number' ? String(rawPeriod) : null) };
        }));
        const normalizedRows = periodResolution.rows.map((row) => ({ ...row, __period: row.period }));

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
            displayRows = period === 'Q'
                ? quarterOnlyRows
                : quarterOnlyRows.filter((row: { __period: string | null }) =>
                    matchesFinancialQuarterSelection(row.__period, period as 'Q1' | 'Q2' | 'Q3' | 'Q4')
                );
        } else if (periodMode === 'ttm') {
            displayRows = normalizedRows.filter((row: any) => String(row.__period).toUpperCase().includes('TTM'));
        }

        const allColumns = Array.from(
            new Set(displayRows.map((row: any) => row.__period).filter((p: any): p is string => Boolean(p)))
        ).sort((a: string, b: string) => periodSortKey(a) - periodSortKey(b));

        let metrics: Array<{ key: string; label: string; isPct?: boolean }> = [];
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
        }

        // The ratio feed often reaches back further than it has data: VCI returns periods
        // from 2012 while the first populated ratio is 2020. A leading run of columns with
        // no value at all is noise, and it also pushes the populated columns out of the
        // visible window. Start the table where the data starts.
        const columns = activeTab === 'ratios'
            ? (() => {
                const firstPopulated = allColumns.findIndex((periodLabel: string) => {
                    const entry = displayRows.find((row: Record<string, unknown>) => row.__period === periodLabel);
                    if (!entry) return false;
                    return metrics.some((metric) => readRatioValue(entry, metric.key) !== null);
                });
                const ratioColumns = firstPopulated > 0 ? allColumns.slice(firstPopulated) : allColumns;
                if (periodMode !== 'year') return ratioColumns;

                // The window is the fiscal years the statement tabs display, newest last.
                const statementPeriods = (ratiosReferenceQuery.data?.data || [])
                    // Some provider payloads carry the year under a legacy key, so read the
                    // same fallbacks the statement tabs use. `IncomeStatementData` types
                    // only `period`, so the row crosses into `Record` at this boundary to
                    // reach the provider's legacy keys.
                    .map((row) => {
                        const record = row as unknown as Record<string, unknown>;
                        const rawPeriod =
                            record?.period
                            ?? record?.fiscal_year
                            ?? record?.fiscalYear
                            ?? record?.year
                            ?? record?.yearReport;
                        return normalizeFinancialPeriod(typeof rawPeriod === 'string' ? rawPeriod : null);
                    })
                    .filter((periodValue): periodValue is string => Boolean(periodValue))
                    // Keep the newest periods, matching the statement tabs' window.
                    .sort((a, b) => periodSortKey(b) - periodSortKey(a))
                    .slice(0, TABLE_YEAR_LIMIT);

                return buildStatementAlignedPeriods(ratioColumns, statementPeriods);
            })()
            : allColumns;

        if (activeTab !== 'ratios') {
            const keys = STATEMENT_METRIC_KEYS[activeTab as 'income_statement' | 'balance_sheet' | 'cash_flow'];
            const labels = STATEMENT_LABELS[activeTab as 'income_statement' | 'balance_sheet' | 'cash_flow'];

            metrics = keys.map((key, i) => ({ key, label: labels[i] }));
        }

        return {
            periods: columns,
            periodIssues: periodResolution.issues,
            invalidPeriodCount: periodResolution.invalidPeriodCount,
            rows: metrics.map(m => {
                const values: Record<string, { val: number | null; growth: number | null; negativeBase: boolean; growthLabel: string | null }> = {};
                displayRows.forEach((d: any) => {
                    const periodLabel = d.__period;
                    if (!periodLabel) {
                        return;
                    }
                    const currentVal = toFiniteNumber(
                        activeTab === 'ratios'
                            ? PER_SHARE_METRIC_KEYS.has(m.key) ? convertFinancialValueForUnit(readRatioValue(d, m.key), unitConfig, periodLabel) : readRatioValue(d, m.key)
                            : convertFinancialValueForUnit(readMetricValue(d, m.key), unitConfig, periodLabel)
                    );
                    const periodIndex = sortedPeriodIndex.get(periodLabel) ?? -1;
                    const prevRow: Record<string, unknown> | null = periodIndex > 0 ? comparisonRows[periodIndex - 1] : null;
                    const prevVal = toFiniteNumber(
                        activeTab === 'ratios'
                            ? prevRow ? PER_SHARE_METRIC_KEYS.has(m.key) ? convertFinancialValueForUnit(readRatioValue(prevRow, m.key), unitConfig, prevRow.__period as string | null) : readRatioValue(prevRow, m.key) : null
                            : convertFinancialValueForUnit(
                                prevRow ? readMetricValue(prevRow, m.key) : null,
                                unitConfig,
                                comparisonRows[periodIndex - 1]?.__period,
                            )
                    );
                    // One convention for the statement tables, the Growth Bridge and
                    // the API's `_growth_rate`: divide by the ABSOLUTE prior value
                    // (issue #104). A negative endpoint still makes the sign
                    // unreadable as ordinary growth, so the pair is classified
                    // (loss to profit / narrowed / widened) instead of calling every
                    // negative pair a turnaround.
                    const growthDetail = percentChangeDetail(currentVal, prevVal);

                    values[periodLabel] = {
                        val: currentVal,
                        growth: growthDetail.change,
                        negativeBase: growthDetail.hasNegativeBase,
                        growthLabel: growthDetail.label,
                    };
                });
                return { label: m.label, isPct: m.isPct, metricKey: m.key, values };
            }),
            // A row the API returned without certification has every metric null plus
            // `unavailable_reason`, so the table would otherwise render an all-empty
            // column and hide why (issue #103).
            unavailableNote: describeUnavailableStatementRows(displayRows),
        };
    }, [activeQuery?.data, ratiosReferenceQuery.data?.data, activeTab, periodMode, period, unitConfig]);

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
                lastDataDate: null,
                fetchedAt: activeQuery?.dataUpdatedAt,
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
        return tableData.periods.map((periodLabel) => ({
            key: periodLabel,
            label: formatFinancialPeriodLabel(periodLabel, { mode: periodMode }),
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
    // Disclose the negative-base comparisons actually present, using the same
    // classification as the statement tables (issue #104).
    const negativeBaseLabels = useMemo(() => {
        if (!tableData) return[] as string[]
        const labels = new Set<string>()
        for (const row of tableData.rows) {
            for (const periodLabel of tableData.periods) {
                const label = row.values[periodLabel]?.growthLabel
                if (label) labels.add(label)
            }
        }
        return Array.from(labels).sort()
    }, [tableData])

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
                            {periodOptions.map((opt) => (
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
                            updatedAt={null}
                            fetchedAt={activeQuery.dataUpdatedAt}
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
                    {tableData && (tableData.periodIssues.length > 0 || tableData.invalidPeriodCount > 0) && (
                        <div className="px-2 py-1 text-[10px] text-amber-300">
                            Fiscal period resolution: {tableData.periodIssues.filter((issue) => issue.reason === 'ambiguous-basis').length} conflicting periods excluded; {tableData.periodIssues.filter((issue) => issue.reason === 'duplicate-identical').length} identical repeats collapsed; {tableData.invalidPeriodCount} undated rows excluded.
                        </div>
                    )}
                    {tableData?.unavailableNote && (
                        // Rendered next to the table, not only in the empty state: an uncertified
                        // period must disclose its reason even when other periods are populated,
                        // or the table silently shows fewer periods than the API returned (#103).
                        <div className="px-2 py-1 text-[10px] text-amber-300">
                            {tableData.unavailableNote}
                        </div>
                    )}
                    {activeTab === 'ratios' && period === 'TTM' ? (
                        <WidgetEmpty
                            message="TTM ratios are not supported"
                            detail="The provider does not supply ratios recomputed from a verified twelve-month window. Latest-period ratios and EPS/DPS sums are not shown as TTM. Select FY or Q."
                        />
                    ) : activeQuery.isLoading && !hasData ? (
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
                            // The API's own reason is shown in the note above the table, so it is
                            // not repeated here (issue #103).
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
                                footerNote={activeTab !== 'ratios'
                                    ? `Note: ${unitLegend}; per-share values (EPS/BVPS/DPS) are ${unitConfig.display === 'USD' ? 'USD' : 'VND'} per share • Reporting Standard: VAS${negativeBaseLabels.length > 0 ? ` • Growth divides by the absolute prior-period value; negative-base comparisons are labelled (${negativeBaseLabels.join(', ')}), not ordinary growth` : ''}`
                                    : `Note: Ratio history by ${period}. EPS/BVPS/DPS are ${unitConfig.display === 'USD' ? 'USD' : 'VND'} per share; dimensionless ratios are not currency-converted. First available period is the base period; missing ratios render as ${EMPTY_VALUE}.`}
                                valueFormatter={(value, row) => {
                                    const meta = denseRowMeta.get(row.id)
                                    // `null` must stay null. Number(null) is 0, and 0 is finite, so
                                    // coercing first turned every absent ratio into a real 0.00.
                                    const numericValue = value === null || value === undefined || value === ''
                                        ? null
                                        : typeof value === 'number' ? value : Number(value)
                                    if (meta?.isPct) {
                                        return formatPct(Number.isFinite(numericValue) ? numericValue : null)
                                    }
                                    if (activeTab === 'ratios') {
                                        return formatRatio(Number.isFinite(numericValue) ? numericValue : null)
                                    }
                                    if (meta?.isPerShare) {
                                        // Per-share values use display currency without the table's billions scale.
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
