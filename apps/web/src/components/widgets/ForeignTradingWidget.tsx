'use client';

import { Globe, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { useForeignTrading } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { VirtualizedTable, type VirtualizedColumn } from '@/components/ui/VirtualizedTable';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { cn } from '@/lib/utils';
import { formatShortDate } from '@/lib/format';
import { getMarketState } from '@/lib/marketHours';
import { memo, useEffect, useMemo, useState } from 'react';
import type { WidgetHealthState } from '@/lib/widgetHealth';

type WindowOption = '1M' | '3M' | '6M' | '1Y';

const WINDOW_OPTIONS: WindowOption[] = ['1M', '3M', '6M', '1Y'];

const WINDOW_LIMITS: Record<WindowOption, number> = {
    '1M': 22,
    '3M': 66,
    '6M': 132,
    '1Y': 264,
};

interface ForeignTradingWidgetProps {
    id: string;
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: unknown) => void;
}

function formatVolume(vol: number | null | undefined): string {
    if (!vol) return '-';
    if (Math.abs(vol) >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
    if (Math.abs(vol) >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
    return vol.toLocaleString();
}

function formatNetVolume(vol: number, signed = false): string {
    if (vol === 0) return '0';
    return `${signed && vol > 0 ? '+' : ''}${formatVolume(signed ? vol : Math.abs(vol))}`;
}

function formatDate(dateStr: string | null | undefined): string {
    return formatShortDate(dateStr);
}

export function parseForeignTradingSnapshotTime(value: string | null | undefined): Date | null {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;

    // Foreign trading is a daily settled feed. A date-only value means the
    // latest trading session, not midnight; use the post-close settlement
    // timestamp (17:00 ICT = 10:00 UTC) so 19:00 ICT reads as ~2h old.
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return new Date(`${text}T10:00:00.000Z`);
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getNetFlowLabel(net: number): string {
    if (net > 0) return 'Net buy';
    if (net < 0) return 'Net sell';
    return 'Flat';
}

function getNetFlowClass(net: number): string {
    if (net > 0) return 'text-green-400';
    if (net < 0) return 'text-red-400';
    return 'text-[var(--text-muted)]';
}

function ForeignTradingWidgetComponent({ id, symbol, onRemove, onDataChange }: ForeignTradingWidgetProps) {
    const [flowWindow, setFlowWindow] = useState<WindowOption>('3M');
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useForeignTrading(symbol, { limit: WINDOW_LIMITS[flowWindow] });

    const trades = useMemo(() => {
        const raw = data?.data || [];
        return [...raw].sort((a, b) => {
            const dateA = String(a.date || '');
            const dateB = String(b.date || '');
            return dateB.localeCompare(dateA);
        });
    }, [data]);

    const totals = useMemo(() => {
        const buy = trades.reduce((sum, t) => sum + (t.buy_volume || 0), 0);
        const sell = trades.reduce((sum, t) => sum + (t.sell_volume || 0), 0);
        return { buy, sell, net: buy - sell };
    }, [trades]);

    const columns = useMemo((): VirtualizedColumn<any>[] => [
        {
            id: 'date',
            header: 'Date',
            accessor: (row) => (
                <div className="text-[var(--text-muted)] font-mono text-[10px]">{formatDate(row.date)}</div>
            ),
            width: 70,
        },
        {
            id: 'buy',
            header: 'Buy',
            accessor: (row) => (
                <span className="text-green-500 font-mono">{formatVolume(row.buy_volume)}</span>
            ),
            align: 'right',
            width: 70,
        },
        {
            id: 'sell',
            header: 'Sell',
            accessor: (row) => (
                <span className="text-red-500 font-mono">{formatVolume(row.sell_volume)}</span>
            ),
            align: 'right',
            width: 70,
        },
        {
            id: 'net',
            header: 'Net',
            accessor: (row) => {
                const net = (row.buy_volume || 0) - (row.sell_volume || 0);
                const netLabel = getNetFlowLabel(net);
                return (
                    <span
                        className={cn(
                            'font-bold font-mono flex items-center justify-end gap-1',
                            getNetFlowClass(net)
                        )}
                    >
                        {net > 0 ? <TrendingUp size={10} /> : net < 0 ? <TrendingDown size={10} /> : null}
                        {netLabel} {formatNetVolume(net)}
                    </span>
                );
            },
            align: 'right',
        },
    ], []);

    const hasData = trades.length > 0;
    const responseWarning = data?.error || null;
    const isFallback = Boolean((error || responseWarning) && hasData);
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 });

    // B7 — accurate freshness badge.
    //
    // The widget previously showed "Cached snapshot · 11h old" any time the
    // last data row was older than 1h, which made fresh end-of-session data
    // look broken. We split the badge into three states based on the actual
    // age of the most recent row, regardless of whether the response is a
    // server-side fallback:
    //
    //   - Fresh         (< 6h, weekday market hours): "Live · syncs every 5m"
    //   - End-of-day    (< 26h):                       "Last sync: <date>"
    //   - Stale         (≥ 26h):                       "Stale · last sync <date>"
    //
    // We retain the "cached snapshot" wording only when we genuinely served
    // a database fallback row (provider degradation), since that's the
    // operator-meaningful distinction.
    const snapshotAgeHours = useMemo(() => {
        const lastDateStr = data?.meta?.last_data_date;
        if (!lastDateStr) return null;
        const lastDate = parseForeignTradingSnapshotTime(lastDateStr);
        if (!lastDate) return null;
        const diffMs = Date.now() - lastDate.getTime();
        if (diffMs < 0) return null;
        return diffMs / (1000 * 60 * 60);
    }, [data?.meta?.last_data_date]);

    const formattedLastSync = useMemo(() => {
        const lastDateStr = data?.meta?.last_data_date;
        if (!lastDateStr) return null;
        const d = parseForeignTradingSnapshotTime(lastDateStr);
        if (!d) return null;
        return d.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
        });
    }, [data?.meta?.last_data_date]);

    const healthState: WidgetHealthState | undefined = (() => {
        // QA-v4 Note F6 / T-2: When the user opens the dashboard on a weekend
        // (or outside market hours), the freshest available row is by
        // definition the last trading day's close. The previous "Cached
        // snapshot · 3d old" copy made this look like a defect when in
        // fact it's the canonical, intended state. Surface a clearer
        // weekend label and skip the "stale" red badge.
        const marketState = getMarketState();
        if (marketState.phase === 'weekend' && snapshotAgeHours !== null && snapshotAgeHours <= 96) {
            return {
                status: 'live',
                label: `Last trading day · ${formattedLastSync ?? '—'}`,
                detail: 'Foreign trading reports settle T+0 from HOSE. Showing the most recent trading day; live updates resume Monday at 09:00 ICT.',
            };
        }
        if (isFallback) {
            return {
                status: 'cached',
                label:
                    snapshotAgeHours !== null && snapshotAgeHours >= 1
                        ? `Cached snapshot · ${snapshotAgeHours >= 24 ? `${Math.floor(snapshotAgeHours / 24)}d` : `${Math.floor(snapshotAgeHours)}h`} old`
                        : 'Cached snapshot',
                detail: responseWarning || 'Showing the last successful foreign flow snapshot while refresh is degraded.',
            };
        }
        if (snapshotAgeHours === null) return undefined;
        // Tiered freshness per QA-v2 F3: red >12h, orange >6h, otherwise live.
        if (snapshotAgeHours >= 12) {
            return {
                status: 'stale',
                label: `Stale · last sync ${formattedLastSync ?? '—'}`,
                detail: 'Foreign trading data has not refreshed in over 12 hours. Use Refresh to retry.',
            };
        }
        if (snapshotAgeHours >= 6) {
            return {
                status: 'cached',
                label: `Catching up · ${Math.floor(snapshotAgeHours)}h old`,
                detail: 'Snapshot is older than 6 hours; backend is catching up. Use Refresh to force a sync.',
            };
        }
        if (snapshotAgeHours >= 2) {
            return {
                status: 'live',
                label: `Last sync ${formattedLastSync ?? 'today'}`,
                detail: 'Foreign trading reports settle T+0 from HOSE. Intraday updates run every 5 min during market hours.',
            };
        }
        return undefined;
    })();

    useEffect(() => {
        onDataChange?.({
            __widgetRuntime: {
                layoutHint: {
                    empty: !hasData,
                    compactHeight: 3,
                },
                provenance: {
                    sourceLabel: 'Foreign trading',
                    apiGroup: '/equity',
                    endpoint: `/equity/${symbol}/foreign-trading`,
                    updatedAt: dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined,
                },
            },
        });
    }, [hasData, onDataChange, symbol, dataUpdatedAt]);

    return (
        <WidgetContainer
            title="Foreign Flow"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading && !hasData}
            noPadding
            widgetId={id}
            showLinkToggle
            exportData={trades}
            exportFilename={`foreign_${symbol}`}
        >
            <div className="h-full flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
                <div className="px-3 py-2 border-b border-[var(--border-color)]/70 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5">
                        {WINDOW_OPTIONS.map((option) => (
                            <button
                                key={option}
                                type="button"
                                onClick={() => setFlowWindow(option)}
                                className={cn(
                                    'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                    flowWindow === option
                                        ? 'bg-blue-600 text-white'
                                        : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                                )}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                    <WidgetMeta
                        updatedAt={data?.meta?.last_data_date || dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        health={healthState}
                        note={`${flowWindow} net position`}
                        align="right"
                    />
                    {/* Co-located refresh button: makes the cached-snapshot recovery affordance discoverable next to the badge instead of relying on the toolbar icon. */}
                    <button
                        type="button"
                        onClick={() => refetch()}
                        disabled={isFetching}
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-accent)] disabled:cursor-not-allowed disabled:opacity-60"
                        title="Refresh foreign trading snapshot"
                    >
                        <RefreshCw size={10} className={cn(isFetching ? 'animate-spin' : '')} />
                        Refresh
                    </button>
                </div>

                <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Globe size={12} className="text-blue-500" />
                        <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Net Position</span>
                    </div>
                    <div
                        className={cn(
                            'text-xs font-black px-2 py-0.5 rounded',
                            totals.net > 0
                                ? 'bg-green-500/10 text-green-400'
                                : totals.net < 0
                                    ? 'bg-red-500/10 text-red-400'
                                    : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                        )}
                    >
                        {getNetFlowLabel(totals.net)} {formatNetVolume(totals.net, true)}
                    </div>
                </div>

                <div className="flex-1 overflow-hidden">
                    {timedOut && isLoading && !hasData ? (
                        <WidgetError
                            title="Loading timed out"
                            error={new Error('Foreign trading data took too long to load.')}
                            onRetry={() => {
                                resetTimeout();
                                refetch();
                            }}
                        />
                    ) : isLoading && !hasData ? (
                        <WidgetSkeleton variant="table" lines={6} />
                    ) : error && !hasData ? (
                        <WidgetError error={error as Error} onRetry={() => refetch()} />
                    ) : !hasData ? (
                        <WidgetEmpty
                            message={`No data for ${symbol}`}
                            detail={responseWarning || 'Foreign flow appears here when exchange data is available.'}
                            health={{
                                status: 'coverage_gap',
                                label: 'Coverage gap',
                                detail: 'Some symbols or sessions do not publish foreign participation in the provider feed yet.',
                            }}
                            icon={<Globe size={18} />}
                            size="compact"
                        />
                    ) : (
                        <VirtualizedTable data={trades} columns={columns} rowHeight={30} />
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

export const ForeignTradingWidget = memo(ForeignTradingWidgetComponent);
export default ForeignTradingWidget;
