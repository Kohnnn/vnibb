'use client';

import { Newspaper, BadgeDollarSign } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useCompanyNews, useDividends, useInsiderDeals } from '@/lib/queries';
import { formatRelativeTime } from '@/lib/format';
import { formatNumber, formatVND } from '@/lib/formatters';

interface NewsCorporateActionsWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

export function NewsCorporateActionsWidget({ id, symbol, onRemove }: NewsCorporateActionsWidgetProps) {
  const {
    data: newsData,
    isLoading: newsLoading,
    error: newsError,
    refetch: refetchNews,
    isFetching: newsFetching,
    dataUpdatedAt: newsUpdatedAt,
  } = useCompanyNews(symbol, { limit: 6, enabled: Boolean(symbol) });

  const {
    data: dividendData,
    isLoading: dividendsLoading,
    error: dividendsError,
    refetch: refetchDividends,
    isFetching: dividendsFetching,
    dataUpdatedAt: dividendsUpdatedAt,
  } = useDividends(symbol, Boolean(symbol));

  const {
    data: insiderData,
    isLoading: insiderLoading,
    error: insiderError,
    refetch: refetchInsider,
    isFetching: insiderFetching,
    dataUpdatedAt: insiderUpdatedAt,
  } = useInsiderDeals(symbol, { limit: 6, enabled: Boolean(symbol) });

  const news = newsData?.data ?? [];
  const dividends = dividendData?.data ?? [];
  const insiderDeals = insiderData ?? [];

  const hasNews = news.length > 0;
  const hasActions = dividends.length > 0 || insiderDeals.length > 0;
  const hasData = hasNews || hasActions;

  const isLoading = newsLoading || dividendsLoading || insiderLoading;
  const isFetching = newsFetching || dividendsFetching || insiderFetching;
  const error = newsError || dividendsError || insiderError;

  const updatedAt = [newsUpdatedAt, dividendsUpdatedAt, insiderUpdatedAt]
    .filter(Boolean)
    .sort((a, b) => Number(b) - Number(a))[0];

  if (!symbol) {
    return <WidgetEmpty message="Select a symbol to view news and actions" />;
  }

  return (
    <WidgetContainer
      title="News + Corporate Actions"
      symbol={symbol}
      onRefresh={() => {
        refetchNews();
        refetchDividends();
        refetchInsider();
      }}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
      widgetId={id}
    >
      <div aria-label="News and corporate actions" className="h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="px-3 py-2 border-b border-gray-800/60">
          <WidgetMeta
            updatedAt={updatedAt}
            isFetching={isFetching && hasData}
            isCached={Boolean(error && hasData)}
            note="Company news + actions"
            align="right"
          />
        </div>

        {isLoading && !hasData ? (
          <div className="p-3">
            <WidgetSkeleton lines={6} />
          </div>
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => refetchNews()} />
        ) : !hasData ? (
          <WidgetEmpty message="No news or corporate actions available" icon={<Newspaper size={18} />} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-gray-800/60 flex-1">
            <section className="p-3 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Newspaper size={14} className="text-blue-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Company News</span>
                </div>
                <span className="text-[10px] text-gray-500">{news.length} items</span>
              </div>

              {newsLoading && !hasNews ? (
                <WidgetSkeleton lines={4} />
              ) : newsError && !hasNews ? (
                <WidgetError error={newsError as Error} onRetry={() => refetchNews()} />
              ) : !hasNews ? (
                <div className="text-xs text-gray-500">No news available yet.</div>
              ) : (
                <div className="space-y-2">
                  {news.map((item, idx) => (
                    <a
                      key={`${item.title}-${idx}`}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg border border-gray-800/60 bg-black/20 px-3 py-2 hover:bg-white/5 transition-colors"
                    >
                      <div className="text-xs font-semibold text-gray-200 line-clamp-2">{item.title}</div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-500">
                        {item.source && <span>{item.source}</span>}
                        {item.published_at && <span>• {formatRelativeTime(item.published_at)}</span>}
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </section>

            <section className="p-3 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BadgeDollarSign size={14} className="text-emerald-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Corporate Actions</span>
                </div>
                <span className="text-[10px] text-gray-500">{dividends.length + insiderDeals.length} items</span>
              </div>

              {dividendsLoading && insiderLoading && !hasActions ? (
                <WidgetSkeleton lines={4} />
              ) : dividendsError && insiderError && !hasActions ? (
                <WidgetError error={(dividendsError || insiderError) as Error} onRetry={() => refetchDividends()} />
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Dividends</div>
                    {dividends.length === 0 ? (
                      <div className="text-xs text-gray-500">No dividends available yet.</div>
                    ) : (
                      <div className="space-y-2">
                        {dividends.slice(0, 4).map((dividend, idx) => (
                          <div
                            key={`${dividend.ex_date}-${idx}`}
                            className="flex items-center justify-between rounded-lg border border-gray-800/60 bg-black/20 px-3 py-2"
                          >
                            <div className="space-y-1">
                              <div className="text-xs font-semibold text-gray-200">
                                {formatVND(dividend.value)}
                              </div>
                              <div className="text-[10px] text-gray-500">
                                {dividend.dividend_type || 'Dividend'}
                                {dividend.ex_date ? ` • Ex ${formatRelativeTime(dividend.ex_date)}` : ''}
                              </div>
                            </div>
                            {dividend.payment_date && (
                              <div className="text-[10px] text-gray-500">Pay {formatRelativeTime(dividend.payment_date)}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Insider Deals</div>
                    {insiderDeals.length === 0 ? (
                      <div className="text-xs text-gray-500">No insider deals available yet.</div>
                    ) : (
                      <div className="space-y-2">
                        {insiderDeals.slice(0, 4).map((deal) => {
                          const action = deal.deal_action?.toUpperCase() || 'DEAL';
                          const isBuy = action.includes('BUY');
                          return (
                            <div
                              key={deal.id}
                              className="flex items-center justify-between rounded-lg border border-gray-800/60 bg-black/20 px-3 py-2"
                            >
                              <div>
                                <div className="text-xs font-semibold text-gray-200">
                                  {deal.insider_name || 'Insider'}
                                </div>
                                <div className="text-[10px] text-gray-500">
                                  {deal.insider_position || '—'}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className={`text-[10px] font-bold ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
                                  {action}
                                </div>
                                <div className="text-[10px] text-gray-500">
                                  {formatNumber(deal.deal_quantity)} @ {formatVND(deal.deal_price)}
                                </div>
                                <div className="text-[10px] text-gray-500">{formatRelativeTime(deal.announce_date)}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </WidgetContainer>
  );
}

export default NewsCorporateActionsWidget;
