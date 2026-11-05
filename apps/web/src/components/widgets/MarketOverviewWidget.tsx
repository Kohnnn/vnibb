'use client';

import { formatPercent, EMPTY_VALUE } from '@/lib/units';
import { useEffect } from 'react';
import { TrendingDown, TrendingUp, Activity } from 'lucide-react';
import { useMarketOverview } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { getLatestTimestampValue } from '@/lib/dataFreshness';
import { getMarketState } from '@/lib/marketHours';
import { priceDirection } from '@/lib/priceColor';

interface MarketOverviewWidgetProps {
  isEditing?: boolean;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
}

function formatValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  return formatPercent(value, { input: 'percent', decimals: 2, signed: value !== 0 });
}

/** `02 Nov 2026`. An index date is its own observation date, never the envelope. */
function formatIndexDate(value: string | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return EMPTY_VALUE;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function MarketOverviewWidget({ onRemove, onDataChange }: MarketOverviewWidgetProps) {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useMarketOverview();
  const indices = data?.data || [];
  const hasData = indices.length > 0;
  const isFallback = Boolean(error && hasData);
  const sourceUpdatedAt =
    getLatestTimestampValue(indices.map((item) => item.time)) ?? null;
  // QA-v4 M-1: When the data was published 2 days ago and we are
  // currently on a weekend (or pre-open before any trading session),
  // the staleness is canonical, not a defect. Use a softer label so
  // users don't think the indices are broken.
  const marketState = getMarketState();
  const sourceLabel = (() => {
    const baseLabel = data?.source?.includes('yahoo_finance') ? 'Yahoo fast path' : 'Indices snapshot';
    if (!sourceUpdatedAt) return baseLabel;
    const ageMs = Date.now() - new Date(sourceUpdatedAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    if (
      (marketState.phase === 'weekend' || marketState.phase === 'pre-open' || marketState.phase === 'after-close')
      && ageHours <= 96
    ) {
      return `${baseLabel} · last close`;
    }
    return baseLabel;
  })();

  useEffect(() => {
    onDataChange?.(
      buildWidgetRuntime({
        empty: !hasData,
        apiGroup: '/market',
        endpoint: '/market/indices',
        sourceLabel,
        lastDataDate: sourceUpdatedAt,
        fetchedAt: dataUpdatedAt,
        stale: isFallback,
        extra: hasData ? { indexCount: indices.length } : undefined,
      }),
    );
  }, [hasData, sourceUpdatedAt, dataUpdatedAt, isFallback, sourceLabel, indices.length, onDataChange]);

  return (
    <WidgetContainer
      title="Vietnam Markets"
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
    >
      <div aria-label="Market overview panel" className="h-full flex flex-col">
        <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]">
          <WidgetMeta
            updatedAt={sourceUpdatedAt}
            fetchedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note={sourceLabel}
            align="right"
          />
        </div>

        <div className="flex-1 overflow-auto p-3">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={4} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="Market data will appear when available." icon={<Activity size={20} />} />
          ) : (
            <div className="index-cards-grid">
              {indices.map((idx, i) => {
                const indexPayload = idx as unknown as Record<string, unknown>;
                const changePct = toFiniteNumber(idx.change_pct ?? indexPayload.changePct);
                const changeValue = toFiniteNumber(idx.change ?? indexPayload.changeValue);
                const currentValue = toFiniteNumber(idx.current_value ?? indexPayload.currentValue);
                const indexName =
                  (idx.index_name as string | undefined) ||
                  (indexPayload.indexName as string | undefined) ||
                  (indexPayload.index_code as string | undefined) ||
                  `Index ${i + 1}`;
                const reference = changePct ?? changeValue;
                // A measured flat session is ink and a missing change is
                // unavailable: `priceDirection` keeps those two apart instead
                // of painting both as `flat`.
                const direction = priceDirection(reference);

                return (
                  <div key={i} className={`index-card ${direction}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="index-card__name">{indexName}</span>
                      {direction === 'none' ? null : direction === 'flat' ? (
                        <Activity size={14} className="text-[var(--text-secondary)]" />
                      ) : direction === 'up' ? (
                        <TrendingUp size={14} className="text-[var(--color-positive)]" />
                      ) : (
                        <TrendingDown size={14} className="text-[var(--color-negative)]" />
                      )}
                    </div>

                    {/* The index level is a price, not a direction. */}
                    <div className="index-card__value text-[var(--text-primary)]">
                      {formatValue(currentValue)}
                    </div>

                    <div className={`index-card__change ${direction === 'up' ? 'data-value-up' : direction === 'down' ? 'data-value-down' : direction === 'flat' ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>
                      {formatValue(changeValue)} ({formatPct(changePct)})
                    </div>

                    <div className="flex items-center gap-2 mt-2 text-[9px] text-[var(--text-muted)]">
                      <span>Vol: {idx.volume?.toLocaleString() || EMPTY_VALUE}</span>
                      <span>H: {formatValue(idx.high)}</span>
                      <span>L: {formatValue(idx.low)}</span>
                      {/* #205: each index keeps its own source date. Sharing the
                          newest date across cards implied older observations
                          were current. */}
                      <span>As of: {formatIndexDate(idx.time)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export default MarketOverviewWidget;
