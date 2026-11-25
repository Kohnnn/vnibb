'use client';

import { useEffect, useMemo, useState } from 'react';
import { Newspaper, BadgeDollarSign, BookMarked } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useCompanyNews, useDividends, useInsiderDeals } from '@/lib/queries';
import { formatTimestamp } from '@/lib/formatDate';
import { formatDividendPayout, formatNumber, formatVND } from '@/lib/formatters';
import type { DividendRecord } from '@/lib/api';
import { normalizeInsiderAction } from '@/lib/insiderActions';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { addNotebookItem } from '@/lib/researchNotebook';
import { newsItemObservation, newsObservationProvenance } from '@/lib/newsTime';
import { hasNewsAssociationEvidence } from '@/lib/newsAssociation';
import { getSentimentProvenance } from '@/components/widgets/news/NewsCard';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { EMPTY_VALUE } from '@/lib/units';
import {
  admittedDividendRows,
  dividendActionText,
  dividendCoverageBasis,
  dividendDistributionExport,
  dividendExport,
  dividendRowLabel,
  dividendSourceLink,
  readDividendCoverage,
} from '@/lib/dividendHistory';
import { DividendCoverageNotice } from './DividendCoverageNotice';

const DIVIDEND_PREVIEW_LIMIT = 4;

interface NewsCorporateActionsWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
}

function getSentimentClasses(sentiment: string | null | undefined): string {
  const normalized = String(sentiment || 'neutral').toLowerCase();
  if (normalized === 'bullish' || normalized === 'positive') {
    return 'border-[var(--color-state-border)] bg-[var(--color-positive-bg)] text-[var(--color-positive)]';
  }
  if (normalized === 'bearish' || normalized === 'negative') {
    return 'border-[var(--color-state-border)] bg-[var(--color-negative-bg)] text-[var(--color-negative)]';
  }
  return 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-muted)]';
}

/** #250: only direct-company/verified-peer rows carry a ranking number. */
function supportsRank(item: {
  association_class?: string | null;
  relevance_score?: number | null;
}): boolean {
  return (
    (item.association_class === 'direct_company' || item.association_class === 'verified_peer') &&
    typeof item.relevance_score === 'number' &&
    item.relevance_score > 0
  );
}

export function NewsCorporateActionsWidget({ id, symbol, onRemove, onDataChange }: NewsCorporateActionsWidgetProps) {
  const [pinned, setPinned] = useState<Record<string, boolean>>({});
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

  const news = useMemo(() => (newsData?.data ?? []).filter(item => hasNewsAssociationEvidence(item, false)), [newsData?.data]);
  const dividendCoverage = readDividendCoverage(dividendData);
  const dividends = admittedDividendRows(dividendData);
  const dividendFailure = dividendsError?.message || dividendData?.error;
  const insiderDeals = insiderData ?? [];

  const hasNews = news.length > 0;
  const hasActions = dividends.length > 0 || insiderDeals.length > 0;

  const pinNews = (item: typeof news[number], key: string) => {
    if (!item.url || !item.source) return;
    addNotebookItem({
      kind: 'news',
      title: item.title,
      body: item.summary || item.ai_summary || undefined,
      symbol,
      sources: [{ label: item.source, sourceName: item.source, url: item.url, publishedAt: item.published_at || item.published_date || undefined }],
      dedupeKey: `company-news:${symbol}:${item.url}`,
      provenance: { sourceLabel: item.source, apiGroup: '/equity', endpoint: `/api/v1/equity/${symbol}/news` },
    });
    setPinned((previous) => ({ ...previous, [key]: true }));
  };

  const pinDividend = (dividend: DividendRecord, key: string) => {
    const url = dividendSourceLink(dividend);
    if (!url || !dividend.source) return;
    addNotebookItem({
      kind: 'news',
      title: `Dividend ${symbol} — ${formatDividendPayout(dividend)}`,
      body: [dividendRowLabel(dividend), ...dividendActionText(dividend), dividend.description].filter(Boolean).join('\n'),
      symbol,
      sources: [{ label: dividend.source, sourceName: dividend.source, url, publishedAt: dividend.published_at || undefined }],
      dedupeKey: `company-dividend:${symbol}:${url}:${dividend.source_event_id ?? dividend.observation_id ?? ''}`,
      provenance: { sourceLabel: dividend.source, apiGroup: '/equity', endpoint: `/api/v1/equity/${symbol}/dividends` },
    });
    setPinned((previous) => ({ ...previous, [key]: true }));
  };
  const hasData = hasNews || hasActions;

  const isLoading = newsLoading || dividendsLoading || insiderLoading;
  const isFetching = newsFetching || dividendsFetching || insiderFetching;
  const error = newsError?.message || dividendFailure || insiderError?.message;
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 });
  // Source observation only: the newest genuine company-news publication date.
  // Query receipt times and corporate-action event dates (which may be future
  // calendar dates) are not observations of what the source published.
  const observation = useMemo(
    () => newsObservationProvenance(news, { receiptAt: newsUpdatedAt }),
    [news, newsUpdatedAt],
  );
  const fetchedAt = [newsUpdatedAt, dividendsUpdatedAt, insiderUpdatedAt]
    .filter(Boolean)
    .sort((a, b) => Number(b) - Number(a))[0];
  const recentNewsCount = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return news.filter((item) => {
      const parsed = newsItemObservation(item);
      return parsed !== null && new Date(parsed).getTime() >= cutoff;
    }).length;
  }, [news]);

  useEffect(() => {
    onDataChange?.(
      buildWidgetRuntime({
        empty: !hasData,
        compactHeight: 4,
        apiGroup: '/equity',
        endpoint: `/equity/${symbol}/news`,
        sourceLabel: 'Company news + actions',
        lastDataDate: observation.lastDataDate,
        fetchedAt,
        coverage: observation.coverage,
        basis: dividendCoverageBasis(dividendCoverage),
        exportData: dividendExport(dividendCoverage, dividends.slice(0, DIVIDEND_PREVIEW_LIMIT).map(dividendDistributionExport)),
        cached: Boolean(error && hasData),
        stale: Boolean(error && hasData),
        warnings: observation.warning ? [observation.warning] : undefined,
        extra: { recentNewsCount, dividends: dividends.length, insiderDeals: insiderDeals.length },
      }),
    );
  }, [
    hasData,
    onDataChange,
    observation.lastDataDate,
    observation.coverage,
    observation.warning,
    fetchedAt,
    error,
    symbol,
    recentNewsCount,
    dividendCoverage,
    dividends,
    insiderDeals.length,
  ]);

  const handleRefresh = () => {
    refetchNews();
    refetchDividends();
    refetchInsider();
  };

  if (!symbol) {
    return <WidgetEmpty message="Select a symbol to view news and actions" />;
  }

  return (
    <WidgetContainer
      title="News + Corporate Actions"
      symbol={symbol}
      onRefresh={handleRefresh}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
      widgetId={id}
    >
      <div aria-label="News and corporate actions" className="h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="px-3 py-2 border-b border-[var(--border-color)]">
          <WidgetMeta
            updatedAt={observation.lastDataDate}
            fetchedAt={fetchedAt}
            isFetching={isFetching && hasData}
            isCached={Boolean(error && hasData)}
            note="Company news + actions"
            align="right"
          />
        </div>
        {!isLoading && !hasData && (
          <div className="px-3 py-2"><DividendCoverageNotice coverage={dividendCoverage} failed={Boolean(dividendFailure)} /></div>
        )}

        {timedOut && isLoading && !hasData ? (
          <WidgetError
            title="Loading timed out"
            error={new Error('News and corporate actions took too long to load.')}
            onRetry={() => {
              resetTimeout();
              handleRefresh();
            }}
          />
        ) : isLoading && !hasData ? (
          <div className="p-3">
            <WidgetSkeleton lines={6} />
          </div>
        ) : error && !hasData ? (
          <WidgetError error={new Error(error)} onRetry={handleRefresh} />
        ) : !hasData ? (
          <WidgetEmpty message="No news or corporate actions available" icon={<Newspaper size={18} />} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-color)] flex-1">
            <section className="p-3 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Newspaper size={14} className="text-[var(--color-accent-primary)]" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Company News</span>
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">{recentNewsCount}/{news.length} in 7d</span>
              </div>
              {newsError && hasNews && (
                <div role="alert" className="text-xs text-[var(--text-muted)]">
                  Company news unavailable. Showing previously loaded news.{' '}
                  <button type="button" onClick={() => refetchNews()}>Retry news</button>
                </div>
              )}

              {newsLoading && !hasNews ? (
                <WidgetSkeleton lines={4} />
              ) : newsError && !hasNews ? (
                <WidgetError error={newsError as Error} onRetry={() => refetchNews()} />
              ) : !hasNews ? (
                <div className="text-xs text-[var(--text-muted)]">No news available yet.</div>
              ) : (
                <div className="space-y-2">
                  {news.map((item, idx) => {
                    const key = `news-${idx}`;
                    const canPin = Boolean(item.url && item.source);
                    const provenance = getSentimentProvenance(item.sentiment_source);
                    // #250: an absent or unavailable label keeps no direction word.
                    const showDirection =
                      Boolean(item.sentiment) && item.sentiment_source !== 'unavailable';
                    return (
                    <div
                      key={`${item.title}-${idx}`}
                      className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 transition-colors hover:bg-[var(--bg-hover)]"
                    >
                      <div className="flex items-start gap-2">
                        <a href={item.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 text-xs font-semibold text-[var(--text-primary)] line-clamp-2 hover:text-[var(--color-accent-primary)]">{item.title}</a>
                        {canPin && (
                          <button type="button" onClick={() => pinNews(item, key)} className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--color-state-bg)] hover:text-[var(--color-accent-primary)]" aria-label="Save news to Research Notebook" title="Save to Research Notebook">
                            <BookMarked size={13} fill={pinned[key] ? 'currentColor' : 'none'} />
                          </button>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span
                          role="note"
                          title={provenance.detail}
                          aria-label={
                            showDirection
                              ? `Article sentiment: ${item.sentiment} (${provenance.label}). ${provenance.detail}`
                              : `Article sentiment: ${provenance.label}. ${provenance.detail}`
                          }
                          className={`rounded border px-1.5 py-0.5 font-semibold ${showDirection ? 'uppercase' : 'normal-case'} ${getSentimentClasses(item.sentiment)}`}
                        >
                          {showDirection ? (
                            <>
                              {item.sentiment}
                              {typeof item.sentiment_score === 'number' ? ` ${Math.round(item.sentiment_score)}` : ''}
                              <span className="ml-1 font-normal lowercase opacity-80">{provenance.label}</span>
                            </>
                          ) : (
                            provenance.label
                          )}
                        </span>
                        {(item.match_reason || item.association_class) && (
                          <span
                            className="rounded border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-1.5 py-0.5 font-semibold uppercase text-[var(--color-accent-primary)]"
                            title={
                              supportsRank(item)
                                ? 'Rule-based ranking score, not a probability of company relevance.'
                                : 'Shared industry or unverified metadata only. No company evidence, so no relevance score is shown.'
                            }
                          >
                            {item.association_class === 'verified_sector'
                              ? 'industry overlap · no company evidence'
                              : item.match_reason?.replaceAll('_', ' ') || 'association unverified'}
                            {supportsRank(item)
                              ? ` · rank ${Math.round((item.relevance_score as number) * 100)}/100`
                              : ''}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                        {item.source && <span>{item.source}</span>}
                        <span>• {newsItemObservation(item) ? formatTimestamp(newsItemObservation(item)!) : 'Date unavailable'}</span>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="p-3 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BadgeDollarSign size={14} className="text-[var(--color-accent-primary)]" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Corporate Actions</span>
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">{Math.min(dividends.length, DIVIDEND_PREVIEW_LIMIT) + Math.min(insiderDeals.length, 4)} shown</span>
              </div>

              {dividendsLoading && insiderLoading && !hasActions ? (
                <WidgetSkeleton lines={4} />
              ) : dividendFailure && insiderError && !hasActions ? (
                <WidgetError error={new Error(dividendFailure)} onRetry={handleRefresh} />
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Dividends</div>
                    {(!dividendsLoading || dividendCoverage) && (
                      <DividendCoverageNotice coverage={dividendCoverage} failed={Boolean(dividendFailure)} />
                    )}
                    {dividendsLoading && dividends.length === 0 ? (
                      <WidgetSkeleton lines={2} />
                    ) : dividends.length === 0 ? (
                      <div className="text-xs text-[var(--text-muted)]">No qualified dividend observations shown.</div>
                    ) : (
                      <div className="space-y-2">
                        {dividends.slice(0, DIVIDEND_PREVIEW_LIMIT).map((dividend, idx) => {
                          const key = `dividend-${symbol}-${dividend.dataset}-${dividend.observation_id ?? idx}`;
                          const canPin = Boolean(dividendSourceLink(dividend));
                          return (
                          <div
                            key={key}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2"
                          >
                            <div className="space-y-1">
                              <div className="text-xs font-semibold text-[var(--text-primary)]">
                                {formatDividendPayout(dividend)}
                              </div>
                              <div className="text-[10px] text-[var(--text-muted)]">
                                {dividendRowLabel(dividend)}
                              </div>
                              <div className="text-[10px] text-[var(--text-muted)]">{dividendActionText(dividend).join(' · ')}</div>
                            </div>
                            <div className="flex items-center gap-1">
                              {canPin && (
                                <button type="button" onClick={() => pinDividend(dividend, key)} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--color-state-bg)] hover:text-[var(--color-accent-primary)]" aria-label="Save corporate action to Research Notebook" title="Save to Research Notebook">
                                  <BookMarked size={13} fill={pinned[key] ? 'currentColor' : 'none'} />
                                </button>
                              )}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Insider Deals</div>
                    {insiderDeals.length === 0 ? (
                      <div className="text-xs text-[var(--text-muted)]">No insider deals available yet.</div>
                    ) : (
                      <div className="space-y-2">
                        {insiderDeals.slice(0, 4).map((deal) => {
                          const actionToken = normalizeInsiderAction(deal.deal_action);
                          const actionLabel = actionToken ?? 'UNKNOWN';
                          const actionClass = actionToken === 'BUY' ? 'text-[var(--color-positive)]'
                            : actionToken === 'SELL' ? 'text-[var(--color-negative)]' : 'text-[var(--text-muted)]';
                          const priceText = deal.price_unit === 'VND' ? formatVND(deal.deal_price) : EMPTY_VALUE;
                          return (
                            <div
                              key={deal.id}
                              className="flex items-center justify-between rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2"
                            >
                              <div>
                                <div className="text-xs font-semibold text-[var(--text-primary)]">
                                  {deal.insider_name || 'Insider'}
                                </div>
                                <div className="text-[10px] text-[var(--text-muted)]">
                                  {deal.insider_position || EMPTY_VALUE}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className={`text-[10px] font-bold ${actionClass}`}>
                                  {actionLabel}
                                </div>
                                <div className="text-[10px] text-[var(--text-muted)]">
                                  {formatNumber(deal.deal_quantity)} @ {priceText}
                                </div>
                                <div className="text-[10px] text-[var(--text-muted)]">{formatTimestamp(deal.announce_date)}</div>
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
