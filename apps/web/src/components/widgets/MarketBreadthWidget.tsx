'use client';

import { useMemo } from 'react';
import { Activity } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { useMarketBreadth } from '@/lib/queries';
import { formatNumber } from '@/lib/format';

interface MarketBreadthWidgetProps {
  id: string;
  onRemove?: () => void;
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return `${value.toFixed(1)}%`;
}

export function MarketBreadthWidget({ id, onRemove }: MarketBreadthWidgetProps) {
  const breadthQuery = useMarketBreadth();
  const rows = useMemo(() => breadthQuery.data?.data ?? [], [breadthQuery.data?.data]);
  const hasData = rows.some((row) => row.total > 0);
  const isLoading = breadthQuery.isLoading;
  const isFetching = breadthQuery.isFetching;
  const error = breadthQuery.error;
  const updatedAt = breadthQuery.data?.updated_at || breadthQuery.dataUpdatedAt;
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 });

  return (
    <WidgetContainer
      title="Market Breadth"
      onRefresh={() => {
        resetTimeout();
        breadthQuery.refetch();
      }}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
      widgetId={id}
    >
      <div className="h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
          <WidgetMeta
            updatedAt={updatedAt}
            isFetching={isFetching && hasData}
            isCached={Boolean(error && hasData)}
            note="A/D + trend breadth"
            align="right"
          />
        </div>

        <div className="flex-1 overflow-auto p-3">
          {timedOut && isLoading && !hasData ? (
            <WidgetError
              title="Loading timed out"
              error={new Error('Market breadth data took too long to load.')}
              onRetry={() => {
                resetTimeout();
                breadthQuery.refetch();
              }}
            />
          ) : isLoading && !hasData ? (
            <WidgetSkeleton lines={4} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => breadthQuery.refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="Breadth data not available yet" icon={<Activity size={18} />} />
          ) : (
            <div className="space-y-2">
              {rows.map((row) => {
                const ratio = row.ad_ratio ?? (row.decliners === 0 && row.advancers > 0 ? Number.POSITIVE_INFINITY : null);
                const breadthPct = row.total > 0 ? ((row.advancers - row.decliners) / row.total) * 100 : 0;
                return (
                  <div
                    key={row.exchange}
                    className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-[var(--text-primary)]">{row.exchange}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{formatNumber(row.total)}</div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                      <div className="text-emerald-400">▲ {row.advancers}</div>
                      <div className="text-red-400">▼ {row.decliners}</div>
                      <div className="text-[var(--text-secondary)]">= {row.unchanged}</div>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1.5">
                        <div className="uppercase tracking-widest text-[var(--text-muted)]">A/D Ratio</div>
                        <div className="mt-1 font-mono text-[var(--text-primary)]">
                          {ratio === Number.POSITIVE_INFINITY ? '∞' : ratio !== null ? ratio.toFixed(2) : '--'}
                        </div>
                      </div>
                      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1.5">
                        <div className="uppercase tracking-widest text-[var(--text-muted)]">Breadth Bias</div>
                        <div className={`mt-1 font-mono ${breadthPct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {breadthPct >= 0 ? '+' : ''}{breadthPct.toFixed(1)}%
                        </div>
                      </div>
                      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1.5">
                        <div className="uppercase tracking-widest text-[var(--text-muted)]">Above SMA20</div>
                        <div className="mt-1 font-mono text-cyan-300">{formatPct(row.pct_above_sma20)}</div>
                      </div>
                      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1.5">
                        <div className="uppercase tracking-widest text-[var(--text-muted)]">Above SMA50</div>
                        <div className="mt-1 font-mono text-cyan-300">{formatPct(row.pct_above_sma50)}</div>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
                      <span>52W Highs <span className="font-mono text-emerald-300">{row.new_highs_52w}</span></span>
                      <span>52W Lows <span className="font-mono text-rose-300">{row.new_lows_52w}</span></span>
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

export default MarketBreadthWidget;
