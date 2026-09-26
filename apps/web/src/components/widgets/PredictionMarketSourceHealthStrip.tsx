'use client';

import { useQuery } from '@tanstack/react-query';
import { API_BASE_URL } from '@/lib/api';
import type { PredictionMarketSource } from './PredictionMarketSource';

const SOURCE_HEALTH_SOURCES = [
    { source: 'polymarket', label: 'Polymarket' },
    { source: 'kalshi', label: 'Kalshi' },
    { source: 'predictit', label: 'PredictIt' },
    { source: 'limitless', label: 'Limitless' },
    { source: 'manifold', label: 'Manifold' },
] as const satisfies ReadonlyArray<{ readonly source: PredictionMarketSource; readonly label: string }>;

export type SourceHealthRow = {
    readonly source: PredictionMarketSource;
    readonly label: string;
    readonly status: string;
    readonly marketCount: number | null;
    readonly snapshotCount: number | null;
    readonly latestSnapshotAt: string | null;
    readonly staleAfterSeconds: number | null;
    readonly liveMarketCount: number | null;
    readonly syntheticMarketCount: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function emptyRow(source: PredictionMarketSource, label: string): SourceHealthRow {
    return {
        source,
        label,
        status: 'empty',
        marketCount: 0,
        snapshotCount: 0,
        latestSnapshotAt: null,
        staleAfterSeconds: null,
        liveMarketCount: 0,
        syntheticMarketCount: 0,
    };
}

function sourceConfig(value: unknown): (typeof SOURCE_HEALTH_SOURCES)[number] | null {
    if (typeof value !== 'string') return null;
    const normalized = value.toLowerCase();
    return SOURCE_HEALTH_SOURCES.find((item) => item.source === normalized) ?? null;
}

function parseHealthRow(value: unknown): SourceHealthRow | null {
    if (!isRecord(value)) return null;
    const config = sourceConfig(value.source);
    if (!config) return null;
    return {
        source: config.source,
        label: config.label,
        status: parseString(value.status)?.toLowerCase() ?? 'unknown',
        marketCount: parseNumber(value.market_count) ?? parseNumber(value.marketCount),
        snapshotCount: parseNumber(value.snapshot_count) ?? parseNumber(value.snapshotCount),
        latestSnapshotAt: parseString(value.latest_snapshot_at) ?? parseString(value.latestSnapshotAt),
        staleAfterSeconds: parseNumber(value.stale_after_seconds) ?? parseNumber(value.staleAfterSeconds),
        liveMarketCount: parseNumber(value.live_market_count),
        syntheticMarketCount: parseNumber(value.synthetic_market_count),
    };
}

function parseSourceHealth(value: unknown): readonly SourceHealthRow[] {
    const bodySources = isRecord(value) && Array.isArray(value.sources) ? value.sources : [];
    const parsed = bodySources
        .map(parseHealthRow)
        .filter((row): row is SourceHealthRow => row !== null);
    return SOURCE_HEALTH_SOURCES.map((config) =>
        parsed.find((row) => row.source === config.source) ?? emptyRow(config.source, config.label),
    );
}

export function sourceHealthStatusLabel(row: SourceHealthRow): string {
    if (row.status === 'error') return 'Error';
    if (row.status === 'loading') return 'Checking';
    const liveCount = row.liveMarketCount ?? Math.max(0, (row.marketCount ?? 0) - (row.syntheticMarketCount ?? 0));
    if (liveCount === 0 || row.status === 'empty' || row.status === 'no_data') return 'No data';
    if (row.status === 'synced' || row.status === 'healthy') return 'Healthy';
    if (row.status === 'stale') return 'Stale';
    return 'Unknown';
}

function chipClass(row: SourceHealthRow): string {
    const label = sourceHealthStatusLabel(row);
    if (label === 'Healthy') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    if (label === 'Stale' || label === 'Error') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    return 'border-default bg-[var(--bg-tertiary)] text-[var(--text-muted)]';
}

function countLabel(row: SourceHealthRow): string {
    const marketCount = row.liveMarketCount ?? row.marketCount ?? 0;
    const snapshotCount = row.snapshotCount ?? 0;
    if (row.status === 'error') return 'Source health request failed; availability is unknown';
    if (sourceHealthStatusLabel(row) === 'No data') return 'No fresh, genuine markets available; historical and synthetic records are not current odds';
    return `${marketCount} current markets · ${snapshotCount} recorded snapshots`;
}

async function fetchSourceHealth(): Promise<readonly SourceHealthRow[]> {
    const response = await fetch(`${API_BASE_URL}/prediction-markets/source-health`, {
        cache: 'no-store',
    });
    if (!response.ok) throw new Error(`source health API returned ${response.status}`);
    return parseSourceHealth(await response.json());
}

export function usePredictionMarketSourceHealth() {
    return useQuery({
        queryKey: ['prediction-market-source-health'],
        queryFn: fetchSourceHealth,
        staleTime: 60000,
        retry: false,
    });
}

export function PredictionMarketSourceHealthStrip() {
    const { data, isPending, isError } = usePredictionMarketSourceHealth();
    const rows = SOURCE_HEALTH_SOURCES.map((config) => {
        const row = data?.find((item) => item.source === config.source) ?? emptyRow(config.source, config.label);
        return isPending || isError ? { ...row, status: isError ? 'error' : 'loading' } : row;
    });

    return (
        <section
            aria-label="Prediction market source health"
            className="flex flex-wrap items-center gap-1.5 rounded-lg border border-default bg-[var(--bg-tertiary)] p-1.5"
        >
            <span className="px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Source health
            </span>
            {rows.map((row) => (
                <div
                    key={row.source}
                    aria-label={`${row.label} source health: ${sourceHealthStatusLabel(row)}`}
                    className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] ${chipClass(row)}`}
                    title={countLabel(row)}
                >
                    <span className="font-semibold text-[var(--text-primary)]">{row.label}</span>
                    <span>{sourceHealthStatusLabel(row)}</span>
                </div>
            ))}
        </section>
    );
}
