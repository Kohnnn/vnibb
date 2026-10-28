'use client';

import { memo, useEffect, useMemo } from 'react';
import { ChartNoAxesColumnIncreasing } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { usePeriodState } from '@/hooks/usePeriodState';
import { useCashFlow } from '@/lib/queries';
import { canonicalPeriodRows, describeUnavailableStatementRows, formatFinancialPeriodLabel, isCanonicalQuarterPeriod, isUnavailableStatementRow, periodSortKey, type FinancialPeriodMode } from '@/lib/financialPeriods';
import { convertFinancialValueForUnit, formatRawValuePlain, getUnitLegend, resolveUnitScale } from '@/lib/units';
import { useUnit } from '@/contexts/UnitContext';
import { buildCashFlowWaterfallModel } from '@/lib/financialVisualizations';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { CashFlowWaterfallChart } from '@/components/widgets/charts/CashFlowWaterfallChart';

interface CashflowWaterfallWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
}

function CashflowWaterfallWidgetComponent({ id, symbol, onRemove, onDataChange }: CashflowWaterfallWidgetProps) {
  const { period, setPeriod } = usePeriodState({
    widgetId: id || 'cashflow_waterfall',
    defaultPeriod: 'FY',
  });
  const { config: unitConfig } = useUnit();
  const apiPeriod = period === 'FY' ? 'year' : period;
  const periodMode: FinancialPeriodMode = period === 'FY' ? 'year' : period === 'TTM' ? 'ttm' : 'quarter';

  // Same canonicalisation as the statement tables: a period the provider repeats
  // with different values has no authoritative basis, so it is excluded rather
  // than letting the bridge pick whichever row happened to sort last, and a row
  // with no fiscal identity cannot become the previous-period comparator
  // (issue #103).
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useCashFlow(symbol, { period: apiPeriod });
  const { rows: canonicalItems, issues: periodIssues, invalidPeriodCount } = useMemo(
    () => canonicalPeriodRows(data?.data ||[]),
    [data?.data],
  );
  const orderedItems = useMemo(
    () => [...canonicalItems].sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period)),
    [canonicalItems],
  );
  // The TTM branch returns a single TTM row today (financial_service
  // .build_ttm_statement_rows), and this filter guarantees TTM mode can never
  // bridge a quarter row under a TTM header if a payload carries one (issue #101).
  const periodItems = useMemo(
    () => periodMode === 'quarter'
      ? orderedItems.filter((item) => isCanonicalQuarterPeriod(item.period))
      : periodMode === 'ttm'
        ? orderedItems.filter((item) => String(item.period ?? '').toUpperCase().includes('TTM'))
        : orderedItems,
    [orderedItems, periodMode],
  );
  // A row the API returned without certification carries every numeric field as
  // null plus `unavailable_reason`. Such a row cannot form a bridge, so it is held
  // out of the model and disclosed in the note rather than rendering as an
  // all-missing bridge; a row that merely has some null fields is untouched
  // (issue #103).
  const unavailableNote = useMemo(() => describeUnavailableStatementRows(periodItems), [periodItems]);
  const displayItems = useMemo(
    () => periodItems.filter((item) => !isUnavailableStatementRow(item)),
    [periodItems],
  );
  const hasData = displayItems.length > 0;
  const duplicatePeriodNote = useMemo(() => {
    const notes: string[] = [];
    const ambiguous = periodIssues.filter((issue) => issue.reason === 'ambiguous-basis');
    if (ambiguous.length > 0) {
      notes.push(
        `Unavailable: ${ambiguous.map((issue) => issue.period).join(', ')} returned conflicting rows with no basis field, so no bridge is shown for ${ambiguous.length === 1 ? 'it' : 'them'}.`,
      );
    }
    if (invalidPeriodCount > 0) {
      notes.push(`${invalidPeriodCount} provider row${invalidPeriodCount === 1 ? '' : 's'} without a fiscal period excluded.`);
    }
    return notes.length > 0 ? notes.join(' ') : null;
  }, [periodIssues, invalidPeriodCount]);
  const statementNote = useMemo(
    () => [duplicatePeriodNote, unavailableNote].filter(Boolean).join(' ') || null,
    [duplicatePeriodNote, unavailableNote],
  );
  const latest = displayItems.at(-1);
  const hasReportedBridge = Boolean(
    latest && [
      latest.operating_cash_flow,
      latest.investing_cash_flow,
      latest.financing_cash_flow,
      latest.net_change_in_cash ?? latest.net_cash_flow,
    ].every((value) => typeof value === 'number' && Number.isFinite(value)),
  );

  // The waterfall model is built from raw statement rows, so the scale is
  // resolved from the converted values and each model value is converted exactly
  // once at format time (issue #100).
  const scale = useMemo(
    () => resolveUnitScale(
      displayItems.flatMap((item) => [
        item.operating_cash_flow,
        item.investing_cash_flow,
        item.financing_cash_flow,
        item.net_change_in_cash,
        item.free_cash_flow,
      ].map((value) => convertFinancialValueForUnit(value, unitConfig, item.period))),
      unitConfig,
    ),
    [displayItems, unitConfig],
  );
  const model = useMemo(
    () => hasReportedBridge ? buildCashFlowWaterfallModel(displayItems) : null,
    [displayItems, hasReportedBridge],
  );
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 10000 });

  useEffect(() => {
    onDataChange?.(
      buildWidgetRuntime({
        empty: !model,
        apiGroup: '/equity',
        endpoint: `/equity/${symbol}/cash-flow?period=${apiPeriod}`,
        sourceLabel: 'Cash bridge',
        lastDataDate: null,
        fetchedAt: dataUpdatedAt,
        stale: Boolean(error && hasData),
        extra: hasData ? { periods: displayItems.length } : undefined,
      }),
    );
  }, [onDataChange, model, error, dataUpdatedAt, symbol, apiPeriod, displayItems.length]);
  const latestLabel = model
    ? formatFinancialPeriodLabel(model.period, { mode: periodMode })
    : period === 'FY'
      ? 'Annual'
      : period;

  return (
    <WidgetContainer
      title="Cash Flow Waterfall"
      symbol={symbol}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
      widgetId={id}
      showLinkToggle
      headerActions={<div className="mr-1"><PeriodToggle value={period} onChange={setPeriod} compact /></div>}
      exportData={displayItems}
      exportFilename={`cashflow_waterfall_${symbol}_${period.toLowerCase()}`}
    >
      <div className="flex h-full flex-col px-2 py-1.5">
        <div className="border-b border-[var(--border-subtle)] pb-1">
          <WidgetMeta
            updatedAt={null}
            fetchedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={Boolean(error && hasData)}
            note={statementNote ?? `${latestLabel} • ${getUnitLegend(scale, unitConfig)}`}
            sourceLabel="VNIBB cash-flow statements"
            align="right"
          />
        </div>

        <div className="flex-1 overflow-auto pt-1">
          {timedOut && isLoading && !hasData ? (
            <WidgetError
              title="Loading timed out"
              error={new Error('Cash flow waterfall took too long to load.')}
              onRetry={() => {
                resetTimeout();
                refetch();
              }}
            />
          ) : isLoading && !hasData ? (
            <WidgetSkeleton lines={6} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !model ? (
            <WidgetEmpty
              message={unavailableNote ? `Cash bridge unavailable for ${symbol}` : `No cash bridge available for ${symbol}`}
              detail={unavailableNote ?? 'A waterfall requires reported operating, investing, financing, and net cash-change fields for one period; missing lines are not inferred.'}
              icon={<ChartNoAxesColumnIncreasing size={18} />}
            />
          ) : (
            <CashFlowWaterfallChart
              model={model}
              formatValue={(value) => formatRawValuePlain(value, scale, unitConfig, model.period)}
            />
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const CashflowWaterfallWidget = memo(CashflowWaterfallWidgetComponent);
export default CashflowWaterfallWidget;
