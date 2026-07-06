'use client';

import { colorblindClass } from './colorblind';

/**
 * ProbabilityGauge — semi-circle gauge for KPI tiles.
 *
 * Used in the redesigned MacroCalibrationWidget to show CPI / Fed /
 * Recession probability with the colour shifting from red through amber
 * to emerald as the value rises.
 */

export interface ProbabilityGaugeProps {
    readonly value: number;
    readonly label?: string;
    readonly sublabel?: string;
    readonly size?: number;
    readonly caption?: string;
}

function toneClass(value: number): string {
    if (value >= 0.66) return colorblindClass('positive');
    if (value >= 0.33) return colorblindClass('warning');
    return colorblindClass('negative');
}

function fillColour(value: number): string {
    if (value >= 0.66) return 'var(--cb-positive, #34d399)';
    if (value >= 0.33) return 'var(--cb-warning, #fbbf24)';
    return 'var(--cb-negative, #f87171)';
}

function arcPath(value: number, size: number, stroke: number): { d: string; cx: number; cy: number; r: number } {
    const clamped = Math.max(0, Math.min(1, value));
    const cx = size / 2;
    const cy = size / 2 + 6;
    const r = size / 2 - stroke / 2 - 4;
    const startX = cx - r;
    const startY = cy;
    const endAngle = Math.PI - Math.PI * clamped;
    const endX = cx - r * Math.cos(endAngle);
    const endY = cy - r * Math.sin(endAngle);
    const largeArc = clamped > 0.5 ? 1 : 0;
    const sweep = 0;
    return {
        d: `M ${startX.toFixed(2)} ${startY.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweep} ${endX.toFixed(2)} ${endY.toFixed(2)}`,
        cx,
        cy,
        r,
    };
}

export function ProbabilityGauge({
    value,
    label,
    sublabel,
    size = 120,
    caption,
}: ProbabilityGaugeProps) {
    const stroke = 10;
    const arc = arcPath(value, size, stroke);
    return (
        <div className="flex flex-col items-center gap-1">
            <svg
                width={size}
                height={size * 0.65}
                viewBox={`0 0 ${size} ${size * 0.65}`}
                role="img"
                aria-label={label ? `${label} ${Math.round(value * 100)}%` : `${Math.round(value * 100)} percent`}
            >
                <path
                    d={`M ${arc.cx - arc.r} ${arc.cy} A ${arc.r} ${arc.r} 0 1 0 ${arc.cx + arc.r} ${arc.cy}`}
                    fill="none"
                    stroke="var(--bg-tertiary)"
                    strokeWidth={stroke}
                    strokeLinecap="round"
                />
                <path
                    d={arc.d}
                    fill="none"
                    stroke={fillColour(value)}
                    strokeWidth={stroke}
                    strokeLinecap="round"
                />
                <text
                    x={arc.cx}
                    y={arc.cy - 2}
                    textAnchor="middle"
                    fontSize={size * 0.32}
                    fontWeight={700}
                    fill="var(--text-primary)"
                >
                    {Math.round(value * 100)}%
                </text>
                {label && (
                    <text
                        x={arc.cx}
                        y={arc.cy + size * 0.18}
                        textAnchor="middle"
                        fontSize={size * 0.13}
                        fill="var(--text-muted)"
                    >
                        {label}
                    </text>
                )}
            </svg>
            {(sublabel || caption) && (
                <div className={`text-[11px] ${toneClass(value)}`}>
                    {sublabel ?? caption}
                </div>
            )}
        </div>
    );
}