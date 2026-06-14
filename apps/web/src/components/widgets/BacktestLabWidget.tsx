'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import { useQuantBacktest } from '@/lib/queries';
import { buildQuantRuntime, extractQuantWarning } from '@/lib/quantWidgetHelpers';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import type { QuantPeriod } from '@/lib/api';

interface BacktestLabWidgetProps {
  symbol: string;
  onDataChange?: (data: WidgetDataPayload) => void;
}

function formatNumber(value: unknown, suffix = ''): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return `${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
}

export function BacktestLabWidget({ symbol, onDataChange }: BacktestLabWidgetProps) {
  const [period, setPeriod] = useState<QuantPeriod>('5Y');
  const [fastWindow, setFastWindow] = useState(20);
  const [slowWindow, setSlowWindow] = useState(50);
  const upperSymbol = symbol?.toUpperCase() || '';
  const invalidWindows = fastWindow >= slowWindow;
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuantBacktest(upperSymbol, {
    period,
    fastWindow,
    slowWindow,
    enabled: Boolean(upperSymbol) && !invalidWindows,
  });
  const payload = data?.data;
  const metrics = payload?.metrics ?? {};
  const trades = payload?.trades ?? [];
  const warnings = payload?.warnings ?? [];
  const warning = useMemo(() => extractQuantWarning(data) || warnings[0] || null, [data, warnings]);
  const hasData = Boolean(payload);

  useEffect(() => {
    onDataChange?.(buildQuantRuntime({
      symbol: upperSymbol,
      empty: !hasData,
      endpoint: `/quant/${upperSymbol}/backtest`,
      sourceLabel: 'VNIBB quant backtest',
      response: data,
      extra: {
        period,
        fast_window: fastWindow,
        slow_window: slowWindow,
        trade_count: metrics.trade_count ?? null,
        warning,
      },
    }));
  }, [data?.meta?.last_data_date, dataUpdatedAt, fastWindow, hasData, metrics.trade_count, onDataChange, payload?.last_data_date, period, slowWindow, upperSymbol, warning]);

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to run a backtest" icon={<Activity size={18} />} />;
  }

  if (invalidWindows) {
    return <WidgetEmpty message="Fast MA must be smaller than slow MA" icon={<AlertTriangle size={18} />} />;
  }

  if (isLoading && !hasData) {
    return <WidgetSkeleton lines={6} />;
  }

  if (error && !hasData) {
    return <WidgetError title="Backtest unavailable" error={error as Error} onRetry={() => refetch()} />;
  }

  if (!hasData) {
    return <WidgetEmpty message={`No backtest data for ${upperSymbol}`} icon={<Activity size={18} />} />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <WidgetMeta updatedAt={payload?.last_data_date || dataUpdatedAt} isFetching={isFetching && hasData} isCached={Boolean(error && hasData)} note="MA crossover backtest" align="right" />

      <div className="mb-2 grid grid-cols-3 gap-2 text-[11px]">
        <Select label="Period" value={period} onChange={(value) => setPeriod(value as QuantPeriod)} options={['1Y', '3Y', '5Y', 'ALL']} />
        <NumberInput label="Fast MA" value={fastWindow} min={2} max={250} onChange={setFastWindow} />
        <NumberInput label="Slow MA" value={slowWindow} min={3} max={500} onChange={setSlowWindow} />
      </div>

      {warning && (
        <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
          {warning}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Return" value={formatNumber(metrics.total_return_pct, '%')} tone={(metrics.total_return_pct ?? 0) >= 0 ? 'good' : 'bad'} />
        <Metric label="Max DD" value={formatNumber(metrics.max_drawdown_pct, '%')} tone="bad" />
        <Metric label="Sharpe" value={formatNumber(metrics.sharpe_daily_rf0)} />
        <Metric label="Trades" value={formatNumber(metrics.trade_count)} />
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="grid grid-cols-4 border-b border-[var(--border-subtle)] px-3 py-2 text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">
          <span>Entry</span><span>Exit</span><span>Return</span><span>PnL</span>
        </div>
        {trades.slice(0, 8).map((trade, index) => (
          <div key={`${trade.entry_date}-${index}`} className="grid grid-cols-4 gap-2 border-b border-[var(--border-subtle)] px-3 py-2 text-xs last:border-b-0">
            <span className="truncate text-[var(--text-secondary)]">{trade.entry_date || '-'}</span>
            <span className="truncate text-[var(--text-secondary)]">{trade.exit_date || trade.status || '-'}</span>
            <span className={(trade.return_pct ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}>{formatNumber(trade.return_pct, '%')}</span>
            <span className={(trade.pnl ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}>{formatNumber(trade.pnl)}</span>
          </div>
        ))}
        {trades.length === 0 && <div className="px-3 py-4 text-xs text-[var(--text-muted)]">No completed trades in this window.</div>}
      </div>

      <p className="mt-2 text-[9px] leading-3 text-[var(--text-muted)]">
        Educational schema-based backtest. Close-price execution, all-in/all-out, fees included. Not trading advice.
      </p>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const toneClass = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-[var(--text-primary)]';
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/50 px-3 py-2">
      <div className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">{label}</div>
      <div className={`mt-1 text-sm font-bold ${toneClass}`}>{value}</div>
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

function NumberInput({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">{label}</span>
      <input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]" />
    </label>
  );
}

export default BacktestLabWidget;
