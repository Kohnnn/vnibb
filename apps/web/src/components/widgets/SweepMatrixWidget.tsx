'use client';

import { useEffect, useMemo, useState } from 'react';
import { Grid3X3, AlertTriangle } from 'lucide-react';
import { useQuantSweep } from '@/lib/queries';
import { buildQuantRuntime, extractQuantWarning } from '@/lib/quantWidgetHelpers';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import type { QuantPeriod, QuantSweepCell, QuantSweepRequest } from '@/lib/api';

interface SweepMatrixWidgetProps {
  symbol: string;
  onDataChange?: (data: WidgetDataPayload) => void;
}

const FAST_SETS = {
  compact: [10, 20, 50],
  short: [5, 10, 20],
  trend: [20, 50, 100],
};

const SLOW_SETS = {
  compact: [50, 100, 200],
  short: [20, 50, 100],
  trend: [100, 150, 200],
};

type SweepPreset = keyof typeof FAST_SETS;

function formatNumber(value: unknown, suffix = ''): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return `${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
}

function metricValue(cell: QuantSweepCell | undefined, objective: NonNullable<QuantSweepRequest['objective']>): number | null {
  const value = cell?.[objective];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function SweepMatrixWidget({ symbol, onDataChange }: SweepMatrixWidgetProps) {
  const [period, setPeriod] = useState<QuantPeriod>('5Y');
  const [preset, setPreset] = useState<SweepPreset>('compact');
  const [objective, setObjective] = useState<NonNullable<QuantSweepRequest['objective']>>('sharpe_daily_rf0');
  const upperSymbol = symbol?.toUpperCase() || '';
  const fastWindows = FAST_SETS[preset];
  const slowWindows = SLOW_SETS[preset];
  const hasValidCombo = fastWindows.some((fast) => slowWindows.some((slow) => fast < slow));
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuantSweep(upperSymbol, {
    period,
    fastWindows,
    slowWindows,
    objective,
    enabled: Boolean(upperSymbol) && hasValidCombo,
  });
  const payload = data?.data;
  const cells = payload?.cells ?? [];
  const warnings = payload?.warnings ?? [];
  const warning = useMemo(() => extractQuantWarning(data) || warnings[0] || null, [data, warnings]);
  const hasData = Boolean(payload);

  useEffect(() => {
    onDataChange?.(buildQuantRuntime({
      symbol: upperSymbol,
      empty: !hasData,
      endpoint: `/quant/${upperSymbol}/sweep`,
      sourceLabel: 'VNIBB quant sweep',
      response: data,
      extra: {
        period,
        preset,
        objective,
        cell_count: cells.length,
        best: payload?.best ?? null,
        warning,
      },
    }));
  }, [cells.length, data, dataUpdatedAt, hasData, objective, onDataChange, payload?.best, period, preset, upperSymbol, warning]);

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to run a sweep" icon={<Grid3X3 size={18} />} />;
  }

  if (!hasValidCombo) {
    return <WidgetEmpty message="At least one fast MA must be smaller than one slow MA" icon={<AlertTriangle size={18} />} />;
  }

  if (isLoading && !hasData) {
    return <WidgetSkeleton lines={7} />;
  }

  if (error && !hasData) {
    return <WidgetError title="Sweep unavailable" error={error as Error} onRetry={() => refetch()} />;
  }

  if (!hasData) {
    return <WidgetEmpty message={`No sweep data for ${upperSymbol}`} icon={<Grid3X3 size={18} />} />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <WidgetMeta updatedAt={payload?.last_data_date || dataUpdatedAt} isFetching={isFetching && hasData} isCached={Boolean(error && hasData)} note="MA parameter sweep" align="right" />

      <div className="mb-2 grid grid-cols-3 gap-2 text-[11px]">
        <Select label="Period" value={period} onChange={(value) => setPeriod(value as QuantPeriod)} options={['1Y', '3Y', '5Y', 'ALL']} />
        <Select label="Grid" value={preset} onChange={(value) => setPreset(value as SweepPreset)} options={['compact', 'short', 'trend']} />
        <Select label="Rank" value={objective} onChange={(value) => setObjective(value as NonNullable<QuantSweepRequest['objective']>)} options={['sharpe_daily_rf0', 'total_return_pct', 'annualized_return_pct', 'max_drawdown_pct']} />
      </div>

      {warning && (
        <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
          {warning}
        </div>
      )}

      {payload?.best && (
        <div className="mb-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">
          <div className="text-[9px] font-black uppercase tracking-widest text-emerald-300">Best by {objective.replace(/_/g, ' ')}</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[var(--text-primary)]">
            <span>{payload.best.fast_window}/{payload.best.slow_window} MA</span>
            <span>Return {formatNumber(payload.best.total_return_pct, '%')}</span>
            <span>Sharpe {formatNumber(payload.best.sharpe_daily_rf0)}</span>
            <span>DD {formatNumber(payload.best.max_drawdown_pct, '%')}</span>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="grid border-b border-[var(--border-subtle)] text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]" style={{ gridTemplateColumns: `64px repeat(${slowWindows.length}, minmax(72px, 1fr))` }}>
          <div className="px-2 py-2">Fast\Slow</div>
          {slowWindows.map((slow) => <div key={slow} className="px-2 py-2 text-right">{slow}</div>)}
        </div>
        {fastWindows.map((fast) => (
          <div key={fast} className="grid border-b border-[var(--border-subtle)] last:border-b-0" style={{ gridTemplateColumns: `64px repeat(${slowWindows.length}, minmax(72px, 1fr))` }}>
            <div className="px-2 py-3 text-xs font-bold text-[var(--text-secondary)]">{fast}</div>
            {slowWindows.map((slow) => {
              const cell = cells.find((item) => item.fast_window === fast && item.slow_window === slow);
              const value = metricValue(cell, objective);
              const invalid = fast >= slow;
              const tone = objective === 'max_drawdown_pct'
                ? (value ?? 0) > -15
                : (value ?? 0) >= 0;
              return (
                <div key={`${fast}-${slow}`} className="px-2 py-2 text-right text-xs">
                  {invalid ? <span className="text-[var(--text-muted)]">-</span> : (
                    <div className={tone ? 'text-emerald-300' : 'text-red-300'}>
                      <div className="font-bold">{formatNumber(value, objective.includes('pct') ? '%' : '')}</div>
                      <div className="text-[9px] text-[var(--text-muted)]">{formatNumber(cell?.trade_count)} trades</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <p className="mt-2 text-[9px] leading-3 text-[var(--text-muted)]">
        Educational bounded grid search over moving-average parameters. Descriptive only, not trading advice.
      </p>
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]">
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

export default SweepMatrixWidget;
