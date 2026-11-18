// Cash Flow Widget - Operating, Investing, Financing with Chart View
'use client';

import { useState, useMemo, useEffect, useCallback, memo } from 'react';
import { Banknote, Table, BarChart3 } from 'lucide-react';
import { useCashFlow } from '@/lib/queries';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
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
    Area,
    ResponsiveContainer,
    Legend,
    CartesianGrid,
    ReferenceLine,
} from 'recharts';
import { convertFinancialValueForUnit, formatAxisValue, formatConvertedValue, formatRawValuePlain, formatUnitValuePlain, getUnitCaption, getUnitLegend, resolveUnitScale, toFiniteNumber } from '@/lib/units';
import { useUnit } from '@/contexts/UnitContext';
import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { cn } from '@/lib/utils';
import { canonicalPeriodRows, describeUnavailableStatementRows, formatFinancialPeriodLabel, FUNDAMENTAL_PERIOD_SYNC_GROUP, isUnavailableStatementRow, matchesFinancialPeriodMode, normalizeFinancialPeriod, periodSortKey, type FinancialPeriodMode } from '@/lib/financialPeriods';
import { DenseFinancialTable, type DenseTableRow } from '@/components/ui/DenseFinancialTable';
import { buildTableInsightContext, describeSelection, seriesFromSelection, toggleSelection, type ChartableColumn, type TableSelection } from '@/lib/tableInsight';
import { buildCashFlowWaterfallModel } from '@/lib/financialVisualizations';
import { CashFlowWaterfallChart } from '@/components/widgets/charts/CashFlowWaterfallChart';
import type { CashFlowData } from '@/types/equity';

interface CashFlowWidgetProps {
    id: string;
    symbol: string;
    config?: Record<string, unknown>;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: unknown) => void;
}

type ViewMode = 'table' | 'chart';

const labels = {
    operating_cash_flow: 'Operating CF',
    investing_cash_flow: 'Investing CF',
    financing_cash_flow: 'Financing CF',
    net_change_in_cash: 'Net Change in Cash',
    free_cash_flow: 'Free Cash Flow',
    capex: 'CapEx',
    dividends_paid: 'Dividends Paid',
    depreciation: 'Depreciation',
    taxes_paid: 'Taxes Paid',
    interest_paid: 'Interest Paid',
    change_in_receivables: 'Receivables Change',
    change_in_inventory: 'Inventory Change',
    change_in_payables: 'Payables Change',
    fx_effect: 'FX Effect',
    proceeds_from_borrowings: 'Borrowings Received',
    proceeds_from_share_issuance: 'Share Issuance',
    proceeds_from_asset_sales: 'Asset Sale Proceeds',
    acquisition_spend: 'Acquisition Spend',
    debt_repayment: 'Debt Repayment',
    stock_repurchased: 'Stock Repurchased',
} as const;

type CashFlowMetric = keyof typeof labels;
const cashFlowMetrics = Object.keys(labels).filter((key): key is CashFlowMetric => Object.hasOwn(labels, key));
// Only the fields defined by the API statement model may bypass raw alias admission.
const wireFields: Readonly<Partial<Record<CashFlowMetric, readonly string[]>>> = {
    operating_cash_flow: ['operating_cash_flow'],
    investing_cash_flow: ['investing_cash_flow'],
    financing_cash_flow: ['financing_cash_flow'],
    net_change_in_cash: ['net_change_in_cash', 'net_cash_flow'],
    free_cash_flow: ['free_cash_flow'],
    capex: ['capex', 'capital_expenditure'],
    dividends_paid: ['dividends_paid'],
    stock_repurchased: ['stock_repurchased'],
    debt_repayment: ['debt_repayment'],
    depreciation: ['depreciation'],
};

const TABLE_YEAR_LIMIT = 20;
const QUARTER_PERIOD_LIMIT = 40;
const STATEMENT_PERIOD_OPTIONS = ['FY', 'Q', 'TTM'] as const;

export const RAW_CASHFLOW_ALIASES: Record<string, string[]> = {
    depreciation: ['depreciation', 'depreciation_and_amortisation', 'khau_hao_tscd'],
    taxes_paid: ['taxes_paid', 'income_tax_paid', 'cash_paid_for_taxes', 'chi_nop_thue_thu_nhap_doanh_nghiep'],
    interest_paid: ['interest_paid', 'interest_expense_paid', 'cash_paid_for_interest', 'lai_vay_da_tra'],
    change_in_receivables: ['change_in_receivables', 'increase_decrease_in_receivables', 'tang_giam_cac_khoan_phai_thu'],
    change_in_inventory: ['change_in_inventory', 'increase_decrease_in_inventories', 'tang_giam_hang_ton_kho'],
    change_in_payables: ['change_in_payables', 'increase_decrease_in_payables', 'tang_giam_cac_khoan_phai_tra'],
    fx_effect: ['effect_of_exchange_rate_changes', 'fx_effect', 'chenh_lech_ty_gia'],
    proceeds_from_borrowings: ['proceeds_from_borrowings', 'cash_received_from_borrowings', 'tien_thu_tu_di_vay'],
    proceeds_from_share_issuance: ['proceeds_from_issue_of_shares', 'cash_received_from_shares_issue', 'phat_hanh_co_phieu'],
    proceeds_from_asset_sales: ['proceeds_from_disposal_of_fixed_assets', 'cash_received_from_disposal_of_fixed_assets', 'thu_tu_thanh_ly_tai_san'],
    acquisition_spend: ['payments_for_acquisitions', 'acquisition_spend', 'chi_mua_cong_ty_con'],
    stock_repurchased: ['stock_repurchased', 'repurchase_of_shares', 'purchase_of_treasury_shares', 'co_phieu_quy'],
};

function toNumeric(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        // A blank string is a missing observation, not a reported zero.
        const trimmed = value.toString().replace(/,/g, '').trim();
        if (!trimmed) return null;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

/**
 * The field-level rejection the API recorded for a metric, wherever its
 * evidence lives: the row's `unit_metadata`, its persisted canonical copy, or
 * the lineage dictionary. A rejected field is not a missing one, so an
 * explicit reason must survive into the table instead of being refilled from
 * the raw provider alias (issue #245).
 */
export function fieldWithheldReason(entry: CashFlowData, metricKey: string): string | null {
    for (const evidence of unitEvidence(entry, metricKey)) {
        const reason = evidence.unavailable_reason;
        if (typeof reason === 'string' && reason.trim()) return reason;
    }
    return null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unitEvidence(entry: CashFlowData, key: string) {
    const lineage = entry.raw_data?._financial_lineage;
    const canonical = isRecord(lineage) ? lineage.canonical_data : undefined;
    return [entry.unit_metadata, isRecord(canonical) ? canonical.unit_metadata : undefined,
        isRecord(lineage) ? lineage.unit_metadata : undefined]
        .map((source) => isRecord(source) && Object.hasOwn(source, key) ? source[key] : undefined)
        .filter(isRecord);
}

/** A raw fallback needs its own evidence that this exact value is already in VND (#245). */
export function getRawMetric(entry: CashFlowData, metricKey: string): number | null {
    const raw = entry.raw_data;
    if (!isRecord(raw) || isUnavailableStatementRow(entry) || entry.currency !== 'VND' || entry.value_unit !== 'VND') return null;

    const aliases = RAW_CASHFLOW_ALIASES[metricKey] ?? [];
    const fields = Object.keys(raw);
    const candidates = aliases.flatMap((alias) => [alias, ...fields.filter((field) => field !== alias && field.toLowerCase() === alias)]);
    if (cashFlowWithholding(entry, [metricKey, ...candidates])) return null;

    for (const field of candidates) {
        const value = Object.hasOwn(raw, field) ? toNumeric(raw[field]) : null;
        if (value === null) continue;
        const [evidence] = unitEvidence(entry, field);
        if (evidence && rawAmountIsVnd(evidence, field, value)) return value;
    }

    return null;
}

/** The currency family a unit label names, ignoring scale (API `_unit_currency`). */
function unitCurrency(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const label = value.trim().toLowerCase();
    const families: [string, string][] = [
        ['vnd', 'vnd'], ['vnđ', 'vnd'], ['đồng', 'vnd'], ['dong', 'vnd'],
        ['usd', 'usd'], ['$', 'usd'], ['eur', 'eur'], ['jpy', 'jpy'],
    ];
    return families.find(([token]) => label.includes(token))?.[1] ?? null;
}

/**
 * The API's own monetary-evidence rule, ported verbatim (`financial_service
 * ._monetary_evidence_admitted`): a role whose currency differs from the
 * target refuses the evidence, `unit`/`value_unit` must name the target
 * exactly, and every component must admit recursively.
 *
 * This checks a declaration, not whether a separate raw number is already
 * normalized. The raw fallback must also pass `rawAmountIsVnd`.
 */
function monetaryEvidenceAdmitted(metadata: unknown, unit: string): boolean {
    if (!metadata || typeof metadata !== 'object') return false
    const entry = metadata as Record<string, unknown>
    if (entry.unavailable_reason) return false
    const target = unitCurrency(unit)
    for (const key of ['unit', 'value_unit', 'source_unit']) {
        const claimed = unitCurrency(entry[key])
        if (claimed !== null && target !== null && claimed !== target) return false
    }
    if (['unit', 'value_unit'].some((key) => entry[key] !== undefined && entry[key] !== null && entry[key] !== unit)) {
        return false
    }
    const components = entry.components
    if (Array.isArray(components) && components.length > 0) {
        return components.every((component) => monetaryEvidenceAdmitted(component, unit))
    }
    const declared = entry.unit !== undefined ? entry.unit : entry.value_unit
    return declared === unit && Boolean(entry.source_unit || entry.unitEvidence)
}

function rawAmountIsVnd(evidence: Readonly<Record<string, unknown>>, field: string, value: number): boolean {
    const label = evidence.label ?? evidence.source_label;
    if (label != null && label !== field) return false;
    const sourceUnit = evidence.source_unit ?? evidence.unitEvidence;
    if (typeof sourceUnit !== 'string' || !['vnd', 'đồng', 'dong'].includes(sourceUnit.trim().toLowerCase())) return false;
    if ((evidence.unit ?? evidence.value_unit) !== 'VND' || !monetaryEvidenceAdmitted(evidence, 'VND')) return false;
    if (evidence.normalization_multiplier != null && evidence.normalization_multiplier !== 1) return false;
    // A certificate for a blank or different value is not evidence for this amount.
    if (Object.hasOwn(evidence, 'provider_value')) return toNumeric(evidence.provider_value) === value;
    return !Object.hasOwn(evidence, 'raw_value') || toNumeric(evidence.raw_value) === value;
}

function cashFlowWithholding(entry: CashFlowData, keys: readonly string[]): string | null {
    return fieldWithheldReason(entry, 'basis') ?? keys.map((key) => fieldWithheldReason(entry, key)).find((reason) => reason !== null) ?? null;
}

/** The same admitted, source-unit observations drive the table, charts and downstream consumers. */
function projectCashFlow(entry: CashFlowData) {
    const record: Record<string, unknown> = { ...entry };
    const withheld: CashFlowData['unit_metadata'] = {};
    const values = Object.fromEntries(cashFlowMetrics.map((metric): [CashFlowMetric, number | null] => {
        const wireKeys = wireFields[metric] ?? [];
        const reason = cashFlowWithholding(entry, [metric, ...wireKeys, ...(RAW_CASHFLOW_ALIASES[metric] ?? [])]);
        if (reason) {
            withheld[metric] = { unavailable_reason: reason };
            return [metric, null];
        }
        // Canonical wire fields have already gone through API admission. An
        // optional provider alias needs affirmative evidence even as a fallback.
        for (const key of wireKeys) {
            const value = record[key];
            if (typeof value === 'number' && Number.isFinite(value)) return [metric, value];
        }
        return [metric, RAW_CASHFLOW_ALIASES[metric] ? getRawMetric(entry, metric) : null];
    }));
    const metrics: Readonly<Partial<Record<CashFlowMetric, number | null>>> = values;
    const source = typeof record.source === 'string' ? record.source : null;
    return {
        row: {
            symbol: entry.symbol,
            period: entry.period,
            source,
            currency: entry.currency ?? null,
            value_unit: entry.value_unit ?? null,
            consolidation_basis: entry.consolidation_basis ?? null,
            flow_basis: entry.flow_basis ?? null,
            aggregation_basis: entry.aggregation_basis ?? null,
            source_periods: entry.source_periods ?? null,
            withheld_fields: describeUnavailableStatementRows([{ period: entry.period, unit_metadata: withheld }]),
            ...metrics,
            net_cash_flow: metrics.net_change_in_cash ?? null,
            capital_expenditure: metrics.capex ?? null,
        },
        reportedMetadata: { ...entry.unit_metadata, ...withheld },
    };
}

function CashFlowWidgetComponent({ id, symbol, config, isEditing, onRemove, onDataChange }: CashFlowWidgetProps) {
    // Default to the shared group the "Financial Period View" banner writes; a
    // widget-level `periodSyncGroup` overrides it and an explicit `null` opts out
    // so the period stays widget-local (issue #101).
    const configuredSyncGroup = config?.periodSyncGroup;
    const periodSyncGroup = configuredSyncGroup === null
        ? undefined
        : typeof configuredSyncGroup === 'string' && configuredSyncGroup.trim()
            ? configuredSyncGroup
            : FUNDAMENTAL_PERIOD_SYNC_GROUP;
    const defaultPeriod =
        config?.defaultPeriod === 'Q' || config?.defaultPeriod === 'TTM'
            ? (config.defaultPeriod as 'Q' | 'TTM')
            : 'FY';
    const { period, setPeriod } = usePeriodState({
        widgetId: id || 'cash_flow',
        defaultPeriod,
        validPeriods: [...STATEMENT_PERIOD_OPTIONS],
        sharedKey: periodSyncGroup ? `${periodSyncGroup}:${symbol.toUpperCase()}` : undefined,
    });
    const showPeriodToggle = config?.hidePeriodToggle !== true;
    const [viewMode, setViewMode] = useState<ViewMode>('table');
    const { config: unitConfig } = useUnit();
    // Selection is local component state: a transient reading aid, not
    // persisted config. periodSyncGroup / defaultPeriod / hidePeriodToggle and
    // the period behaviour are untouched.
    const [selection, setSelection] = useState<TableSelection | null>(null);
    
    const apiPeriod = period === 'FY' ? 'year' : period === 'Q' ? 'quarter' : period;
    const periodMode: FinancialPeriodMode = period === 'FY' ? 'year' : period === 'TTM' ? 'ttm' : 'quarter';
    const visiblePeriodLimit = period === 'Q' ? QUARTER_PERIOD_LIMIT : TABLE_YEAR_LIMIT;

    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useCashFlow(symbol, { period: apiPeriod, limit: visiblePeriodLimit });

    const items = data?.data;
    // Provider payloads can repeat a fiscal period or emit rows with no fiscal
    // identity at all. `canonicalPeriodRows` never picks between conflicting rows
    // (nothing in the payload proves which basis is authoritative) - it excludes
    // them and reports the reason, so a duplicate is disclosed rather than shown as
    // two columns labelled "2020" (issue #103).
    const { rows: canonicalItems, issues: periodIssues, invalidPeriodCount } = useMemo(
        () => canonicalPeriodRows(items ?? []),
        [items]
    );
    const orderedItems = useMemo(
        () => [...canonicalItems].sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period)),
        [canonicalItems]
    );
    const periodItems = useMemo(
        () => orderedItems.filter((item) => matchesFinancialPeriodMode(normalizeFinancialPeriod(item.period), periodMode)),
        [orderedItems, periodMode]
    );
    const projectedItems = useMemo(() => periodItems.map((entry) => ({ entry, ...projectCashFlow(entry) })), [periodItems]);
    const unavailableNote = useMemo(() => describeUnavailableStatementRows(projectedItems.map(({ entry, reportedMetadata }) => ({
        period: entry.period, unavailable_reason: entry.unavailable_reason, unit_metadata: reportedMetadata,
    }))), [projectedItems]);
    // Field-level withholding can leave a period with no admitted amount and no row-level reason.
    // Keep its diagnostics above, but publish only periods with an observation (including zero).
    const displayItems = useMemo(
        () => projectedItems.filter(({ entry, row }) => !isUnavailableStatementRow(entry)
            && cashFlowMetrics.some((metric) => row[metric] != null)).map(({ row }) => row),
        [projectedItems]
    );
    const duplicatePeriodNote = useMemo(() => {
        const notes: string[] = [];
        const ambiguous = periodIssues.filter((issue) => issue.reason === 'ambiguous-basis');
        if (ambiguous.length > 0) {
            notes.push(
                `Unavailable: ${ambiguous.map((issue) => issue.period).join(', ')} returned conflicting rows without an authoritative basis/revision selection, so no value is shown.`
            );
        }
        if (invalidPeriodCount > 0) {
            notes.push(`${invalidPeriodCount} provider row${invalidPeriodCount === 1 ? '' : 's'} without a fiscal period excluded.`);
        }
        return notes.length > 0 ? notes.join(' ') : null;
    }, [periodIssues, invalidPeriodCount]);
    const statementNote = useMemo(
        () => [duplicatePeriodNote, unavailableNote].filter(Boolean).join(' ') || null,
        [duplicatePeriodNote, unavailableNote]
    );
    const hasData = displayItems.length > 0;
    const responseFailed = Boolean(data?.error?.trim());
    const refreshFailed = Boolean(error) || responseFailed;
    const isFallback = refreshFailed && hasData;
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData);


    // One FX boundary: convert once here; axis/tooltip format without converting
    // again (issue #100). A missing raw value stays `null` so the chart draws a gap
    // instead of a fabricated zero (issue #103).
    const chartData = useMemo(() => {
        if (!displayItems.length) return [];
        return displayItems.map((d) => ({
            period: formatFinancialPeriodLabel(d.period, { mode: periodMode }),
            operatingCF: convertFinancialValueForUnit(d.operating_cash_flow ?? null, unitConfig, d.period),
            investingCF: convertFinancialValueForUnit(d.investing_cash_flow ?? null, unitConfig, d.period),
            financingCF: convertFinancialValueForUnit(d.financing_cash_flow ?? null, unitConfig, d.period),
            freeCashFlow: convertFinancialValueForUnit(d.free_cash_flow ?? null, unitConfig, d.period),
            netCashFlow: convertFinancialValueForUnit(d.net_change_in_cash, unitConfig, d.period),
        }));
    }, [displayItems, periodMode, unitConfig]);

    const tableScale = useMemo(() => {
        const values = displayItems.flatMap((item) => cashFlowMetrics.map((metric) =>
            convertFinancialValueForUnit(item[metric], unitConfig, item.period)));
        return resolveUnitScale(values, unitConfig);
    }, [displayItems, unitConfig]);

    const unitLegend = useMemo(() => getUnitLegend(tableScale, unitConfig).replace(/^Values in/, 'Display units:'), [tableScale, unitConfig]);
    const unitNote = useMemo(
        () => `${unitLegend}. Display settings do not verify source units or reporting standard. First available period is the base period.`,
        [unitLegend]
    );

    const tableColumns = useMemo(
        () =>
            displayItems.slice(-visiblePeriodLimit).map((entry, index) => ({
                key: entry.period ?? `period_${index}`,
                label: formatFinancialPeriodLabel(entry.period, { mode: periodMode }),
                align: 'right' as const,
            })),
        [displayItems, periodMode, visiblePeriodLimit]
    );

/** Table metric id -> the camelCase series key the chart draws for it. */
const CHART_SERIES_BY_METRIC: Record<string, string> = {
    operating_cash_flow: 'operatingCF',
    investing_cash_flow: 'investingCF',
    financing_cash_flow: 'financingCF',
    free_cash_flow: 'freeCashFlow',
    net_change_in_cash: 'netCashFlow',
};

    // The metric series the chart can plot, in the order the chart draws them.
    const insightSeries = useMemo<ChartableColumn[]>(
        () => [
            { key: 'operatingCF', label: 'Operating CF', kind: 'currency' },
            { key: 'investingCF', label: 'Investing CF', kind: 'currency' },
            { key: 'financingCF', label: 'Financing CF', kind: 'currency' },
            { key: 'freeCashFlow', label: 'Free Cash Flow', kind: 'currency' },
            { key: 'netCashFlow', label: 'Net Cash Change', kind: 'currency' },
            ...tableColumns.map((column) => ({
                key: column.key,
                label: column.label,
                kind: 'number' as const,
                isPeriod: true,
            })),
        ],
        [tableColumns]
    );

    const activeSeries = useMemo(
        () => seriesFromSelection(insightSeries, selection),
        [insightSeries, selection]
    );

    const chartInsight = useMemo(
        () => buildTableInsightContext({ selection, columns: insightSeries }),
        [selection, insightSeries]
    );

    useEffect(() => {
        const units = [...new Set(displayItems.map((item) => item.value_unit).filter(Boolean))].join(', ') || undefined;
        const basis = [...new Set(displayItems.map((item) =>
            [item.consolidation_basis, item.flow_basis, item.aggregation_basis].filter(Boolean).join(' / '),
        ).filter(Boolean))].join('; ') || undefined;
        onDataChange?.(buildWidgetRuntime({
            apiGroup: '/equity',
            empty: !hasData,
            endpoint: `/equity/${symbol}/cash-flow?period=${apiPeriod}`,
            sourceLabel: 'Cash flow',
            lastDataDate: null,
            fetchedAt: dataUpdatedAt,
            cached: isFallback,
            observationStatus: hasData ? 'available' : isLoading ? 'loading' : refreshFailed || statementNote ? 'unavailable' : 'empty',
            refreshStatus: isFetching ? 'refreshing' : refreshFailed ? 'failed' : dataUpdatedAt ? 'succeeded' : undefined,
            period,
            periodScope: periodSyncGroup ? 'shared' : 'local',
            units,
            basis,
            warnings: statementNote ? [statementNote] : undefined,
            exportData: displayItems,
            extra: { periods: displayItems.length, data: displayItems, ...(hasData ? { tableInsight: chartInsight } : {}) },
        }));
    }, [onDataChange, hasData, isFallback, isLoading, refreshFailed, isFetching, dataUpdatedAt, symbol, apiPeriod, period, periodSyncGroup, displayItems, statementNote, chartInsight]);
    // A metric selection is a series selection: the shared contract charts one
    // series only for a `column` selection whose key is a series key. Table row
    // ids are the raw statement metric names while the chart series are
    // camelCase, so the row is translated here. Only metrics the chart actually
    // draws are selectable.
    const attachSelection = useCallback(
        (row: DenseTableRow): DenseTableRow => {
            const seriesKey = CHART_SERIES_BY_METRIC[row.id];
            if (!seriesKey) return row;
            return {
                ...row,
                selectable: true,
                selected: selection?.kind === 'column' && selection.key === seriesKey,
                onSelect: () => setSelection((current) => toggleSelection(current, { kind: 'column', key: seriesKey })),
            };
        },
        [selection]
    );

    const selectionLabel = describeSelection(selection, insightSeries);
    const selectColumn = useCallback(
        (key: string) => setSelection((current) => toggleSelection(current, { kind: 'column', key })),
        []
    );
    const clearSelection = useCallback(() => setSelection(null), []);
    const tableRows = useMemo<DenseTableRow[]>(() => {
        const recentItems = displayItems.slice(-visiblePeriodLimit)
        const hasMetricData = (metricKey: CashFlowMetric) =>
            recentItems.some((entry) => entry[metricKey] != null)

        const mapValues = (metricKey: CashFlowMetric) =>
            Object.fromEntries(
                recentItems.map((entry, index) => [
                    tableColumns[index]?.key ?? `period_${index}`,
                    convertFinancialValueForUnit(entry[metricKey], unitConfig, entry.period),
                ])
            );

        const createRow = (groupId: string, metricKey: CashFlowMetric): DenseTableRow | null =>
            hasMetricData(metricKey)
                ? attachSelection({
                    id: metricKey,
                    label: labels[metricKey],
                    parentId: groupId,
                    indent: 12,
                    values: mapValues(metricKey),
                })
                : null;
        return [
            { id: 'group:operations', label: 'Operating details', values: {}, isGroup: true },
            createRow('group:operations', 'operating_cash_flow'),
            createRow('group:operations', 'depreciation'),
            createRow('group:operations', 'taxes_paid'),
            createRow('group:operations', 'interest_paid'),
            createRow('group:operations', 'change_in_receivables'),
            createRow('group:operations', 'change_in_inventory'),
            createRow('group:operations', 'change_in_payables'),
            createRow('group:operations', 'fx_effect'),
            { id: 'group:investing', label: 'Investing details', values: {}, isGroup: true },
            createRow('group:investing', 'investing_cash_flow'),
            createRow('group:investing', 'capex'),
            createRow('group:investing', 'proceeds_from_asset_sales'),
            createRow('group:investing', 'acquisition_spend'),
            { id: 'group:financing', label: 'Financing details', values: {}, isGroup: true },
            createRow('group:financing', 'financing_cash_flow'),
            createRow('group:financing', 'proceeds_from_borrowings'),
            createRow('group:financing', 'proceeds_from_share_issuance'),
            createRow('group:financing', 'dividends_paid'),
            createRow('group:financing', 'debt_repayment'),
            createRow('group:financing', 'stock_repurchased'),
            { id: 'group:summary', label: 'Summary', values: {}, isGroup: true },
            createRow('group:summary', 'free_cash_flow'),
            createRow('group:summary', 'net_change_in_cash'),
        ].filter(Boolean) as DenseTableRow[];
    }, [displayItems, tableColumns, unitConfig, visiblePeriodLimit, attachSelection]);

    const renderTable = () => (
        <DenseFinancialTable
            columns={tableColumns}
            rows={tableRows}
            sortable
            showTrend={false}
            maxYears={tableColumns.length || 1}
            initialScrollPosition="end"
            storageKey={`cash-flow:${id}:${symbol}:${period}`}
            selectedColumnKey={selection?.kind === 'column' ? selection.key : null}
            onSelectionClear={clearSelection}
            footerNote={unitNote + (period === 'TTM' ? displayItems.map((item) =>
                ` • TTM basis: ${item.aggregation_basis ?? 'Unknown'}; Source periods: ${item.source_periods?.length ? item.source_periods.join(', ') : 'Unknown'}`,
            ).join('') : '')}
            valueFormatter={(value) =>
                formatUnitValuePlain(value as number | null | undefined, tableScale, unitConfig)
            }
        />
    );

    const waterfallModel = useMemo(() => buildCashFlowWaterfallModel(displayItems), [displayItems]);
    const [chartType, setChartType] = useState<'overview' | 'fcf' | 'waterfall'>('overview');
    const chartedSeries = activeSeries.filter((entry) => entry.kind !== 'text');
    // A metric selection charts exactly its own series: the flow series live in
    // the overview pane while free/net cash live in the FCF pane, so the pane is
    // chosen from the selection. With no selection the user's chart-type choice
    // stands. Only a selection with nothing drawable falls back to the hint.
    const selectionIsFcfPane = selection?.kind === 'column'
        && ['freeCashFlow', 'netCashFlow'].includes(selection.key);
    const drawOverview = selection
        ? !selectionIsFcfPane && chartedSeries.some((entry) =>
            ['operatingCF', 'investingCF', 'financingCF'].includes(entry.key))
        : chartedSeries.length > 0;
    // A selection drives its own pane regardless of the user's chart-type pick;
    // otherwise the pick stands.
    const effectiveChartType = selection
        ? (selectionIsFcfPane ? 'fcf' as const : 'overview' as const)
        : chartType;
    const xAxisInterval = useMemo(
        () => (chartData.length > 12 ? Math.max(1, Math.ceil(chartData.length / 8)) - 1 : 0),
        [chartData.length]
    );

    const renderChart = () => {
        if (displayItems.length === 0) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-1 text-[var(--text-muted)]">
                    <BarChart3 size={32} className="opacity-20" />
                    <p className="text-[10px] font-bold uppercase tracking-widest">No visualization available</p>
                </div>
            );
        }

        return (
            <div className="h-full flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2 px-1 pt-0.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <span
                            data-testid="cash-flow-chart-focus"
                            className="truncate text-[10px] font-bold uppercase tracking-tighter text-[var(--text-secondary)]"
                            title={selectionLabel}
                        >
                            {selectionLabel}
                        </span>
                        {selection ? (
                            <button
                                type="button"
                                onClick={clearSelection}
                                aria-label="Clear table selection"
                                className="shrink-0 rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tighter text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                            >
                                Clear
                            </button>
                        ) : null}
                    </div>
                    <select
                        aria-label="Cash flow chart mode"
                        value={effectiveChartType}
                        onChange={(e) => setChartType(e.target.value as 'overview' | 'fcf' | 'waterfall')}
                        className="shrink-0 bg-[var(--bg-secondary)] text-[10px] font-bold text-[var(--text-secondary)] border border-[var(--border-color)] rounded px-2 py-1 focus:outline-none focus:border-[var(--color-state-border)] uppercase tracking-tighter cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                    >
                        <option value="overview">Cash Flows</option>
                        <option value="fcf">Free Cash Flow</option>
                        <option value="waterfall">Waterfall</option>
                    </select>
                </div>
                <div className="flex-1 min-h-[132px]">
                    {effectiveChartType === 'waterfall' ? (
                        waterfallModel ? (
                            <CashFlowWaterfallChart
                                model={waterfallModel}
                                formatValue={(value) => formatRawValuePlain(value, tableScale, unitConfig, waterfallModel.period)}
                            />
                        ) : (
                            <div className="flex h-full items-center justify-center text-[var(--text-muted)]">Waterfall data unavailable</div>
                        )
                    ) : (
                    <ChartMountGuard className="h-full" minHeight={120}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={120}>
                            {effectiveChartType === 'overview' && drawOverview ? (
                                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                                    <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} interval={xAxisInterval} minTickGap={12} />
                                    <YAxis
                                        tickFormatter={(value) => formatAxisValue(value, unitConfig, { converted:true })}
                                        tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
                                        axisLine={false}
                                        tickLine={false}
                                        label={{ value: getUnitCaption(unitConfig), angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 9 }}
                                    />
                                    <ReferenceLine y={0} stroke="#333" />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'var(--bg-tooltip)',
                                            border: '1px solid var(--border-default)',
                                            borderRadius: '8px',
                                            fontSize: '11px',
                                        }}
                                        formatter={(value: unknown) => formatConvertedValue(toFiniteNumber(value), unitConfig)}
                                    />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                                    {(drawOverview && chartedSeries.some((entry) => entry.key === 'operatingCF')) ? (
                                        <Bar dataKey="operatingCF" name="Operating" fill="var(--chart-blue)" radius={[2, 2, 2, 2]} />
                                    ) : null}
                                    {chartedSeries.some((entry) => entry.key === 'investingCF') ? (
                                        <Bar dataKey="investingCF" name="Investing" fill="var(--chart-slate)" radius={[2, 2, 2, 2]} />
                                    ) : null}
                                    {chartedSeries.some((entry) => entry.key === 'financingCF') ? (
                                        <Bar dataKey="financingCF" name="Financing" fill="var(--chart-cat-4)" radius={[2, 2, 2, 2]} />
                                    ) : null}
                                </ComposedChart>
                            ) : chartedSeries.length > 0 ? (
                                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                                    <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} interval={xAxisInterval} minTickGap={12} />
                                    <YAxis
                                        tickFormatter={(value) => formatAxisValue(value, unitConfig, { converted:true })}
                                        tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
                                        axisLine={false}
                                        tickLine={false}
                                        label={{ value: getUnitCaption(unitConfig), angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 9 }}
                                    />
                                    <ReferenceLine y={0} stroke="#333" />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'var(--bg-tooltip)',
                                            border: '1px solid var(--border-default)',
                                            borderRadius: '8px',
                                            fontSize: '11px',
                                        }}
                                        formatter={(value: unknown) => formatConvertedValue(toFiniteNumber(value), unitConfig)}
                                    />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                                    {chartedSeries.some((entry) => entry.key === 'freeCashFlow') ? (
                                        <Area type="monotone" dataKey="freeCashFlow" name="Free Cash Flow" fill="var(--color-positive)" stroke="var(--color-positive)" fillOpacity={0.1} />
                                    ) : null}
                                    {chartedSeries.some((entry) => entry.key === 'netCashFlow') ? (
                                        <Line type="monotone" dataKey="netCashFlow" name="Net Cash Change" stroke="var(--chart-blue)" strokeWidth={2} dot={{ r: 3 }} />
                                    ) : null}
                                </ComposedChart>
                            ) : (
                                <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-[var(--text-muted)]">
                                    No charted series for this selection
                                </div>
                            )}
                        </ResponsiveContainer>
                    </ChartMountGuard>
                    )}
                </div>
            </div>
        );
    };


    return (
        <WidgetContainer
            title="Cash Flow Statement"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading && !hasData}
            noPadding
            widgetId={id}
            showLinkToggle
            exportData={displayItems}
        >
            <div className="h-full flex flex-col px-2 py-1.5">
                {/* The dashboard wraps widget children in a header-suppressing
                    provider, so the container header never renders on a
                    dashboard. View controls therefore live in the body: they
                    own the widget's viewMode/period state and must stay
                    reachable wherever the widget is rendered. */}
                <div className="flex items-center justify-between gap-2 pb-1 border-b border-[var(--border-subtle)]">
                    <div className="flex items-center gap-1.5">
                        <div className="flex bg-[var(--bg-secondary)] rounded p-0.5 border border-[var(--border-color)]">
                            <button
                                type="button"
                                onClick={() => setViewMode('table')}
                                aria-pressed={viewMode === 'table'}
                                className={cn(
                                    "p-1 rounded transition-all",
                                    viewMode === 'table'
                                        ? "bg-[var(--bg-tertiary)] text-[var(--color-accent-primary)] shadow-sm"
                                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                                )}
                                title="Table View"
                                aria-label="Table View"
                            >
                                <Table size={12} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode('chart')}
                                aria-pressed={viewMode === 'chart'}
                                className={cn(
                                    "p-1 rounded transition-all",
                                    viewMode === 'chart'
                                        ? "bg-[var(--bg-tertiary)] text-[var(--color-accent-primary)] shadow-sm"
                                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                                )}
                                title="Chart View"
                                aria-label="Chart View"
                            >
                                <BarChart3 size={12} />
                            </button>
                        </div>
                        {showPeriodToggle ? <PeriodToggle value={period} onChange={setPeriod} compact options={[...STATEMENT_PERIOD_OPTIONS]} /> : null}
                    </div>
                    <WidgetMeta
                        updatedAt={null}
                        fetchedAt={dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={isFallback}
                        note={period === 'FY' ? 'Annual · newest on right' : period === 'TTM' ? 'TTM · newest on right' : 'Quarterly · newest on right'}
                        sourceLabel="Cash flow"
                        align="right"
                    />
                </div>
                <div className="flex-1 overflow-auto scrollbar-hide pt-1">
                    {statementNote && (
                        <div className="mb-2 rounded border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-2 py-1 text-[10px] text-[var(--color-warning)]">
                            {statementNote}
                        </div>
                    )}
                    {timedOut && isLoading && !hasData ? (
                        <WidgetError
                            title="Loading timed out"
                            error={new Error('Request timed out after 15 seconds.')}
                            onRetry={() => {
                                resetTimeout()
                                refetch()
                            }}
                        />
                    ) : isLoading && !hasData ? (
                        <WidgetSkeleton variant="table" lines={6} />
                    ) : refreshFailed && !hasData ? (
                        <WidgetError error={error ?? new Error('Cash flow refresh failed.')} onRetry={() => refetch()} />
                    ) : !hasData ? (
                        <WidgetEmpty
                            message={unavailableNote
                                ? `Cash flow unavailable for ${symbol}.`
                                : `No cash flow data for ${symbol}. Try switching period or refresh.`}
                            detail={unavailableNote ?? undefined}
                            icon={<Banknote size={18} />}
                            action={{ label: 'Retry', onClick: () => refetch() }}
                        />
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

export const CashFlowWidget = memo(CashFlowWidgetComponent);
export default CashFlowWidget;
