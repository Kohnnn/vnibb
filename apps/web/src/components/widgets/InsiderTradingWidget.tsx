// Insider Trading Widget - Recent insider buy/sell transactions

'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getInsiderDeals, getInsiderSentiment } from '@/lib/api';
import { DEFAULT_TICKER } from '@/lib/defaultTicker';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { formatShortDate } from '@/lib/format';
import { normalizeInsiderAction } from '@/lib/insiderActions';

interface InsiderTradingWidgetProps {
  id?: string;
  symbol?: string;
  isEditing?: boolean;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
}

// #109: the footer printed "Net: +-" because the sign prefix was decided from
// `net_value >= 0` while this formatter rendered every falsy value as '-'.
// Unavailable is now an em dash, zero is a real zero, and negatives keep the
// sign inside the formatted amount instead of collapsing into "VND-…".
function formatCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9) return `${sign}VND${(magnitude / 1e9).toFixed(1)}bn`;
  if (magnitude >= 1e6) return `${sign}VND${(magnitude / 1e6).toFixed(1)}mn`;
  if (magnitude >= 1e3) return `${sign}VND${(magnitude / 1e3).toFixed(1)}k`;
  return `${sign}VND${magnitude}`;
}

// Admitted money is canonical VND only when the provider supplied unit
// evidence; anything else renders unavailable instead of assuming VND.
function formatAdmittedMoney(value: number | null | undefined, unit: string | null | undefined): string {
  if (unit !== 'VND') return '—';
  return formatCurrency(value);
}

function formatDate(dateStr: string): string {
  return formatShortDate(dateStr);
}

function getSentimentColor(score: number): string {
  if (score > 30) return 'text-green-400';
  if (score < -30) return 'text-red-400';
  return 'text-[var(--text-secondary)]';
}

function getSentimentLabel(score: number): string {
  if (score > 50) return 'Very Bullish';
  if (score > 30) return 'Bullish';
  if (score > 10) return 'Slightly Bullish';
  if (score > -10) return 'Neutral';
  if (score > -30) return 'Slightly Bearish';
  if (score > -50) return 'Bearish';
  return 'Very Bearish';
}

export function InsiderTradingWidget({ symbol = DEFAULT_TICKER, onDataChange }: InsiderTradingWidgetProps) {
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell'>('all');

  const {
    data: dealsData,
    isLoading: dealsLoading,
    error: dealsError,
    refetch: refetchDeals,
    isFetching: dealsFetching,
    dataUpdatedAt: dealsUpdatedAt,
  } = useQuery({
    queryKey: ['insider-deals', symbol],
    queryFn: () => getInsiderDeals(symbol, { limit: 20 }),
    enabled: !!symbol,
  });

  const {
    data: sentimentData,
    isLoading: sentimentLoading,
    error: sentimentError,
    refetch: refetchSentiment,
    isFetching: sentimentFetching,
  } = useQuery({
    queryKey: ['insider-sentiment', symbol],
    queryFn: () => getInsiderSentiment(symbol, 90),
    enabled: !!symbol,
  });

  const deals = dealsData || [];
  const sentiment = sentimentData;

  const filteredDeals = deals.filter((deal) => {
    if (filter === 'all') return true;
    const action = normalizeInsiderAction(deal.deal_action);
    if (filter === 'buy') return action === 'BUY';
    if (filter === 'sell') return action === 'SELL';
    return true;
  });

  const isLoading = dealsLoading || sentimentLoading;
  const error = dealsError || sentimentError;
  const isFetching = dealsFetching || sentimentFetching;
  const hasData = deals.length > 0;
  const isFallback = Boolean(error && hasData);
  // The backend aggregates the requested 90-day window itself: money fields are
  // canonical VND only when every classified deal in that window carried finite
  // value plus VND evidence, and it reports that admission through
  // `value_unit`. The separate undated 20-row deals list never certifies this
  // window, so it is deliberately not read here. A missing `value_unit` (older
  // deployments) withholds instead of guessing a denomination.
  const sentimentAdmitted = sentiment
    ? sentiment.value_unit === 'VND' &&
      sentiment.buy_value != null &&
      Number.isFinite(sentiment.buy_value) &&
      sentiment.sell_value != null &&
      Number.isFinite(sentiment.sell_value) &&
      sentiment.net_value != null &&
      Number.isFinite(sentiment.net_value)
    : false;
  // The score is derived from that same aggregate, so it ships null whenever
  // money is withheld; mirror the withholding rather than render an unbacked score.
  const rawScore = sentiment?.sentiment_score;
  const admittedScore =
    sentimentAdmitted && rawScore != null && Number.isFinite(rawScore) ? rawScore : null;
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 })

  // Source observation = latest disclosed transaction date; ignore scheduled future dates.
  const lastDataDate = deals.reduce<string | null>((latest, deal) => {
    const observedAt = new Date(deal.announce_date).getTime();
    if (!Number.isFinite(observedAt) || observedAt > Date.now()) return latest;
    return latest === null || observedAt > new Date(latest).getTime() ? deal.announce_date : latest;
  }, null);

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: {
          empty: filteredDeals.length === 0,
          compactHeight: 3,
        },
        provenance: {
          updatedAt: lastDataDate,
          fetchedAt: dealsUpdatedAt,
        },
      },
    })
  }, [filteredDeals.length, lastDataDate, dealsUpdatedAt, onDataChange])

  return (
    <div className="h-full flex flex-col">
      {/* Header with Sentiment */}
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2">
          {sentiment && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-[var(--text-muted)]">Sentiment:</span>
              <span className={`font-medium ${admittedScore != null ? getSentimentColor(admittedScore) : 'text-[var(--text-muted)]'}`}>
                {admittedScore == null ? '—' : `${admittedScore > 0 ? '+' : ''}${admittedScore.toFixed(0)}`}
              </span>
              <span className={`text-[10px] ${admittedScore != null ? getSentimentColor(admittedScore) : 'text-[var(--text-muted)]'}`}>
                ({admittedScore == null ? 'Unavailable' : getSentimentLabel(admittedScore)})
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <WidgetMeta
            updatedAt={lastDataDate}
            fetchedAt={dealsUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note="90d sentiment"
            align="right"
          />
          <button
            onClick={() => {
              refetchDeals();
              refetchSentiment();
            }}
            disabled={isFetching}
            className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 mb-2 px-1">
        <button
          onClick={() => setFilter('all')}
          className={`flex-1 px-2 py-1 text-[10px] rounded transition-colors ${
            filter === 'all'
              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('buy')}
          className={`flex-1 px-2 py-1 text-[10px] rounded transition-colors ${
            filter === 'buy'
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setFilter('sell')}
          className={`flex-1 px-2 py-1 text-[10px] rounded transition-colors ${
            filter === 'sell'
              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          Sell
        </button>
      </div>

      {/* Deals List */}
      <div className="flex-1 overflow-y-auto">
        {timedOut && isLoading && !hasData ? (
          <WidgetError error={new Error('Insider activity took too long to load.')} title="Loading timed out" onRetry={() => {
            resetTimeout()
            refetchDeals()
            refetchSentiment()
          }} />
        ) : isLoading && !hasData ? (
          <WidgetSkeleton lines={5} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => refetchDeals()} />
        ) : filteredDeals.length === 0 ? (
          <WidgetEmpty
            message={
              filter === 'all'
                ? 'No insider disclosures returned'
                : `No ${filter === 'buy' ? 'buy' : 'sell'} disclosures in the returned filings`
            }
            detail={
              filter === 'all'
                ? 'This panel lists the most recent official insider transactions filed with HOSE/HNX; the deals feed is not date-filtered, unlike the separate 90-day sentiment summary. Empty state means no disclosures were returned — not the same as "insiders never trade".'
                : 'Try the All filter to see every returned disclosure.'
            }
            icon={<AlertCircle size={18} />}
            size="compact"
          />
        ) : (
          <div className="space-y-1.5">
            {filteredDeals.map((deal) => {
              const action = normalizeInsiderAction(deal.deal_action);
              const isBuy = action === 'BUY';
              const isSell = action === 'SELL';
              const ActionIcon = isBuy ? TrendingUp : isSell ? TrendingDown : AlertCircle;
              const actionColor = isBuy ? 'text-green-400' : isSell ? 'text-red-400' : 'text-[var(--text-muted)]';
              const actionLabel = isBuy ? 'BUY' : isSell ? 'SELL' : 'UNKNOWN';

              return (
                <div
                  key={deal.id}
                  className="rounded bg-[var(--bg-secondary)] p-2 transition-colors hover:bg-[var(--bg-tertiary)]"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <ActionIcon size={12} className={actionColor} />
                      <span className="break-words whitespace-normal text-xs text-[var(--text-primary)]" title={deal.insider_name || 'Unknown'}>
                        {deal.insider_name || 'Unknown'}
                      </span>
                      <span className={`text-[10px] font-semibold uppercase ${actionColor}`}>{actionLabel}</span>
                    </div>
                    <span className={`text-xs font-medium ${actionColor}`}>
                      {formatAdmittedMoney(deal.deal_value, deal.value_unit)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                    <span className="break-words whitespace-normal" title={deal.insider_position || ''}>
                      {deal.insider_position || 'N/A'}
                    </span>
                    <span>{formatDate(deal.announce_date)}</span>
                  </div>
                  {deal.deal_quantity ? (
                    <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                      {deal.deal_quantity.toLocaleString()} shares @ {formatAdmittedMoney(deal.deal_price, deal.price_unit)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Summary Footer */}
      {sentiment && !isLoading && (
        <div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">Buy:</span>
              <span className={sentimentAdmitted ? 'text-green-400 font-medium' : 'text-[var(--text-muted)] font-medium'}>
                {sentimentAdmitted ? formatCurrency(sentiment.buy_value) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">Sell:</span>
              <span className={sentimentAdmitted ? 'text-red-400 font-medium' : 'text-[var(--text-muted)] font-medium'}>
                {sentimentAdmitted ? formatCurrency(sentiment.sell_value) : '—'}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[var(--text-muted)]">Net:</span>
            <span className={`font-medium ${
              !sentimentAdmitted || sentiment.net_value == null
                ? 'text-[var(--text-muted)]'
                : sentiment.net_value >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {sentimentAdmitted && sentiment.net_value != null && sentiment.net_value > 0 ? '+' : ''}
              {sentimentAdmitted ? formatCurrency(sentiment.net_value) : '—'}
            </span>
          </div>
          <div className="mt-1 text-[10px] text-[var(--text-muted)]">
            {sentimentAdmitted
              ? `Buy ${sentiment.buy_count} · Sell ${sentiment.sell_count} · ${sentiment.total_deals} deals reported in ${sentiment.period_days}d window.`
              : `Money withheld: this ${sentiment.period_days}d window is not fully VND-admitted. Buy ${sentiment.buy_count} · Sell ${sentiment.sell_count} · ${sentiment.total_deals} deals reported.`}
          </div>
        </div>
      )}
    </div>
  );
}
