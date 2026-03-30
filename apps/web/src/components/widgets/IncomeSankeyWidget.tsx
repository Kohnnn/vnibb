'use client';

import { memo, useMemo } from 'react';
import { GitBranchPlus } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import { useIncomeStatement } from '@/lib/queries';
import { formatFinancialPeriodLabel, periodSortKey, type FinancialPeriodMode } from '@/lib/financialPeriods';
import { formatUnitValuePlain, getUnitLegend, resolveUnitScale } from '@/lib/units';
import { useUnit } from '@/contexts/UnitContext';
import { buildIncomeSankeyModel } from '@/lib/financialVisualizations';
import { IncomeSankeyChart } from '@/components/widgets/charts/IncomeSankeyChart';

interface IncomeSankeyWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

function IncomeSankeyWidgetComponent({ id, symbol, onRemove }: IncomeSankeyWidgetProps) {
  const { period, setPeriod } = usePeriodState({
    widgetId: id || 'income_sankey',
    defaultPeriod: 'FY',
  });
  const { config: unitConfig } = useUnit();
  const apiPeriod = period === 'FY' ? 'year' : period;
  const periodMode: FinancialPeriodMode = period === 'FY' ? 'year' : period === 'TTM' ? 'ttm' : 'quarter';

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useIncomeStatement(symbol, { period: apiPeriod });
  const orderedItems = useMemo(
    () => [...(data?.data || [])].sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period)),
    [data?.data],
  );
  const hasData = orderedItems.length > 0;

  const scale = useMemo(
    () => resolveUnitScale(orderedItems.flatMap((item) => [item.revenue, item.cost_of_revenue, item.gross_profit, item.operating_income, item.net_income]), unitConfig),
    [orderedItems, unitConfig],
  );
  const model = useMemo(() => buildIncomeSankeyModel(orderedItems), [orderedItems]);
  const latestLabel = model
    ? formatFinancialPeriodLabel(model.period, { mode: periodMode, index: orderedItems.length - 1, total: orderedItems.length })
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
      exportData={orderedItems}
      exportFilename={`income_sankey_${symbol}_${period.toLowerCase()}`}
    >
      <div className="flex h-full flex-col px-2 py-1.5">
        <div className="border-b border-[var(--border-subtle)] pb-1">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={Boolean(error && hasData)}
            note={`${latestLabel} • ${getUnitLegend(scale, unitConfig)}`}
            sourceLabel="Income flow"
            align="right"
          />
        </div>

        <div className="flex-1 overflow-auto pt-1">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={6} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !model ? (
            <WidgetEmpty
              message={`No flow visualization available for ${symbol}`}
              detail="Revenue and profit fields must be present for the selected period."
              icon={<GitBranchPlus size={18} />}
            />
          ) : (
            <IncomeSankeyChart
              model={model}
              formatValue={(value) => formatUnitValuePlain(value, scale, unitConfig)}
            />
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const IncomeSankeyWidget = memo(IncomeSankeyWidgetComponent);
export default IncomeSankeyWidget;
