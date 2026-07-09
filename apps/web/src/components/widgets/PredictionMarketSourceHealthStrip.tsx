'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';
import type { PredictionMarketSource } from './PredictionMarketSource';

const SOURCE_HEALTH_SOURCES = [
    { source: 'polymarket', label: 'Polymarket' },
    { source: 'kalshi', label: 'Kalshi' },
    { source: 'predictit', label: 'PredictIt' },
    { source: 'limitless', label: 'Limitless' },
    { source: 'manifold', label: 'Manifold' },
] as const satisfies ReadonlyArray<{ readonly source: PredictionMarketSource; readonly label: string }>;

type SourceHealthRow = {
    readonly source: PredictionMarketSource;
    readonly label: string;
    readonly status: string;
    readonly marketCount: number | null;
    readonly snapshotCount: number | null;
    readonly latestSnapshotAt: string | null;
    readonly staleAfterSeconds: number | null;
};

type HealthState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error' }
    | { readonly kind: 'ready'; readonly rows: readonly SourceHealthRow[] };

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

function hasSnapshots(row: SourceHealthRow): boolean {
    return (row.snapshotCount ?? 0) > 0;
}

function statusLabel(row: SourceHealthRow): string {
    if (!hasSnapshots(row) || row.status === 'empty' || row.status === 'no_data') return 'Awaiting data';
    if (row.status === 'synced' || row.status === 'healthy') return 'Healthy';
    if (row.status === 'stale') return 'Stale';
    return 'Unknown';
}

function chipClass(row: SourceHealthRow): string {
    const label = statusLabel(row);
    if (label === 'Healthy') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    if (label === 'Stale') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    return 'border-default bg-[var(--bg-tertiary)] text-[var(--text-muted)]';
}

function countLabel(row: SourceHealthRow): string {
    const marketCount = row.marketCount ?? 0;
    const snapshotCount = row.snapshotCount ?? 0;
    if (snapshotCount === 0) return 'No snapshots yet';
    return `${marketCount} markets · ${snapshotCount} snapshots`;
}

export function PredictionMarketSourceHealthStrip() {
    const [state, setState] = useState<HealthState>({ kind: 'loading' });

    const refresh = useCallback(async () => {
        setState({ kind: 'loading' });
        try {
            const response = await fetch(`${API_BASE_URL}/prediction-markets/source-health`, {
                cache: 'no-store',
            });
            if (!response.ok) {
                setState({ kind: 'error' });
                return;
            }
            setState({ kind: 'ready', rows: parseSourceHealth(await response.json()) });
        } catch (error: unknown) {
            if (error instanceof Error) {
                setState({ kind: 'error' });
                return;
            }
            setState({ kind: 'error' });
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    if (state.kind === 'loading') {
        return (
            <div className="rounded-lg border border-dashed border-default bg-[var(--bg-tertiary)] px-2 py-1.5 text-[11px] text-[var(--text-muted)]">
                Checking source health...
            </div>
        );
    }

    if (state.kind === 'error') {
        return (
            <div className="rounded-lg border border-dashed border-default bg-[var(--bg-tertiary)] px-2 py-1.5 text-[11px] text-[var(--text-muted)]">
                Source health unavailable
            </div>
        );
    }

    return (
        <section
            aria-label="Prediction market source health"
            className="flex flex-wrap items-center gap-1.5 rounded-lg border border-default bg-[var(--bg-tertiary)] p-1.5"
        >
            <span className="px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Source health
            </span>
            {state.rows.map((row) => (
                <div
                    key={row.source}
                    aria-label={`${row.label} source health: ${statusLabel(row)}`}
                    className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] ${chipClass(row)}`}
                    title={countLabel(row)}
                >
                    <span className="font-semibold text-[var(--text-primary)]">{row.label}</span>
                    <span>{statusLabel(row)}</span>
                </div>
            ))}
        </section>
    );
}
