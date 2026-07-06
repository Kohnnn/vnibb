'use client';

import { colorblindClass } from './colorblind';

/**
 * Sparkline — small inline SVG line chart.
 *
 * Used in TopMoversPulseWidget, PredictionMarketDrawer, PredictionAlertsWidget.
 * No chart library dep. Renders N points normalised into a width×height SVG
 * and uses a positive/negative stroke colour based on the overall trend.
 */

export interface SparklineProps {
    readonly values: readonly number[];
    readonly width?: number;
    readonly height?: number;
    readonly min?: number;
    readonly max?: number;
    readonly ariaLabel?: string;
}

export function Sparkline({
    values,
    width = 80,
    height = 24,
    min,
    max,
    ariaLabel,
}: SparklineProps) {
    if (values.length < 2) {
        return (
            <svg
                width={width}
                height={height}
                role="img"
                aria-label={ariaLabel ?? 'no data'}
                className="text-[var(--text-muted)]"
            >
                <line
                    x1={2}
                    y1={height / 2}
                    x2={width - 2}
                    y2={height / 2}
                    stroke="currentColor"
                    strokeOpacity={0.4}
                    strokeDasharray="2 3"
                />
            </svg>
        );
    }
    const lo = min ?? Math.min(...values);
    const hi = max ?? Math.max(...values);
    const span = hi - lo || 0.01;
    const xStep = width / (values.length - 1);
    const points = values
        .map((value, index) => {
            const x = index * xStep;
            const y = height - ((value - lo) / span) * (height - 2) - 1;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
    const direction = values[values.length - 1] >= values[0] ? 'positive' : 'negative';
    const stroke =
        direction === 'positive'
            ? 'var(--cb-positive, #34d399)'
            : 'var(--cb-negative, #f87171)';
    const strokeClass = direction === 'positive' ? colorblindClass('positive') : colorblindClass('negative');
    const lastPoint = values[values.length - 1];
    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={ariaLabel ?? `sparkline from ${values[0].toFixed(2)} to ${lastPoint.toFixed(2)}`}
            className={strokeClass}
        >
            <polyline
                points={points}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle
                cx={(values.length - 1) * xStep}
                cy={height - ((lastPoint - lo) / span) * (height - 2) - 1}
                r={1.6}
                fill={stroke}
            />
        </svg>
    );
}