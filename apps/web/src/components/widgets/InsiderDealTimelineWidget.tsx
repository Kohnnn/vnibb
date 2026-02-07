'use client';

import { useMemo } from 'react';
import { UserRound } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useInsiderDeals } from '@/lib/queries';
import { formatRelativeTime } from '@/lib/format';
import { formatNumber, formatVND } from '@/lib/formatters';

interface InsiderDealTimelineWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

export function InsiderDealTimelineWidget({ id, symbol, onRemove }: InsiderDealTimelineWidgetProps) {
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

  const summary = useMemo(() => {
    const buys = deals.filter((deal) => deal.deal_action?.toUpperCase().includes('BUY'));
    const sells = deals.filter((deal) => deal.deal_action?.toUpperCase().includes('SELL'));
    const buyValue = buys.reduce((sum, deal) => sum + (deal.deal_value ?? 0), 0);
    const sellValue = sells.reduce((sum, deal) => sum + (deal.deal_value ?? 0), 0);
    return {
      buyCount: buys.length,
      sellCount: sells.length,
      buyValue,
      sellValue,
      netValue: buyValue - sellValue,
    };
  }, [deals]);

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
      <div className="h-full flex flex-col bg-[#0a0a0a]">
        <div className="px-3 py-2 border-b border-gray-800/60">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
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
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-gray-800/60 bg-black/20 p-3">
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest">Buys</div>
                  <div className="text-xs font-semibold text-emerald-400">{summary.buyCount}</div>
                  <div className="text-[10px] text-gray-500">{formatVND(summary.buyValue)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest">Sells</div>
                  <div className="text-xs font-semibold text-red-400">{summary.sellCount}</div>
                  <div className="text-[10px] text-gray-500">{formatVND(summary.sellValue)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest">Net</div>
                  <div className={`text-xs font-semibold ${summary.netValue >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {summary.netValue >= 0 ? '+' : '-'}{formatVND(Math.abs(summary.netValue))}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {deals.slice(0, 8).map((deal) => {
                  const action = deal.deal_action?.toUpperCase() || 'DEAL';
                  const isBuy = action.includes('BUY');
                  const value = deal.deal_value ?? (deal.deal_price ?? 0) * (deal.deal_quantity ?? 0);
                  return (
                    <div
                      key={deal.id}
                      className="flex items-center justify-between rounded-lg border border-gray-800/60 bg-black/20 px-3 py-2"
                    >
                      <div>
                        <div className="text-xs font-semibold text-gray-200">
                          {deal.insider_name || 'Insider'}
                        </div>
                        <div className="text-[10px] text-gray-500">{deal.insider_position || '—'}</div>
                        <div className="text-[10px] text-gray-500">
                          {formatRelativeTime(deal.announce_date)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-[10px] font-bold ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
                          {action}
                        </div>
                        <div className="text-[10px] text-gray-500">
                          {formatNumber(deal.deal_quantity)} @ {formatVND(deal.deal_price)}
                        </div>
                        <div className="text-[10px] text-gray-500">{formatVND(value)}</div>
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
