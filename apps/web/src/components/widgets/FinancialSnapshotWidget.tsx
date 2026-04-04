'use client';

import { memo, useMemo } from 'react';

import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { DenseFinancialTable, type DenseTableColumn, type DenseTableRow } from '@/components/ui/DenseFinancialTable';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { useUnit } from '@/contexts/UnitContext';
import { usePeriodState } from '@/hooks/usePeriodState';
import { useBalanceSheet, useCashFlow, useFinancialRatios, useIncomeStatement, useProfile } from '@/lib/queries';
import { formatFinancialPeriodLabel, periodSortKey, type FinancialPeriodMode } from '@/lib/financialPeriods';
import { formatNumber, formatPercent, formatUnitValuePlain, getUnitLegend, resolveUnitScale } from '@/lib/units';
import type { BalanceSheetData, CashFlowData, FinancialRatioData, IncomeStatementData } from '@/types/equity';

interface FinancialSnapshotWidgetProps {
    id: string;
    symbol: string;
    config?: Record<string, unknown>;
    hideHeader?: boolean;
    onRemove?: () => void;
}

type SnapshotPeriod = 'FY' | 'Q' | 'TTM';
type SnapshotValueKind = 'statement' | 'percent' | 'ratio' | 'per_share' | 'shares_mn';

interface SnapshotRowDefinition {
    id: string;
    label: string;
    kind: SnapshotValueKind;
    getValue: (periodKey: string, context: SnapshotContext) => number | null;
}

interface SnapshotSectionDefinition {
    id: string;
    title: string;
    rows: SnapshotRowDefinition[];
}

interface SnapshotContext {
    periodMode: FinancialPeriodMode;
    periods: string[];
    incomeByPeriod: Map<string, IncomeStatementData>;
    balanceByPeriod: Map<string, BalanceSheetData>;
    cashByPeriod: Map<string, CashFlowData>;
    ratiosByPeriod: Map<string, FinancialRatioData>;
    profileSharesOutstanding: number | null;
}

const SNAPSHOT_PERIOD_OPTIONS: SnapshotPeriod[] = ['FY', 'Q', 'TTM'];
const ANNUAL_PERIOD_LIMIT = 12;
const QUARTER_PERIOD_LIMIT = 16;

const RAW_BALANCE_ALIASES: Record<string, string[]> = {
    short_term_investment: ['short_term_investment', 'st_investment', 'short_term_investments'],
    other_current_assets: ['other_current_assets', 'other_current_asset'],
    fixed_assets_gross: ['fixed_assets_gross', 'gross_fixed_assets', 'property_plant_equipment_gross'],
    depreciation: ['depreciation', 'accumulated_depreciation'],
    long_term_investments: ['long_term_investments', 'lt_investments', 'long_term_investment'],
    other_long_term_assets: ['other_long_term_assets', 'lt_assets_other', 'other_lt_assets'],
    other_current_liabilities: ['other_current_liabilities', 'other_st_liabilities', 'other_short_term_liabilities'],
    other_long_term_liabilities: ['other_long_term_liabilities', 'other_lt_liabilities'],
    preferred_equity: ['preferred_equity', 'preferred_stock'],
    paid_in_capital: ['paid_in_capital', 'capital_stock', 'share_capital'],
    share_premium: ['share_premium', 'capital_surplus'],
    other_equity: ['other_equity'],
    minority_interest: ['minority_interest', 'non_controlling_interest'],
    shares_outstanding: ['shares_outstanding', 'year_end_shares_outstanding', 'shares_out'],
};

const RAW_INCOME_ALIASES: Record<string, string[]> = {
    sales_marketing_expense: ['sales_marketing_expense', 'sales_and_marketing_expense', 'selling_expense'],
    general_admin_expense: ['general_admin_expense', 'general_and_admin_expense', 'administrative_expense', 'selling_general_admin'],
    financial_income: ['financial_income', 'finance_income'],
    financial_expenses: ['financial_expenses', 'finance_expense'],
    associates: ['associates', 'share_of_profit_from_associates'],
    npat_before_mi: ['npat_before_mi', 'net_profit_after_tax_before_minority_interest'],
    minority_interest: ['minority_interest', 'non_controlling_interest'],
    npat_less_mi_adjusted: ['npat_less_mi_adjusted', 'adjusted_net_income'],
};

const RAW_CASHFLOW_ALIASES: Record<string, string[]> = {
    depreciation_amortization: ['depreciation_amortization', 'depreciation', 'depreciation_and_amortization'],
    change_in_working_capital: ['change_in_working_capital', 'delta_working_capital'],
    other_adjustments: ['other_adjustments'],
    capital_expenditures_net: ['capital_expenditures_net', 'capex_net', 'capital_expenditure', 'capex'],
    investments_net: ['investments_net', 'investment_activity_net'],
    other_financing_cash_flow: ['other_financing_cash_flow', 'other_financing_cf'],
};

function normalizeLookupKey(value: string): string {
    return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        const parsed = Number(value.replace(/,/g, '').trim());
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readObjectNumber(source: Record<string, unknown> | null | undefined, keys: string[]): number | null {
    if (!source) return null;

    for (const key of keys) {
        const direct = toFiniteNumber(source[key]);
        if (direct !== null) return direct;
    }

    const normalizedEntries = Object.entries(source).map(([key, value]) => [normalizeLookupKey(key), value] as const);
    for (const key of keys) {
        const normalizedKey = normalizeLookupKey(key);
        const match = normalizedEntries.find(([candidate]) => candidate === normalizedKey);
        if (!match) continue;
        const parsed = toFiniteNumber(match[1]);
        if (parsed !== null) return parsed;
    }

    return null;
}

function readEntryNumber(entry: Record<string, unknown> | null | undefined, directKeys: string[], rawKeys: string[] = []): number | null {
    if (!entry) return null;

    const direct = readObjectNumber(entry, directKeys);
    if (direct !== null) return direct;

    const rawData = entry.raw_data;
    if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
        return null;
    }

    return readObjectNumber(rawData as Record<string, unknown>, rawKeys);
}

function parseYearAndQuarter(periodKey: string): { year: number | null; quarter: number | null; isYtd: boolean } {
    const upper = periodKey.toUpperCase();
    const yearMatch = upper.match(/(20\d{2})/);
    const quarterMatch = upper.match(/Q([1-4])/);
    return {
        year: yearMatch ? Number(yearMatch[1]) : null,
        quarter: quarterMatch ? Number(quarterMatch[1]) : null,
        isYtd: upper.includes('YTD'),
    };
}

function normalizeStatementPeriod(period: string | undefined, mode: FinancialPeriodMode): string | null {
    const label = String(period || '').trim();
    if (!label) return null;
    const upper = label.toUpperCase();
    const yearMatch = upper.match(/(20\d{2})/);
    const quarterMatch = upper.match(/Q([1-4])/);

    if (mode === 'ttm') {
        if (upper.includes('TTM')) {
            return yearMatch ? `${yearMatch[1]}-TTM` : 'TTM';
        }
        return yearMatch ? `${yearMatch[1]}-TTM` : 'TTM';
    }

    if (mode === 'year') {
        if (upper.includes('YTD') && yearMatch) {
            return `${yearMatch[1]} YTD`;
        }
        return yearMatch ? yearMatch[1] : label;
    }

    if (yearMatch && quarterMatch) {
        return `${yearMatch[1]}-Q${quarterMatch[1]}`;
    }

    const altQuarter = upper.match(/^Q([1-4])[-/](20\d{2})$/);
    if (altQuarter) {
        return `${altQuarter[2]}-Q${altQuarter[1]}`;
    }

    return quarterMatch ? `Q${quarterMatch[1]}` : label;
}

function formatSnapshotPeriodLabel(periodKey: string, mode: FinancialPeriodMode): string {
    if (periodKey.endsWith(' YTD')) {
        return periodKey.replace(' YTD', ' (YTD)');
    }
    if (periodKey.includes('-TTM')) {
        return `TTM ${periodKey.slice(0, 4)}`;
    }
    if (periodKey === 'TTM') return 'TTM';
    return formatFinancialPeriodLabel(periodKey, { mode: mode === 'quarter' ? 'quarter' : 'year' });
}

function buildPeriodMap<T extends { period?: string }>(rows: T[], mode: FinancialPeriodMode): Map<string, T> {
    const map = new Map<string, T>();
    rows.forEach((row) => {
        const normalized = normalizeStatementPeriod(row.period, mode);
        if (normalized) {
            map.set(normalized, row);
        }
    });
    return map;
}

function getPreviousPeriodKey(periodKey: string, context: SnapshotContext): string | null {
    const asc = [...context.periods].sort((left, right) => periodSortKey(left) - periodSortKey(right));
    const index = asc.indexOf(periodKey);
    if (index <= 0) return null;
    return asc[index - 1] || null;
}

function getComparablePeriodKey(periodKey: string, context: SnapshotContext): string | null {
    const parsed = parseYearAndQuarter(periodKey);
    if (context.periodMode === 'year') {
        return parsed.year ? String(parsed.year - 1) : getPreviousPeriodKey(periodKey, context);
    }
    if (context.periodMode === 'quarter' && parsed.year && parsed.quarter) {
        const target = `${parsed.year - 1}-Q${parsed.quarter}`;
        return context.periods.includes(target) ? target : getPreviousPeriodKey(periodKey, context);
    }
    return getPreviousPeriodKey(periodKey, context);
}

function valueFromIncome(context: SnapshotContext, periodKey: string, directKeys: string[], rawKeys: string[] = []): number | null {
    return readEntryNumber(context.incomeByPeriod.get(periodKey) as Record<string, unknown> | undefined, directKeys, rawKeys);
}

function valueFromBalance(context: SnapshotContext, periodKey: string, directKeys: string[], rawKeys: string[] = []): number | null {
    return readEntryNumber(context.balanceByPeriod.get(periodKey) as Record<string, unknown> | undefined, directKeys, rawKeys);
}

function valueFromCash(context: SnapshotContext, periodKey: string, directKeys: string[], rawKeys: string[] = []): number | null {
    return readEntryNumber(context.cashByPeriod.get(periodKey) as Record<string, unknown> | undefined, directKeys, rawKeys);
}

function valueFromRatios(context: SnapshotContext, periodKey: string, directKeys: string[]): number | null {
    return readEntryNumber(context.ratiosByPeriod.get(periodKey) as Record<string, unknown> | undefined, directKeys);
}

function safeDivide(numerator: number | null, denominator: number | null, multiplier = 1): number | null {
    if (numerator === null || denominator === null || denominator === 0) return null;
    return (numerator / denominator) * multiplier;
}

function yearOverYearGrowth(current: number | null, previous: number | null): number | null {
    if (current === null || previous === null || previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
}

function deriveDebt(context: SnapshotContext, periodKey: string): number | null {
    const shortDebt = valueFromBalance(context, periodKey, ['short_term_debt']);
    const longDebt = valueFromBalance(context, periodKey, ['long_term_debt']);
    if (shortDebt === null && longDebt === null) return null;
    return (shortDebt || 0) + (longDebt || 0);
}

function deriveWorkingCapitalDelta(context: SnapshotContext, periodKey: string): number | null {
    const currentKey = periodKey;
    const previousKey = getPreviousPeriodKey(periodKey, context);
    if (!previousKey) return valueFromCash(context, periodKey, [], RAW_CASHFLOW_ALIASES.change_in_working_capital);

    const currentAssets = valueFromBalance(context, currentKey, ['accounts_receivable', 'inventory'], ['other_current_assets']);
    const previousAssets = valueFromBalance(context, previousKey, ['accounts_receivable', 'inventory'], ['other_current_assets']);
    const currentPayables = valueFromBalance(context, currentKey, ['accounts_payable'], ['other_current_liabilities']);
    const previousPayables = valueFromBalance(context, previousKey, ['accounts_payable'], ['other_current_liabilities']);

    if (currentAssets === null || previousAssets === null || currentPayables === null || previousPayables === null) {
        return valueFromCash(context, periodKey, [], RAW_CASHFLOW_ALIASES.change_in_working_capital);
    }

    return -((currentAssets - previousAssets) - (currentPayables - previousPayables));
}

const PL_SECTION: SnapshotSectionDefinition = {
    id: 'pl',
    title: 'Profit & Loss',
    rows: [
        { id: 'revenue', label: 'Revenue', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, ['revenue']) },
        { id: 'cogs', label: 'COGS', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, ['cost_of_revenue']) },
        { id: 'gross_profit', label: 'Gross Profit', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, ['gross_profit']) },
        { id: 'sales_marketing_expense', label: 'Sales & Marketing exp.', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, [], RAW_INCOME_ALIASES.sales_marketing_expense) },
        { id: 'general_admin_expense', label: 'General & Admin exp.', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, ['selling_general_admin'], RAW_INCOME_ALIASES.general_admin_expense) },
        { id: 'operating_profit', label: 'Operating Profit', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, ['operating_income']) },
        { id: 'financial_income', label: 'Financial Income', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, [], RAW_INCOME_ALIASES.financial_income) },
        { id: 'financial_expenses', label: 'Financial Expenses', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, [], RAW_INCOME_ALIASES.financial_expenses) },
        { id: 'interest_expense', label: 'Interest Expense', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, ['interest_expense']) },
        { id: 'associates', label: 'Associates', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, [], RAW_INCOME_ALIASES.associates) },
        { id: 'other_income', label: 'Net Other Income/(Loss)', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, ['other_income']) },
        { id: 'profit_before_tax', label: 'Profit Before Tax (PBT)', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, ['pre_tax_profit', 'profit_before_tax']) },
        { id: 'tax_expense', label: 'Income Tax', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, ['tax_expense']) },
        { id: 'npat_before_mi', label: 'NPAT Before MI', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, [], RAW_INCOME_ALIASES.npat_before_mi) },
        { id: 'minority_interest', label: 'Minority Interest', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, [], RAW_INCOME_ALIASES.minority_interest) },
        { id: 'npat_reported', label: 'NPAT Less MI, Reported', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, ['net_income']) },
        { id: 'npat_adjusted', label: 'NPAT Less MI, Adjusted', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, [], RAW_INCOME_ALIASES.npat_less_mi_adjusted) },
        { id: 'ebitda', label: 'EBITDA', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, ['ebitda']) },
        { id: 'eps_reported', label: 'EPS Reported', kind: 'per_share', getValue: (periodKey, context) => valueFromIncome(context, periodKey, ['eps']) },
        { id: 'dps_reported', label: 'DPS Reported', kind: 'per_share', getValue: (periodKey, context) => valueFromRatios(context, periodKey, ['dps']) },
        { id: 'payout_ratio', label: 'DPS/EPS (%)', kind: 'percent', getValue: (periodKey, context) => valueFromRatios(context, periodKey, ['payout_ratio']) },
    ],
};

const BS_SECTION: SnapshotSectionDefinition = {
    id: 'bs',
    title: 'Balance Sheet',
    rows: [
        { id: 'cash_and_equivalents', label: 'Cash & Equivalents', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, ['cash', 'cash_and_equivalents']) },
        { id: 'short_term_investment', label: 'ST Investment', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, [], RAW_BALANCE_ALIASES.short_term_investment) },
        { id: 'accounts_receivable', label: 'Accounts Receivable', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, ['accounts_receivable', 'receivables']) },
        { id: 'inventories', label: 'Inventories', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, ['inventory']) },
        { id: 'other_current_assets', label: 'Other Current assets', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, [], RAW_BALANCE_ALIASES.other_current_assets) },
        { id: 'total_current_assets', label: 'Total Current Assets', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, ['current_assets']) },
        { id: 'fixed_assets_gross', label: 'Fixed Assets, Gross', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, [], RAW_BALANCE_ALIASES.fixed_assets_gross) },
        { id: 'depreciation', label: '- Depreciation', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, [], RAW_BALANCE_ALIASES.depreciation) },
        { id: 'fixed_assets_net', label: 'Fixed Assets, Net', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, ['fixed_assets']) },
        { id: 'long_term_investments', label: 'LT investments', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, [], RAW_BALANCE_ALIASES.long_term_investments) },
        { id: 'other_long_term_assets', label: 'LT assets, other', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, [], RAW_BALANCE_ALIASES.other_long_term_assets) },
        {
            id: 'total_long_term_assets',
            label: 'Total LT Assets',
            kind: 'statement',
            getValue: (periodKey, context) => {
                const totalAssets = valueFromBalance(context, periodKey, ['total_assets']);
                const currentAssets = valueFromBalance(context, periodKey, ['current_assets']);
                if (totalAssets !== null && currentAssets !== null) return totalAssets - currentAssets;
                return null;
            },
        },
        { id: 'total_assets', label: 'Total Assets', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, ['total_assets']) },
        { id: 'accounts_payable', label: 'Accounts Payable', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, ['accounts_payable']) },
        { id: 'short_term_debt', label: 'ST Debt', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, ['short_term_debt']) },
        { id: 'other_current_liabilities', label: 'Other ST Liabilities', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, [], RAW_BALANCE_ALIASES.other_current_liabilities) },
        { id: 'total_current_liabilities', label: 'Total Current Liabilities', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, ['current_liabilities']) },
        { id: 'long_term_debt', label: 'LT Debt', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, ['long_term_debt']) },
        { id: 'other_long_term_liabilities', label: 'Other LT liabilities', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, [], RAW_BALANCE_ALIASES.other_long_term_liabilities) },
        { id: 'total_liabilities', label: 'Total Liabilities', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, ['total_liabilities']) },
        { id: 'preferred_equity', label: 'Preferred Equity', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, [], RAW_BALANCE_ALIASES.preferred_equity) },
        { id: 'paid_in_capital', label: 'Paid in capital', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, [], RAW_BALANCE_ALIASES.paid_in_capital) },
        { id: 'share_premium', label: 'Share premium', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, [], RAW_BALANCE_ALIASES.share_premium) },
        { id: 'retained_earnings', label: 'Retained earnings', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, ['retained_earnings']) },
        { id: 'other_equity', label: 'Other equity', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, [], RAW_BALANCE_ALIASES.other_equity) },
        { id: 'minority_interest_bs', label: 'Minority interest', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, [], RAW_BALANCE_ALIASES.minority_interest) },
        { id: 'total_equity', label: 'Total equity', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, ['total_equity', 'equity']) },
        {
            id: 'liabilities_equity',
            label: 'Liabilities & equity',
            kind: 'statement',
            getValue: (periodKey, context) => {
                const liabilities = valueFromBalance(context, periodKey, ['total_liabilities']);
                const equity = valueFromBalance(context, periodKey, ['total_equity', 'equity']);
                if (liabilities !== null && equity !== null) return liabilities + equity;
                return null;
            },
        },
        {
            id: 'shares_outstanding',
            label: 'Y/E shares out, mn',
            kind: 'shares_mn',
            getValue: (periodKey, context) => {
                const direct = valueFromBalance(context, periodKey, [], RAW_BALANCE_ALIASES.shares_outstanding);
                if (direct !== null) return direct >= 1_000_000 ? direct / 1_000_000 : direct;
                return context.profileSharesOutstanding !== null ? context.profileSharesOutstanding / 1_000_000 : null;
            },
        },
    ],
};

const CF_SECTION: SnapshotSectionDefinition = {
    id: 'cf',
    title: 'Cash Flow',
    rows: [
        {
            id: 'beginning_cash_balance',
            label: 'Beginning Cash Balance',
            kind: 'statement',
            getValue: (periodKey, context) => {
                const previousKey = getPreviousPeriodKey(periodKey, context);
                return previousKey ? valueFromBalance(context, previousKey, ['cash', 'cash_and_equivalents']) : null;
            },
        },
        { id: 'net_income_cf', label: 'Net Income', kind: 'statement', getValue: (periodKey, context) => valueFromIncome(context, periodKey, ['net_income']) },
        { id: 'depreciation_amortization', label: 'Dep. & Amortization', kind: 'statement', getValue: (periodKey, context) => valueFromCash(context, periodKey, ['depreciation'], RAW_CASHFLOW_ALIASES.depreciation_amortization) },
        { id: 'change_in_working_capital', label: 'Delta in Working Capital', kind: 'statement', getValue: (periodKey, context) => deriveWorkingCapitalDelta(context, periodKey) },
        { id: 'other_adjustments', label: 'Other Adjustments', kind: 'statement', getValue: (periodKey, context) => valueFromCash(context, periodKey, [], RAW_CASHFLOW_ALIASES.other_adjustments) },
        { id: 'cash_from_operations', label: 'Cash from Operations', kind: 'statement', getValue: (periodKey, context) => valueFromCash(context, periodKey, ['operating_cash_flow']) },
        { id: 'capital_expenditures_net', label: 'Capital Expenditures, Net', kind: 'statement', getValue: (periodKey, context) => valueFromCash(context, periodKey, ['capex', 'capital_expenditure'], RAW_CASHFLOW_ALIASES.capital_expenditures_net) },
        { id: 'investments_net', label: 'Investments, Net', kind: 'statement', getValue: (periodKey, context) => valueFromCash(context, periodKey, [], RAW_CASHFLOW_ALIASES.investments_net) },
        { id: 'cash_from_investments', label: 'Cash from Investments', kind: 'statement', getValue: (periodKey, context) => valueFromCash(context, periodKey, ['investing_cash_flow']) },
        { id: 'dividends_paid', label: 'Dividends Paid', kind: 'statement', getValue: (periodKey, context) => valueFromCash(context, periodKey, ['dividends_paid']) },
        {
            id: 'delta_share_capital',
            label: 'Delta in Share Capital',
            kind: 'statement',
            getValue: (periodKey, context) => {
                const previousKey = getPreviousPeriodKey(periodKey, context);
                const current = valueFromBalance(context, periodKey, [], RAW_BALANCE_ALIASES.paid_in_capital);
                const previous = previousKey ? valueFromBalance(context, previousKey, [], RAW_BALANCE_ALIASES.paid_in_capital) : null;
                return current !== null && previous !== null ? current - previous : null;
            },
        },
        {
            id: 'delta_short_term_debt',
            label: 'Delta in ST Debt',
            kind: 'statement',
            getValue: (periodKey, context) => {
                const previousKey = getPreviousPeriodKey(periodKey, context);
                const current = valueFromBalance(context, periodKey, ['short_term_debt']);
                const previous = previousKey ? valueFromBalance(context, previousKey, ['short_term_debt']) : null;
                return current !== null && previous !== null ? current - previous : null;
            },
        },
        {
            id: 'delta_long_term_debt',
            label: 'Delta in LT Debt',
            kind: 'statement',
            getValue: (periodKey, context) => {
                const previousKey = getPreviousPeriodKey(periodKey, context);
                const current = valueFromBalance(context, periodKey, ['long_term_debt']);
                const previous = previousKey ? valueFromBalance(context, previousKey, ['long_term_debt']) : null;
                return current !== null && previous !== null ? current - previous : null;
            },
        },
        { id: 'other_financing_cash_flow', label: 'Other financing C/F', kind: 'statement', getValue: (periodKey, context) => valueFromCash(context, periodKey, [], RAW_CASHFLOW_ALIASES.other_financing_cash_flow) },
        { id: 'cash_from_financing', label: 'Cash from Financing', kind: 'statement', getValue: (periodKey, context) => valueFromCash(context, periodKey, ['financing_cash_flow']) },
        { id: 'net_change_in_cash', label: 'Net Change in Cash', kind: 'statement', getValue: (periodKey, context) => valueFromCash(context, periodKey, ['net_change_in_cash', 'net_cash_flow']) },
        { id: 'ending_cash_balance', label: 'Ending Cash Balance', kind: 'statement', getValue: (periodKey, context) => valueFromBalance(context, periodKey, ['cash', 'cash_and_equivalents']) },
    ],
};

const RATIOS_SECTION: SnapshotSectionDefinition = {
    id: 'ratios',
    title: 'Ratios',
    rows: [
        {
            id: 'revenue_growth_yoy',
            label: 'Revenue Growth YoY',
            kind: 'percent',
            getValue: (periodKey, context) => valueFromRatios(context, periodKey, ['revenue_growth']) ?? yearOverYearGrowth(
                valueFromIncome(context, periodKey, ['revenue']),
                (() => {
                    const comparableKey = getComparablePeriodKey(periodKey, context);
                    return comparableKey ? valueFromIncome(context, comparableKey, ['revenue']) : null;
                })()
            ),
        },
        {
            id: 'operating_growth_yoy',
            label: 'Op. Profit (EBIT) YoY',
            kind: 'percent',
            getValue: (periodKey, context) => {
                const comparableKey = getComparablePeriodKey(periodKey, context);
                return yearOverYearGrowth(
                    valueFromIncome(context, periodKey, ['operating_income']),
                    comparableKey ? valueFromIncome(context, comparableKey, ['operating_income']) : null
                );
            },
        },
        {
            id: 'pbt_growth_yoy',
            label: 'PBT YoY',
            kind: 'percent',
            getValue: (periodKey, context) => {
                const comparableKey = getComparablePeriodKey(periodKey, context);
                return yearOverYearGrowth(
                    valueFromIncome(context, periodKey, ['pre_tax_profit', 'profit_before_tax']),
                    comparableKey ? valueFromIncome(context, comparableKey, ['pre_tax_profit', 'profit_before_tax']) : null
                );
            },
        },
        {
            id: 'eps_growth_yoy',
            label: 'Reported EPS YoY',
            kind: 'percent',
            getValue: (periodKey, context) => valueFromRatios(context, periodKey, ['earnings_growth']) ?? yearOverYearGrowth(
                valueFromIncome(context, periodKey, ['eps']),
                (() => {
                    const comparableKey = getComparablePeriodKey(periodKey, context);
                    return comparableKey ? valueFromIncome(context, comparableKey, ['eps']) : null;
                })()
            ),
        },
        { id: 'gross_margin', label: 'Gross Profit Margin', kind: 'percent', getValue: (periodKey, context) => valueFromRatios(context, periodKey, ['gross_margin']) },
        { id: 'operating_margin', label: 'Op. Profit (EBIT) Margin', kind: 'percent', getValue: (periodKey, context) => valueFromRatios(context, periodKey, ['operating_margin']) },
        {
            id: 'ebitda_margin',
            label: 'EBITDA Margin',
            kind: 'percent',
            getValue: (periodKey, context) => safeDivide(
                valueFromIncome(context, periodKey, ['ebitda']),
                valueFromIncome(context, periodKey, ['revenue']),
                100
            ),
        },
        { id: 'net_margin', label: 'NPAT-MI Margin', kind: 'percent', getValue: (periodKey, context) => valueFromRatios(context, periodKey, ['net_margin']) },
        { id: 'roe', label: 'ROE', kind: 'percent', getValue: (periodKey, context) => valueFromRatios(context, periodKey, ['roe']) },
        { id: 'roa', label: 'ROA', kind: 'percent', getValue: (periodKey, context) => valueFromRatios(context, periodKey, ['roa']) },
        {
            id: 'days_inventory_on_hand',
            label: 'Days Inventory On Hand',
            kind: 'ratio',
            getValue: (periodKey, context) => {
                const directTurnover = valueFromRatios(context, periodKey, ['inventory_turnover']);
                if (directTurnover !== null && directTurnover !== 0) {
                    return 365 / directTurnover;
                }
                return null;
            },
        },
        {
            id: 'days_receivable',
            label: 'Days Accts, Receivable',
            kind: 'ratio',
            getValue: (periodKey, context) => {
                const directTurnover = valueFromRatios(context, periodKey, ['receivables_turnover']);
                if (directTurnover !== null && directTurnover !== 0) {
                    return 365 / directTurnover;
                }
                return null;
            },
        },
        {
            id: 'days_payable',
            label: 'Days Accts, Payable',
            kind: 'ratio',
            getValue: (periodKey, context) => {
                const payables = valueFromBalance(context, periodKey, ['accounts_payable']);
                const cogs = valueFromIncome(context, periodKey, ['cost_of_revenue']);
                return safeDivide(payables, cogs, 365);
            },
        },
        {
            id: 'cash_conversion_days',
            label: 'Cash Conversion Days',
            kind: 'ratio',
            getValue: (periodKey, context) => {
                const dio = RATIOS_SECTION.rows.find((row) => row.id === 'days_inventory_on_hand')?.getValue(periodKey, context) ?? null;
                const dso = RATIOS_SECTION.rows.find((row) => row.id === 'days_receivable')?.getValue(periodKey, context) ?? null;
                const dpo = RATIOS_SECTION.rows.find((row) => row.id === 'days_payable')?.getValue(periodKey, context) ?? null;
                if (dio === null || dso === null || dpo === null) return null;
                return dio + dso - dpo;
            },
        },
        { id: 'current_ratio', label: 'Current Ratio', kind: 'ratio', getValue: (periodKey, context) => valueFromRatios(context, periodKey, ['current_ratio']) },
        { id: 'quick_ratio', label: 'Quick Ratio', kind: 'ratio', getValue: (periodKey, context) => valueFromRatios(context, periodKey, ['quick_ratio']) },
        { id: 'cash_ratio', label: 'Cash Ratio', kind: 'ratio', getValue: (periodKey, context) => valueFromRatios(context, periodKey, ['cash_ratio']) },
        {
            id: 'debt_assets_pct',
            label: 'Debt / Assets %',
            kind: 'percent',
            getValue: (periodKey, context) => safeDivide(deriveDebt(context, periodKey), valueFromBalance(context, periodKey, ['total_assets']), 100),
        },
        {
            id: 'debt_capital_pct',
            label: 'Debt / Capital %',
            kind: 'percent',
            getValue: (periodKey, context) => {
                const debt = deriveDebt(context, periodKey);
                const equity = valueFromBalance(context, periodKey, ['total_equity', 'equity']);
                if (debt === null || equity === null) return null;
                return safeDivide(debt, debt + equity, 100);
            },
        },
        {
            id: 'net_debt_equity',
            label: 'Net Debt / Equity',
            kind: 'ratio',
            getValue: (periodKey, context) => {
                const debt = deriveDebt(context, periodKey);
                const cash = valueFromBalance(context, periodKey, ['cash', 'cash_and_equivalents']);
                const equity = valueFromBalance(context, periodKey, ['total_equity', 'equity']);
                if (debt === null || cash === null || equity === null || equity === 0) return null;
                return (debt - cash) / equity;
            },
        },
        { id: 'interest_coverage', label: 'Interest Coverage', kind: 'ratio', getValue: (periodKey, context) => valueFromRatios(context, periodKey, ['interest_coverage']) },
    ],
};

const SNAPSHOT_SECTIONS: SnapshotSectionDefinition[] = [PL_SECTION, BS_SECTION, CF_SECTION, RATIOS_SECTION];

function FinancialSnapshotWidgetComponent({ id, symbol, config, hideHeader, onRemove }: FinancialSnapshotWidgetProps) {
    const periodSyncGroup = typeof config?.periodSyncGroup === 'string' ? config.periodSyncGroup : undefined;
    const defaultPeriod = config?.defaultPeriod === 'Q' || config?.defaultPeriod === 'TTM'
        ? (config.defaultPeriod as SnapshotPeriod)
        : 'FY';
    const { period, setPeriod } = usePeriodState({
        widgetId: id || 'financial_snapshot',
        defaultPeriod,
        validPeriods: [...SNAPSHOT_PERIOD_OPTIONS],
        sharedKey: periodSyncGroup ? `${periodSyncGroup}:${symbol.toUpperCase()}` : undefined,
    });
    const { config: unitConfig } = useUnit();

    const periodMode: FinancialPeriodMode = period === 'FY' ? 'year' : period === 'Q' ? 'quarter' : 'ttm';
    const periodLimit = period === 'Q' ? QUARTER_PERIOD_LIMIT : ANNUAL_PERIOD_LIMIT;
    const statementPeriod = period === 'FY' ? 'year' : period === 'Q' ? 'quarter' : 'TTM';
    const ratioPeriod = period === 'FY' ? 'FY' : period === 'Q' ? 'Q' : 'TTM';

    const incomeQuery = useIncomeStatement(symbol, { period: statementPeriod, limit: periodLimit });
    const balanceQuery = useBalanceSheet(symbol, { period: statementPeriod, limit: periodLimit });
    const cashFlowQuery = useCashFlow(symbol, { period: statementPeriod, limit: periodLimit });
    const ratiosQuery = useFinancialRatios(symbol, { period: ratioPeriod });
    const profileQuery = useProfile(symbol, Boolean(symbol));

    const incomeRows = useMemo(
        () => [...(incomeQuery.data?.data || [])].sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period)),
        [incomeQuery.data?.data]
    );
    const balanceRows = useMemo(
        () => [...(balanceQuery.data?.data || [])].sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period)),
        [balanceQuery.data?.data]
    );
    const cashRows = useMemo(
        () => [...(cashFlowQuery.data?.data || [])].sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period)),
        [cashFlowQuery.data?.data]
    );
    const ratioRows = useMemo(
        () => [...(ratiosQuery.data?.data || [])].sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period)),
        [ratiosQuery.data?.data]
    );

    const incomeByPeriod = useMemo(() => buildPeriodMap(incomeRows, periodMode), [incomeRows, periodMode]);
    const balanceByPeriod = useMemo(() => buildPeriodMap(balanceRows, periodMode), [balanceRows, periodMode]);
    const cashByPeriod = useMemo(() => buildPeriodMap(cashRows, periodMode), [cashRows, periodMode]);
    const ratiosByPeriod = useMemo(() => buildPeriodMap(ratioRows, periodMode), [ratioRows, periodMode]);

    const periods = useMemo(() => {
        const values = new Set<string>();
        [incomeByPeriod, balanceByPeriod, cashByPeriod, ratiosByPeriod].forEach((map) => {
            map.forEach((_value, key) => values.add(key));
        });
        return Array.from(values).sort((left, right) => periodSortKey(right) - periodSortKey(left));
    }, [balanceByPeriod, cashByPeriod, incomeByPeriod, ratiosByPeriod]);

    const tableColumns = useMemo<DenseTableColumn[]>(
        () => periods.map((periodKey) => ({ key: periodKey, label: formatSnapshotPeriodLabel(periodKey, periodMode), align: 'right' })),
        [periodMode, periods]
    );

    const snapshotContext = useMemo<SnapshotContext>(
        () => ({
            periodMode,
            periods,
            incomeByPeriod,
            balanceByPeriod,
            cashByPeriod,
            ratiosByPeriod,
            profileSharesOutstanding: profileQuery.data?.data?.outstanding_shares ?? null,
        }),
        [balanceByPeriod, cashByPeriod, incomeByPeriod, periodMode, periods, profileQuery.data?.data?.outstanding_shares, ratiosByPeriod]
    );

    const sectionTables = useMemo(() => {
        return SNAPSHOT_SECTIONS.map((section) => ({
            ...section,
            rows: section.rows.map<DenseTableRow>((row) => ({
                id: row.id,
                label: row.label,
                values: Object.fromEntries(periods.map((periodKey) => [periodKey, row.getValue(periodKey, snapshotContext)])),
            })),
        }));
    }, [periods, snapshotContext]);

    const statementValues = useMemo(
        () => sectionTables.flatMap((section) => section.rows.flatMap((row) => Object.values(row.values).filter((value): value is number | null | undefined => typeof value === 'number' || value === null || value === undefined))),
        [sectionTables]
    );
    const tableScale = useMemo(() => resolveUnitScale(statementValues, unitConfig), [statementValues, unitConfig]);
    const unitLegend = useMemo(() => getUnitLegend(tableScale, unitConfig), [tableScale, unitConfig]);

    const isLoading =
        incomeQuery.isLoading
        && balanceQuery.isLoading
        && cashFlowQuery.isLoading
        && ratiosQuery.isLoading
        && incomeRows.length === 0
        && balanceRows.length === 0
        && cashRows.length === 0
        && ratioRows.length === 0;
    const hasPeriods = periods.length > 0;
    const isFetching = incomeQuery.isFetching || balanceQuery.isFetching || cashFlowQuery.isFetching || ratiosQuery.isFetching;
    const combinedError = incomeQuery.error || balanceQuery.error || cashFlowQuery.error || ratiosQuery.error;
    const updatedAt = Math.max(
        incomeQuery.dataUpdatedAt,
        balanceQuery.dataUpdatedAt,
        cashFlowQuery.dataUpdatedAt,
        ratiosQuery.dataUpdatedAt
    );

    return (
        <WidgetContainer
            title="Financial Snapshot"
            symbol={symbol}
            onRefresh={() => {
                void incomeQuery.refetch();
                void balanceQuery.refetch();
                void cashFlowQuery.refetch();
                void ratiosQuery.refetch();
            }}
            onClose={onRemove}
            isLoading={isLoading && !hasPeriods}
            widgetId={id}
            hideHeader={hideHeader}
            noPadding
        >
            <div className="flex h-full flex-col overflow-hidden bg-[var(--bg-primary)]">
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
                    <PeriodToggle value={period} onChange={setPeriod} compact options={[...SNAPSHOT_PERIOD_OPTIONS]} />
                    <div className="ml-auto">
                        <WidgetMeta
                            updatedAt={updatedAt}
                            isFetching={isFetching && hasPeriods}
                            note={period === 'FY' ? 'Annual · latest first' : period === 'Q' ? 'Quarterly · latest first' : 'TTM · latest first'}
                            align="right"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-auto p-3">
                    {isLoading && !hasPeriods ? (
                        <WidgetSkeleton variant="table" lines={8} />
                    ) : combinedError && !hasPeriods ? (
                        <WidgetError error={combinedError as Error} onRetry={() => {
                            void incomeQuery.refetch();
                            void balanceQuery.refetch();
                            void cashFlowQuery.refetch();
                            void ratiosQuery.refetch();
                        }} />
                    ) : !hasPeriods ? (
                        <WidgetEmpty message={`No financial snapshot data available for ${symbol}.`} />
                    ) : (
                        <div className="grid gap-3 xl:grid-cols-2">
                            {sectionTables.map((section) => (
                                <div key={section.id} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]/55 p-3">
                                    <div className="mb-2 flex items-center justify-between">
                                        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--text-primary)]">{section.title}</div>
                                        <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">{unitLegend}</div>
                                    </div>
                                    <DenseFinancialTable
                                        columns={tableColumns}
                                        rows={section.rows}
                                        sortable={false}
                                        showTrend={false}
                                        latestFirst
                                        maxYears={tableColumns.length || 1}
                                        storageKey={`financial-snapshot:${section.id}:${id}:${symbol}:${period}`}
                                        footerNote={section.id === 'ratios' ? undefined : `Note: ${unitLegend} except per-share and ratio rows.`}
                                        valueFormatter={(value, row) => {
                                            const definition = SNAPSHOT_SECTIONS.find((item) => item.id === section.id)?.rows.find((item) => item.id === row.id);
                                            if (!definition) return '-';
                                            if (definition.kind === 'percent') {
                                                return formatPercent(value as number | null | undefined, { decimals: 1, input: 'percent', clamp: 'margin' });
                                            }
                                            if (definition.kind === 'ratio') {
                                                return formatNumber(value as number | null | undefined, { decimals: 2 });
                                            }
                                            if (definition.kind === 'per_share' || definition.kind === 'shares_mn') {
                                                return formatNumber(value as number | null | undefined, { decimals: 2 });
                                            }
                                            return formatUnitValuePlain(value as number | null | undefined, tableScale, unitConfig);
                                        }}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

export const FinancialSnapshotWidget = memo(FinancialSnapshotWidgetComponent);
export default FinancialSnapshotWidget;
