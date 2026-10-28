'use client';

import { memo, useEffect, useMemo } from 'react';
import { GitBranchPlus } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { usePeriodState } from '@/hooks/usePeriodState';
import { useIncomeStatement } from '@/lib/queries';
import { canonicalPeriodRows, describeUnavailableStatementRows, formatFinancialPeriodLabel, isCanonicalQuarterPeriod, isUnavailableStatementRow, matchesFinancialQuarterSelection, periodSortKey, type FinancialPeriodMode } from '@/lib/financialPeriods';
import { convertFinancialValueForUnit, formatRawValuePlain, getUnitLegend, resolveUnitScale } from '@/lib/units';
import { useUnit } from '@/contexts/UnitContext';
import { buildIncomeSankeyModel } from '@/lib/financialVisualizations';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { IncomeSankeyChart } from '@/components/widgets/charts/IncomeSankeyChart';

interface IncomeSankeyWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
}

function IncomeSankeyWidgetComponent({ id, symbol, onRemove, onDataChange }: IncomeSankeyWidgetProps) {
  const { period, setPeriod } = usePeriodState({
    widgetId: id || 'income_sankey',
    defaultPeriod: 'FY',
  });
  const { config: unitConfig } = useUnit();
  const apiPeriod = period === 'FY' ? 'year' : period;
  const periodMode: FinancialPeriodMode = period === 'FY' ? 'year' : period === 'TTM' ? 'ttm' : 'quarter';

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useIncomeStatement(symbol, { period: apiPeriod });
  // Same canonicalisation as the statement tables: a period the provider repeats
  // with different values has no authoritative basis, so it is excluded rather
  // than letting the flow chart pick whichever row happened to sort last, and a
  // row with no fiscal identity cannot become the previous-period comparator
  // (issue #103).
  const { rows: canonicalItems, issues: periodIssues, invalidPeriodCount } = useMemo(
    () => canonicalPeriodRows(data?.data ||[]),
    [data?.data],
  );
  const orderedItems = useMemo(
    () => [...canonicalItems]
      .sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period)),
    [canonicalItems],
  );
  const selectedQuarter = period === 'Q1' || period === 'Q2' || period === 'Q3' || period === 'Q4' ? period : null;
  // The TTM branch returns a single TTM row today (financial_service
  // .build_ttm_statement_rows), and this filter guarantees TTM mode can never
  // chart a quarter row under a TTM header if a payload carries one (issue #101).
  const periodItems = useMemo(
    () => periodMode === 'quarter'
      ? orderedItems.filter((item) => isCanonicalQuarterPeriod(item.period) &&
        (period === 'Q' || (selectedQuarter !== null && matchesFinancialQuarterSelection(item.period, selectedQuarter))))
      : periodMode === 'ttm'
        ? orderedItems.filter((item) => String(item.period ?? '').toUpperCase().includes('TTM'))
        : orderedItems,
    [orderedItems, periodMode, period, selectedQuarter],
  );
  // A row the API returned without certification carries every numeric field as
  // null plus `unavailable_reason`. Such a row cannot form a flow, so it is held
  // out of the model and disclosed in the note rather than charting as an
  // all-missing flow; a row that merely has some null fields is untouched
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
        `Unavailable: ${ambiguous.map((issue) => issue.period).join(', ')} returned conflicting rows with no basis field, so no flow is shown for ${ambiguous.length === 1 ? 'it' : 'them'}.`,
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

  // The Sankey model is built from raw statement rows, so the scale is resolved
  // from the converted values and each model value is converted exactly once at
  // format time. Resolving the scale from raw VND while the config says USD
  // divided one quantity by two different rates (issue #100).
  const scale = useMemo(
    () => resolveUnitScale(
      displayItems.flatMap((item) => [
        item.revenue,
        item.cost_of_revenue,
        item.gross_profit,
        item.operating_income,
        item.net_income,
      ].map((value) => convertFinancialValueForUnit(value, unitConfig, item.period))),
      unitConfig,
    ),
    [displayItems, unitConfig],
  );
  const model = useMemo(() => buildIncomeSankeyModel(displayItems), [displayItems]);
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 10000 });

  useEffect(() => {
    onDataChange?.(
      buildWidgetRuntime({
        empty: !model,
        apiGroup: '/equity',
        endpoint: `/equity/${symbol}/income-statement?period=${apiPeriod}`,
        sourceLabel: 'Income flow',
        lastDataDate: null,
        fetchedAt: dataUpdatedAt,
        stale: Boolean(error && hasData),
        extra: model ? { periods: displayItems.length } : undefined,
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
      title="Income Sankey"
      symbol={symbol}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
      widgetId={id}
      showLinkToggle
      headerActions={<div className="mr-1"><PeriodToggle value={period} onChange={setPeriod} compact /></div>}
      exportData={displayItems}
      exportFilename={`income_sankey_${symbol}_${period.toLowerCase()}`}
    >
      <div className="flex h-full flex-col px-2 py-1.5">
        <div className="border-b border-[var(--border-subtle)] pb-1">
          <WidgetMeta
            updatedAt={null}
            fetchedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={Boolean(error && hasData)}
            note={statementNote ?? `${latestLabel} • ${getUnitLegend(scale, unitConfig)}`}
            sourceLabel="Income flow"
            align="right"
          />
        </div>

        <div className="flex-1 overflow-auto pt-1">
          {timedOut && isLoading && !hasData ? (
            <WidgetError
              title="Loading timed out"
              error={new Error('Income Sankey took too long to load.')}
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
              message={unavailableNote ? `Income flow unavailable for ${symbol}` : `No flow visualization available for ${symbol}`}
              detail={unavailableNote ?? 'A positive revenue-to-net-income flow must be available for the selected period; losses cannot be shown as positive ribbons.'}
              icon={<GitBranchPlus size={18} />}
            />
          ) : (
            <IncomeSankeyChart
              model={model}
              formatValue={(value) => formatRawValuePlain(value, scale, unitConfig, model.period)}
            />
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const IncomeSankeyWidget = memo(IncomeSankeyWidgetComponent);
export default IncomeSankeyWidget;
