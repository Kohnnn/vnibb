'use client';

import { useEffect, useMemo } from 'react';
import { BarChart2, RefreshCw } from 'lucide-react';
import { useHistoricalPrices } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { buildWidgetRuntime, type WidgetDataPayload } from '@/lib/widgetRuntime';
import { deriveWidgetHealth } from '@/lib/widgetHealth';
import { colorForDirection, priceDirection, signedToneClass } from '@/lib/priceColor';
import { analyzeVolume, volumeHistoryWindow, VOLUME_SAMPLE_BASIS, VOLUME_UNCERTIFIED, type VolumeBar } from './volumeAnalysis';

interface VolumeAnalysisWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: WidgetDataPayload) => void;
}

function formatVolume(vol: number): string {
    if (vol >= 1e9) return `${(vol / 1e9).toFixed(1)}B`;
    if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)}M`;
    if (vol >= 1e3) return `${(vol / 1e3).toFixed(0)}K`;
    return vol.toLocaleString();
}

const SOURCE_LABEL = 'Volume analysis (derived)';
const CLOSE_MARKERS = { up: '↑', down: '↓', flat: '–', none: '?' } as const;
const signedClose = new Intl.NumberFormat(undefined, { signDisplay: 'exceptZero', maximumSignificantDigits: 6 });
const signedPercent = new Intl.NumberFormat(undefined, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 1 });

function formatRange(start: string | null, end: string | null): string {
    if (start === end) return start ?? 'unknown';
    return `${start ?? 'unknown'} to ${end ?? 'unknown'}`;
}

function RecentVolumeBar({ bar, maxVolume }: { bar: VolumeBar; maxVolume: number }) {
    const { date, volume, closeChange } = bar;
    const direction = priceDirection(closeChange);
    const closeLabel = closeChange === null ? 'Close direction unknown' : `Close ${direction} (${signedClose.format(closeChange)})`;
    return (
        <li className="flex items-center gap-2">
            <time dateTime={date ?? undefined} title={date ?? undefined} className="w-12 shrink-0 text-[10px] text-[var(--text-muted)]">
                {date?.slice(5) ?? 'No date'}
            </time>
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-[var(--bg-tertiary)]">
                {volume !== null && (
                    <div aria-hidden="true" className="h-full" style={{
                        width: `${(volume / maxVolume) * 100}%`,
                        backgroundColor: direction === 'none' ? 'var(--border-default)' : colorForDirection(closeChange),
                    }} />
                )}
                <span className="absolute right-1 top-0.5 text-[10px] text-[var(--text-secondary)]">
                    {volume === null ? 'Unknown' : formatVolume(volume)}
                </span>
            </div>
            <span role="img" aria-label={closeLabel} title={closeLabel} className={`w-4 shrink-0 text-center text-xs ${signedToneClass(closeChange)}`}>
                {CLOSE_MARKERS[direction]}
            </span>
        </li>
    );
}

export function VolumeAnalysisWidget({ symbol, onDataChange }: VolumeAnalysisWidgetProps) {
    const { startDate, endDate } = volumeHistoryWindow(Date.now());
    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useHistoricalPrices(symbol, { startDate, endDate, interval: '1D' });

    const analysis = useMemo(() => analyzeVolume(data, startDate, endDate), [data, startDate, endDate]);
    const { unitsWithheld, coverage, recent, maxVolume, sourceAsOf, coverageDetail, summary } = analysis;
    const hasBars = recent.length > 0;
    const loadFailed = Boolean(error || data?.error);
    const isFallback = loadFailed && hasBars;
    const observationStatus = isLoading && !data ? 'loading'
        : unitsWithheld || (loadFailed && !hasBars) ? 'unavailable'
        : summary.observationCount ? 'available' : 'empty';
    const refreshStatus = loadFailed ? 'failed' : isFetching ? 'refreshing' : data ? 'succeeded' : undefined;
    const stale = isFallback || deriveWidgetHealth({ updatedAt: sourceAsOf }).status === 'stale';
    const health = deriveWidgetHealth({ updatedAt: sourceAsOf, coverage, observationStatus, refreshStatus, cached: isFallback, stale, sourceLabel: SOURCE_LABEL });

    useEffect(() => {
        onDataChange?.(buildWidgetRuntime({
            empty: !hasBars,
            apiGroup: '/equity',
            endpoint: '/equity/historical',
            endpointKind: 'route_summary',
            sourceLabel: SOURCE_LABEL,
            lastDataDate: sourceAsOf,
            fetchedAt: dataUpdatedAt,
            stale,
            cached: isFallback,
            coverage,
            coverageDetail,
            observationStatus,
            refreshStatus,
            adjustmentMode: data?.meta?.adjustment_mode,
            basis: unitsWithheld ? VOLUME_UNCERTIFIED : VOLUME_SAMPLE_BASIS,
            extra: data ? summary : undefined,
            exportData: data ? summary : undefined,
        }));
    }, [onDataChange, hasBars, sourceAsOf, dataUpdatedAt, stale, isFallback, coverage, coverageDetail,
        observationStatus, refreshStatus, data, unitsWithheld, summary]);

    if (!symbol) {
        return <WidgetEmpty message="Select a symbol to view volume" />;
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="mb-1 flex shrink-0 items-center justify-between gap-2 px-1 py-1">
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--text-secondary)]">
                    <BarChart2 size={12} aria-hidden="true" className="text-[var(--color-accent-primary)]" />
                    <span>{unitsWithheld ? 'Units not certified' : `Sample avg: ${summary.avgVolume === null ? 'unavailable' : formatVolume(summary.avgVolume)}`}</span>
                    {!unitsWithheld && (
                        <span className={signedToneClass(summary.volumeChangePct)}>
                            Latest vs sample avg: {summary.volumeChangePct === null ? 'unavailable' : signedPercent.format(summary.volumeChangePct / 100)}
                        </span>
                    )}
                </div>
                <button
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)]"
                    aria-label="Refresh volume analysis"
                    type="button"
                >
                    <RefreshCw size={12} aria-hidden="true" className={isFetching ? 'animate-spin motion-reduce:animate-none' : ''} />
                </button>
            </div>

            <div role="region" aria-label="Volume analysis details" tabIndex={0} className="min-h-0 flex-1 space-y-2 overflow-auto">
                <div className="space-y-1 border-b border-[var(--border-subtle)] px-1 pb-2 text-[10px] text-[var(--text-secondary)]">
                    <p>Observed: {formatRange(coverageDetail.observedStart, coverageDetail.observedEnd)} · {summary.observationCount ?? 'unknown'} valid volume {summary.observationCount === 1 ? 'observation' : 'observations'} · {summary.excludedVolumeCount ?? 'unknown'} excluded for missing or invalid volume</p>
                    {hasBars && <p>{VOLUME_SAMPLE_BASIS}</p>}
                    <p>Requested (calendar): {formatRange(startDate, endDate)}</p>
                    <p>Returned: {formatRange(summary.returnedStart, summary.returnedEnd)} · {summary.returnedCount ?? 'unknown'} {summary.returnedCount === 1 ? 'bar' : 'bars'}</p>
                    <p>Expected sessions: {summary.expectedSessionCount ?? 'unknown'} · Missing sessions: {summary.missingSessionCount ?? 'unknown'} · Unresolved exclusions: {summary.unresolvedSessionCount ?? 'unknown'} · Replaced exclusions: {summary.replacedExclusionCount ?? 'unknown'}</p>
                    <WidgetMeta updatedAt={sourceAsOf} fetchedAt={dataUpdatedAt} isFetching={isFetching && hasBars} health={health} />
                    <p>Source age: {summary.sourceAgeDays === null ? 'unknown' : `${summary.sourceAgeDays} calendar ${summary.sourceAgeDays === 1 ? 'day' : 'days'}`}</p>
                </div>

                {observationStatus === 'loading' ? (
                    <WidgetSkeleton lines={6} />
                ) : unitsWithheld ? (
                    <WidgetEmpty message={VOLUME_UNCERTIFIED} icon={<BarChart2 size={18} />} />
                ) : loadFailed && !hasBars ? (
                    <WidgetError title="Failed to load historical volume" onRetry={() => refetch()} />
                ) : !hasBars ? (
                    <WidgetEmpty message="No historical bars returned" icon={<BarChart2 size={18} />} />
                ) : (
                    <>
                        <p className="px-1 text-[10px] text-[var(--text-muted)]">
                            Showing {recent.length} of {summary.returnedCount} returned bars. Bar length shows volume.
                        </p>
                        <p className="px-1 text-[10px] text-[var(--text-muted)]">
                            Color and arrows show close vs previous returned bar: ↑ Up · ↓ Down · – Flat · ? Unknown
                        </p>
                        <ul aria-label="Recent volume bars" className="space-y-1 px-1 pb-2">
                            {recent.map((bar, i) => <RecentVolumeBar key={`${bar.date}-${i}`} bar={bar} maxVolume={maxVolume} />)}
                        </ul>
                    </>
                )}
            </div>
        </div>
    );
}
