'use client';

import { useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { ChartSizeBox } from '@/components/ui/ChartSizeBox';
import { Sparkline } from '@/components/ui/Sparkline';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { useHistoricalPrices, useQuantMetrics } from '@/lib/queries';
import { QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods';
import { cn } from '@/lib/utils';
import type { OHLCData } from '@/lib/chartUtils';

interface RiskDashboardWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatSigned(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}${suffix}`;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function computeHurstFromPrices(prices: number[]): number | null {
  if (prices.length < 120) return null;

  const logPrices = prices.map((price) => Math.log(price)).filter((value) => Number.isFinite(value));
  if (logPrices.length < 120) return null;

  const lags = Array.from({ length: 24 }, (_, index) => index + 2);
  const pairs: Array<{ lag: number; tau: number }> = [];

  for (const lag of lags) {
    const diffs: number[] = [];
    for (let index = lag; index < logPrices.length; index += 1) {
      diffs.push(logPrices[index] - logPrices[index - lag]);
    }
    const tau = std(diffs);
    if (Number.isFinite(tau) && tau > 0) {
      pairs.push({ lag, tau });
    }
  }

  if (pairs.length < 6) return null;

  const x = pairs.map((pair) => Math.log(pair.lag));
  const y = pairs.map((pair) => Math.log(pair.tau));
  const xMean = average(x);
  const yMean = average(y);
  if (xMean === null || yMean === null) return null;

  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < x.length; index += 1) {
    numerator += (x[index] - xMean) * (y[index] - yMean);
    denominator += (x[index] - xMean) ** 2;
  }

  if (!Number.isFinite(denominator) || denominator === 0) return null;
  const hurst = (numerator / denominator) * 2;
  if (!Number.isFinite(hurst)) return null;

  return Math.max(0, Math.min(1, hurst));
}

function classifyHurst(hurst: number | null): { label: string; tone: string } {
  if (hurst === null) return { label: 'Insufficient Data', tone: 'text-[var(--text-secondary)]' };
  if (hurst > 0.55) return { label: 'Trending', tone: 'text-emerald-300' };
  if (hurst < 0.45) return { label: 'Mean-Reverting', tone: 'text-amber-300' };
  return { label: 'Random Walk', tone: 'text-cyan-300' };
}

function riskGrade(score: number): { label: string; tone: string } {
  if (score >= 80) return { label: 'Low Risk', tone: 'text-emerald-300' };
  if (score >= 60) return { label: 'Balanced', tone: 'text-cyan-300' };
  if (score >= 40) return { label: 'Elevated', tone: 'text-amber-300' };
  return { label: 'High Risk', tone: 'text-rose-300' };
}

export function RiskDashboardWidget({ id, symbol, onRemove }: RiskDashboardWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || '';
  const [period, setPeriod] = useState<QuantPeriodOption>('1Y');

  const quantQuery = useQuantMetrics(upperSymbol, {
    period,
    metrics: ['drawdown_recovery', 'parkinson_volatility', 'sortino'],
    enabled: Boolean(upperSymbol),
  });
  const historyQuery = useHistoricalPrices(upperSymbol, {
    startDate: new Date(Date.now() - 8 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    adjustmentMode: 'adjusted',
    enabled: Boolean(upperSymbol),
  });

  const priceSeries = ((historyQuery.data?.data || []) as OHLCData[])
    .slice()
    .sort((left, right) => new Date(String(left.time)).getTime() - new Date(String(right.time)).getTime());

  const metrics = quantQuery.data?.data?.metrics || {};
  const drawdown = metrics.drawdown_recovery as Record<string, any> | undefined;
  const parkinson = metrics.parkinson_volatility as Record<string, any> | undefined;
  const sortino = metrics.sortino as Record<string, any> | undefined;

  const sortinoAverage = average(
    Object.values(sortino?.monthly_sortino || {}).filter((value): value is number => typeof value === 'number')
  );
  const underwaterSeries = (drawdown?.underwater_series || []).map((point: any) => Number(point.drawdown_pct)).filter(Number.isFinite);
  const hurst = useMemo(
    () => computeHurstFromPrices(priceSeries.map((candle) => Number(candle.close)).filter(Number.isFinite)),
    [priceSeries]
  );
  const hurstState = classifyHurst(hurst);

  const riskComputation = useMemo(() => {
    const drawdownPenalty = Math.min(Math.abs(Number(drawdown?.max_drawdown_from_52w_high_pct || 0)) * 1.1, 35);
    const volatilityPenalty = Math.min(Number(parkinson?.current_parkinson_vol_30d_pct || 0), 30);
    const sortinoPenalty = sortinoAverage === null ? 12 : Math.min(Math.max(2 - sortinoAverage, 0) * 12, 20);
    const hurstPenalty = hurst === null ? 8 : Math.abs(hurst - 0.5) < 0.08 ? 6 : 0;
    const score = Math.max(0, Math.min(100, Math.round(100 - drawdownPenalty - volatilityPenalty - sortinoPenalty - hurstPenalty)));

    return {
      score,
      drivers: [
        { label: 'Drawdown Stress', value: drawdownPenalty, tone: 'text-rose-300' },
        { label: 'Volatility Stress', value: volatilityPenalty, tone: 'text-amber-300' },
        { label: 'Sortino Penalty', value: sortinoPenalty, tone: 'text-cyan-300' },
        { label: 'Structure Penalty', value: hurstPenalty, tone: 'text-violet-300' },
      ],
    }
  }, [drawdown?.max_drawdown_from_52w_high_pct, parkinson?.current_parkinson_vol_30d_pct, sortinoAverage, hurst]);

  const riskScore = riskComputation.score
  const scoreLabel = riskGrade(riskScore);
  const hasData = Boolean(drawdown || parkinson || sortino || hurst !== null);
  const isLoading = (quantQuery.isLoading || historyQuery.isLoading) && !hasData;
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading, { timeoutMs: 10_000 });
  const warningMessage = quantQuery.data?.data?.warning || null;
  const latestDataDate = quantQuery.data?.data?.last_data_date ?? historyQuery.data?.data?.at(-1)?.time ?? null;

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to inspect risk" icon={<ShieldAlert size={18} />} />;
  }

  const exportRows = [
    {
      symbol: upperSymbol,
      period,
      risk_score: riskScore,
      risk_label: scoreLabel.label,
      max_drawdown_pct: drawdown?.max_drawdown_from_52w_high_pct ?? null,
      parkinson_vol_pct: parkinson?.current_parkinson_vol_30d_pct ?? null,
      avg_sortino: sortinoAverage,
      hurst,
    },
  ];

  return (
    <WidgetContainer
      title="Risk Dashboard"
      symbol={upperSymbol}
      widgetId={id}
      onClose={onRemove}
      onRefresh={() => {
        resetTimeout();
        void quantQuery.refetch();
        void historyQuery.refetch();
      }}
      noPadding
      exportData={exportRows}
      exportFilename={`risk_dashboard_${upperSymbol}_${period.toLowerCase()}`}
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5">
            {QUANT_PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                  period === option
                    ? 'bg-blue-600 text-white'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <WidgetMeta
            updatedAt={quantQuery.data?.data?.last_data_date ?? quantQuery.data?.data?.computed_at ?? historyQuery.dataUpdatedAt}
            isFetching={(quantQuery.isFetching || historyQuery.isFetching) && hasData}
            note={`${period} composite view · adjusted history`}
            align="right"
          />
        </div>

        {timedOut && isLoading ? (
          <WidgetError
            title="Loading timed out"
            error={new Error('Risk dashboard data took too long to load.')}
            onRetry={() => {
              resetTimeout();
              void quantQuery.refetch();
              void historyQuery.refetch();
            }}
          />
        ) : isLoading ? (
          <WidgetSkeleton lines={8} />
        ) : quantQuery.error && !hasData ? (
          <WidgetError error={quantQuery.error as Error} onRetry={() => quantQuery.refetch()} />
        ) : historyQuery.error && !hasData ? (
          <WidgetError error={historyQuery.error as Error} onRetry={() => historyQuery.refetch()} />
        ) : !hasData ? (
          <WidgetEmpty message="Risk metrics not available yet" icon={<ShieldAlert size={18} />} />
        ) : (
          <div className="flex h-full flex-col gap-3">
            {warningMessage ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">
                {warningMessage}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 xl:col-span-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Composite Risk Score</div>
                <div className={`mt-1 text-2xl font-black ${scoreLabel.tone}`}>{riskScore}</div>
                <div className={`mt-1 text-sm font-semibold ${scoreLabel.tone}`}>{scoreLabel.label}</div>
                <div className="mt-2 text-[11px] text-[var(--text-secondary)]">
                  Built from drawdown stress, Parkinson volatility, monthly Sortino quality, and Hurst structure.
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Max Drawdown</div>
                <div className="mt-1 text-lg font-semibold text-rose-300">{formatSigned(drawdown?.max_drawdown_from_52w_high_pct, '%')}</div>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Volatility Regime</div>
                <div className="mt-1 text-lg font-semibold text-cyan-300">{parkinson?.current_regime || '—'}</div>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Hurst</div>
                <div className={`mt-1 text-lg font-semibold ${hurstState.tone}`}>{hurstState.label}</div>
                <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{hurst === null ? 'Needs more price history' : `Value ${hurst.toFixed(3)} from long-run price structure`}</div>
              </div>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Underwater Curve</div>
                  <div className="text-[10px] text-[var(--text-secondary)]">Last {underwaterSeries.length || 0} observations</div>
                </div>
                {underwaterSeries.length < 2 ? (
                  <WidgetEmpty message="Drawdown history is still sparse" size="compact" />
                ) : (
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
                    <ChartSizeBox className="w-full" minHeight={88}>
                      {({ width, height }) => (
                        <Sparkline data={underwaterSeries} width={width} height={Math.max(72, height)} color="red" />
                      )}
                    </ChartSizeBox>
                    <div className="mt-2 text-[11px] text-[var(--text-secondary)]">
                      Current drawdown: {formatSigned(drawdown?.current_drawdown_pct, '%')} • Average recovery: {formatSigned(drawdown?.avg_days_to_recovery, 'd')}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Sortino Quality</div>
                  <div className="mt-1 text-lg font-semibold text-emerald-300">{formatSigned(sortinoAverage)}</div>
                  <div className="mt-2 text-[11px] text-[var(--text-secondary)]">
                    Best months: {(sortino?.best_months || []).join(', ') || '—'}
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    Avoid months: {(sortino?.avoid_months || []).join(', ') || '—'}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Score Drivers</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[var(--text-secondary)]">
                    {riskComputation.drivers.map((driver) => (
                      <div key={driver.label} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-2">
                        <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">{driver.label}</div>
                        <div className={cn('mt-1 font-mono', driver.tone)}>-{driver.value.toFixed(1)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Volatility Stack</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[var(--text-secondary)]">
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-2">
                      <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Parkinson 30D</div>
                      <div className="mt-1 font-mono text-cyan-300">{formatSigned(parkinson?.current_parkinson_vol_30d_pct, '%')}</div>
                    </div>
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-2">
                      <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Close/Range</div>
                      <div className="mt-1 font-mono text-[var(--text-primary)]">{formatSigned(parkinson?.close_to_park_ratio)}</div>
                    </div>
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-2">
                      <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">52W Drawdown</div>
                      <div className="mt-1 font-mono text-rose-300">{formatSigned(drawdown?.current_drawdown_from_52w_high_pct, '%')}</div>
                    </div>
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-2">
                      <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Hurst Value</div>
                      <div className="mt-1 font-mono text-[var(--text-primary)]">{hurst === null ? '—' : hurst.toFixed(3)}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-[11px] text-[var(--text-secondary)]">
                    Latest input date: {latestDataDate ? String(latestDataDate).slice(0, 10) : '—'} • Hurst uses long-run price history for context.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </WidgetContainer>
  );
}

export default RiskDashboardWidget;
