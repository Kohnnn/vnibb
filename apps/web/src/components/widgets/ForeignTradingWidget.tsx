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
import { describeForeignFlow } from '@/lib/foreignFlowProvenance';
import { parseForeignSessionDate, qualifyForeignFlowWindow } from '@/lib/foreignFlowWindow';
import { deriveWidgetHealth } from '@/lib/widgetHealth';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { memo, useEffect, useMemo, useState } from 'react';
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
    if (vol == null || !Number.isFinite(vol)) return 'n/a';
    if (Math.abs(vol) >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
    if (Math.abs(vol) >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
    return vol.toLocaleString();
}

function getNetVolume(buy: number | null | undefined, sell: number | null | undefined): number | null {
    if (buy == null || sell == null || !Number.isFinite(buy) || !Number.isFinite(sell)) return null;
    return buy - sell;
}

function formatNetVolume(vol: number, signed = false): string {
    if (vol === 0) return '0';
    return `${signed && vol > 0 ? '+' : ''}${formatVolume(signed ? vol : Math.abs(vol))}`;
}

function formatDate(dateStr: string | null | undefined): string {
    return formatShortDate(dateStr);
}

export { parseForeignTradingSnapshotTime } from '@/lib/foreignFlowProvenance';

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
    const [lastClosureCheck, setLastClosureCheck] = useState(0);
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useForeignTrading(symbol, {
        sessions: WINDOW_SESSIONS[flowWindow],
    });

    const coverage = data?.meta;
    const flowData = useMemo(
        () => qualifyForeignFlowWindow(data?.data, coverage, WINDOW_SESSIONS[flowWindow]),
        [data?.data, coverage, flowWindow],
    );
    const trades = useMemo(() => [...flowData.rows].sort(
        (a, b) => String(b.date || '').localeCompare(String(a.date || '')),
    ), [flowData.rows]);
    const windowNet = flowData.total;
    const coverageLabel = flowData.windowed
        ? `${flowData.observed}/${WINDOW_SESSIONS[flowWindow]} ${flowData.calendarVerified ? 'qualifying' : 'candidate'} sessions · requested ${flowData.requestedStart} – ${flowData.requestedEnd} · returned ${flowData.returnedStart ?? 'none'} – ${flowData.returnedEnd ?? 'none'} · ${flowData.gaps ?? 'unknown'} missing · ${flowData.nullSessions} null`
        : `${WINDOW_SESSIONS[flowWindow]} sessions requested · retained history (unverified window) · ${flowData.returnedStart ?? 'unknown'} – ${flowData.returnedEnd ?? 'unknown'}`;

    const columns = useMemo((): VirtualizedColumn<any>[] => [
        {
            id: 'date',
            header: 'Date',
            accessor: (row) => (
                <div className="text-[var(--text-muted)] font-mono text-[10px]">{parseForeignSessionDate(row.date) ?? '-'}</div>
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
    const { provenance, closureExpiresAt } = useMemo(() => {
        const { closureExpiresAt, ...provenance } = describeForeignFlow({
            response: data,
            fetchedAt: dataUpdatedAt,
            requestedSessions: WINDOW_SESSIONS[flowWindow],
            window: flowData,
            requestFailed: Boolean(error),
            isLoading,
            isFetching,
        }, Math.max(lastClosureCheck, Date.now()));
        return { provenance, closureExpiresAt };
    }, [data, dataUpdatedAt, error, flowData, flowWindow, isLoading, isFetching, lastClosureCheck]);

    useEffect(() => {
        if (closureExpiresAt === undefined) return;
        const delay = Math.min(Math.max(0, closureExpiresAt - Date.now()), 2 ** 31 - 1);
        const timer = window.setTimeout(() => setLastClosureCheck(Date.now()), delay);
        return () => window.clearTimeout(timer);
    }, [closureExpiresAt, lastClosureCheck]);
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 });
    const coverageWarning = [
        ...(provenance.warnings ?? []),
        flowData.windowed && coverage?.provider_row_cap_applied && `Live feed caps ${coverage.provider_row_cap} rows; longer windows rely on retained history.`,
        flowData.windowed && coverage?.non_session_dates?.length && `${coverage.non_session_dates.length} row(s) dated on a non-session were excluded.`,
        flowData.windowed && coverage?.duplicate_session_dates?.length && `${coverage.duplicate_session_dates.length} duplicated session date(s) collapsed.`,
        flowData.windowed && coverage?.calendar_verified === false && 'Exchange calendar unverified for this range; closures may appear as gaps.',
    ].filter(Boolean).join(' ');
    const health = deriveWidgetHealth(provenance);
    const observed = provenance.updatedAt;
    const label = health.status === 'cached' ? 'Cached snapshot'
        : health.status === 'stale' && observed ? `Stale · source as of ${formatDate(String(observed))}`
        : health.status === 'awaiting_update' && provenance.expectedClosedSession && observed ? `Last trading day · ${formatDate(String(observed))}`
        : health.label;

    useEffect(() => {
        const { updatedAt, ...facts } = provenance;
        onDataChange?.(buildWidgetRuntime({
            ...facts,
            empty: !hasData,
            compactHeight: 3,
            sourceLabel: 'Foreign trading',
            apiGroup: '/equity',
            endpoint: `/equity/${symbol}/foreign-trading?sessions=${WINDOW_SESSIONS[flowWindow]}&window_contract=sessions-v2`,
            lastDataDate: updatedAt,
            units: 'Volume: shares',
            basis: flowData.windowed ? 'Admitted foreign trading sessions; window net requires complete coverage.' : 'Retained foreign history; requested session window is unverified.',
            exportData: trades,
        }));
    }, [flowData.windowed, flowWindow, hasData, onDataChange, provenance, symbol, trades]);

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
            <div className="flex min-h-full flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
                <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)]/70 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <div className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5">
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
                        updatedAt={provenance.updatedAt}
                        fetchedAt={provenance.fetchedAt}
                        isFetching={isFetching && hasData}
                        health={hasData ? { ...health, label } : undefined}
                        note={coverageLabel}
                        align="right"
                        className="min-w-[10rem] flex-1"
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

                <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/50 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <div className="flex items-center gap-2">
                        <Globe size={12} className="text-[var(--color-accent-primary)]" />
                        <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Net Position</span>
                    </div>
                    <div
                        className={cn(
                            'shrink-0 text-xs font-black px-2 py-0.5 rounded',
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
                    <p role="status" className="shrink-0 px-3 py-1.5 border-b border-[var(--border-color)] text-[10px] text-[var(--text-secondary)]">
                        {coverageWarning}
                    </p>
                )}

                {/* min-h floor: when the header/warning stack grows the table keeps
                    a scrollable body instead of collapsing to zero painted rows. */}
                <div className="flex-1 min-h-[160px] overflow-hidden">
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
                    ) : provenance.observationStatus === 'unavailable' ? (
                        <WidgetError error={error || new Error(data?.error || 'Foreign trading is unavailable.')} onRetry={() => refetch()} />
                    ) : !hasData ? (
                        <WidgetEmpty
                            message={`No data for ${symbol}`}
                            detail={data?.error || 'Foreign flow appears here when exchange data is available.'}
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
