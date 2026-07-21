'use client';

import { useEffect, useMemo } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Minus } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { usePriceBoard } from '@/lib/queries';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import { parseWatchlistSymbols } from './WatchlistWidget';
import type { PriceBoardResponse } from '@/lib/api';
import { useDashboard } from '@/contexts/DashboardContext';
import type { WidgetGroupId } from '@/types/widget';

interface WatchlistLimitsMonitorWidgetProps {
  id: string;
  config?: Record<string, unknown>;
  widgetGroup?: WidgetGroupId;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
}

type BoardRow = PriceBoardResponse['data'][number];

export function classifyLimit(row: BoardRow): { status: 'At ceiling' | 'At floor' | 'Inside range' | 'Unavailable'; distance: number | null } {
  const { price, ceiling, floor } = row;
  if (![price, ceiling, floor].every((value) => typeof value === 'number' && Number.isFinite(value)) || ceiling! <= floor!) return { status: 'Unavailable', distance: null };
  if (price === ceiling) return { status: 'At ceiling', distance: 1 };
  if (price === floor) return { status: 'At floor', distance: 0 };
  return { status: 'Inside range', distance: (price! - floor!) / (ceiling! - floor!) };
}

function formatSize(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toLocaleString('en-US') : '—';
}

export function WatchlistLimitsMonitorWidget({ id, config, widgetGroup, onRemove, onDataChange }: WatchlistLimitsMonitorWidgetProps) {
  const { state } = useDashboard();
  const symbolSummary = useMemo(() => {
    const dashboardSymbols = state.dashboards.flatMap((dashboard) => dashboard.tabs.flatMap((tab) => tab.widgets.flatMap((widget) => widget.type === 'watchlist' ? parseWatchlistSymbols(widget.config) : [])));
    const manualSymbols = parseWatchlistSymbols(config);
    const deduplicated = [...new Set([...dashboardSymbols, ...manualSymbols])];
    return {
      dashboardCount: dashboardSymbols.length,
      manualCount: manualSymbols.length,
      deduplicatedCount: deduplicated.length,
      cappedCount: Math.max(0, deduplicated.length - 50),
      symbols: deduplicated.slice(0, 50),
    };
  }, [config, state.dashboards]);
  const { symbols } = symbolSummary;
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = usePriceBoard(symbols, { enabled: symbols.length > 0 });
  const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup, { widgetType: 'watchlist_limits_monitor' });
  const rows = data?.data ?? [];
  const refreshedAt = rows[0]?.refreshedAt ?? dataUpdatedAt;
  const source = rows[0]?.source ?? 'Price board';

  useEffect(() => {
    onDataChange?.(buildWidgetRuntime({
      empty: symbols.length === 0 || rows.length === 0,
      apiGroup: '/trading',
      endpoint: '/trading/price-board',
      sourceLabel: source,
      lastDataDate: refreshedAt,
      stale: Boolean(error && rows.length),
      extra: { requestedSymbols: symbols.length, returnedSymbols: rows.length, snapshot: 'live', ...symbolSummary },
    }));
  }, [error, onDataChange, refreshedAt, rows.length, source, symbolSummary, symbols.length]);

  return (
    <WidgetContainer title="Watchlist Ceiling/Floor" widgetId={id} onRefresh={() => refetch()} onClose={onRemove} isLoading={isLoading && !rows.length} noPadding>
      <div className="flex h-full flex-col bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <WidgetMeta updatedAt={refreshedAt} isFetching={isFetching && Boolean(rows.length)} sourceLabel={source} note={`Dashboard ${symbolSummary.dashboardCount} · Manual ${symbolSummary.manualCount} · Deduplicated ${symbolSummary.deduplicatedCount} · Capped ${symbolSummary.cappedCount} · Query ${symbols.length}/50`} align="right" />
        </div>
        <div className="flex-1 overflow-auto p-3">
          {!symbols.length ? <WidgetEmpty message="Your watchlist is empty" detail="Add symbols in the Watchlist widget to monitor provider ceiling and floor fields." /> : isLoading && !rows.length ? <WidgetSkeleton lines={7} /> : error && !rows.length ? <WidgetError error={error as Error} onRetry={() => refetch()} /> : !rows.length ? <WidgetEmpty message="No live price-board rows are available" detail="The price board did not return a snapshot for the requested watchlist symbols." /> : <div className="space-y-2">{rows.map((row) => <LimitRow key={row.symbol} row={row} onSelect={setLinkedSymbol} />)}</div>}
        </div>
      </div>
    </WidgetContainer>
  );
}

function LimitRow({ row, onSelect }: { row: BoardRow; onSelect: (symbol: string) => void }) {
  const { status, distance } = classifyLimit(row);
  const tone = status === 'At ceiling' ? 'text-emerald-300' : status === 'At floor' ? 'text-rose-300' : status === 'Inside range' ? 'text-blue-300' : 'text-[var(--text-muted)]';
  const icon = status === 'At ceiling' ? <ArrowUpToLine size={13} /> : status === 'At floor' ? <ArrowDownToLine size={13} /> : <Minus size={13} />;
  return <button type="button" onClick={() => onSelect(row.symbol)} className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 text-left hover:border-blue-500/30"><div className="flex items-center justify-between gap-3"><span className="font-semibold text-[var(--text-primary)]">{row.symbol}</span><span className={`flex items-center gap-1 text-xs font-semibold ${tone}`}>{icon}{status}</span></div><div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-[var(--text-muted)] md:grid-cols-4"><span>Price {row.price ?? '—'}</span><span>Distance {distance === null ? 'Unavailable' : `${(distance * 100).toFixed(1)}%`}</span><span>Bid size {formatSize(row.bestBidVol)}</span><span>Ask size {formatSize(row.bestAskVol)}</span></div></button>;
}

export default WatchlistLimitsMonitorWidget;
