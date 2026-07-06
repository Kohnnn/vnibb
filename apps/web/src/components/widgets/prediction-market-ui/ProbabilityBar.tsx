'use client';

import { colorblindClass } from './colorblind';

/**
 * ProbabilityBar — horizontal progress-style bar.
 *
 * Renders a single probability (0..1) as a coloured bar. The colour is
 * derived from the value: low (red), mid (amber), high (emerald). Use
 * the optional ``delta`` to overlay a "now vs open" tick.
 */

export interface ProbabilityBarProps {
    readonly value: number;
    readonly delta?: number | null;
    readonly showLabels?: boolean;
    readonly height?: number;
}

function toneClass(value: number): string {
    if (value >= 0.7) return colorblindClass('positive');
    if (value >= 0.35) return colorblindClass('warning');
    return colorblindClass('negative');
}

function fillColour(value: number): string {
    if (value >= 0.7) return 'var(--cb-positive, #34d399)';
    if (value >= 0.35) return 'var(--cb-warning, #fbbf24)';
    return 'var(--cb-negative, #f87171)';
}

export function ProbabilityBar({ value, delta = null, showLabels = false, height = 8 }: ProbabilityBarProps) {
    const clamped = Math.max(0, Math.min(1, value));
    const pct = Math.round(clamped * 100);
    const tone = toneClass(clamped);
    return (
        <div className="flex flex-col gap-1">
            <div
                className="relative w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]"
                style={{ height }}
                role="meter"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                <div
                    className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-300"
                    style={{ width: `${pct}%`, backgroundColor: fillColour(clamped) }}
                />
                {delta !== null && Number.isFinite(delta) && Math.abs(delta) >= 0.005 && (
                    <span
                        className="absolute top-1/2 h-2 w-[2px] -translate-y-1/2 bg-white/40"
                        style={{ left: `calc(${Math.round(Math.max(0, Math.min(1, value - delta)) * 100)}% - 1px)` }}
                        aria-label={`Open ${Math.round((value - delta) * 100)}%`}
                    />
                )}
            </div>
            {showLabels && (
                <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                    <span className={tone}>Now {pct}%</span>
                    {delta !== null && Number.isFinite(delta) && (
                        <span className={delta >= 0 ? colorblindClass('positive') : colorblindClass('negative')}>
                            {delta >= 0 ? '+' : ''}
                            {(delta * 100).toFixed(1)}pp
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}