'use client';

import { memo, useMemo } from 'react';
import { ChartNoAxesColumnIncreasing } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { usePeriodState } from '@/hooks/usePeriodState';
import { useCashFlow } from '@/lib/queries';
import { formatFinancialPeriodLabel, isCanonicalQuarterPeriod, periodSortKey, type FinancialPeriodMode } from '@/lib/financialPeriods';
import { formatUnitValuePlain, getUnitLegend, resolveUnitScale } from '@/lib/units';
import { useUnit } from '@/contexts/UnitContext';
import { buildCashFlowWaterfallModel } from '@/lib/financialVisualizations';
import { CashFlowWaterfallChart } from '@/components/widgets/charts/CashFlowWaterfallChart';

interface CashflowWaterfallWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

function CashflowWaterfallWidgetComponent({ id, symbol, onRemove }: CashflowWaterfallWidgetProps) {
  const { period, setPeriod } = usePeriodState({
    widgetId: id || 'cashflow_waterfall',
    defaultPeriod: 'FY',
  });
  const { config: unitConfig } = useUnit();
  const apiPeriod = period === 'FY' ? 'year' : period;
  const periodMode: FinancialPeriodMode = period === 'FY' ? 'year' : period === 'TTM' ? 'ttm' : 'quarter';

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useCashFlow(symbol, { period: apiPeriod });
  const orderedItems = useMemo(
    () => [...(data?.data || [])].sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period)),
    [data?.data],
  );
  const displayItems = useMemo(
    () => periodMode === 'quarter'
      ? orderedItems.filter((item) => isCanonicalQuarterPeriod(item.period))
      : orderedItems,
    [orderedItems, periodMode],
  );
  const hasData = displayItems.length > 0;

  const scale = useMemo(
    () => resolveUnitScale(displayItems.flatMap((item) => [item.operating_cash_flow, item.investing_cash_flow, item.financing_cash_flow, item.net_change_in_cash, item.free_cash_flow]), unitConfig),
    [displayItems, unitConfig],
  );
  const model = useMemo(() => buildCashFlowWaterfallModel(displayItems), [displayItems]);
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 10000 });
  const latestLabel = model
    ? formatFinancialPeriodLabel(model.period, { mode: periodMode, index: displayItems.length - 1, total: displayItems.length })
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
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={Boolean(error && hasData)}
            note={`${latestLabel} • ${getUnitLegend(scale, unitConfig)}`}
            sourceLabel="Cash bridge"
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
              message={`No cash bridge available for ${symbol}`}
              detail="Operating, investing, financing, and net cash fields are required."
              icon={<ChartNoAxesColumnIncreasing size={18} />}
            />
          ) : (
            <CashFlowWaterfallChart
              model={model}
              formatValue={(value) => formatUnitValuePlain(value, scale, unitConfig)}
            />
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const CashflowWaterfallWidget = memo(CashflowWaterfallWidgetComponent);
export default CashflowWaterfallWidget;
