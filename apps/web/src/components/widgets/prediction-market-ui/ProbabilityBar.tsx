'use client';


/**
 * ProbabilityBar — horizontal progress-style bar.
 *
 * Renders a single probability (0..1). Probability is not a gain or loss;
 * the bar uses the accent and the optional delta marks "now vs open".
 */

export interface ProbabilityBarProps {
    readonly value: number;
    readonly delta?: number | null;
    readonly showLabels?: boolean;
    readonly height?: number;
}


export function ProbabilityBar({ value, delta = null, showLabels = false, height = 8 }: ProbabilityBarProps) {
    const clamped = Math.max(0, Math.min(1, value));
    const pct = Math.round(clamped * 100);
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
                    style={{ width: `${pct}%`, backgroundColor: 'var(--color-accent-primary)' }}
                />
                {delta !== null && Number.isFinite(delta) && Math.abs(delta) >= 0.005 && (
                    <span
                        className="absolute top-1/2 h-2 w-[2px] -translate-y-1/2 bg-[var(--text-primary)]"
                        style={{ left: `calc(${Math.round(Math.max(0, Math.min(1, value - delta)) * 100)}% - 1px)` }}
                        aria-label={`Open ${Math.round((value - delta) * 100)}%`}
                    />
                )}
            </div>
            {showLabels && (
                <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                    <span className="text-[var(--text-primary)]">Now {pct}%</span>
                    {delta !== null && Number.isFinite(delta) && (
                        <span className="text-[var(--text-secondary)]">
                            {delta >= 0 ? '+' : ''}
                            {(delta * 100).toFixed(1)}pp
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}