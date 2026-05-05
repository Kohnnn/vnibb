'use client';

import { useMemo } from 'react';

import { EMPTY_VALUE, formatPercent } from '@/lib/units';
import type { CashFlowWaterfallModel } from '@/lib/financialVisualizations';

interface CashFlowWaterfallChartProps {
  model: CashFlowWaterfallModel;
  formatValue: (value: number) => string;
}

const SVG_WIDTH = 920;
const SVG_HEIGHT = 400;
const CHART_LEFT = 70;
const CHART_RIGHT = 860;
const CHART_TOP = 46;
const CHART_BOTTOM = 310;
const BAR_MAX_WIDTH = 96;
const BAR_MIN_WIDTH = 52;

function splitLabel(label: string): string[] {
  if (label.length <= 12 || !label.includes(' ')) return [label];

  const parts = label.split(' ')
  const midpoint = Math.ceil(parts.length / 2)
  return [parts.slice(0, midpoint).join(' '), parts.slice(midpoint).join(' ')].filter(Boolean)
}

function formatDelta(changePct: number | null | undefined): string {
  if (changePct === null || changePct === undefined) return '';
  const formatted = formatPercent(changePct, { decimals: 1, input: 'percent', clamp: 'yoy_change' });
  return formatted === EMPTY_VALUE ? '' : `${changePct > 0 ? '+' : ''}${formatted}`;
}

export function CashFlowWaterfallChart({ model, formatValue }: CashFlowWaterfallChartProps) {
  const { maxValue, minValue, steps, summary } = model;

  const laidOut = useMemo(() => {
    const extentMax = maxValue === minValue ? maxValue + 1 : maxValue;
    const extentMin = maxValue === minValue ? minValue - 1 : minValue;
    const range = extentMax - extentMin;
    const availableWidth = CHART_RIGHT - CHART_LEFT;
    const barWidth = steps.length
      ? Math.max(BAR_MIN_WIDTH, Math.min(BAR_MAX_WIDTH, availableWidth / Math.max(steps.length, 1) - 18))
      : BAR_MAX_WIDTH;
    const totalBarsWidth = barWidth * steps.length;
    const xGap = steps.length > 1 ? Math.max((availableWidth - totalBarsWidth) / (steps.length - 1), 10) : 0;

    const scaleY = (value: number) => CHART_BOTTOM - ((value - extentMin) / range) * (CHART_BOTTOM - CHART_TOP);

    return {
      zeroY: scaleY(0),
      bars: steps.map((step, index) => {
        const x = CHART_LEFT + index * (barWidth + xGap);
        const topY = scaleY(Math.max(step.start, step.end));
        const bottomY = scaleY(Math.min(step.start, step.end));
        return {
          ...step,
          x,
          width: barWidth,
          topY,
          bottomY,
          zeroY: scaleY(0),
          connectorY: scaleY(step.end),
        };
      }),
      ticks: [extentMin, (extentMin + extentMax) / 2, extentMax],
      scaleY,
    };
  }, [maxValue, minValue, steps]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <SummaryCard label="Free Cash Flow" value={summary.freeCashFlow !== null ? formatValue(summary.freeCashFlow) : EMPTY_VALUE} tone="text-emerald-300" />
        <SummaryCard label="CapEx" value={summary.capex !== null ? formatValue(summary.capex) : EMPTY_VALUE} tone="text-amber-300" />
        <SummaryCard label="Dividends" value={summary.dividends !== null ? formatValue(summary.dividends) : EMPTY_VALUE} tone="text-cyan-300" />
        <SummaryCard label="Net Change" value={formatValue(summary.netChange)} tone="text-blue-300" />
      </div>

      <div className="min-h-[340px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
        <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
          Bridge from operating cash flow to net cash change
        </div>
        <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="h-full w-full">
          <line x1={CHART_LEFT - 10} y1={laidOut.zeroY} x2={CHART_RIGHT + 30} y2={laidOut.zeroY} stroke="rgba(148,163,184,0.35)" strokeDasharray="4 4" />

          {laidOut.ticks.map((tick, index) => (
            <g key={`tick-${index}`}>
              <line x1={CHART_LEFT - 6} y1={laidOut.scaleY(tick)} x2={CHART_RIGHT + 16} y2={laidOut.scaleY(tick)} stroke="rgba(71,85,105,0.18)" />
              <text x={8} y={laidOut.scaleY(tick) + 4} fill="var(--text-muted)" fontSize="11">
                {formatValue(tick)}
              </text>
            </g>
          ))}

          {laidOut.bars.map((bar, index) => {
            const delta = formatDelta(bar.changePct);
            const fill = bar.tone === 'total'
              ? '#2563eb'
              : bar.value >= 0
                ? '#16a34a'
                : '#ef4444';

            return (
              <g key={bar.id}>
                {index > 0 && bar.tone !== 'total' ? (
                  <line
                    x1={laidOut.bars[index - 1].x + laidOut.bars[index - 1].width}
                    y1={laidOut.bars[index - 1].connectorY}
                    x2={bar.x}
                    y2={laidOut.bars[index - 1].connectorY}
                    stroke="rgba(148,163,184,0.45)"
                    strokeDasharray="4 3"
                  />
                ) : null}

                <rect
                  x={bar.x}
                  y={bar.topY}
                  width={bar.width}
                  height={Math.max(bar.bottomY - bar.topY, 2)}
                  rx={8}
                  fill={fill}
                  opacity={0.92}
                />

                <text x={bar.x + bar.width / 2} y={bar.topY - 8} textAnchor="middle" fill="var(--text-primary)" fontSize="12" fontWeight="600">
                  {formatValue(bar.value)}
                </text>
                {delta ? (
                  <text x={bar.x + bar.width / 2} y={bar.topY - 22} textAnchor="middle" fill="var(--text-secondary)" fontSize="11">
                    {delta}
                  </text>
                ) : null}
                {splitLabel(bar.label).map((line, lineIndex) => (
                  <text
                    key={`${bar.id}-label-${lineIndex}`}
                    x={bar.x + bar.width / 2}
                    y={CHART_BOTTOM + 22 + lineIndex * 13}
                    textAnchor="middle"
                    fill="var(--text-muted)"
                    fontSize="11"
                    fontWeight="600"
                  >
                    {line}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

export default CashFlowWaterfallChart;
