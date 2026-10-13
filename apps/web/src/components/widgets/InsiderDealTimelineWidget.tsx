'use client';

import { useEffect, useMemo } from 'react';
import { UserRound } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useInsiderDeals } from '@/lib/queries';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { formatTimestamp } from '@/lib/format';
import { formatNumber, formatVND } from '@/lib/formatters';
import { normalizeInsiderAction } from '@/lib/insiderActions';

interface InsiderDealTimelineWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
}

export function InsiderDealTimelineWidget({ id, symbol, onRemove, onDataChange }: InsiderDealTimelineWidgetProps) {
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useInsiderDeals(symbol, { limit: 20, enabled: Boolean(symbol) });

  const deals = data ?? [];
  const hasData = deals.length > 0;

  // Source observation = latest disclosed transaction date; ignore scheduled future dates.
  const lastDataDate = deals.reduce<string | null>((latest, deal) => {
    const observedAt = new Date(deal.announce_date).getTime();
    if (!Number.isFinite(observedAt) || observedAt > Date.now()) return latest;
    return latest === null || observedAt > new Date(latest).getTime() ? deal.announce_date : latest;
  }, null);

  const summary = useMemo(() => {
    const buys = deals.filter((deal) => normalizeInsiderAction(deal.deal_action) === 'BUY');
    const sells = deals.filter((deal) => normalizeInsiderAction(deal.deal_action) === 'SELL');
    const buyValue = buys.reduce((sum, deal) => sum + (deal.value_unit === 'VND' ? deal.deal_value ?? 0 : 0), 0);
    const sellValue = sells.reduce((sum, deal) => sum + (deal.value_unit === 'VND' ? deal.deal_value ?? 0 : 0), 0);
    return {
      buyCount: buys.length,
      sellCount: sells.length,
      buyValue,
      sellValue,
      netValue: buyValue - sellValue,
    };
  }, [deals]);

  useEffect(() => {
    onDataChange?.(buildWidgetRuntime({
      empty: !hasData,
      apiGroup: '/insider',
      endpoint: `/api/v1/insider/deals/${symbol}`,
      sourceLabel: 'Latest insider filings',
      lastDataDate,
      fetchedAt: dataUpdatedAt,
      stale: Boolean(error && hasData),
      extra: {
        dealCount: deals.length,
        netValue: summary.netValue,
      },
    }));
  }, [deals.length, error, hasData, lastDataDate, dataUpdatedAt, onDataChange, summary.netValue, symbol]);

  if (!symbol) {
    return <WidgetEmpty message="Select a symbol to view insider activity" />;
  }

  return (
    <WidgetContainer
      title="Insider Deal Timeline"
      symbol={symbol}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
      widgetId={id}
    >
      <div className="h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="px-3 py-2 border-b border-[var(--border-color)]">
          <WidgetMeta
            updatedAt={lastDataDate}
            fetchedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={Boolean(error && hasData)}
            note="Latest insider filings"
            align="right"
          />
        </div>

        <div className="p-3 space-y-3">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={5} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="No insider deals available yet" icon={<UserRound size={18} />} />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                <div>
                  <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">Buys</div>
                  <div className="text-xs font-semibold text-emerald-400">{summary.buyCount}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{formatVND(summary.buyValue)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">Sells</div>
                  <div className="text-xs font-semibold text-red-400">{summary.sellCount}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{formatVND(summary.sellValue)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">Net</div>
                  <div className={`text-xs font-semibold ${summary.netValue >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {summary.netValue >= 0 ? '+' : '-'}{formatVND(Math.abs(summary.netValue))}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {deals.slice(0, 8).map((deal) => {
                  const actionToken = normalizeInsiderAction(deal.deal_action);
                  const actionLabel = actionToken ?? 'UNKNOWN';
                  const actionClass = actionToken === 'BUY' ? 'text-emerald-400'
                    : actionToken === 'SELL' ? 'text-red-400' : 'text-[var(--text-muted)]';
                  const priceText = deal.price_unit === 'VND' ? formatVND(deal.deal_price) : '—';
                  const valueText = deal.value_unit === 'VND' ? formatVND(deal.deal_value) : '—';
                  return (
                    <div
                      key={deal.id}
                      className="flex items-center justify-between rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2"
                    >
                      <div>
                        <div className="text-xs font-semibold text-[var(--text-primary)]">
                          {deal.insider_name || 'Insider'}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">{deal.insider_position || '—'}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {formatTimestamp(deal.announce_date)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-[10px] font-bold ${actionClass}`}>
                          {actionLabel}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {formatNumber(deal.deal_quantity)} @ {priceText}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">{valueText}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export default InsiderDealTimelineWidget;
