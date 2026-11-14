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
import { formatShortDate } from '@/lib/formatDate';
import { getMarketState } from '@/lib/marketHours';
import { memo, useEffect, useMemo, useState } from 'react';
import type { WidgetHealthState } from '@/lib/widgetHealth';

import { EMPTY_VALUE } from '@/lib/units';
type WindowOption = '1M' | '3M' | '6M' | '1Y';

const WINDOW_OPTIONS: WindowOption[] = ['1M', '3M', '6M', '1Y'];

// #249 — a window is a number of market sessions, not a row count: retained
// history can be sparse, so a row cap silently spans a longer period. The API
// counts sessions back from the latest expected exchange session and reports
// the requested/observed ranges, gaps and the last validated session.
const WINDOW_SESSIONS: Record<WindowOption, number> = {
    '1M': 20,
    '3M': 60,
    '6M': 120,
    '1Y': 250,
};

interface ForeignTradingWidgetProps {
    id: string;
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: WidgetDataPayload) => void;
}

function formatVolume(vol: number | null | undefined): string {
    if (vol == null) return 'n/a';
    if (Math.abs(vol) >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
    if (Math.abs(vol) >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
    return vol.toLocaleString();
}

function getNetVolume(buy: number | null | undefined, sell: number | null | undefined): number | null {
    if (buy == null || sell == null) return null;
    return buy - sell;
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

function getNetFlowLabel(net: number | null): string {
    if (net === null) return 'Unavailable';
    if (net > 0) return 'Net buy';
    if (net < 0) return 'Net sell';
    return 'Flat';
}

function getNetFlowClass(net: number | null): string {
    if (net === null) return 'text-[var(--text-muted)]';
    if (net > 0) return 'text-[var(--color-positive)]';
    if (net < 0) return 'text-[var(--color-negative)]';
    return 'text-[var(--text-muted)]';
}

function ForeignTradingWidgetComponent({ id, symbol, onRemove, onDataChange }: ForeignTradingWidgetProps) {
    const [flowWindow, setFlowWindow] = useState<WindowOption>('3M');
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useForeignTrading(symbol, {
        sessions: WINDOW_SESSIONS[flowWindow],
    });

    const coverage = data?.meta;
    const responseWarning = data?.error || null;
    // Rows are already admitted to the session window server-side; sorting is
    // presentation only and never re-derives a window total from a row count.
    const trades = useMemo(() => {
        const raw = data?.data || [];
        return [...raw].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    }, [data]);

    const windowNet = useMemo(() => {
        if (trades.length === 0) return null;
        // A partial window is a partial disclosure: the admitted rows sum, but
        // they may not be presented as the selected window's net.
        if (coverage?.coverage_status !== undefined && coverage.coverage_status !== 'complete') {
            return null;
        }
        if (coverage?.window_net_volume !== undefined) return coverage.window_net_volume;
        let total = 0;
        for (const trade of trades) {
            const net = getNetVolume(trade.buy_volume, trade.sell_volume);
            if (net === null) return null;
            total += net;
        }
        return total;
    }, [coverage?.coverage_status, coverage?.window_net_volume, trades]);

    const coverageLabel = useMemo(() => {
        const requested = coverage?.requested_session_count ?? WINDOW_SESSIONS[flowWindow];
        const observed = coverage?.observed_session_count ?? null;
        if (observed === null) return `${requested} sessions requested`;
        const range = [coverage?.observed_start_date, coverage?.observed_end_date]
            .filter((value): value is string => Boolean(value))
            .map((value) => formatDate(value))
            .join(' – ');
        const gaps = coverage?.gap_session_count ?? 0;
        return `${observed}/${requested} sessions${range ? ` · ${range}` : ''}${gaps ? ` · ${gaps} gap${gaps === 1 ? '' : 's'}` : ''}`;
    }, [coverage, flowWindow]);

    const coverageWarning = useMemo(() => {
        const parts: string[] = [];
        // The response-level degradation record travels with the rows: a
        // retained fallback sample must not read as live data (#249).
        if (responseWarning) parts.push(responseWarning.replace(/^; |; $/g, ''));
        for (const warning of coverage?.warnings ?? []) {
            if (!responseWarning?.includes(warning)) parts.push(warning);
        }
        if (coverage?.provider_row_cap_applied) {
            parts.push(`Live feed caps ${coverage.provider_row_cap} rows; longer windows rely on retained history.`);
        }
        if ((coverage?.non_session_dates?.length ?? 0) > 0) {
            parts.push(`${coverage.non_session_dates!.length} row(s) dated on a non-session were excluded.`);
        }
        if ((coverage?.duplicate_session_dates?.length ?? 0) > 0) {
            parts.push(`${coverage.duplicate_session_dates!.length} duplicated session date(s) collapsed.`);
        }
        if (coverage?.calendar_verified === false) {
            parts.push('Exchange calendar unverified for this range; closures may appear as gaps.');
        }
        return [...new Set(parts)].join(' ');
    }, [coverage, responseWarning]);

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
                <span className="text-[var(--color-positive)] font-mono">{formatVolume(row.buy_volume)}</span>
            ),
            align: 'right',
            width: 70,
        },
        {
            id: 'sell',
            header: 'Sell',
            accessor: (row) => (
                <span className="text-[var(--color-negative)] font-mono">{formatVolume(row.sell_volume)}</span>
            ),
            align: 'right',
            width: 70,
        },
        {
            id: 'net',
            header: 'Net',
            accessor: (row) => {
                const net = getNetVolume(row.buy_volume, row.sell_volume);
                const netLabel = getNetFlowLabel(net);
                return (
                    <span
                        className={cn(
                            'font-bold font-mono flex items-center justify-end gap-1',
                            getNetFlowClass(net)
                        )}
                    >
                        {net !== null && (net > 0 ? <TrendingUp size={10} /> : net < 0 ? <TrendingDown size={10} /> : null)}
                        {netLabel}{net !== null ? ` ${formatNetVolume(net)}` : ''}
                    </span>
                );
            },
            align: 'right',
        },
    ], []);

    const hasData = trades.length > 0;
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
                label: `Last trading day · ${formattedLastSync ?? EMPTY_VALUE}`,
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
                label: `Stale · last sync ${formattedLastSync ?? EMPTY_VALUE}`,
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
                    updatedAt: data?.meta?.last_data_date ?? null,
                    fetchedAt: dataUpdatedAt || null,
                },
            },
        });
    }, [hasData, onDataChange, symbol, data?.meta?.last_data_date, dataUpdatedAt]);

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
                                        ? 'bg-[var(--color-accent-fill)] text-[var(--color-on-accent)]'
                                        : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                                )}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                    <WidgetMeta
                        updatedAt={data?.meta?.last_data_date ?? null}
                        fetchedAt={dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        health={healthState}
                        note={coverageLabel}
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
                        <Globe size={12} className="text-[var(--color-accent-primary)]" />
                        <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Net Position</span>
                    </div>
                    <div
                        className={cn(
                            'text-xs font-black px-2 py-0.5 rounded',
                            windowNet !== null && windowNet > 0
                                ? 'bg-[var(--color-positive-bg)] text-[var(--color-positive)]'
                                : windowNet !== null && windowNet < 0
                                    ? 'bg-[var(--color-negative-bg)] text-[var(--color-negative)]'
                                    : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                        )}
                    >
                        {getNetFlowLabel(windowNet)}{windowNet !== null ? ` ${formatNetVolume(windowNet, true)}` : ''}
                    </div>
                </div>
                {coverageWarning && (
                    <p role="status" className="px-3 py-1.5 border-b border-[var(--border-color)] text-[10px] text-[var(--text-secondary)]">
                        {coverageWarning}
                    </p>
                )}

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
                    ) : (error || responseWarning) && !hasData ? (
                        <WidgetError error={(error as Error) || new Error(responseWarning ?? undefined)} onRetry={() => refetch()} />
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
